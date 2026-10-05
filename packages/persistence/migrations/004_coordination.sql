-- Verrous à durée limitée pour les rôles uniques (connexion Gateway d'un shard, sondeur…).
-- `token` est un jeton de fencing : il augmente à chaque changement de détenteur, et les écritures
-- du détenteur le vérifient pour qu'un ancien détenteur ralenti ne puisse plus rien écrire.
CREATE TABLE leases (
  name       text PRIMARY KEY,
  holder     text NOT NULL,
  token      bigint NOT NULL,
  expires_at timestamptz NOT NULL
);

-- Dernière session Gateway connue par shard, pour qu'un autre processus puisse la reprendre (RESUME).
CREATE TABLE gateway_sessions (
  shard_id    integer PRIMARY KEY,
  session     jsonb NOT NULL,
  lease_token bigint NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- `requested` : suppression demandée par un administrateur ; `left` : le bot a quitté le serveur.
ALTER TABLE guild_registry ADD COLUMN inactive_reason text NULL CHECK (inactive_reason IN ('requested', 'left'));
UPDATE guild_registry SET inactive_reason = 'requested' WHERE inactive_since IS NOT NULL;
ALTER TABLE guild_registry ADD CONSTRAINT guild_registry_inactive_consistent
  CHECK ((inactive_since IS NULL) = (inactive_reason IS NULL));

GRANT SELECT, INSERT, UPDATE ON leases TO {{app_role}};
GRANT SELECT, INSERT, UPDATE, DELETE ON gateway_sessions TO {{app_role}};
