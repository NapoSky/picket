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
| `DATABASE_POOL_MAX` | `10` | Maximum main-pool connections per bot replica (1 to 100), plus a separate fixed pool of 2 for message/board locks. |
| `ROLES` | `http-ingress` | Comma-separated roles of this process: `http-ingress` (receives interactions), `shard-runner` (Gateway connection) and `job-runner` (timer alerts, board updates and purges). Every replica can run all of them: shards and jobs are held by one replica at a time, through a lease. |
| `SHARD_COUNT` | `1` | Total number of Gateway shards (1 to 256). One shard is enough up to roughly 2,500 servers. |
| `GUILD_RETENTION_DAYS` | `30` | Days between a server becoming inactive and the erasure of its data (1 to 365). |
| `SUPPORT_GUILD_EVENTS_CHANNEL_ID` | empty | Private channel for lifecycle notifications and owner-only `/picket-ops servers`. Its server is resolved through Discord; no separate server ID is needed. Operator departures include the operator name and reason. Empty disables both features. The bot needs access to the channel and permission to send messages. Notifications use the support server’s forced PICKET language, then its Discord server language, then English. Sent messages remain in Discord. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug` or `trace`. |
| `PICKET_VERSION` | `unknown` | Identifier included in bot and CLI logs. Compose supplies the `PICKET_IMAGE` reference; manual builds can also set the `PICKET_VERSION` build argument. |
| `NODE_ENV` | `production` | `development`, `test` or `production`. |

`DISCORD_REST_GLOBAL_RPS` and `DATABASE_POOL_MAX` are passed through Compose’s `.env`. Their defaults allow one
permanent replica and a second during the switch. With multiple replicas, account for the deployment peak and one-off
tools before choosing the limits; each limit remains local to its process.
The command registration CLI uses a separate REST budget of 5 requests/s.

## War log

Add `warlog-poller` to `ROLES` to run the shared collector. Compose includes it by default.
All replicas may declare it; one lease holder collects and distributes. The bot also coordinates a 40 requests/s
authenticated REST budget through PostgreSQL, with the configured local limit still applying.

| Variable | Default | Meaning |
| --- | --- | --- |
| `WAR_API_URL` | `https://war-service-live.foxholeservices.com` | HTTPS root of the Foxhole shard API. |
| `WAR_LOG_POLL_INTERVAL` | `15` | Seconds between collection cycles (5 to 300). |

Run migrations before restarting replicas, then deploy commands. Server subscriptions start disabled; officers use
`/warlog settings`. Collector recovery resets the public baseline without replaying old events.

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

The `backup` service also uses `secrets/postgres_password` for a dump including FORCE RLS tables, except short-lived statistics history and OAuth sessions.
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

The bot withdraws readiness immediately on SIGTERM. HTTP drainage proceeds independently of background jobs;
SQL stays open until existing interactions and workers finish. The final exit deadline is the proxy drain plus
75 seconds. Compose uses a 15-second drain and a 100-second stop grace; allow at least the drain plus 75 seconds
and margin if configuring another supervisor. A background job exceeding this deadline is interrupted after
the HTTP listener has drained.

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

## Private service administration

An administrator's confirmed removal in `/picket settings` → Data makes PICKET leave that server and schedules
data erasure immediately, using `GUILD_RETENTION_DAYS`. Migration 018 also queues existing explicit deletion
requests. The job-runner resumes unfinished departures; a dispatched request is never blindly repeated after
an uncertain response, protecting later installations. No support-channel configuration is required for this flow.

Run `migrate`, then `deploy-commands`, and deploy the updated bot. The CLI resolves the server containing
`SUPPORT_GUILD_EVENTS_CHANNEL_ID` and registers **`/picket-ops servers` only in that server**, separately from
public commands. Open it in any channel of that server. The configured channel remains the destination for
lifecycle notifications. The ephemeral panel is independent of Stats.

Only the **Discord application owner**, or the **developer team owner** for a team-owned application, is authorized.
Ownership comes from the bot API: no new environment variables or Gateway intents are needed. Discord command
permissions must also allow this person to use it; registration uses administrator-only defaults. Server administrator
roles alone never grant operator access. There is no delegation interface.

