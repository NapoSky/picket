-- Registre des guildes, hors RLS : seul point d'entrée pour énumérer les guildes (purge, tâches
-- planifiées) sans jamais lire de données d'un tenant. Il ne contient aucun contenu de tenant.
CREATE TABLE guild_registry (
  guild_id       text PRIMARY KEY,
  registered_at  timestamptz NOT NULL DEFAULT now(),
  inactive_since timestamptz NULL
);
CREATE INDEX guild_registry_inactive_since_idx ON guild_registry (inactive_since) WHERE inactive_since IS NOT NULL;

-- L'état d'activité vit désormais dans le registre.
ALTER TABLE guild_settings DROP COLUMN inactive_since;

GRANT SELECT, INSERT, UPDATE ON guild_registry TO {{app_role}};

-- Suppression définitive des données d'une guilde. SECURITY DEFINER : le rôle applicatif n'a pas
-- (et ne doit pas avoir) le droit de supprimer le journal d'audit ni de contourner la RLS.
-- Toute table portant une colonne `guild_id` est purgée : convention à respecter pour les tables à venir.
CREATE FUNCTION purge_guild(p_guild_id text) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  previous text := current_setting('app.guild_id', true);
  target   record;
BEGIN
  PERFORM set_config('app.guild_id', p_guild_id, true);
  FOR target IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'guild_id'
    ORDER BY table_name
  LOOP
    EXECUTE format('DELETE FROM %I WHERE guild_id = $1', target.table_name) USING p_guild_id;
  END LOOP;
  PERFORM set_config('app.guild_id', COALESCE(previous, ''), true);
END;
$$;

REVOKE ALL ON FUNCTION purge_guild(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_guild(text) TO {{app_role}};
