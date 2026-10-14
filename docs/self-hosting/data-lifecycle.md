---
aside: false
---

# Data export and lifecycle

This page describes the implementation at the source revision linked below. It explains what a self-hosted instance
exports and deletes. The full guild export is available under **`/picket settings` → Data → Export** and requires
administrator access.

You can download your guild’s settings, timers and retained journals, plus a **60-day voice summary**.
Usage data expires automatically by type: **7, 30 or 60 days**. You can also request voice erasure or schedule guild deletion.

You control downloaded copies. Old PICKET backups expire within 30 days; they do not contain voice history.

<ArchifyDiagram diagram="data-lifecycle" title="Data, export and end of life" />

<details>
<summary>See exact export contents and detailed retention rules</summary>

## What the guild export includes

The file is a `picket.guild-data` JSON document, version `1`, with `guildId`, `exportedAt`, `scope`, `notIncluded` and
`data`. It contains a consistent snapshot of the guild's currently retained rows. Logs are flushed to SQL and journals
older than 30 days are purged before reading. Export remains available during suspension, before permanent purge.

| Family | Included tables, with all their columns |
| --- | --- |
| Guild configuration and lifecycle | `guild_settings`, `guild_registry`, `guild_permission_roles` |
| Guild audit and operations | `guild_audit_log`, `guild_application_logs`, `guild_audit_delivery`, `guild_audit_schedule`, `interaction_receipts` |
| Timers | `timer_boards`, `timer_board_messages`, `timer_assets`, `timer_events`, `timer_alerts`, `timer_schedule` |
| Guild war log | `warlog_subscriptions`, `warlog_deliveries`, `warlog_hooks`, `warlog_hook_jobs`, `warlog_schedule` |
| Stats configuration and tracking preferences | `stats_settings`, `stats_privacy` |

These **21 tables** are explicitly selected, filtered by `guild_id`, and subject to RLS. Observation timestamps in
`stats_settings` are masked when outside the 60-day retention window.

Two derived collections supplement the SQL rows:

| Collection | Fields and meaning |
| --- | --- |
| `stats_members` | `userId`, `username`, `totalSeconds`, `lastActivityDate`, `pendingEvents`, `lastPendingActivityDate`: per-member summaries over the last 60 days. |
| `stats_summary` | `retentionDays` (60), `members`, `totalSeconds`, `pendingEvents`: guild summary. |

Pending disk voice events are captured before the SQL snapshot, bounded to 60 days and deduplicated against committed
events. They contribute pending counts; their durations are not credited until processing.

The file is built in memory and sent as a private attachment. PICKET keeps no copy. The limit is the smaller of
**10 MiB** and Discord's attachment limit: exceeding it rejects the export without producing a partial file.
The recipient controls retention of the downloaded copy.

## What is excluded

| Data | Where it lives and why it is excluded |
| --- | --- |
| Todolist content and Discord messages | In Discord. Read temporarily for creation or clicks; no PostgreSQL copy of the content. Actions may produce guild logs without content. |
| Raw voice events/segments, connected state, internal participant/channel metadata and disk journal | Internal sources for summaries; their rows are not attached to the guild export. |
| Stats admin snapshots | Private models rebuilt from segments; excluded from guild exports and standard backups. |
| Dashboard sessions and OAuth states | Authentication identity and encrypted tokens; excluded from exports and standard backups. |
| Shared public Foxhole state | Global wars, objects, events and concrete timers; no Discord member data. The export includes the guild's subscriptions/deliveries. |
| Global application state and coordination | Leases, locks, Gateway sessions and REST budgets; outside guild exports. |
| Secrets and operational diagnostics | Secrets live outside exported tables; sanitized diagnostics are separate from guild logs and contain no Discord identifiers or user content. |

Activity exports from **`/stats export`** and the dashboard are CSV/JSON statistical reports controlled by the caller's
access scope. Their contract differs from the guild export above: see [voice statistics](../guide/stats).

## Automatic deletion

