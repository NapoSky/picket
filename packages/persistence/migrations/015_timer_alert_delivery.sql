-- Additive: old replicas keep their existing semantics during rollout/rollback.
-- A NULL message_id alone cannot distinguish a skipped/removed alert from a
-- process interrupted before sending. Only new reservations mark delivery pending.
ALTER TABLE timer_alerts ADD COLUMN delivery_pending boolean NOT NULL DEFAULT false;
