-- Last known server name and actual bot membership, independent of Stats/deletion requests.
CREATE TABLE guild_support_presence (
  guild_id text PRIMARY KEY REFERENCES guild_registry(guild_id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  present boolean NOT NULL
);
-- Existing deployments are a silent baseline. Reuse cached names when available; later Gateway
-- metadata updates this independent copy even when Stats is disabled.
ALTER TABLE stats_settings NO FORCE ROW LEVEL SECURITY;
INSERT INTO guild_support_presence(guild_id, name, present)
  SELECT r.guild_id, COALESCE(s.guild_name, ''), r.inactive_reason IS DISTINCT FROM 'left'
  FROM guild_registry r LEFT JOIN stats_settings s ON s.guild_id = r.guild_id;
ALTER TABLE stats_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE guild_support_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_support_presence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON guild_support_presence
  USING (guild_id = current_setting('app.guild_id', true))
  WITH CHECK (guild_id = current_setting('app.guild_id', true));
CREATE POLICY support_presence_owner_read ON guild_support_presence FOR SELECT TO CURRENT_USER USING (true);
GRANT SELECT, INSERT, UPDATE ON guild_support_presence TO {{app_role}};

-- Reconciliation exposes only membership IDs, never names across tenants.
CREATE FUNCTION picket_support_present_guilds() RETURNS TABLE(guild_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT guild_id FROM public.guild_support_presence WHERE present
$$;
REVOKE ALL ON FUNCTION picket_support_present_guilds() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION picket_support_present_guilds() TO {{app_role}};

-- Instance-level delivery queue: only the name-based message and destination, no source server IDs.
-- Rows are removed after delivery; Discord messages are retained as an operational history.
CREATE TABLE support_guild_deliveries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel_id text NOT NULL,
  content text NOT NULL,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON support_guild_deliveries TO {{app_role}};
