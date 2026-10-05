#!/bin/sh
# Commande forcée de la clé SSH utilisée par GitHub Actions (voir la documentation d'auto-hébergement) :
#   command="/opt/picket/deploy/ssh-entrypoint.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA… picket-deploy
# La clé ne peut rien faire d'autre que déployer une image identifiée par son condensat.
set -eu

image="${SSH_ORIGINAL_COMMAND:-}"

if ! printf '%s' "$image" | grep -Eq '^ghcr\.io/[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$'; then
  echo "refused: expected ghcr.io/<owner>/<image>@sha256:<digest>" >&2
  exit 2
fi

# Le workflow envoie sur l'entrée standard le jeton éphémère du job (GITHUB_TOKEN, lecture des paquets) :
# aucun jeton personnel n'est stocké sur le serveur, et celui-ci expire à la fin du job.
IFS= read -r registry_token || true
if [ -n "$registry_token" ]; then
  printf '%s' "$registry_token" | docker login ghcr.io -u github-actions --password-stdin > /dev/null
  trap 'docker logout ghcr.io > /dev/null 2>&1 || true' EXIT
fi

"$(dirname "$(readlink -f "$0")")/rollout.sh" "$image"
