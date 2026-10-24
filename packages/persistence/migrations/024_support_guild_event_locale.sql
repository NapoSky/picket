-- Render new notifications in the destination server language at delivery time.
-- Keep pre-existing text deliveries readable across the upgrade.
ALTER TABLE support_guild_deliveries ALTER COLUMN content DROP NOT NULL;
ALTER TABLE support_guild_deliveries ADD COLUMN event jsonb;
ALTER TABLE support_guild_deliveries ADD CONSTRAINT support_guild_delivery_payload
  CHECK (content IS NOT NULL OR event IS NOT NULL);
