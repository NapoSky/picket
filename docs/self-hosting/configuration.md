# Configuration

PICKET is configured through environment variables. A value that is a secret can instead be provided as a file by
suffixing the name with `_FILE` (Docker secrets); giving both is an error.

## Application

| Variable | Default | Meaning |
| --- | --- | --- |
| `DISCORD_APPLICATION_ID` | required | Application identifier. |
| `DISCORD_PUBLIC_KEY` | required | 64 hexadecimal characters; verifies the signature of incoming interactions. |
| `DISCORD_BOT_TOKEN` / `_FILE` | required | Bot token. Never logged. |
| `DATABASE_URL` / `_FILE` | required | PostgreSQL connection string of the **application role** (no ownership, subject to row security). |
| `DATABASE_POOL_MAX` | `10` | Maximum connections per replica (1 to 100). |
| `ROLES` | `http-ingress` | Comma-separated roles of this process: `http-ingress` (receives interactions), `shard-runner` (Gateway connection) and `job-runner` (timer alerts, board updates and purges). Every replica can run all of them: shards and jobs are held by one replica at a time, through a lease. |
| `SHARD_COUNT` | `1` | Total number of Gateway shards (1 to 256). One shard is enough up to roughly 2,500 servers. |
| `GUILD_RETENTION_DAYS` | `30` | Days between a server becoming inactive and the erasure of its data (1 to 365). |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug` or `trace`. |
| `NODE_ENV` | `production` | `development`, `test` or `production`. |

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
node apps/bot/dist/cli.js purge                 # erase servers past the retention period and interaction records older than 7 days
```
