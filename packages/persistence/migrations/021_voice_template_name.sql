-- A template uses its voice channel name, including the existing 90-character limit.
ALTER TABLE voice_templates DROP CONSTRAINT voice_templates_name_check;
ALTER TABLE voice_templates ADD CONSTRAINT voice_templates_name_check CHECK (length(name) BETWEEN 1 AND 90);
