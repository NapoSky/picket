#!/bin/sh
# Mise à jour sans interruption. Prérequis : plugin docker-rollout
# (https://github.com/wowu/docker-rollout), Traefik avec le provider Docker, `.env` et `secrets/` en place.
#
# Ordre : migrations (ajouts seulement, compatibles avec l'ancienne version) -> bascule progressive
# des répliques -> enregistrement des commandes (seulement si leur définition a changé).
set -eu
cd "$(dirname "$0")"

PICKET_IMAGE="${1:?usage: rollout.sh <image-reference>}"
export PICKET_IMAGE

docker compose pull picket
docker compose up -d --wait postgres
docker compose run --rm migrate
docker rollout -f compose.yml picket
docker compose run --rm deploy-commands
