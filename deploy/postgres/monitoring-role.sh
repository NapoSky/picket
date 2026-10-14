#!/bin/sh
# Run after postgres is healthy, also on upgrades of existing volumes.
set -eu
password="$(cat "${PICKET_MONITOR_PASSWORD_FILE:?set PICKET_MONITOR_PASSWORD_FILE}")"
[ -n "$password" ] || { echo 'monitoring password is empty' >&2; exit 1; }
psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-picket}" \
  -v monitor_password="$password" <<'SQL'
SELECT 'CREATE ROLE picket_monitor LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'picket_monitor') \gexec
ALTER ROLE picket_monitor PASSWORD :'monitor_password';
GRANT pg_monitor TO picket_monitor;
SQL
