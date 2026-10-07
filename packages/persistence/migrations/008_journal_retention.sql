-- Journaux de serveur : stockage partagé, exportable et soumis à la même rétention de 30 jours.
CREATE TABLE guild_application_logs (
  id       uuid PRIMARY KEY,
  guild_id text NOT NULL REFERENCES guild_registry (guild_id) ON DELETE CASCADE,
  record   jsonb NOT NULL,
  at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guild_application_logs_guild_at_idx ON guild_application_logs (guild_id, at);
CREATE INDEX guild_application_logs_at_idx ON guild_application_logs (at);
CREATE INDEX guild_audit_log_retention_idx ON guild_audit_log (at);
CREATE INDEX timer_events_retention_idx ON timer_events (at);

ALTER TABLE guild_application_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_application_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON guild_application_logs
  USING (guild_id = current_setting('app.guild_id', true))
  WITH CHECK (guild_id = current_setting('app.guild_id', true));
GRANT SELECT, INSERT ON guild_application_logs TO {{app_role}};

-- Seul le propriétaire des tables (rôle de migration) peut nettoyer les anciennes entrées entre tenants.
-- L'application conserve son accès SELECT/INSERT et ne peut pas modifier ou effacer un journal récent.
CREATE POLICY retention_read ON guild_audit_log FOR SELECT TO CURRENT_USER
  USING (at <= CURRENT_TIMESTAMP - INTERVAL '30 days');
CREATE POLICY retention_delete ON guild_audit_log FOR DELETE TO CURRENT_USER
  USING (at <= CURRENT_TIMESTAMP - INTERVAL '30 days');
CREATE POLICY retention_read ON timer_events FOR SELECT TO CURRENT_USER
  USING (at <= CURRENT_TIMESTAMP - INTERVAL '30 days');
CREATE POLICY retention_delete ON timer_events FOR DELETE TO CURRENT_USER
  USING (at <= CURRENT_TIMESTAMP - INTERVAL '30 days');
CREATE POLICY retention_read ON guild_application_logs FOR SELECT TO CURRENT_USER
  USING (at <= CURRENT_TIMESTAMP - INTERVAL '30 days');
CREATE POLICY retention_delete ON guild_application_logs FOR DELETE TO CURRENT_USER
  USING (at <= CURRENT_TIMESTAMP - INTERVAL '30 days');

CREATE FUNCTION purge_expired_journals(p_guild_id text DEFAULT NULL)
RETURNS TABLE (audit_deleted bigint, timer_events_deleted bigint, application_logs_deleted bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.guild_audit_log WHERE at <= CURRENT_TIMESTAMP - INTERVAL '30 days'
    AND (p_guild_id IS NULL OR guild_id = p_guild_id);
  GET DIAGNOSTICS audit_deleted = ROW_COUNT;
  DELETE FROM public.timer_events WHERE at <= CURRENT_TIMESTAMP - INTERVAL '30 days'
    AND (p_guild_id IS NULL OR guild_id = p_guild_id);
  GET DIAGNOSTICS timer_events_deleted = ROW_COUNT;
  DELETE FROM public.guild_application_logs WHERE at <= CURRENT_TIMESTAMP - INTERVAL '30 days'
    AND (p_guild_id IS NULL OR guild_id = p_guild_id);
  GET DIAGNOSTICS application_logs_deleted = ROW_COUNT;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION purge_expired_journals(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_expired_journals(text) TO {{app_role}};

-- Appliquer également la rétention aux historiques déjà présents au déploiement.
SELECT * FROM purge_expired_journals();
