-- Membership generations prevent an old confirmation from affecting a later installation.
ALTER TABLE guild_support_presence ADD COLUMN revision bigint NOT NULL DEFAULT 0;
CREATE FUNCTION advance_support_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.revision := OLD.revision + CASE WHEN OLD.present IS DISTINCT FROM NEW.present THEN 1 ELSE 0 END;
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_membership_generation BEFORE UPDATE ON guild_support_presence
  FOR EACH ROW EXECUTE FUNCTION advance_support_membership();

-- Instance-level operator records deliberately survive tenant erasure. No tenant foreign keys.
CREATE TABLE operator_sessions (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{32}$'),
  scope jsonb NOT NULL,
  state jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX operator_sessions_expiry ON operator_sessions(expires_at);
CREATE TABLE operator_departures (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{32}$'),
  session_id text NOT NULL,
  target_id text NOT NULL,
  target_name text NOT NULL,
  actor_name text NOT NULL,
  expected_revision bigint NOT NULL,
  snapshot jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('prepared', 'pending', 'executing', 'uncertain', 'left', 'absent', 'failed', 'returned')),
  reason text NOT NULL DEFAULT '',
  failure text,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  requested_at timestamptz,
  attempted_at timestamptz,
  completed_at timestamptz,
  purge_since timestamptz,
  synced_at timestamptz
);
CREATE UNIQUE INDEX operator_departure_one_inflight ON operator_departures(target_id)
  WHERE status IN ('pending', 'executing', 'uncertain') OR (status IN ('left', 'absent') AND synced_at IS NULL);
CREATE INDEX operator_departures_history ON operator_departures(requested_at DESC) WHERE requested_at IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON operator_sessions, operator_departures TO {{app_role}};

-- A narrow metadata projection, not a blanket bypass of tenant isolation.
CREATE POLICY operator_metadata_owner_read ON guild_settings FOR SELECT TO CURRENT_USER USING (true);
CREATE FUNCTION picket_operator_servers()
RETURNS TABLE (server_id text, name text, registered_at timestamptz, present boolean,
  inactive_since timestamptz, inactive_reason text, revision bigint, features jsonb, pending boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT r.guild_id, COALESCE(p.name, ''), r.registered_at, COALESCE(p.present, false),
    r.inactive_since, r.inactive_reason, COALESCE(p.revision, 0), COALESCE(s.features, '{}'::jsonb),
    EXISTS (SELECT 1 FROM public.operator_departures d WHERE d.target_id = r.guild_id
      AND (d.status IN ('pending', 'executing', 'uncertain') OR (d.status IN ('left', 'absent') AND d.synced_at IS NULL)))
  FROM public.guild_registry r
  LEFT JOIN public.guild_support_presence p ON p.guild_id = r.guild_id
  LEFT JOIN public.guild_settings s ON s.guild_id = r.guild_id
$$;
REVOKE ALL ON FUNCTION picket_operator_servers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION picket_operator_servers() TO {{app_role}};
