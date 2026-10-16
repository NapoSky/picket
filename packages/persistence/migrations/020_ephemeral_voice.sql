-- Durable configuration, private drafts and operational voice lifecycle state.
ALTER TABLE guild_settings ALTER COLUMN features SET DEFAULT '{"timers":true,"todolists":true,"warlog":false,"voice":true}';
-- Existing feature triggers read tenant-scoped member roles, including when only
-- an unrelated feature changes. Keep each update in its guild's RLS context.
DO $$
DECLARE target text; previous text := current_setting('app.guild_id', true);
BEGIN
  FOR target IN SELECT guild_id FROM guild_settings WHERE NOT features ? 'voice' LOOP
    PERFORM set_config('app.guild_id', target, true);
    UPDATE guild_settings SET features = features || '{"voice":true}'::jsonb WHERE guild_id = target;
  END LOOP;
  PERFORM set_config('app.guild_id', COALESCE(previous, ''), true);
END $$;
CREATE TABLE voice_settings (
  guild_id text PRIMARY KEY REFERENCES guild_registry(guild_id) ON DELETE CASCADE,
  deployment_limit integer NOT NULL DEFAULT 6 CHECK (deployment_limit BETWEEN 1 AND 10)
);
CREATE TABLE voice_templates (
  id text PRIMARY KEY, guild_id text NOT NULL REFERENCES guild_registry(guild_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  category_id text NOT NULL, channel_name text NOT NULL CHECK (length(channel_name) BETWEEN 1 AND 90),
  capacity integer NOT NULL DEFAULT 99 CHECK (capacity BETWEEN 1 AND 99),
  idle_minutes integer NOT NULL DEFAULT 15 CHECK (idle_minutes IN (1,5,10,15,20,30)),
  revision integer NOT NULL DEFAULT 1, UNIQUE(guild_id,name)
);
CREATE TABLE voice_sessions (
  id text PRIMARY KEY, guild_id text NOT NULL REFERENCES guild_registry(guild_id) ON DELETE CASCADE,
  user_id text NOT NULL, state jsonb NOT NULL, revision integer NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL
);
CREATE TABLE voice_channels (
  id text PRIMARY KEY, guild_id text NOT NULL REFERENCES guild_registry(guild_id) ON DELETE CASCADE,
  batch_id text NOT NULL, template_id text, template_revision integer NOT NULL,
  category_id text NOT NULL, name text NOT NULL, capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 99),
  idle_minutes integer NOT NULL CHECK(idle_minutes BETWEEN 1 AND 30),
  channel_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','creating','active','uncertain','failed','deleted')),
  completed_at timestamptz, attempted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  needs_check boolean NOT NULL DEFAULT true,
  empty_since timestamptz, delete_after timestamptz, last_verified_at timestamptz, retry_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(guild_id,name)
);
CREATE TABLE voice_presence (
  guild_id text NOT NULL REFERENCES guild_registry(guild_id) ON DELETE CASCADE,
  user_id text NOT NULL, channel_id text NOT NULL, PRIMARY KEY(guild_id,user_id)
);
CREATE TABLE voice_runtime (
  guild_id text PRIMARY KEY REFERENCES guild_registry(guild_id) ON DELETE CASCADE,
  lease_name text NOT NULL, lease_token bigint NOT NULL, ready boolean NOT NULL DEFAULT false
);
CREATE INDEX voice_channels_due ON voice_channels(retry_at,delete_after) WHERE status IN ('pending','creating','active');
CREATE INDEX voice_presence_channel ON voice_presence(guild_id,channel_id);
CREATE INDEX voice_sessions_expiry ON voice_sessions(expires_at);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['voice_settings','voice_templates','voice_sessions','voice_channels','voice_presence','voice_runtime'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (guild_id = current_setting(''app.guild_id'',true)) WITH CHECK (guild_id = current_setting(''app.guild_id'',true))',t);
    EXECUTE format('CREATE POLICY voice_owner_read ON %I FOR SELECT TO %I USING (true)',t,current_user);
  END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON voice_settings,voice_templates,voice_sessions,voice_channels,voice_presence,voice_runtime TO {{app_role}};
-- Bounded cross-tenant discovery; all mutations still use tenant transactions.
CREATE FUNCTION picket_voice_work(p_now timestamptz DEFAULT now()) RETURNS TABLE(guild_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT c.guild_id FROM public.voice_channels c JOIN public.guild_registry g USING(guild_id)
 WHERE g.inactive_since IS NULL AND c.retry_at <= p_now
 AND (c.status IN ('pending','creating') OR (c.status='active' AND
   (c.needs_check OR c.delete_after <= p_now)))
 GROUP BY c.guild_id ORDER BY min(c.retry_at) LIMIT 50
$$;
REVOKE ALL ON FUNCTION picket_voice_work(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION picket_voice_work(timestamptz) TO {{app_role}};
CREATE FUNCTION picket_voice_shard_guilds(p_lease text) RETURNS TABLE(guild_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT r.guild_id FROM public.voice_runtime r JOIN public.guild_registry g USING(guild_id)
 WHERE r.lease_name=p_lease AND g.inactive_since IS NULL
$$;
REVOKE ALL ON FUNCTION picket_voice_shard_guilds(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION picket_voice_shard_guilds(text) TO {{app_role}};
-- Extend the existing public aggregate without exposing per-guild configuration.
DROP FUNCTION picket_instance_overview();
CREATE FUNCTION picket_instance_overview()
RETURNS TABLE(active_guilds bigint,timers bigint,todolists bigint,warlog bigint,stats bigint,voice bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT count(*),count(*) FILTER(WHERE s.features->>'timers'='true'),
 count(*) FILTER(WHERE s.features->>'todolists'='true'),count(*) FILTER(WHERE s.features->>'warlog'='true'),
 count(*) FILTER(WHERE s.features->>'stats'='true'),count(*) FILTER(WHERE COALESCE((s.features->>'voice')::boolean,true))
 FROM public.guild_registry r LEFT JOIN public.guild_settings s USING(guild_id) WHERE r.inactive_since IS NULL
$$;
REVOKE ALL ON FUNCTION picket_instance_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION picket_instance_overview() TO {{app_role}};
-- Retention also runs when a guild no longer has any scheduled channel work.
CREATE FUNCTION picket_voice_gc(p_now timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target record; previous text:=current_setting('app.guild_id',true);
BEGIN
 FOR target IN
   SELECT guild_id FROM (
     SELECT guild_id FROM public.voice_sessions WHERE expires_at<=p_now
     UNION SELECT guild_id FROM public.voice_channels WHERE status IN ('deleted','failed') AND completed_at<p_now-interval '1 day'
     UNION SELECT p.guild_id FROM public.voice_presence p WHERE NOT EXISTS(
       SELECT 1 FROM public.voice_channels c WHERE c.guild_id=p.guild_id AND
       (c.status='creating' OR (c.channel_id=p.channel_id AND c.status='active')))
   ) candidates ORDER BY guild_id LIMIT 50
 LOOP
   PERFORM set_config('app.guild_id',target.guild_id,true);
   DELETE FROM public.voice_sessions WHERE guild_id=target.guild_id AND expires_at<=p_now;
   DELETE FROM public.voice_channels WHERE guild_id=target.guild_id AND status IN ('deleted','failed') AND completed_at<p_now-interval '1 day';
   DELETE FROM public.voice_presence p WHERE p.guild_id=target.guild_id AND NOT EXISTS(
     SELECT 1 FROM public.voice_channels c WHERE c.guild_id=p.guild_id AND
     (c.status='creating' OR (c.channel_id=p.channel_id AND c.status='active')));
 END LOOP;
 PERFORM set_config('app.guild_id',COALESCE(previous,''),true);
END $$;
REVOKE ALL ON FUNCTION picket_voice_gc(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION picket_voice_gc(timestamptz) TO {{app_role}};
