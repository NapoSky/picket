#!/bin/sh
set -eu
[ -n "${MONITORING_HOST:-}" ] || { echo 'Set MONITORING_HOST in .env' >&2; exit 1; }
case "${MONITORING_DISCORD_WEBHOOK_URL:-}" in
  https://discord.com/api/webhooks/*|https://discordapp.com/api/webhooks/*) ;;
  *) echo 'Set MONITORING_DISCORD_WEBHOOK_URL to a Discord webhook in .env' >&2; exit 1 ;;
esac
exec /run.sh
