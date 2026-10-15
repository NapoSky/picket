-- A confirmed administrator deletion request also asks the bot to leave.
-- Keep the intent durable, and never retry a dispatched DELETE after a lost response.
CREATE TABLE guild_departure_requests (
  guild_id text PRIMARY KEY REFERENCES guild_registry(guild_id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  registered_at timestamptz NOT NULL,
  expected_revision bigint NOT NULL,
  requested_at timestamptz NOT NULL,
  attempted_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','executing','uncertain','left','failed','returned'))
);
INSERT INTO guild_departure_requests(guild_id, registered_at, expected_revision, requested_at)
  SELECT r.guild_id, r.registered_at, COALESCE(p.revision, 0), r.inactive_since
  FROM guild_registry r LEFT JOIN guild_support_presence p USING(guild_id)
  WHERE r.inactive_reason = 'requested';
ALTER TABLE guild_departure_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_departure_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON guild_departure_requests
  USING (guild_id = current_setting('app.guild_id', true))
  WITH CHECK (guild_id = current_setting('app.guild_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON guild_departure_requests TO {{app_role}};
CREATE POLICY departure_owner_read ON guild_departure_requests FOR SELECT TO CURRENT_USER USING (true);
CREATE INDEX guild_departure_pending ON guild_departure_requests(requested_at)
  WHERE status IN ('pending','executing','uncertain');
CREATE FUNCTION picket_pending_departures() RETURNS TABLE(guild_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT guild_id FROM public.guild_departure_requests
  WHERE status IN ('pending','executing','uncertain') ORDER BY requested_at LIMIT 50
$$;
REVOKE ALL ON FUNCTION picket_pending_departures() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION picket_pending_departures() TO {{app_role}};
