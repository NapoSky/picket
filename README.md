<p align="center">
  <img src="assets/picket-banner.jpg" alt="PICKET" width="100%">
</p>

# PICKET

**The operational watchpost of a regiment.** A Discord bot for [Foxhole](https://www.foxholegame.com/) regiments: know what
must be done, what must be monitored, and what happened while you were away.

[![CI](https://github.com/NapoSky/picket/actions/workflows/ci.yml/badge.svg)](https://github.com/NapoSky/picket/actions/workflows/ci.yml)
[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-docs.picket--foxhole.com-informational)](https://docs.picket-foxhole.com)

> **Status: v1.0, running in real conditions.** The foundation, the todo lists and the timers are done. The war log is
> next. See [what is built](#what-is-built).

PICKET is faction-neutral (Wardens and Colonials alike), lightweight, and built for regiment-scale collaboration. It is a
community project: it is **not** affiliated with, endorsed by or sponsored by Siege Camp.

## What is built

| Area | State |
| --- | --- |
| **Todo lists** | `/todolist create` posts an interactive list; one button per item; quantities `(x3)`, categories, pagination beyond 25 items; the list lives in the Discord message, nothing is stored in the database |
| **Timers** | A countdown board per channel for stockpiles, facilities, fields, ships, tanks and trains; place suggestions as you type; one button per timer to refresh it, however many people click at once; silent expiry alerts with configurable thresholds and roles; strike, clean up, repair; the state lives in the database, so a deleted message is simply reposted |
| **Permissions** | Three levels (`member`, `officer`, `admin`), roles configurable per server, audit log of every change |
| **Server settings** | Language, time zone, audit channel, per-feature switches |
| **Multi-server** | Every server is isolated at the database level (row-level security) |
| **Data management** | Retention period after the bot is removed, scheduled deletion on demand, nothing kept longer than needed |
| **Languages** | English and French; add one by dropping a JSON file in [`packages/i18n/locales`](packages/i18n/locales) (Weblate-ready) |
| **Operations** | Zero-downtime rolling updates, several identical replicas, signed requests only, secrets kept out of the repository and the logs |
| War log | Planned |

### Commands

| Command | Level | What it does |
| --- | --- | --- |
| `/todolist create` | member | Opens a form and posts a todo list in the channel |
| `/timers create` | officer | Creates the timer board of the channel |
| `/timers add` / `strike` | member | Adds a timer (type, place, then a form) or strikes one |
| `/timers cleanup` / `repair` / `settings` | officer | Removes struck timers, reposts the board, shows or changes its settings |
| `/picket status` | member | Shows server settings, configured access roles and your access level |
| `/picket settings` | officer | Opens the private configuration panel; permissions and data management are admin-only |

The full guide is in the [documentation](https://docs.picket-foxhole.com). By using the official instance you accept its
[Terms of Service](https://docs.picket-foxhole.com/legal/terms) and
[Privacy Policy](https://docs.picket-foxhole.com/legal/privacy).

## Use it

PICKET needs the **View Channel**, **Send Messages** (or **Send Messages in Threads**) and **Embed Links** permissions in
the channels where you post todo lists. It requests no privileged intent and never reads message content.

Invite link (replace `<APPLICATION_ID>`):

```text
https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot%20applications.commands&permissions=274877926400
```

## Self-host it

PICKET ships as one container image, run as several identical replicas on top of PostgreSQL. The [`deploy/`](deploy)
directory contains a Docker Compose stack with its own Traefik (HTTPS on port 443 only, certificates through the
Cloudflare DNS challenge), zero-downtime updates with `docker-rollout`, and a GitHub Actions workflow that deploys by
image digest over a restricted SSH key.

Start with the [installation guide](https://docs.picket-foxhole.com/self-hosting/install) and the
[configuration reference](https://docs.picket-foxhole.com/self-hosting/configuration).

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

## Develop

Requirements: Node 24, [pnpm](https://pnpm.io) 12 (`corepack enable`), and Docker for the integration tests.

```sh
pnpm install
pnpm build              # TypeScript 7 (tsc -b)
pnpm test               # typecheck + unit tests (no Docker)
pnpm test:int           # integration tests on a throw-away PostgreSQL (needs Docker)
pnpm test:all           # both
pnpm i18n:keys          # regenerate the typed translation keys after editing en.json
pnpm docs:dev           # documentation site with live reload
```

Before integration tests, start Docker Engine or Docker Desktop and check `docker info`. Testcontainers starts its own
PostgreSQL 18 container and creates isolated, migrated test databases; it does not use the development database below.
No Discord credentials are needed: Discord replies and messages use test doubles.

Run it locally against a development Discord application (never the production one):

```sh
cp .env.example .env                                    # fill in your development application and token
docker compose -f compose.dev.yml up -d --wait          # local PostgreSQL
pnpm build
node --env-file=.env apps/bot/dist/cli.js migrate
node --env-file=.env apps/bot/dist/cli.js deploy-commands
node --env-file=.env apps/bot/dist/main.js
```

Discord must reach `POST /interactions` to deliver interactions, so expose the local port with a tunnel when you test
commands.

## Translate

English is the source language. Add or improve a language by editing `packages/i18n/locales/<discord-locale>.json`; the
file name is the Discord locale code. The CI checks keys, placeholders and Discord's length limits. Details in the
[translation guide](https://docs.picket-foxhole.com/contributing/translating).

## License

PICKET is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE): you may use, change and share it for any
noncommercial purpose, including running it for your own community, regiment or association. Selling it, or offering it as
a paid service, is not permitted. This is a source-available license, not an OSI-approved open source license.

Foxhole is a game by Siege Camp. "Foxhole", its names, logos, artwork, maps, structure and item names and icons, and the
data of the Foxhole War API belong to Siege Camp or its licensors and are **not** covered by this license. See
[NOTICE](NOTICE).

Required Notice: Copyright 2026 NapoSky (https://github.com/NapoSky/picket)
