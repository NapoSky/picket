-- NULL = langue automatique (celle de l'utilisateur Discord) ; une valeur impose la langue du serveur.
ALTER TABLE guild_settings ALTER COLUMN locale DROP NOT NULL;
ALTER TABLE guild_settings ALTER COLUMN locale SET DEFAULT NULL;

-- 'en' était seulement la valeur par défaut (aucune commande ne la modifiait) : retour à l'automatique.
-- La RLS FORCE s'applique aussi au propriétaire : on la suspend le temps de la mise à jour.
ALTER TABLE guild_settings NO FORCE ROW LEVEL SECURITY;
UPDATE guild_settings SET locale = NULL;
ALTER TABLE guild_settings FORCE ROW LEVEL SECURITY;