| Data | Trigger and cleanup |
| --- | --- |
| Interaction receipts | Deleted after 7 days; used only to prevent duplicates. |
| Audit, timer events and guild application logs | Deleted after a fixed 30 days, even while the guild remains active. |
| SQL voice activity and participant/channel metadata | Rolling 60-day window. Reports enforce the cutoff at read time; SQL maintenance runs in batches every two minutes. Segments crossing the cutoff are clipped. |
| Disk voice journal | Events expire after 60 days; cleanup under lock. Successfully replayed events leave the buffer. Erasure markers also expire after 60 days. |
| Connected presence | Removed on disconnect or exclusion; also subject to retention cleanup. |
| Expired or struck timers | Deleted after `purgeAfterHours`: 24 hours by default, configurable or disableable. |
| Empty inactive timer boards | Deleted after 30 days without activity. Messages are removed when Discord permits it. |
| Timer alerts | Messages removed after expiry, refresh, deletion or replacement by a closer threshold. |
| War-log deliveries | Collection removes deliveries completed more than one day ago and stale generations/wars. |
| Public Foxhole history | Retains the two most recently observed wars; cleaned during collection. |
| Dashboard sessions / OAuth states | Session expires after at most eight hours, or earlier token expiry. OAuth state: ten minutes. Cleaned during Stats maintenance. |
| Diagnostics and metrics | Loki: 30 days; Prometheus: 30 days or 5 GB. Docker logs rotate by size (`10m` × 3 files per hardened container). |
| Standard backups | At most five archives, none older than 30 days; the backup service rotates and deletes them. |

The daily job at **03:00 in `TZ`** (Europe/Paris by default) purges receipts, journals and guilds past their deadline.
It catches missed schedules and retries failures. Timer, Stats, buffer and war-log maintenance have their own triggers.
An outage may delay physical cleanup; Stats reads continue to enforce the 60-day cutoff.

## Bot removal and guild deletion

Removing the bot marks the guild inactive and retains its data for **`GUILD_RETENTION_DAYS`** (30 days by default).
Returning the bot before purge reactivates data when deactivation was caused by removal.

A confirmed deletion request also suspends the guild and announces its deadline. It needs **explicit cancellation**
by an administrator before that deadline: reconnecting Gateway or returning the bot does not cancel the request.

At the deadline, purge first erases the guild's disk events and markers, then all SQL rows carrying its `guild_id`,
including registry and audits. Disk failure retains the registry for retry. Shared public Foxhole data follows its
own retention schedule.

## Opt-out and individual erasure

Opting out through `/stats privacy` or the dashboard stops future collection and closes current presence; it does
not itself delete retained history. An erasure request deletes SQL voice facts and participant name, plus pending
disk events. Tracking preferences and `erased_before` cutoffs remain to prevent late replay from restoring activity.

Admin snapshots are immediately invalidated: affected results remain inaccessible until rebuilding. Physical cleanup
follows refresh. Daily retention also invalidates snapshots.

## Backups and copies outside the instance

Standard backups encrypt the PostgreSQL dump directly with age. They retain Stats configuration and privacy
preferences, but exclude voice events/segments/presence, participant/channel metadata, admin snapshots, web sessions
and OAuth states. They do not copy `voice-buffer`. A standard restore therefore does not restore erased voice history.

Other data can remain in an older archive until rotation, for at most 30 days. Archives copied elsewhere by the
operator, Discord messages and downloaded exports need their own lifecycle management. See [disaster recovery](./disaster_recovery).

Sources: [SQL export](https://github.com/NapoSky/picket/blob/155e6e94b1786ea5dae79f23055e207e423a3012/packages/guild/src/infrastructure/postgres-guild-data-export-repository.ts),
[JSON format](https://github.com/NapoSky/picket/blob/155e6e94b1786ea5dae79f23055e207e423a3012/packages/guild/src/application/export-guild-data.ts),
[retention](https://github.com/NapoSky/picket/blob/155e6e94b1786ea5dae79f23055e207e423a3012/apps/bot/src/composition.ts),
[Stats maintenance](https://github.com/NapoSky/picket/blob/155e6e94b1786ea5dae79f23055e207e423a3012/packages/stats/src/infrastructure/postgres-stats-store.ts), and
[backup](https://github.com/NapoSky/picket/blob/155e6e94b1786ea5dae79f23055e207e423a3012/deploy/backup/run.sh).

</details>
