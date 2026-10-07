# Configuration

PICKET is configured through environment variables. A value that is a secret can instead be provided as a file by
suffixing the name with `_FILE` (Docker secrets); giving both is an error.

## Application

| Variable | Default | Meaning |
| --- | --- | --- |
| `DISCORD_APPLICATION_ID` | required | Application identifier. |
| `DISCORD_PUBLIC_KEY` | required | 64 hexadecimal characters; verifies the signature of incoming interactions. |
| `DISCORD_BOT_TOKEN` / `_FILE` | required | Bot token. Never logged. |
| `DISCORD_REST_GLOBAL_RPS` | `20` | Shared authenticated REST request limit per process (1 to 40). Covers messages, roles, channels and Gateway; interaction replies use a separate client. |
| `DATABASE_URL` / `_FILE` | required | PostgreSQL connection string of the **application role** (no ownership, subject to row security). |
| `DATABASE_POOL_MAX` | `10` | Maximum connections per replica (1 to 100). |
| `ROLES` | `http-ingress` | Comma-separated roles of this process: `http-ingress` (receives interactions), `shard-runner` (Gateway connection) and `job-runner` (timer alerts, board updates and purges). Every replica can run all of them: shards and jobs are held by one replica at a time, through a lease. |
| `SHARD_COUNT` | `1` | Total number of Gateway shards (1 to 256). One shard is enough up to roughly 2,500 servers. |
| `GUILD_RETENTION_DAYS` | `30` | Days between a server becoming inactive and the erasure of its data (1 to 365). |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug` or `trace`. |
| `PICKET_VERSION` | `unknown` | Identifier included in bot and CLI logs. Compose supplies the `PICKET_IMAGE` reference; manual builds can also set the `PICKET_VERSION` build argument. |
| `NODE_ENV` | `production` | `development`, `test` or `production`. |

`DISCORD_REST_GLOBAL_RPS` and `DATABASE_POOL_MAX` are passed through Compose’s `.env`. Their defaults allow one
permanent replica and a second during the switch. With multiple replicas, account for the deployment peak and one-off
tools before choosing the limits; each limit remains local to its process.
The command registration CLI uses a separate REST budget of 5 requests/s.

## Docker backups

These settings belong to the stack’s `.env`, rather than the bot’s application configuration:

| Setting | Default | Meaning |
| --- | --- | --- |
| `BACKUP_DIR` | `../backups` | Host directory mounted at `/backups`. Relative paths are resolved from `deploy/`; create it with mode `700` before starting. |
| `secrets/backup_recipients` | required | Public `age1…` recipients, one per line, created by `init-secrets.sh`. Kept on the server. |

`init-secrets.sh` also creates `secrets/backup_identity` (private identity, mode `600`) and asks you to store it in a vault
then remove it from the server. This file is not mounted into any service; it is used only for restoration.

`backup.sh` and `rollout.sh` detect the deployment user’s UID/GID and supply them to Compose through the process
environment. You do not need to set them in `.env`; the scripts do not write to that file.

The `backup` service also uses `secrets/postgres_password` for a complete dump, including tables protected by FORCE RLS.
It encrypts the stream directly; no plaintext archive is written to disk. `rollout.sh` stops before migrations if the
backup or its verification fails.

Daily backups run at **03:30 Europe/Paris**. Retention is fixed at **five successful backups in total**, daily and
pre-migration combined, with a maximum age of **30 days**. These limits are independent of `GUILD_RETENTION_DAYS`.
See [installation](./install#_3-prepare-backups) for key setup and directory permissions.

## Network and shutdown

| Variable | Default | Meaning |
| --- | --- | --- |
| `HTTP_PORT` | `8080` | Port of the interactions endpoint. |
| `HEALTH_PORT` | `8081` | Port of `/healthz` and `/readyz`. Keep it internal. |
| `SHUTDOWN_DRAIN_MS` | `10000` | Time spent reporting "not ready" before stopping, so the reverse proxy can remove the replica (0 to 120000). |

## Migrations

Used by the `migrate` task only, with the database **owner** role:

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_MIGRATOR_URL` / `_FILE` | required | Connection string of the owner role. |
| `DATABASE_APP_ROLE` | `picket_app` | Role that receives the privileges on the tables. |

## Command line

```sh
node apps/bot/dist/cli.js migrate               # apply database migrations
node apps/bot/dist/cli.js deploy-commands       # register slash commands (--force to redeploy)
node apps/bot/dist/cli.js purge                 # erase expired servers, journals > 30 days and interaction records > 7 days
```

For backups, from `deploy/`:

```sh
./backup.sh daily                 # verified encrypted backup on demand
./backup.sh prune                 # apply only count and age retention
./backup.sh start                 # start the daily service with automatically detected permissions
```
