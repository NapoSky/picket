# Architecture

Interactive views of the [self-hosted stack](../self-hosting/architecture) and
[data export and lifecycle](../self-hosting/data-lifecycle) complement this code overview.

PICKET is a modular monolith in a pnpm workspace: one image, several identical replicas, PostgreSQL as the single
source of truth.

```text
apps/bot            bot composition: interactions, Gateway, jobs and CLI
apps/stats          isolated dashboard HTTP process and bounded SQL pool
packages/kernel     identifiers, Result, Clock, Logger, Secret
packages/config     environment validation
packages/i18n       translations, locale resolution, catalog checks
packages/persistence  database access, migrations, row-level security
packages/coordination leases with fencing, per-key locks, Gateway session store
packages/discord    interaction pipeline, command and component registries, HTTP and Gateway adapters, REST ports
packages/guild      servers: settings, permissions, lifecycle
packages/game-data  regions and locations of the game, with the search behind the autocomplete
packages/todolist   todo lists: grammar, layout, ticking (state lives in the Discord message)
packages/timers     timer boards: state in the database, pure rendering, alerts, board upkeep
packages/warlog     shared collector, public state, tenant subscriptions and paced deliveries
packages/testing    helpers shared by the tests
```

## Layers

Each feature package is split into `domain/`, `application/`, `infrastructure/` and `presentation/`. Dependencies only
point inwards. A test (`tests/architecture`) fails the build when `domain/` or `application/` imports Discord, the
database, HTTP or Node modules, when a package reaches into another one instead of its public API, or when code outside
`@picket/config` reads `process.env`.

## Rules worth knowing

- **A server is a tenant.** Every table that holds server data has a `guild_id` column and row-level security that
  reads `app.guild_id`; code reaches it through `withTenant`. A test fails when such a table lacks the policy. The
  application connects with a role that owns nothing and cannot bypass the policy.
- **Idempotence.** Interactions are claimed once across replicas; writes use natural keys and conditional updates.
- **Singletons use leases.** Work that must run once (a Gateway shard, the periodic jobs) is held through a lease with a
  fencing token, checked by the writes of the holder.
- **The database is the truth, Discord is a view.** Timers keep their state in PostgreSQL and render it with a pure
  function (the same state always gives the same messages, compared by hash). A change and its pending render are
  written in the same transaction, so a crash between the two is repaired by the planner. A render reads the latest
  state under a per-board lock, and a burst of changes shares a single render.
- **Rolling updates.** Migrations only add; payloads and identifiers that cross versions are versioned.
- **Commands are declared once.** The registry validates names, options and texts at startup and generates the JSON sent
  to Discord. Every command states its required level explicitly.

## Add a command

1. Add the texts to `packages/i18n/locales/en.json` and translate them in every shipped catalog, then run `pnpm i18n:keys`.
2. Write the use case in the `application/` layer, with a port for what it needs.
3. Add the adapter in `infrastructure/` and the command in `presentation/discord/` (level, options, handler using `t`).
4. Register it in `apps/bot/src/composition.ts`.
5. Test it: unit tests with in-memory fakes, and an integration test against PostgreSQL when it touches data.

## Add a button or a form

1. Declare a `ComponentFamily`: a namespace (`td`), a version, the required level, and the server feature it belongs to.
2. Build identifiers with `encodeCustomId` (`namespace:version:payload`, 100 characters at most). A new format means a new
   version: old buttons are answered as expired, never ignored.
3. Register the family in `apps/bot/src/composition.ts`. Buttons and forms go through the same chain as commands: duplicates,
   access level, feature, suspension, language, errors.
4. Return `{ kind: 'deferred', ... }` for anything that talks to Discord: the pipeline acknowledges within 3 seconds, runs
   the work afterwards and delivers the result; shutting a replica down waits for it.

## Tests

```sh
pnpm test          # typecheck + unit tests (fast, no Docker)
pnpm test:int      # integration tests on a throw-away PostgreSQL (needs Docker)
pnpm test:all      # both
```

