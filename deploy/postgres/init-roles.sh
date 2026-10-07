#!/bin/sh
# Initialize PostgreSQL roles on the volume's first startup (docker-entrypoint-initdb.d).
#   picket_migrator: database owner, runs migrations.
#   picket_app: application role, neither owner nor BYPASSRLS, so row security applies.
# Passwords come from PICKET_*_PASSWORD_FILE (Docker secrets) or PICKET_*_PASSWORD.
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
