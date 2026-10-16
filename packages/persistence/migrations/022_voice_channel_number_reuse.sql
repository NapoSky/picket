-- Keep completed deployment results while releasing their channel names immediately.
ALTER TABLE voice_channels DROP CONSTRAINT voice_channels_guild_id_name_key;
CREATE UNIQUE INDEX voice_channels_live_name ON voice_channels(guild_id,name)
WHERE status NOT IN ('deleted','failed');
