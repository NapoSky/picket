#!/bin/sh
# All dump, encryption and retention tools run inside the backup container.
set -eu
cd "$(dirname "$0")"

# Supply the deployment user's identity to Compose at runtime, without editing .env.
PICKET_BACKUP_UID="$(id -u)"
PICKET_BACKUP_GID="$(id -g)"
export PICKET_BACKUP_UID PICKET_BACKUP_GID

case "${1:-daily}" in
  start) docker compose up -d backup ;;
  *) docker compose run --rm -T backup "${1:-daily}" ;;
esac