Search by name (case- and accent-insensitive), filter by presence, and examine a server's registration date, enabled
modules, timer-board/active-timer counts and Warlog configuration. Presence and service suspension are separate.
Registration time is not necessarily the latest invitation time, and enabled modules do not prove usage.
Five servers appear per page. Names and reasons are escaped and mentions suppressed. Indistinguishable servers
with the same name and registration minute cannot be removed.

Choose **Prepare departure**, enter an internal reason of 10–500 characters, then type **`QUITTER`**. Submitting
requests the departure. Sessions last ten minutes; confirmations last at most two minutes and are single-use
across replicas. Refresh the server view after expiry. Ownership, support scope, membership generation, name,
configuration and retention are checked again before dispatch. The support server is always protected.

The normal data retention period applies; existing deletion deadlines are preserved. Reinvitation can reactivate
a departed server, but does not cancel an explicit deletion request. No immediate erasure, mass departure or
reinvitation block is provided. Operator identity and reason remain in private instance history, outside tenant exports.

Requests are durable. The job-runner reconciles unfinished operations every 15 seconds. An uncertain response
is checked after at least 30 seconds **without repeating the departure**. Refresh the operation or open History
for the latest result; local synchronization failures are retried and later memberships are protected. A single
private lifecycle notification includes the operator, reason and purge deadline; other Discord messages remain.
History entries show a shortened reason; **Examine** displays the full operation and reason.

Completed operations are retained for 30 days after completion, independently of tenant purge. Unresolved requests
remain for reconciliation. The job-runner cleans expired sessions and unsubmitted confirmations. Discord messages
already sent to the private channel remain there.

Rerun `deploy-commands` after changing the support server or clearing the setting: it removes the previous scoped
commands and registers the new ones when enabled. Runtime checks always enforce the current channel. Failed
channel/owner resolution denies sensitive actions while ordinary features and public deployment continue, with
an operator diagnostic. Restore channel access and rerun `deploy-commands` if scoped registration failed.

## Voice statistics and dashboard

