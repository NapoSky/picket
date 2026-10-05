# Architecture

PICKET is a modular monolith in a pnpm workspace: one image, several identical replicas, PostgreSQL as the single
source of truth.

```text
apps/bot            composition root: HTTP server, Gateway runner, command line
packages/kernel     identifiers, Result, Clock, Logger, Secret
packages/config     environment validation
packages/i18n       translations, locale resolution, catalog checks
packages/persistence  database access, migrations, row-level security
packages/coordination leases with fencing, per-key locks, Gateway session store
packages/discord    interaction pipeline, command and component registries, HTTP and Gateway adapters, REST ports
packages/guild      servers: settings, permissions, lifecycle
packages/todolist   todo lists: grammar, layout, ticking (state lives in the Discord message)
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
- **Singletons use leases.** Work that must run once (a Gateway shard) is held through a lease with a fencing token,
  checked by the writes of the holder.
- **Rolling updates.** Migrations only add; payloads and identifiers that cross versions are versioned.
- **Commands are declared once.** The registry validates names, options and texts at startup and generates the JSON sent
  to Discord. Every command states its required level explicitly.

## Add a command

1. Add the texts to `packages/i18n/locales/en.json` and `fr.json`, then run `pnpm i18n:keys`.
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

The toolchain is TypeScript 7 (`tsc`), Jest with `@swc/jest`, and no linter: the architecture test and the compiler's
strict mode do that job.
