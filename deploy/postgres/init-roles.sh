#!/bin/sh
# Initialise les rôles Postgres au premier démarrage du volume (docker-entrypoint-initdb.d).
#   picket_migrator : propriétaire de la base, exécute les migrations.
#   picket_app      : rôle de l'application, ni propriétaire ni BYPASSRLS, donc soumis à la RLS.
# Les mots de passe viennent de PICKET_*_PASSWORD_FILE (Docker secrets) ou de PICKET_*_PASSWORD.
set -eu

secret() {
  eval "file=\${${1}_FILE:-}"
  if [ -n "$file" ]; then
    cat "$file"
  else
    eval "printf '%s' \"\${${1}:-}\""
  fi
}

migrator_password="$(secret PICKET_MIGRATOR_PASSWORD)"
app_password="$(secret PICKET_APP_PASSWORD)"
if [ -z "$migrator_password" ] || [ -z "$app_password" ]; then
  echo "init-roles: PICKET_MIGRATOR_PASSWORD and PICKET_APP_PASSWORD are required" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v migrator_password="$migrator_password" -v app_password="$app_password" <<'SQL'
CREATE ROLE picket_migrator LOGIN PASSWORD :'migrator_password' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE picket_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
SELECT format('ALTER DATABASE %I OWNER TO picket_migrator', current_database()) \gexec
SQL
