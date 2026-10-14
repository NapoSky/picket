#!/bin/sh
# restore.sh verify|restore <backup-directory> <private-age-identity>
set -eu
mode="${1:-}"
case "$mode" in verify|restore) ;; *) echo 'usage: restore.sh verify|restore <backup-directory> <private-age-identity>' >&2; exit 2 ;; esac
[ "$#" = 3 ] || { echo 'Provide a backup directory and private age identity' >&2; exit 2; }
RESTORE_ARCHIVE_DIR="$(cd "$2" && pwd)"
identity_dir="$(dirname "$3")"
RESTORE_IDENTITY_FILE="$(cd "$identity_dir" && pwd)/$(basename "$3")"
[ -f "$RESTORE_IDENTITY_FILE" ] || { echo 'Private identity not found' >&2; exit 1; }
export RESTORE_ARCHIVE_DIR RESTORE_IDENTITY_FILE
cd "$(dirname "$0")"

if [ "$mode" = verify ]; then
  restore_project="picket-restore-$$"
  cleanup() { docker compose -f restore.compose.yml -p "$restore_project" down --volumes >/dev/null; }
  trap cleanup EXIT
  docker compose build backup
  docker compose -f restore.compose.yml -p "$restore_project" up -d --wait postgres
  docker compose -f restore.compose.yml -p "$restore_project" run --rm -T restore
  # Record success within the isolated project, without touching production services.
  PICKET_BACKUP_UID="$(id -u)" PICKET_BACKUP_GID="$(id -g)" \
    docker compose -f restore.compose.yml -p "$restore_project" run --rm -T record-verification
  echo 'Isolated restore verified; temporary database will be removed.'
else
  exec 9> .rollout.lock
  flock -n 9 || { echo 'Another deployment or restoration is running' >&2; exit 1; }
  running="$(docker compose ps --status running --services)"
  for service in $running; do
    case "$service" in picket|picket-stats|backup)
      echo 'Stop picket, picket-stats and backup before restoring' >&2; exit 1 ;;
    esac
  done
  docker compose build backup
  docker compose up -d --wait postgres
  docker compose run --rm -T restore
  echo 'Database restored. Review erasures since the snapshot, then deploy its compatible image.'
fi
