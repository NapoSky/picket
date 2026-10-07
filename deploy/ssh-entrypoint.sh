#!/bin/sh
# Forced command for the SSH key used by GitHub Actions (see the self-hosting documentation):
#   command="/opt/picket/deploy/ssh-entrypoint.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA… picket-deploy
# The key can only deploy an image referenced by its digest.
set -eu

image="${SSH_ORIGINAL_COMMAND:-}"

if ! printf '%s' "$image" | grep -Eq '^ghcr\.io/[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$'; then
  echo "refused: expected ghcr.io/<owner>/<image>@sha256:<digest>" >&2
  exit 2
fi

# The workflow sends the temporary job token through standard input (GITHUB_TOKEN, package read access):
# no personal token is stored on the server, and the job token expires when the job ends.
IFS= read -r registry_token || true
if [ -n "$registry_token" ]; then
  printf '%s' "$registry_token" | docker login ghcr.io -u github-actions --password-stdin > /dev/null
  trap 'docker logout ghcr.io > /dev/null 2>&1 || true' EXIT
fi

"$(dirname "$(readlink -f "$0")")/rollout.sh" "$image"
