-- Timers : l'état vit en base, Discord n'est qu'une vue. Toutes les tables de tenant portent `guild_id`
-- (RLS et purge de la guilde, voir `purge_guild`) ; les suppressions en cascade partent du board.

CREATE TABLE timer_boards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id    text NOT NULL,
  channel_id  text NOT NULL,
  -- Langue du canal à la création ; la langue imposée au serveur, si elle existe, prime.
  locale      text NULL,
  settings    jsonb NOT NULL DEFAULT '{}',
  -- Incrémenté à chaque mutation : permet de repérer un état périmé sans rien lire de Discord.
  rev         integer NOT NULL DEFAULT 0,
  -- Vrai tant que les messages publiés ne reflètent pas l'état (mutation faite, rendu pas encore confirmé).
  needs_sync  boolean NOT NULL DEFAULT true,
  sync_error  text NULL,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz NULL
);
-- Un seul board actif par canal ; un board archivé laisse la place.
CREATE UNIQUE INDEX timer_boards_channel_idx ON timer_boards (guild_id, channel_id) WHERE archived_at IS NULL;

CREATE TABLE timer_board_messages (
  board_id     uuid NOT NULL REFERENCES timer_boards (id) ON DELETE CASCADE,
  guild_id     text NOT NULL,
  page         smallint NOT NULL CHECK (page >= 0),
  message_id   text NOT NULL,
  content_hash text NOT NULL,
  PRIMARY KEY (board_id, page)
);

CREATE TABLE timer_assets (
  id            text PRIMARY KEY CHECK (id ~ '^[a-z0-9]{8,16}$'),
  board_id      uuid NOT NULL REFERENCES timer_boards (id) ON DELETE CASCADE,
  guild_id      text NOT NULL,
  -- Le catalogue des types est une donnée du code : pas de liste fermée en base.
  type          text NOT NULL CHECK (type ~ '^[a-z_]{2,24}$'),
  name          text NOT NULL,
  code          text NULL,
  region_key    text NOT NULL,
  location_key  text NOT NULL,
  owner_user_id text NOT NULL,
  direction     text NOT NULL CHECK (direction IN ('down', 'up')),
  duration_s    integer NOT NULL CHECK (duration_s > 0),
  started_at    timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'struck')),
  struck_at     timestamptz NULL,
  -- Échéance affichée au moment du barrage : l'asset barré garde sa durée d'origine.
  frozen_at     timestamptz NULL,
  rev           integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'struck') = (struck_at IS NOT NULL AND frozen_at IS NOT NULL))
);
CREATE INDEX timer_assets_board_idx ON timer_assets (board_id, status);

-- Journal en ajout seul : audit, et matière des futures statistiques.
CREATE TABLE timer_events (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guild_id text NOT NULL,
  board_id uuid NOT NULL,
  asset_id text NULL,
  actor_id text NOT NULL,
  action   text NOT NULL,
  detail   jsonb NULL,
  at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX timer_events_board_idx ON timer_events (guild_id, board_id, at DESC);

-- Une ligne par (asset, échéance, seuil) : réclamée avant l'envoi, donc jamais envoyée deux fois, et ré-armée
-- d'elle-même par un refresh puisque l'échéance change.
CREATE TABLE timer_alerts (
  asset_id      text NOT NULL REFERENCES timer_assets (id) ON DELETE CASCADE,
  guild_id      text NOT NULL,
  board_id      uuid NOT NULL REFERENCES timer_boards (id) ON DELETE CASCADE,
  due_at        timestamptz NOT NULL,
  threshold_min integer NOT NULL CHECK (threshold_min > 0),
  -- NULL : seuil rattrapé sans message (un seuil plus proche de l'échéance l'a remplacé), ou message retiré.
  message_id    text NULL,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  acked_by      text NULL,
  acked_at      timestamptz NULL,
  PRIMARY KEY (asset_id, due_at, threshold_min)
);
CREATE INDEX timer_alerts_board_idx ON timer_alerts (board_id) WHERE message_id IS NOT NULL;

-- Prochaine échéance de travail de chaque board (rendu à confirmer, alerte, expiration, purge). Hors RLS : le
-- planificateur doit énumérer les boards à traiter sans lire de données de tenant ; il ne contient que des
-- identifiants et une date, comme `guild_registry`.
CREATE TABLE timer_schedule (
  board_id uuid PRIMARY KEY REFERENCES timer_boards (id) ON DELETE CASCADE,
  guild_id text NOT NULL,
  wake_at  timestamptz NOT NULL
);
CREATE INDEX timer_schedule_wake_idx ON timer_schedule (wake_at);

ALTER TABLE timer_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE timer_boards FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON timer_boards
  USING (guild_id = current_setting('app.guild_id', true))
  WITH CHECK (guild_id = current_setting('app.guild_id', true));

ALTER TABLE timer_board_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE timer_board_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON timer_board_messages
  USING (guild_id = current_setting('app.guild_id', true))
  WITH CHECK (guild_id = current_setting('app.guild_id', true));

ALTER TABLE timer_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE timer_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON timer_assets
  USING (guild_id = current_setting('app.guild_id', true))
  WITH CHECK (guild_id = current_setting('app.guild_id', true));

ALTER TABLE timer_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE timer_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON timer_events
  USING (guild_id = current_setting('app.guild_id', true))
  WITH CHECK (guild_id = current_setting('app.guild_id', true));

ALTER TABLE timer_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE timer_alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON timer_alerts
  USING (guild_id = current_setting('app.guild_id', true))
  WITH CHECK (guild_id = current_setting('app.guild_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON timer_boards, timer_board_messages, timer_assets, timer_alerts, timer_schedule TO {{app_role}};
GRANT SELECT, INSERT ON timer_events TO {{app_role}};
