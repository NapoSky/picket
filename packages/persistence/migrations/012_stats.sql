-- Vocal statistics: all historical facts expire after 60 days. Configuration is separate.
CREATE TABLE stats_settings (
  guild_id text PRIMARY KEY,
  excluded_channels text[] NOT NULL DEFAULT '{}',
  afk_channel_id text NULL,
  guild_name text NOT NULL DEFAULT '',
  changed_at timestamptz NOT NULL DEFAULT now(),
  enabled_at timestamptz NULL,
  observed_through timestamptz NULL,
  interrupted_at timestamptz NULL
);

CREATE TABLE stats_privacy (
  guild_id text NOT NULL, user_id text NOT NULL,
  opted_out boolean NOT NULL DEFAULT false,
  erased_before timestamptz NOT NULL DEFAULT '-infinity',
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE stats_users (
  guild_id text NOT NULL, user_id text NOT NULL, name text NOT NULL,
  last_seen_at timestamptz NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE stats_channels (
  guild_id text NOT NULL, channel_id text NOT NULL, name text NOT NULL,
  last_seen_at timestamptz NOT NULL,
  PRIMARY KEY (guild_id, channel_id)
);

CREATE TABLE stats_voice_events (
  event_key text PRIMARY KEY, guild_id text NOT NULL, user_id text NOT NULL,
  channel_id text NULL, previous_channel_id text NULL,
  at timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('join','leave','move','excluded','role_lost','recovery')),
  quality text NOT NULL CHECK (quality IN ('observed','snapshot','replayed','interrupted'))
);
CREATE INDEX stats_events_expiry ON stats_voice_events (at);
CREATE INDEX stats_events_user_time ON stats_voice_events (guild_id,user_id,at);

CREATE TABLE stats_voice_segments (
  id text PRIMARY KEY, guild_id text NOT NULL, user_id text NOT NULL, channel_id text NOT NULL,
  shard_id integer NOT NULL,
  started_at timestamptz NOT NULL, ended_at timestamptz NULL,
  confirmed_through timestamptz NOT NULL,
  current_roles text[] NOT NULL DEFAULT '{}',
  end_reason text NULL,
  quality text NOT NULL CHECK (quality IN ('observed','snapshot','replayed','interrupted')),
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  CHECK (confirmed_through >= started_at)
);
CREATE UNIQUE INDEX stats_one_open_presence ON stats_voice_segments (guild_id,user_id) WHERE ended_at IS NULL;
CREATE INDEX stats_segments_guild_time ON stats_voice_segments (guild_id,started_at);
CREATE INDEX stats_segments_user_time ON stats_voice_segments (guild_id,user_id,started_at);
CREATE INDEX stats_segments_channel_time ON stats_voice_segments (guild_id,channel_id,started_at);
CREATE INDEX stats_segments_expiry ON stats_voice_segments (confirmed_through);

-- Current voice state, not an annuary: only connected humans in enabled guilds.
-- Non-targets have no historical facts or user profile. This short-lived state allows role gains and shard handoff.
CREATE TABLE stats_voice_presence (
  guild_id text NOT NULL, user_id text NOT NULL, channel_id text NOT NULL,
  roles text[] NOT NULL, shard_id integer NOT NULL, seen_at timestamptz NOT NULL,
  PRIMARY KEY (guild_id,user_id)
);
-- Context is set for the transaction by the trusted collector/web backend, never by HTTP input.
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['stats_settings','stats_privacy','stats_users','stats_channels','stats_voice_events','stats_voice_segments','stats_voice_presence'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
    EXECUTE format('CREATE POLICY stats_read ON %I FOR SELECT USING (guild_id = current_setting(''app.guild_id'',true) OR current_setting(''app.stats_scope'',true) = ''global'')',tab);
    EXECUTE format('CREATE POLICY stats_write ON %I FOR ALL USING (guild_id = current_setting(''app.guild_id'',true)) WITH CHECK (guild_id = current_setting(''app.guild_id'',true))',tab);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO {{app_role}}',tab);
  END LOOP;
  FOREACH tab IN ARRAY ARRAY['stats_privacy','stats_users','stats_voice_events','stats_voice_segments','stats_voice_presence'] LOOP
    EXECUTE format('CREATE POLICY stats_person ON %I AS RESTRICTIVE FOR SELECT USING (COALESCE(current_setting(''app.stats_scope'',true),'''') <> ''self'' OR user_id = current_setting(''app.stats_actor'',true))',tab);
  END LOOP;
END $$;

-- Settings changed through any entry point immediately stop invalid collections.
CREATE FUNCTION stats_targets_changed() RETURNS trigger LANGUAGE plpgsql SET search_path = public,pg_temp AS $$
DECLARE gid text := COALESCE(NEW.guild_id,OLD.guild_id); targets text[]; valid boolean;
BEGIN
  IF COALESCE(NEW.level,OLD.level) <> 'member' THEN RETURN NULL; END IF;
  SELECT array_agg(role_id) INTO targets FROM guild_permission_roles WHERE guild_id=gid AND level='member';
  valid := COALESCE(cardinality(targets),0)>0 AND NOT gid=ANY(targets);
  UPDATE stats_settings SET changed_at=now() WHERE guild_id=gid;
  IF NOT valid THEN
    UPDATE guild_settings SET features=jsonb_set(features,'{stats}','false') WHERE guild_id=gid AND COALESCE((features->>'stats')::boolean,false);
  END IF;
  UPDATE stats_voice_segments SET ended_at=GREATEST(started_at,CASE WHEN confirmed_through>now()-interval '120 seconds' THEN now() ELSE confirmed_through END),confirmed_through=GREATEST(started_at,CASE WHEN confirmed_through>now()-interval '120 seconds' THEN now() ELSE confirmed_through END),end_reason='role_lost'
    WHERE guild_id=gid AND ended_at IS NULL AND (NOT valid OR NOT current_roles && targets);
  RETURN NULL;
END $$;
CREATE TRIGGER stats_targets AFTER INSERT OR UPDATE OR DELETE ON guild_permission_roles FOR EACH ROW EXECUTE FUNCTION stats_targets_changed();

CREATE FUNCTION stats_feature_changed() RETURNS trigger LANGUAGE plpgsql SET search_path = public,pg_temp AS $$
DECLARE targets text[];
BEGIN
  IF COALESCE((NEW.features->>'stats')::boolean,false) THEN
    SELECT array_agg(role_id) INTO targets FROM guild_permission_roles WHERE guild_id=NEW.guild_id AND level='member';
    IF COALESCE(cardinality(targets),0)=0 OR NEW.guild_id=ANY(targets) THEN RAISE EXCEPTION 'stats requires explicit member roles without everyone' USING ERRCODE='23514'; END IF;
  END IF;
  IF COALESCE((NEW.features->>'stats')::boolean,false) IS DISTINCT FROM COALESCE((OLD.features->>'stats')::boolean,false) THEN
    INSERT INTO stats_settings(guild_id,changed_at,enabled_at) VALUES(NEW.guild_id,now(),CASE WHEN COALESCE((NEW.features->>'stats')::boolean,false) THEN now() ELSE NULL END) ON CONFLICT(guild_id) DO UPDATE SET changed_at=now(),enabled_at=EXCLUDED.enabled_at;
    IF NOT COALESCE((NEW.features->>'stats')::boolean,false) THEN
      UPDATE stats_voice_segments SET ended_at=GREATEST(started_at,CASE WHEN confirmed_through>now()-interval '120 seconds' THEN now() ELSE confirmed_through END),confirmed_through=GREATEST(started_at,CASE WHEN confirmed_through>now()-interval '120 seconds' THEN now() ELSE confirmed_through END),end_reason='disabled' WHERE guild_id=NEW.guild_id AND ended_at IS NULL;
      DELETE FROM stats_voice_presence WHERE guild_id=NEW.guild_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stats_feature BEFORE UPDATE OF features ON guild_settings FOR EACH ROW EXECUTE FUNCTION stats_feature_changed();

-- Dashboard sessions contain encrypted OAuth tokens. Browser cookies contain only random opaque identifiers.
CREATE TABLE stats_web_sessions (
  token_hash text PRIMARY KEY, user_id text NOT NULL, display_name text NOT NULL,
  encrypted_token text NOT NULL, csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX stats_web_session_expiry ON stats_web_sessions(expires_at);
CREATE TABLE stats_oauth_states (state_hash text PRIMARY KEY, expires_at timestamptz NOT NULL);
GRANT SELECT,INSERT,UPDATE,DELETE ON stats_web_sessions,stats_oauth_states TO {{app_role}};
