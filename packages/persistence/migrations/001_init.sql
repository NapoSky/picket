-- Le rôle applicatif ({{app_role}}) ne possède aucune table : il reste donc soumis à la RLS.

CREATE TABLE guild_settings (
  guild_id         text PRIMARY KEY,
  locale           text NOT NULL DEFAULT 'en',
  timezone         text NOT NULL DEFAULT 'UTC',
  audit_channel_id text NULL,
  features         jsonb NOT NULL DEFAULT '{"timers": true, "todolists": true, "warlog": false}',
  emoji_overrides  jsonb NOT NULL DEFAULT '{}',
  installed_at     timestamptz NOT NULL DEFAULT now(),
  inactive_since   timestamptz NULL
);

-- Fail-closed : sans `app.guild_id` (NULL), aucune ligne n'est visible ni écrivable.
ALTER TABLE guild_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON guild_settings
  USING (guild_id = current_setting('app.guild_id', true))
  WITH CHECK (guild_id = current_setting('app.guild_id', true));

-- Dédoublonnage des interactions entre répliques ; pas de données de tenant, donc pas de RLS.
CREATE TABLE interaction_receipts (
  interaction_id text PRIMARY KEY,
  guild_id       text NULL,
  received_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX interaction_receipts_received_at_idx ON interaction_receipts (received_at);

CREATE TABLE app_state (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON guild_settings, interaction_receipts, app_state TO {{app_role}};
