#!/usr/bin/env bash
# Runs only in a one-off container, against an EMPTY database. No plaintext dump on disk.
set -euo pipefail
export PGPASSWORD="$(cat "${POSTGRES_PASSWORD_FILE:?}")"
export PGUSER=postgres
cd /restore/archive
test -s picket.dump.age
test -s /restore/identity
# Compare the expected digest of the fixed archive name. Do not trust arbitrary
# paths or filenames embedded in an externally recovered checksum file.
read -r expected filename < picket.dump.age.sha256
[[ "$expected" =~ ^[a-f0-9]{64}$ && "$filename" = picket.dump.age ]] || { echo 'Invalid archive checksum file' >&2; exit 1; }
actual="$(sha256sum picket.dump.age)"
[[ "${actual%% *}" = "$expected" ]] || { echo 'Archive checksum mismatch' >&2; exit 1; }
tables="$(psql -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S')")"
[ "$tables" = 0 ] || { echo 'Restore refused: target database is not empty' >&2; exit 1; }
age --decrypt -i /restore/identity picket.dump.age \
  | pg_restore --exit-on-error --dbname="${PGDATABASE:-picket}"

psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_class WHERE relname='guild_settings' AND relrowsecurity AND relforcerowsecurity AND pg_get_userbyid(relowner)='picket_migrator') THEN
    RAISE EXCEPTION 'Restored tenant isolation or ownership is invalid';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_proc WHERE proname='purge_guild') THEN
    RAISE EXCEPTION 'Restored purge function missing';
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='picket_app' AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Unsafe application role';
  END IF;
END $$;
SET ROLE picket_app;
DO $$ BEGIN
  IF EXISTS (SELECT FROM public.guild_settings) THEN
    RAISE EXCEPTION 'Tenant data visible without a tenant context';
  END IF;
END $$;
RESET ROLE;
SQL
echo 'Archive restored; ownership, purge function and tenant isolation verified.'
