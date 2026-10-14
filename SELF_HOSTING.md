# Self-hosting and local development

Run your own PICKET instance or set up a development environment. For an invitation to the official instance and a
feature overview, see the [README](README.md).

## Self-hosting

PICKET ships as one container image, run as several identical replicas on top of PostgreSQL. The [`deploy/`](deploy)
directory contains a Docker Compose stack with Traefik (HTTPS on port 443 only, certificates through the Cloudflare DNS
challenge), zero-downtime updates with `docker-rollout`, and encrypted PostgreSQL backups. The repository also ships a
GitHub Actions workflow that deploys images by digest over a restricted SSH key.

Start with the [installation guide](https://docs.picket-foxhole.com/self-hosting/install) and the
[configuration reference](https://docs.picket-foxhole.com/self-hosting/configuration). They cover host requirements,
Discord application setup, secrets, backup keys, first deployment and updates.

Optional operator monitoring and Discord alerts are described in the
[monitoring guide](docs/self-hosting/monitoring.md). Restore commands and the
monthly isolated verification are in [disaster recovery](docs/self-hosting/disaster_recovery.md).

Create your own Discord application for your instance. In the Developer Portal, configure **Guild Install** with the
`bot` and `applications.commands` scopes and these permissions:

- **View Channel**
- **Send Messages**
- **Embed Links**
- **Read Message History**
- **Send Messages in Threads**, if you use PICKET in threads

Select **Discord Provided Link** and use the generated link to invite your instance. Its default installation settings
supply the scopes and permissions; the official PICKET invitation in the README installs the official instance.

## How it works

A modular monolith in a pnpm workspace, organised in clean layers (`domain`, `application`, `infrastructure`,
`presentation`) that an architecture test enforces.

| Package | Role |
| --- | --- |
| [`apps/bot`](apps/bot) | Composition root: HTTP server, Gateway runner, command line |
| [`packages/kernel`](packages/kernel) | Identifiers, `Result`, clock, logger, secrets |
| [`packages/config`](packages/config) | Environment validation |
| [`packages/observability`](packages/observability) | Structured logs and health endpoints |
| [`packages/i18n`](packages/i18n) | Translations and catalog checks |
| [`packages/persistence`](packages/persistence) | Database access, migrations, row-level security |
| [`packages/coordination`](packages/coordination) | Leases with fencing, per-key locks, Gateway session store |
| [`packages/discord`](packages/discord) | Interaction pipeline, command and component registries, REST and Gateway adapters |
| [`packages/guild`](packages/guild) | Servers: settings, permissions, lifecycle |
| [`packages/game-data`](packages/game-data) | Regions and locations of the game, and the search behind the autocomplete |
| [`packages/todolist`](packages/todolist) | Todo lists: grammar, layout, ticking |
| [`packages/stats`](packages/stats) | Filtered voice facts, persistent buffer, OAuth dashboard and privacy |
| [`packages/timers`](packages/timers) | Timer boards: database state, pure rendering, alerts, board upkeep |

- **PostgreSQL** is the single source of truth. Every table that holds server data has row-level security.
- Interactions arrive as **signed HTTP requests** (Ed25519); the Gateway is used for server lifecycle and voice/role events, with
  `Guilds`, `GuildVoiceStates` and privileged `GuildMembers` intents for vocal statistics. Enable **Server Members Intent** in the Developer Portal; Presence and Message Content remain disabled.
- Work that must run once (a Gateway shard, the periodic jobs) is held through a **lease with a fencing token**;
  interactions are claimed once across replicas.
- Buttons and forms share one chain with commands: duplicate detection, access level, feature switch, suspension,
  language, error handling.

## Local development

Requirements: Node 24, [pnpm](https://pnpm.io) 12 (`corepack enable`), and Docker for the development database and
integration tests.

### Install and check

From the repository root:

```sh
pnpm install
pnpm build              # TypeScript 7 (tsc -b)
pnpm test               # typecheck + unit tests (no Docker)
pnpm test:arch          # architecture boundaries
pnpm test:int           # integration tests on a throw-away PostgreSQL (needs Docker)
pnpm test:all           # typecheck + unit and integration tests
pnpm i18n:keys          # regenerate typed translation keys after editing en.json
pnpm docs:dev           # documentation site with live reload
pnpm docs:build         # build the documentation
```

Before integration tests, start Docker Engine or Docker Desktop and check `docker info`. Testcontainers starts its own
PostgreSQL 18 container and creates isolated, migrated test databases; it does not use the development database below.
No Discord credentials are needed for the automated tests: Discord replies and messages use test doubles.

### Develop and test the stats dashboard

```sh
pnpm stats:dev                    # offline preview: http://127.0.0.1:8082, synthetic data, admin view
pnpm stats:dev member --port 8083 # member view on another local port
pnpm stats:dev admin --host       # administrator preview on all interfaces
pnpm stats:dev --host 192.168.1.10 # listen on a specific address
pnpm stats:dev officer           # officer in Demo regiment, member in Demo allies
pnpm stats:test                  # typecheck, stats unit tests, config and secret initialization
pnpm stats:test:int              # stats integration tests, isolated PostgreSQL 18 (Docker)
pnpm stats:test:load             # opt-in benchmark: 300 guilds × 50 people × 8 segments/day × 60 days (Docker)
```

The load benchmark runs only through `pnpm stats:test:load`; it is excluded from ordinary test commands and CI.
Use it for a performance investigation or after changing report queries, indexes or materialized views.
`STATS_LOAD_PEOPLE` and `STATS_LOAD_SEGMENTS` can reduce its default 7.2-million-segment workload.

The preview uses the actual dashboard HTML/CSS/JS with a separate in-memory API and a visible fictitious-data banner.
Its deterministic 60-day fixture contains five servers, 74 distinct people (98 server/person pairs) and four channels.
Six people belong to all five servers. Activity includes weekday and weekend patterns, operation spikes, morning
logistics and a reserve server whose collection stopped ten days ago. Select 30 or 60 days to see its retained history.
It needs no `.env`, Discord credentials or database and listens on loopback by default.
`--host` listens on all interfaces; `--host <address>` selects an IP address or hostname.
Both `pnpm stats:dev admin --host` and `pnpm stats:dev --mode admin --host` select the same view.
The positional role never changes the directory served; the dashboard stays at `/`.
Vite handles `--host`, `--port`, `--help` and CLI errors natively. Invalid options, invalid
preview modes and occupied ports terminate with a non-zero exit code (`strictPort` is enabled). Test language, themes, scopes,
period/channel filters, downloads and privacy controls; restarting resets its data. Vite reloads the browser
when static assets change. For API TypeScript changes, run `pnpm build` and restart `pnpm stats:dev`.
The production entry point never mounts this preview API. Automated integration tests exercise real OAuth/session
handling, fresh access checks, RLS and retention with Discord test doubles and temporary databases.

For the connected development environment, keep development parameters in **`.env.dev`**, with `.env.example`
as defaults. The shared `stats:dev:prepare` command starts PostgreSQL from the existing `compose.dev.yml`, builds
the application and applies its migrations. Keep deployment `.env` separate.

```sh
pnpm stats:dev:live admin --host    # real local PostgreSQL, simulated Discord administrator
pnpm stats:dev:live officer        # simulated officer; loopback by default
pnpm stats:dev:live member         # simulated member; loopback by default
pnpm stats:dev:live admin --port 8083
```

This mode reads the **real development database** and uses a clearly labelled simulated Discord identity. Click
**Start development session** to sign in locally; no Discord requests or OAuth secret are needed. It does not seed
or replace statistics. `admin` selects instance administration, `officer` regiment access and `member` personal access
for the development account. `--host` listens on all interfaces, otherwise only loopback. PostgreSQL must be local
and `NODE_ENV` must be `development`; the production entry point never enables simulated identities. The health
endpoint defaults to 8084, so the bot can keep 8081.

For real Discord OAuth, use `pnpm stats:dev:oauth`. Set `DISCORD_CLIENT_SECRET` (or its `_FILE` counterpart) in
`.env.dev` and register `http://localhost:8082/auth/callback` on that development application. Access then comes from
real guild and application Team membership. This command accepts no simulated role.

Start `node --env-file=.env.example --env-file=.env.dev apps/bot/dist/main.js` in another terminal for the bot and
voice collector. Both processes share `STATS_BUFFER_PATH`; their roles are independent. When running real OAuth
and the bot together, choose distinct health ports: `HEALTH_PORT=8084 pnpm stats:dev:oauth` (the bot defaults to 8081).
Do not run the preview and live dashboard on the same HTTP port simultaneously.

### Run a development instance

Use a dedicated development Discord application and server, with its own installation settings as described above.
Keep its credentials in your local `.env.dev` file.

```sh
cp .env.example .env.dev                                    # fill in your development application and token
docker compose -f compose.dev.yml up -d --wait           # local PostgreSQL
pnpm build
node --env-file=.env.example --env-file=.env.dev apps/bot/dist/cli.js migrate
node --env-file=.env.example --env-file=.env.dev apps/bot/dist/cli.js deploy-commands
node --env-file=.env.example --env-file=.env.dev apps/bot/dist/main.js
```

Discord must reach `POST /interactions` to deliver interactions. Expose the local port with an HTTPS tunnel and set
the development application's **Interactions Endpoint URL** to `https://<your tunnel>/interactions` once the bot is
running.

To stop the development database while keeping its data:

```sh
docker compose -f compose.dev.yml down
```

See [Contribute](README.md#contribute) for bug reports, pull requests, documentation and translations.

Admin voice dashboards use PostgreSQL materialized snapshots. Configure `TZ=Europe/Paris` and
`STATS_ADMIN_REFRESH_CRON="0 0,12 * * *"` in the instance environment. The existing job-runner
refreshes at these deadlines and after erasure/purge; the HTTP process only reads snapshots.
Live development prepares an admin snapshot once at startup; run the bot job-runner separately for scheduled refreshes and invalidations.
Member/officer views keep their current freshness. The UI displays the snapshot timestamp;
60-day clipping applies even before physical cleanup. Backups exclude all `stats_admin_*` data.
