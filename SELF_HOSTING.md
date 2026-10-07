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
| [`packages/timers`](packages/timers) | Timer boards: database state, pure rendering, alerts, board upkeep |

- **PostgreSQL** is the single source of truth. Every table that holds server data has row-level security.
- Interactions arrive as **signed HTTP requests** (Ed25519); the Gateway is only used for server lifecycle events, with
  the non-privileged `Guilds` intent.
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

### Run a development instance

Use a dedicated development Discord application and server, with its own installation settings as described above.
Keep its credentials in your local `.env` file.

```sh
cp .env.example .env                                    # fill in your development application and token
docker compose -f compose.dev.yml up -d --wait           # local PostgreSQL
pnpm build
node --env-file=.env apps/bot/dist/cli.js migrate
node --env-file=.env apps/bot/dist/cli.js deploy-commands
node --env-file=.env apps/bot/dist/main.js
```

Discord must reach `POST /interactions` to deliver interactions. Expose the local port with an HTTPS tunnel and set
the development application's **Interactions Endpoint URL** to `https://<your tunnel>/interactions` once the bot is
running.

To stop the development database while keeping its data:

```sh
docker compose -f compose.dev.yml down
```

See [Contribute](README.md#contribute) for bug reports, pull requests, documentation and translations.
