#!/usr/bin/env bash
# Stream a complete database dump directly into public-key encryption.
# No plaintext archive is stored; the backup container receives no private decryption key.
set -euo pipefail
umask 077
cd "$(dirname "$0")"

reason="${1:-daily}"
case "$reason" in daily|pre-migration|prune|schedule) ;; *) echo 'usage: backup.sh [daily|pre-migration|prune|schedule]' >&2; exit 2 ;; esac
if [ "$reason" = schedule ]; then exec python3 ./schedule.py; fi
: "${BACKUP_DIR:=/backups}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
exec 8> "$BACKUP_DIR/.backup.lock"
flock -w 300 8

# Run retention first, so a failed daily dump cannot retain old snapshots forever.
python3 ./retention.py "$BACKUP_DIR"
if [ "$reason" = prune ]; then exit 0; fi
: "${BACKUP_RECIPIENTS_FILE:=/run/secrets/backup_recipients}"
# Reject identities and password-based encryption: the container receives only public age recipients.
python3 - "$BACKUP_RECIPIENTS_FILE" <<'PY'
import pathlib, re, sys
recipients = [line.strip() for line in pathlib.Path(sys.argv[1]).read_text().splitlines()
              if line.strip() and not line.lstrip().startswith('#')]
if not recipients or any(not re.fullmatch(r'age1[0-9a-z]+', key) for key in recipients):
    sys.exit('backup recipients must contain only public age1... keys')
PY

PGPASSWORD="$(cat "${POSTGRES_PASSWORD_FILE:?set POSTGRES_PASSWORD_FILE}")"
export PGPASSWORD

stamp="$(date -u +'%Y%m%dT%H%M%SZ')"
work="$(mktemp -d "$BACKUP_DIR/picket-$stamp-XXXXXXXX.partial")"
trap 'rm -rf -- "$work"' EXIT
archive="$work/picket.dump.age"

# pipefail detects failures of pg_dump, encryption, the write AND hashing.
# postgres is deliberately used: app and migrator roles cannot bypass FORCE RLS.
pg_dump --username=postgres --dbname="${PGDATABASE:-picket}" --format=custom \
  | age --encrypt --recipients-file "$BACKUP_RECIPIENTS_FILE" \
  | tee "$archive" \
  | sha256sum > "$work/stream.sha256"
expected="$(cut -d ' ' -f 1 "$work/stream.sha256")"
actual="$(sha256sum "$archive")"
if [ "$expected" != "${actual%% *}" ] || [ ! -s "$archive" ]; then
  echo 'encrypted backup failed read-back verification' >&2
  exit 1
fi
printf '%s  picket.dump.age\n' "$expected" > "$work/picket.dump.age.sha256"
printf 'created_at=%s\nreason=%s\n' "$stamp" "$reason" > "$work/manifest.txt"
rm "$work/stream.sha256"
sync -f "$archive"
destination="${work%.partial}"
mv "$work" "$destination"
# Rotate only after the new archive is verified and published. Failed attempts
# must not evict one of the five existing complete backups to make room.
python3 ./retention.py "$BACKUP_DIR"
sync -f "$BACKUP_DIR"
date -u +'%s' > "$BACKUP_DIR/.last-success.new"
mv "$BACKUP_DIR/.last-success.new" "$BACKUP_DIR/.last-success"
echo "encrypted PostgreSQL backup verified: $(basename "$destination")"