Start Docker Engine or Docker Desktop before running integration tests, and check that `docker info` succeeds.
Testcontainers starts PostgreSQL 18 (`postgres:18-alpine`), creates isolated databases, applies the migrations and connects
through the application role subject to row-level security. The tests do not use your development database or Discord
credentials. Test databases and the container are removed at the end of the run.

The server panel integration tests cover signed HTTP interactions, native selections and modals, immediate language and
permission changes, audit records, tenant isolation, transition aliases, deletion confirmation, recovery after panel
expiry and the retention deadline. Gateway tests also verify that reconnecting the bot does not cancel a deletion
requested through the panel. Discord messages and replies use test doubles: visual checks on desktop and mobile still
require a development Discord application.

Validation on 2026-10-07: all 176 integration tests (12 suites) and 702 unit tests (44 suites) passed. TypeScript and the
EN/FR documentation build also passed.

The toolchain is TypeScript 7 (`tsc`), Jest with `@swc/jest`, and no linter: the architecture test and the compiler's
strict mode do that job.

## Server panel

`/picket settings` uses Components V2; boards and todolists retain their existing embeds. Panel view models do not depend on Discord wire types. A `panel` reply updates the original message after a deferred acknowledgement; errors may be delivered as private follow-ups.

Every button or menu has a unique `custom_id` within the message, including buttons that lead to the same screen. Navigation, refresh and cancellation use distinct actions. The adapter checks identifier uniqueness and length before sending: Discord rejects duplicates with error `50035` (invalid form body). Flow tests also validate conversion of panels to the Discord wire format.

Families separate navigation, officer settings, administrator permissions, deletion and cancellation. Only read navigation and cancellation are available during suspension. Identifiers carry the owner, guild and expiry; no collectors or session storage are needed. Access is checked again before deferred work and use cases update current state transactionally.

The registry accepts unpublished transition aliases. Deploy all replicas before `deploy-commands`: old paths open the panel without applying arguments. Remove aliases in a later release. Roll back code and command definitions together; the database schema is unchanged. Monitor access denials, expired components and Discord delivery errors in existing logs.

## Voice statistics

`packages/stats` owns timestamped voice facts, channel presence segments, disk recovery, privacy and the optional Fastify dashboard. Collection shares Gateway shards; only target roles produce history. SQL transaction contexts enforce self/guild/global stats access through RLS without a BYPASSRLS account. Global context is authorized only after Discord Team verification. OAuth sessions are shared in PostgreSQL and encrypted with the application client secret. The buildless frontend uses existing PICKET assets, external JS/CSS, EN/FR text and SVG charts; no new UI framework or BI service is needed. The production HTTP runtime is composed in `apps/stats`, a separate Node.js process/container. Its read traffic has one bounded pool; it runs no collector or bot jobs. The bot and HTTP service share PostgreSQL and the disk buffer for privacy/erasure, with independent health and rolling updates. Member/guild reports derive aggregates from retained segments. Global admin reports read the private materialized models from migration `014_stats_admin_snapshot`; all access goes through functions that require the trusted global context. The application cannot SELECT their backing rows directly.

The shared PICKET overview exposes current active-guild totals and enabled-feature counts to authenticated dashboard users. Migration `013_instance_overview` provides a parameterless SQL function returning only aggregates, with a fixed search path and execution granted to the application role. Its migration-owner read policy leaves application tenant isolation intact. No guild identifiers, names or settings are returned, and no historical aggregate is stored. Voice access remains self/guild/Team scoped.

### Reproducible voice workload

