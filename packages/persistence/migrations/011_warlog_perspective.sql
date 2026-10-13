-- A guild's reference faction survives subscription renewals and war changes.
ALTER TABLE warlog_subscriptions ADD COLUMN perspective text NOT NULL DEFAULT 'NONE'
  CHECK (perspective IN ('NONE', 'WARDENS', 'COLONIALS'));
