#!/bin/sh
# Zero-downtime update. Requires the docker-rollout plugin
# (https://github.com/wowu/docker-rollout), with `.env` and `secrets/` in place. Traefik is part of the stack.
#
# Order: verified encrypted backup -> compatible migrations -> rolling replica update
# -> command registration (only if the command definitions changed).
set -eu
umask 077
cd "$(dirname "$0")"

PICKET_IMAGE="${1:?usage: rollout.sh <image-reference>}"
export PICKET_IMAGE

# Supply the deployment user's identity to Compose at runtime, without editing .env.
PICKET_BACKUP_UID="$(id -u)"
PICKET_BACKUP_GID="$(id -g)"
export PICKET_BACKUP_UID PICKET_BACKUP_GID

# Serialise the whole deployment, including manual calls (not just the migrator).
exec 9> .rollout.lock
if ! flock -n 9; then
  echo 'another PICKET deployment is already running' >&2
  exit 1
fi

docker compose pull picket
docker compose build backup
docker compose up -d --wait postgres traefik
./backup.sh pre-migration
docker compose run --rm migrate
docker rollout -f compose.yml picket
docker compose up -d backup
docker compose run --rm deploy-commands
