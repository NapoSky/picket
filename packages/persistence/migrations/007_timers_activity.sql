-- Dernière modification du board : un board vide et inactif depuis longtemps est supprimé (voir `isAbandoned`).
ALTER TABLE timer_boards ADD COLUMN last_activity_at timestamptz NOT NULL DEFAULT now();
