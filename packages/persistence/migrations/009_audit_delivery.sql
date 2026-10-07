-- File durable, liée aux journaux sources : leur rétention de 30 jours efface aussi les livraisons.
CREATE TABLE guild_audit_delivery (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guild_id text NOT NULL REFERENCES guild_registry(guild_id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  audit_id bigint UNIQUE REFERENCES guild_audit_log(id) ON DELETE CASCADE,
  timer_event_id bigint UNIQUE REFERENCES timer_events(id) ON DELETE CASCADE,
  queued_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  message_id text,
  last_error text,
  CHECK (num_nonnulls(audit_id, timer_event_id) = 1)
);
CREATE INDEX guild_audit_delivery_pending_idx ON guild_audit_delivery(guild_id, id) WHERE completed_at IS NULL;
ALTER TABLE guild_audit_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_audit_delivery FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON guild_audit_delivery
  USING (guild_id = current_setting('app.guild_id', true))
  WITH CHECK (guild_id = current_setting('app.guild_id', true));
GRANT SELECT, INSERT, UPDATE ON guild_audit_delivery TO {{app_role}};

-- Index global de réveil, sans contenu de journal (comme timer_schedule).
CREATE TABLE guild_audit_schedule (
  guild_id text PRIMARY KEY REFERENCES guild_registry(guild_id) ON DELETE CASCADE,
  wake_at timestamptz,
  failure_reason text,
  failed_at timestamptz
);
CREATE INDEX guild_audit_schedule_due_idx ON guild_audit_schedule(wake_at) WHERE failure_reason IS NULL;
GRANT SELECT, INSERT, UPDATE ON guild_audit_schedule TO {{app_role}};

CREATE FUNCTION enqueue_guild_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text;
BEGIN
  IF TG_TABLE_NAME = 'guild_audit_log' THEN
    IF NEW.action NOT LIKE 'settings.%' AND NEW.action NOT LIKE 'permissions.%'
       AND NEW.action NOT LIKE 'guild.%' AND NEW.action NOT IN ('audit.test', 'todolist.created') THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME = 'timer_events' THEN
    IF NEW.action NOT IN ('add', 'reactivate', 'strike', 'cleanup', 'auto_purge', 'reset_war', 'acknowledge') THEN RETURN NEW; END IF;
  END IF;
  SELECT audit_channel_id INTO target FROM guild_settings WHERE guild_id = NEW.guild_id;
  IF TG_TABLE_NAME = 'guild_audit_log' THEN
    IF target IS NULL AND NEW.action = 'settings.audit_channel' THEN target := NEW.before->>'auditChannelId'; END IF;
  END IF;
  IF target IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'guild_audit_log' THEN
    INSERT INTO guild_audit_delivery(guild_id, channel_id, audit_id) VALUES(NEW.guild_id, target, NEW.id);
  ELSIF TG_TABLE_NAME = 'timer_events' THEN
    INSERT INTO guild_audit_delivery(guild_id, channel_id, timer_event_id) VALUES(NEW.guild_id, target, NEW.id);
  END IF;
  INSERT INTO guild_audit_schedule(guild_id, wake_at) VALUES(NEW.guild_id, now())
    ON CONFLICT(guild_id) DO UPDATE SET wake_at = LEAST(guild_audit_schedule.wake_at, excluded.wake_at);
  RETURN NEW;
END;
$$;
CREATE TRIGGER publish_audit AFTER INSERT ON guild_audit_log FOR EACH ROW EXECUTE FUNCTION enqueue_guild_audit();
CREATE TRIGGER publish_timer_audit AFTER INSERT ON timer_events FOR EACH ROW EXECUTE FUNCTION enqueue_guild_audit();

CREATE FUNCTION change_guild_audit_channel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.audit_channel_id IS NOT DISTINCT FROM OLD.audit_channel_id THEN RETURN NEW; END IF;
  UPDATE guild_audit_delivery SET completed_at = now(), last_error = 'channel_changed'
    WHERE guild_id = NEW.guild_id AND completed_at IS NULL;
  INSERT INTO guild_audit_schedule(guild_id, wake_at) VALUES(NEW.guild_id, NULL)
    ON CONFLICT(guild_id) DO UPDATE SET wake_at = NULL, failure_reason = NULL, failed_at = NULL;
  RETURN NEW;
END;
$$;
CREATE TRIGGER change_audit_channel AFTER UPDATE OF audit_channel_id ON guild_settings
  FOR EACH ROW EXECUTE FUNCTION change_guild_audit_channel();
