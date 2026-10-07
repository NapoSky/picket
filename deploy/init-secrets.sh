#!/bin/sh
# Generate deployment secrets in ./secrets (created once, never overwritten).
# Discord and Cloudflare tokens are supplied manually.
# Both age keys are generated here; move the private identity off-host afterward.
set -eu
cd "$(dirname "$0")"

umask 077
mkdir -p secrets
chmod 700 secrets
exec 9> secrets/.init.lock
if ! flock -n 9; then
  echo 'another secrets initialization is already running' >&2
  exit 1
fi

# Preserve an existing public recipient, including one whose private identity
# has already been moved off-host. Never rotate keys on a repeated init.
if [ ! -s secrets/backup_recipients ]; then
  if ! command -v age-keygen >/dev/null 2>&1; then
    if ! docker image inspect picket-postgres-backup:18 >/dev/null 2>&1; then
      docker build -t picket-postgres-backup:18 ./backup
    fi
  fi

  keygen() {
    if command -v age-keygen >/dev/null 2>&1; then
      (cd secrets && age-keygen "$@")
    else
      docker run --rm --user "$(id -u):$(id -g)" \
        --mount "type=bind,source=$PWD/secrets,target=/keys" --workdir /keys \
        --entrypoint age-keygen picket-postgres-backup:18 "$@"
    fi
  }

  backup_work="$(mktemp -d secrets/.backup-keys.XXXXXXXX)"
  trap 'rm -rf -- "$backup_work"' EXIT
  if [ ! -s secrets/backup_identity ]; then
    keygen -o "${backup_work#secrets/}/backup_identity"
    chmod 600 "$backup_work/backup_identity"
    mv "$backup_work/backup_identity" secrets/backup_identity
  fi
  chmod 600 secrets/backup_identity
  keygen -y backup_identity > "$backup_work/backup_recipients"
  if [ ! -s "$backup_work/backup_recipients" ]; then
    echo 'backup key generation produced no public recipient' >&2
    exit 1
  fi
  mv "$backup_work/backup_recipients" secrets/backup_recipients
  echo 'created secrets/backup_recipients'
fi

if [ -f secrets/backup_identity ]; then
  chmod 600 secrets/backup_identity
  echo 'ACTION REQUIRED: store secrets/backup_identity (PRIVATE KEY) in a vault with a recovery plan, then remove it from this server.'
  echo 'Backups cannot be restored without this private key. Keep secrets/backup_recipients (PUBLIC KEY) on the server.'
fi

generate() {
  if [ ! -s "secrets/$1" ]; then
    printf '%s' "$2" > "secrets/$1"
    echo "created secrets/$1"
  fi
}

random() { openssl rand -hex 24; }

postgres_password="$(random)"
migrator_password="$(random)"
app_password="$(random)"

generate postgres_password "$postgres_password"
generate picket_migrator_password "$migrator_password"
generate picket_app_password "$app_password"

# Connection URLs must use the passwords actually stored on disk.
migrator_password="$(cat secrets/picket_migrator_password)"
app_password="$(cat secrets/picket_app_password)"
generate database_migrator_url "postgres://picket_migrator:${migrator_password}@postgres:5432/picket"
generate database_url "postgres://picket_app:${app_password}@postgres:5432/picket"

if [ ! -s secrets/discord_bot_token ]; then
  : > secrets/discord_bot_token
  echo "ACTION REQUIRED: paste the bot token into deploy/secrets/discord_bot_token"
fi

# Cloudflare API token (Zone > DNS > Edit, restricted to your zone): Traefik uses it for certificates (DNS-01 challenge).
if [ ! -s secrets/cloudflare_dns_token ]; then
  : > secrets/cloudflare_dns_token
  echo "ACTION REQUIRED: paste the Cloudflare token into deploy/secrets/cloudflare_dns_token"
fi

# Readable by the container user; the parent directory (700) protects access on the host.
chmod 644 secrets/postgres_password secrets/picket_migrator_password secrets/picket_app_password \
  secrets/database_migrator_url secrets/database_url secrets/discord_bot_token \
  secrets/cloudflare_dns_token secrets/backup_recipients