The official instance uses **[https://stats.picket-foxhole.com](https://stats.picket-foxhole.com)**, with OAuth callback
`https://stats.picket-foxhole.com/auth/callback`. For your own instance, choose your own hostname; the examples below
use `stats.example.org` and your Discord application.

Collection is disabled per guild by default. Run migrations and deploy commands, enable **Server Members Intent** in the bot’s Developer Portal page, then configure `/stats settings`. Presence Intent and Message Content Intent stay off. Guilds and Voice States are non-privileged intents requested in code. Privileged intent approval may be required by Discord for verified applications; consult [Discord’s current requirements](https://docs.discord.com/developers/events/gateway#privileged-intents).

### Settings in the main Docker stack

Gateway sessions record the intents used when they were opened. After an upgrade changes those intents, or when
an older session has no recorded mask, the bot automatically opens a fresh session once. Look for
`gateway session incompatible; identifying with current intents`, followed by `gateway ready` in the bot logs.
Later rollouts resume compatible sessions normally. Voice activity never received under the old session cannot
be reconstructed.

Give the bot **View Channel** on tracked voice channels, including private ones; channel/category overwrites
can override the permission granted when inviting it. Statistics do not require **Connect**, **Speak** or
**Administrator**. The dashboard uses the signed-in user's OAuth scopes for membership checks. Adding bot
permissions does not change Discord's OAuth rate limits; the dashboard handles short waits automatically and
shows a retry delay for longer limits.

`picket` and `picket-stats` use the same `deploy/.env`, image and PostgreSQL database. Both services inherit
`x-picket-environment` from `deploy/compose.yml`: the existing Discord application ID, bot token and database
connection are reused. There is no separate stats environment file or second Discord application to configure.
The bot's public key remains the one configured for interaction signatures; OAuth uses the same application's
client secret, which is a separate credential supplied by Discord.

Set these values in **`deploy/.env`**, using `deploy/.env.example` as the template:

| Setting | Default | Meaning |
| --- | --- | --- |
| `DASHBOARD_HOST` | unset | Public hostname only, such as `stats.example.org`. Compose derives `DASHBOARD_URL=https://stats.example.org` for both services and configures Traefik. Empty disables the dashboard. |
| `DASHBOARD_POOL_MAX` | `2` | Maximum PostgreSQL connections for each dedicated `picket-stats` process (1–10). The bot keeps its existing `DATABASE_POOL_MAX` pool. |
| `TZ` | `Europe/Paris` | Shared instance timezone. The bot's job runner uses it for cron schedules and daily retention at 03:00. |
| `STATS_ADMIN_REFRESH_CRON` | `0 0,12 * * *` | Five-field cron for admin voice snapshots, interpreted in `TZ` and executed by the bot's job runner. Quote the value in `.env`. |
| `STATS_BUFFER_MAX_MIB` | `128` | Maximum disk allocation for queued voice event files, shared across services and overlapping replicas (1–1024 MiB). Small lock/counter/privacy files add filesystem overhead. |

For example, to enable your instance's dashboard with the default refresh schedule:

```dotenv
DASHBOARD_HOST=stats.example.org
DASHBOARD_POOL_MAX=2
TZ=Europe/Paris
STATS_ADMIN_REFRESH_CRON="0 0,12 * * *"
STATS_BUFFER_MAX_MIB=128
```

Credentials remain in **`deploy/secrets/`**, created by the existing `./init-secrets.sh` workflow:

| File | Use |
| --- | --- |
| `secrets/discord_bot_token` | Existing bot token, mounted into both services through `DISCORD_BOT_TOKEN_FILE`. |
| `secrets/database_url` | Existing application-role connection, mounted into both services through `DATABASE_URL_FILE`. |
| `secrets/discord_client_secret` | Same application's OAuth2 client secret, mounted only into `picket-stats` through `DISCORD_CLIENT_SECRET_FILE`. Required when the dashboard is enabled; the script creates an empty placeholder, not an OAuth credential. |

Compose fixes the internal dashboard port at **8082** and the shared buffer path at **`/app/data/voice-buffer`**,
backed by the `voice-buffer` volume. `DASHBOARD_URL`, `DASHBOARD_PORT`, `STATS_BUFFER_PATH` and the secret-file
paths are not settings to add to `deploy/.env`: the current Compose derives or fixes them. Changing the internal
port or buffer path requires updating the service configuration and its routing or volume mount together.

### Enable the Docker dashboard

1. For instance administration, the application must belong to a Discord **Team**. Every accepted Team member gets this access; pending invitations do not. Team roles are not restricted further. No admin identifier or enrolment secret is configured. Member and officer dashboards do not require Team membership.
2. Register `https://stats.example.org/auth/callback` as an OAuth2 redirect on that application. The user scopes are `identify`, `guilds`, `guilds.members.read`; they differ from Gateway intents.
3. Run `./init-secrets.sh` in `deploy/`: it creates empty files for the bot token and OAuth2 client secret, alongside the generated PostgreSQL secrets. Paste the **real OAuth2 client secret** from the same application into `secrets/discord_client_secret`. It is distinct from the bot token and the public key; Discord issues both credentials. Existing values are preserved on subsequent runs.
4. Set `DASHBOARD_HOST=stats.example.org` in `deploy/.env`. Configure this host in Cloudflare as for `PICKET_HOST`. Everything is included in the main `compose.yml`; no override or second application is needed. Leave the host unset and the OAuth placeholder empty to keep the dashboard disabled.
5. Deploy with the usual rollout script: it updates `picket` and `picket-stats` independently after migrations. Traefik routes the dashboard to `picket-stats:8082` and interactions to `picket:8080`. Each service has its own internal health endpoint and shutdown drain.

### Run outside Compose

For a manual Node.js launch, configure `DASHBOARD_URL` directly instead of `DASHBOARD_HOST`, and provide the
existing `DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN` / `_FILE` and `DATABASE_URL` / `_FILE` to the HTTP process.
`DISCORD_CLIENT_SECRET` / `_FILE` is required when the URL is set. The HTTP process does not require
`DISCORD_PUBLIC_KEY` or bot `ROLES`.

| Variable | Runtime default | Meaning |
| --- | --- | --- |
| `DASHBOARD_URL` | unset | Public HTTPS origin without a path; non-production also permits HTTP on `localhost` or `127.0.0.1`. |
| `DASHBOARD_PORT` | `8082` | Dashboard HTTP listener port. |
| `STATS_BUFFER_PATH` | `./data/voice-buffer` | Private, persistent writable directory shared with the bot. |

Local development reuses the root `.env.example`, `.env.dev` and `compose.dev.yml`. Use `pnpm stats:dev` for
fictitious data, `pnpm stats:dev:live` for local PostgreSQL with a simulated identity, or `pnpm stats:dev:oauth`
for real Discord sign-in. See the [development setup](https://github.com/NapoSky/picket/blob/main/SELF_HOSTING.md#develop-and-test-the-stats-dashboard)
for commands, credentials and ports. The schedules remain configured on the separately running bot.
The simulated admin launch prepares its snapshot once at startup; subsequent scheduled refreshes need the bot's job runner.

### Runtime, refresh and retention

Session cookies are opaque, Secure/HttpOnly/SameSite=Lax on HTTPS. OAuth state is single-use and expires after ten minutes; encrypted access tokens and sessions expire within eight hours. POST actions require same-origin CSRF validation. Tokens are never sent to frontend JavaScript. Rotating the client secret invalidates existing encrypted sessions; sign in again.

In production, the dashboard runs in **its own Node.js process and container** (`apps/stats`), with its own event loop and memory. It starts no Gateway shard, voice collector or maintenance jobs. Collection stays in `picket`; PostgreSQL and the private voice-buffer volume are shared. The HTTP service needs writable access to that volume for privacy markers and erasure of pending facts. With no dashboard host, it runs only internal health and opens no SQL pool or public dashboard listener. The OAuth secret is mounted only into `picket-stats`.

Budget **bot replicas × (main pool + 2 lock connections) + stats replicas × dashboard pool**, plus CLI, backup and administrative connections. One bot plus one enabled HTTP service defaults to 10 + 2 + 2 connections. Bot-authenticated requests from both services share the PostgreSQL Discord budget; the dashboard additionally caps its local rate at 5 RPS. Reports use indexed, exact presence segments with transaction-scoped RLS; no Superset, Grafana, ClickHouse, Redis or BI metadata service is required. Member and officer reports derive hourly and daily figures at read time. The global admin report and its exports read private native PostgreSQL materialized views, rebuilt at midnight and noon by default. The UI states the snapshot timestamp; connected people refer to that snapshot, not the current moment. Change `STATS_ADMIN_REFRESH_CRON` and `TZ` to set the instance schedule. The existing leased job runner performs refreshes, catches up after outages and retries failures; the HTTP service never refreshes a view. Initial population uses ordinary `REFRESH`; later updates use `CONCURRENTLY` and publish all views atomically. A refresh can consume one main-pool connection for up to ten minutes; test and monitor the actual workload.

All history is bounded to 60 days at read time. The leased maintenance job cleans expired rows in bounded batches approximately every two minutes; a large expired backlog or outage can delay physical cleanup. Expired disk records are removed during buffer maintenance, including when SQL replay fails. Monitor job health and recover outages promptly. The database remains necessary for shard leases; a disk buffer cannot guarantee uninterrupted collection throughout a PostgreSQL outage.

Erasure and guild purge invalidate the global snapshot in the same transaction. While a replacement is pending, admin reports and exports return a temporary-unavailability response rather than stale contributions; ordinary guild/member views remain available. The worker checks invalidations every minute and refreshes outside the normal cron. The daily retention pass also invalidates the snapshot. Every report applies the current sliding 60-day cutoff even to older snapshots; physical aggregate cleanup follows refresh completion.

**Backups exclude statistics history, materialized snapshot data and OAuth/session data**, while keeping schema, stats configuration and privacy preferences. This prevents backups from extending the statistical retention period and from restoring erased activity. A database-volume loss therefore loses statistical history. External snapshots, downloaded exports and operator backups must follow the same retention policy; the application cannot purge copies it does not manage.