`pnpm stats:test:load` creates 300 guilds, 50 distinct tracked people per guild, 60 days and eight closed
segments per person/day: **7,200,000 segments**, mixing reconnects, moves and two channels. It reconciles member and
instance totals, daily server series, distinct active people, hourly durations and peak presence. The response includes
the first member page and recent presences, as in the admin dashboard. It also runs twenty primary-pool checkpoints
concurrently, with pools of four main and two dashboard connections. This benchmark is opt-in through
`pnpm stats:test:load` and excluded from ordinary unit/integration commands and recurring CI, including its former
360,000-segment reduced profile. Correctness tests still cover collection, report totals, snapshots, access and erasure
on small fixtures. `STATS_LOAD_PEOPLE` (1–200) and `STATS_LOAD_SEGMENTS` (1–48) override the
load profile without changing collection limits. Synthetic retained facts measure report cost and checkpoint contention,
not full Gateway collection throughput; raw events and other tables are excluded from the reported segments size.
Measurements are written to the system temporary directory as `picket-stats-benchmark.json`.

The extended run measures approximately **2.0 s p95 per guild**, **48.5 s for the global computation from
segments**, and **9.1 s for the materialized admin report** (maximum of three reads). Initial refresh takes
**179 s**, and the following CONCURRENTLY refresh **195 s**. An admin read during that second refresh takes
**9.2 s**; primary confirmations actually launched during refresh remain at **53 ms p95**. Segments and indexes
occupy **3,128 MB**, with an additional **1,095 MB** for views and their indexes. These measurements depend on
hardware and cache; they do not guarantee production latency. The test bounds post-refresh admin reads to
15 seconds and reports background computation separately from dashboard reads.

Global SQL statements have a 30-second timeout; guild and personal statements retain 10 seconds, with a one-second
lock timeout. Daily reads split only overlapping days and first combine repeated segments per person/day before
computing distinct people across guilds. UTC hourly reads use one-hour bins; other zones preserve fifteen-minute bins
for daylight-saving and offset changes. Member/guild aggregates are derived at read time. Admin daily contributions retain member/guild/channel identities and exact boundaries for clipping; hourly totals and concurrency peaks are materialized separately. Distinct people are deduplicated across days and guilds. Initial population uses REFRESH; subsequent rebuilds use CONCURRENTLY in one REPEATABLE READ transaction, guarded by an advisory lock. The job-runner checks `STATS_ADMIN_REFRESH_CRON` (default `0 0,12 * * *`) each minute in `TZ` (default Europe/Paris), catches up missed schedules and retries failed builds. The existing daily retention remains at 03:00, now in that same instance zone. Erasure/purge increments a revision transactionally; global reads fail closed until a matching snapshot is published. A concurrent erasure aborts publication rather than resurrecting old contributions. Reads enforce the current exact 60-day cutoff independently of snapshot age. The daily retention job also invalidates the snapshot. Backups exclude materialized data and state; the worker bootstraps them after restore.

Server data downloads export Stats settings, privacy preferences, `stats_members` summaries and a `stats_summary`
overview over 60 days. Pending disk facts are captured before the SQL snapshot, deduplicated against committed event
keys and reduced to per-member counts; their durations are not credited before processing. Raw events, segments,
connected-state rows and journal entries are omitted. Guild purges erase the disk journal and tracking markers before
SQL deletion; failed external erasure leaves the registry entry for retry. The CLI uses the same purge path and shared
volume. Authorization comes from Discord identity and guild permissions, combined with current PICKET role mappings
in PostgreSQL; forged query privileges cannot broaden access. The owning Application Team retains its agreed global scope.

`pnpm stats:dev` uses Vite for local preview and browser reloads, with the real dashboard and isolated fictitious data on loopback by default (`--host` / `--port` are native Vite options); `pnpm stats:dev:live admin --host` starts the dedicated HTTP process against real local PostgreSQL with a simulated Discord identity, using `.env.example` defaults and `.env.dev` overrides. Preparation reuses `compose.dev.yml` and applies migrations. The production entry point rejects simulation; `pnpm stats:dev:oauth` exercises real OAuth. Run the bot separately. `pnpm stats:test` and `pnpm stats:test:int` select the feature tests explicitly. See `SELF_HOSTING.md`, the stats development section, for setup. Web and Discord exports share the same flat JSON-array/CSV contract; global exports additionally identify each guild.
