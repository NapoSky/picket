-- Niveaux d'accès par rôle (`officer`, `member`). L'identifiant du rôle @everyone est celui de la guilde.
CREATE TABLE guild_permission_roles (
  guild_id text NOT NULL,
  level    text NOT NULL CHECK (level IN ('officer', 'member')),
  role_id  text NOT NULL,
  PRIMARY KEY (guild_id, level, role_id)
);

ALTER TABLE guild_permission_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_permission_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON guild_permission_roles
  USING (guild_id = current_setting('app.guild_id', true))
  WITH CHECK (guild_id = current_setting('app.guild_id', true));

-- Journal d'audit en ajout seul : l'application ne peut ni modifier ni supprimer une entrée.
CREATE TABLE guild_audit_log (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guild_id text NOT NULL,
  actor_id text NOT NULL,
  action   text NOT NULL,
  before   jsonb NULL,
  after    jsonb NULL,
  at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guild_audit_log_guild_at_idx ON guild_audit_log (guild_id, at DESC);

ALTER TABLE guild_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON guild_audit_log
  USING (guild_id = current_setting('app.guild_id', true))
  WITH CHECK (guild_id = current_setting('app.guild_id', true));

GRANT SELECT, INSERT, DELETE ON guild_permission_roles TO {{app_role}};
GRANT SELECT, INSERT ON guild_audit_log TO {{app_role}};
