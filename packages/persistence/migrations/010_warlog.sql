-- Public game data is global; Discord subscriptions and delivery state are tenant data.
CREATE TABLE wars (
  war_number integer PRIMARY KEY,
  payload jsonb NOT NULL
);
CREATE TABLE warlog_state (
  id integer PRIMARY KEY CHECK (id = 1),
  generation bigint NOT NULL DEFAULT 0,
  available boolean NOT NULL DEFAULT false,
  highest_war integer NOT NULL DEFAULT 0,
  payload jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO warlog_state(id) VALUES (1);
CREATE TABLE war_objects (
  war_number integer NOT NULL REFERENCES wars ON DELETE CASCADE,
  object_key text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY(war_number, object_key)
);
CREATE TABLE war_events (
  event_id text PRIMARY KEY,
  war_number integer NOT NULL REFERENCES wars ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL,
  detected_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX war_events_war_time ON war_events(war_number, detected_at);
CREATE TABLE concrete_timers (
  war_number integer NOT NULL REFERENCES wars ON DELETE CASCADE,
  object_key text NOT NULL,
  observed_at timestamptz NOT NULL,
  ready_at timestamptz NOT NULL,
  notified_at timestamptz,
  payload jsonb NOT NULL,
  PRIMARY KEY(war_number, object_key)
);
CREATE INDEX concrete_timers_due ON concrete_timers(ready_at) WHERE notified_at IS NULL;
CREATE TABLE warlog_subscriptions (
  guild_id text PRIMARY KEY REFERENCES guild_registry ON DELETE CASCADE,
  channel_id text,
  zones jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(zones) = 'array' AND jsonb_array_length(zones) <= 3),
  locale text,
  paused boolean NOT NULL DEFAULT true,
  confirmed_war integer,
  enabled_at timestamptz,
  revision integer NOT NULL DEFAULT 0,
  failure_reason text,
  CHECK (paused OR (channel_id IS NOT NULL AND confirmed_war IS NOT NULL AND jsonb_array_length(zones) >= 1))
);
CREATE TABLE warlog_deliveries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guild_id text NOT NULL REFERENCES guild_registry ON DELETE CASCADE,
  event_key text NOT NULL,
  war_number integer NOT NULL,
  channel_id text NOT NULL,
  generation bigint NOT NULL,
  revision integer NOT NULL,
  payload jsonb NOT NULL,
  locale text,
  notice boolean NOT NULL DEFAULT false,
  queued_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  claimed_until timestamptz,
  completed_at timestamptz,
  message_id text,
  last_error text,
  UNIQUE(guild_id, event_key)
);
CREATE INDEX warlog_deliveries_pending ON warlog_deliveries(guild_id, id) WHERE completed_at IS NULL;
CREATE TABLE warlog_hooks (
  guild_id text NOT NULL REFERENCES guild_registry ON DELETE CASCADE,
  war_number integer NOT NULL,
  board_id text NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(guild_id, war_number, board_id)
);
CREATE TABLE warlog_hook_jobs (
  guild_id text NOT NULL REFERENCES guild_registry ON DELETE CASCADE,
  war_number integer NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY(guild_id, war_number)
);
-- Global wake-up index only: no channel, filters, message or user data.
CREATE TABLE warlog_schedule (
  guild_id text PRIMARY KEY REFERENCES guild_registry ON DELETE CASCADE,
  wake_at timestamptz,
  last_served_at timestamptz NOT NULL DEFAULT 'epoch',
  hook_pending boolean NOT NULL DEFAULT false
);
CREATE INDEX warlog_schedule_due ON warlog_schedule(wake_at);
-- A single shared budget covers actual authenticated REST attempts across replicas.
CREATE TABLE discord_request_budget (
  id integer PRIMARY KEY CHECK (id = 1),
  window_at timestamptz NOT NULL,
  requests integer NOT NULL
);
ALTER TABLE warlog_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE warlog_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON warlog_subscriptions
  USING (guild_id = current_setting('app.guild_id', true))
  WITH CHECK (guild_id = current_setting('app.guild_id', true));
ALTER TABLE warlog_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE warlog_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON warlog_deliveries
  USING (guild_id = current_setting('app.guild_id', true))
  WITH CHECK (guild_id = current_setting('app.guild_id', true));
ALTER TABLE warlog_hooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE warlog_hooks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON warlog_hooks
  USING (guild_id = current_setting('app.guild_id', true))
  WITH CHECK (guild_id = current_setting('app.guild_id', true));
ALTER TABLE warlog_hook_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE warlog_hook_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON warlog_hook_jobs
  USING (guild_id = current_setting('app.guild_id', true))
  WITH CHECK (guild_id = current_setting('app.guild_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON wars, warlog_state, war_objects, war_events, concrete_timers,
  warlog_subscriptions, warlog_deliveries, warlog_hooks, warlog_hook_jobs, warlog_schedule, discord_request_budget TO {{app_role}};
GRANT USAGE, SELECT ON SEQUENCE warlog_deliveries_id_seq TO {{app_role}};
