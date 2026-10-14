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

docker compose pull picket picket-stats
docker compose build backup
docker compose up -d --wait postgres traefik
docker compose exec -T postgres sh /opt/picket/monitoring-role.sh
# Before migration, the snapshot belongs to the image currently serving requests.
# On a first install there is no previous image; use the initial deployment image.
BACKUP_SOURCE_IMAGE="$(docker compose exec -T picket node -p 'process.env.PICKET_VERSION || "unknown"' 2>/dev/null || true)"
if [ -z "$BACKUP_SOURCE_IMAGE" ] || [ "$BACKUP_SOURCE_IMAGE" = unknown ]; then BACKUP_SOURCE_IMAGE="$PICKET_IMAGE"; fi
export BACKUP_SOURCE_IMAGE
./backup.sh pre-migration
unset BACKUP_SOURCE_IMAGE
docker compose run --rm migrate
docker rollout -f compose.yml picket
docker rollout -f compose.yml picket-stats
docker compose up -d backup
# Mounted configuration files do not change Compose's service hash. Reload the
# running monitoring services so copied dashboards, alerts and collectors take effect.
monitoring_services=""
for service in $(docker compose config --services); do
  case "$service" in grafana|prometheus|loki|alloy|operations-exporter|node-exporter|postgres-exporter)
    monitoring_services="$monitoring_services $service" ;;
  esac
done
if [ -n "$monitoring_services" ]; then
  docker compose up -d $monitoring_services
  docker compose restart $monitoring_services
fi
docker compose run --rm deploy-commands
