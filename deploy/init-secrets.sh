#!/bin/sh
# Génère les secrets de déploiement dans ./secrets (créés une seule fois, jamais écrasés).
# Seul le jeton du bot Discord doit être renseigné à la main.
set -eu
cd "$(dirname "$0")"

umask 077
mkdir -p secrets
chmod 700 secrets

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

# Les URL doivent reprendre les mots de passe réellement écrits sur disque.
migrator_password="$(cat secrets/picket_migrator_password)"
app_password="$(cat secrets/picket_app_password)"
generate database_migrator_url "postgres://picket_migrator:${migrator_password}@postgres:5432/picket"
generate database_url "postgres://picket_app:${app_password}@postgres:5432/picket"

if [ ! -s secrets/discord_bot_token ]; then
  : > secrets/discord_bot_token
  echo "ACTION REQUISE : collez le jeton du bot dans deploy/secrets/discord_bot_token"
fi

# Jeton d'API Cloudflare (Zone > DNS > Edit, limité à votre zone) : Traefik s'en sert pour les certificats (défi DNS-01).
if [ ! -s secrets/cloudflare_dns_token ]; then
  : > secrets/cloudflare_dns_token
  echo "ACTION REQUISE : collez le jeton Cloudflare dans deploy/secrets/cloudflare_dns_token"
fi

# Lisibles par l'utilisateur du conteneur ; le répertoire parent (700) protège l'accès côté hôte.
chmod 644 secrets/*
