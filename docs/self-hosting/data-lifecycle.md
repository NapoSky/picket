---
aside: false
---

# Data export and lifecycle

This page explains what PICKET stores for a Discord server, what its export includes and what causes data to be
deleted. It describes the implementation at the source revision linked below.

Request the guild export under **`/picket settings` → Data → Export**, as a server administrator. It includes
retained settings, timers and journals, current temporary-voice template names and a **60-day voice summary**.
Some information is summarized or deliberately excluded.

Usage data expires according to its type. Members can stop voice tracking or request erasure; administrators can
schedule deletion of the server’s data. Downloaded copies remain under their recipient’s control.

<ArchifyDiagram diagram="data-lifecycle" title="Overview: data, export and end of life" />

<details>
<summary>Understand my export’s contents</summary>

## Stored data and export contents

The diagram compares server-scoped database records with their representation in the file. Observed members
and channels belong to this scope. Content stored only in Discord and global instance information are outside
this inventory.

<ArchifyDiagram diagram="guild-data-export" title="Server data: inclusions, summaries and exclusions" />

| Family | What PICKET stores for your server | In the guild export |
| --- | --- | --- |
| Settings and access | Discord server name and ID, language, time zone, enabled features, authorized roles, audit channel, Stats settings and individual tracking preferences. | Retained settings and preferences, plus active/inactive server status. |
| Timers and war log | Boards, tracked assets and deadlines, owners, associated channels and messages, alerts, subscriptions and notification processing. | Currently retained data, including notification processing records. |
| Temporary voice | Templates and options: destination category, channel names, capacity and idle timeout. Private drafts, created channels, presence and cleanup status. | **Current template names only.** Options and operational data are excluded. |
| Voice activity | Discord IDs and names of observed members, names and IDs of observed voice channels, joins/departures, presence periods, associated roles and private summaries. | **Per-member summary**: identity, accumulated time and last activity over 60 days, plus a server summary. Detailed history, connected presence and the observed-channel list are excluded. |
| Logs and tracking | Administration actions with their author, usage records, duplicate-prevention receipts and audit-message processing. Internal bot-departure request state. | Retained journals, receipts and audit processing. **Internal departure requests are excluded.** |

Counts of voice events awaiting storage supplement the summaries. They come from the disk journal; their
durations are not added to totals until processing.

PICKET builds the file in memory and sends it privately without keeping a copy. Export remains available during
suspension, before permanent purge. It represents the data retained at the time of the request; it is not a
backup that can restore everything.

Activity exports from **`/stats export`** and the dashboard are separate statistical reports: see
[voice statistics](../guide/stats). See also [temporary voice channels](../guide/voice).

<details>
<summary>Technical reference: export format, tables and limits</summary>

### Exact format and contents

The file is a `picket.guild-data` JSON document, version `1`, with `guildId`, `exportedAt`, `scope`, `notIncluded` and
`data`. It contains a consistent snapshot of the guild's currently retained rows. Logs are flushed to SQL and journals
older than 30 days are purged before reading. Export remains available during suspension, before permanent purge.

| Family | Included tables, with all their columns |
| --- | --- |
| Guild configuration and lifecycle | `guild_settings`, `guild_registry`, `guild_support_presence`, `guild_permission_roles` |
| Guild audit and operations | `guild_audit_log`, `guild_application_logs`, `guild_audit_delivery`, `guild_audit_schedule`, `interaction_receipts` |
| Timers | `timer_boards`, `timer_board_messages`, `timer_assets`, `timer_events`, `timer_alerts`, `timer_schedule` |
| Guild war log | `warlog_subscriptions`, `warlog_deliveries`, `warlog_hooks`, `warlog_hook_jobs`, `warlog_schedule` |
| Stats configuration and tracking preferences | `stats_settings`, `stats_privacy` |

These **22 tables** are explicitly selected, filtered by `guild_id`, and subject to RLS. Observation timestamps in
`stats_settings` are masked when outside the 60-day retention window.

Current temporary-voice template names are added in `voice_templates`, with the `name` field only.
All other columns from that table are excluded.

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

### What is excluded

| Data | Where it lives and why it is excluded |
| --- | --- |
| Todolist content and Discord messages | In Discord. Read temporarily for creation or clicks; no PostgreSQL copy of the content. Actions may produce guild logs without content. |
| Raw voice events/segments, connected state, internal participant/channel metadata and disk journal | Internal sources for summaries; their rows are not attached to the guild export. |
| Temporary-voice options and processing | Template options, deployment limit, private drafts, created channels, presence and verification/cleanup status. Only template names are attached. |
| Bot-departure requests | Internal state used to execute or reconcile removal; excluded. Active/inactive registry status and audit records are exported. |
| Stats admin snapshots | Private models rebuilt from segments; excluded from guild exports and standard backups. |
| Dashboard sessions and OAuth states | Authentication identity and encrypted tokens; excluded from exports and standard backups. |
| Shared public Foxhole state | Global wars, objects, events and concrete timers; no Discord member data. The export includes the guild's subscriptions/deliveries. |
| Global application state and coordination | Leases, locks, Gateway sessions and REST budgets; outside guild exports. |
| Private service administration | Operator sessions and departure history, including internal reasons, are instance records outside guild exports. |
| Secrets and operational diagnostics | Secrets live outside exported tables; sanitized diagnostics are separate from guild logs and contain no Discord identifiers or user content. |

</details>

</details>

<details>
<summary>Understand retention and erasure</summary>

## What retains or erases data

The triggers below have different effects: expiry cleans the affected data, opting out stops future collection,
and a server purge removes its server-scoped database records.

<ArchifyDiagram diagram="guild-data-retention" title="Retention and erasure: triggers and consequences" />

### Bot removal and guild deletion

Removing the bot marks the guild inactive and retains its data for **the instance’s retention period** (30 days by default).
Returning the bot before purge reactivates data when deactivation was caused by removal.

A confirmed administrator removal makes PICKET leave the server and immediately schedules erasure with the
announced deadline. To cancel before that deadline, invite PICKET back and **explicitly cancel deletion** in
`/picket settings` → Data as a server administrator. Reconnecting Gateway or returning the bot alone does not cancel the request.

At the deadline, purge first erases the guild's disk events and markers, then server-scoped database records,
including registry and audits. Disk failure retains the registry for retry. Shared public Foxhole data follows its
own retention schedule.

### Opt-out and individual erasure

Opting out through `/stats privacy` or the dashboard stops future collection and closes current presence; it does
not itself delete retained history. An erasure request deletes SQL voice facts and participant name, plus pending
disk events. The member’s Discord ID, tracking preferences and a protection date remain to prevent old
observations from restoring erased activity.

Admin snapshots are immediately invalidated: affected results remain inaccessible until rebuilding. Physical cleanup
follows refresh. Daily retention also invalidates snapshots.

Usual retention continues while purge is pending. Returning the bot reactivates the data that remains; it does
not restore data that has already expired. Erasing activity does not by itself stop future collection: that
depends on the member’s tracking choice.

<details>
<summary>Exact retention periods and cleanup execution</summary>

The rules below specify the duration for each data type. They also cover instance processing beyond the database
records of a single server.

The purge delay for an inactive server is configured with `GUILD_RETENTION_DAYS`: 30 days by default.

| Data | Trigger and cleanup |
| --- | --- |
| Interaction receipts | Deleted after 7 days; used only to prevent duplicates. |
| Private operator sessions and departures | Sessions expire after ten minutes; unsubmitted confirmations after at most two minutes. Completed operation history expires after 30 days, independently of tenant purge. Unresolved requests remain for reconciliation. Cleanup runs in the job-runner every 15 seconds; Discord notifications remain in their private channel. |
| Audit, timer events and guild application logs | Deleted after a fixed 30 days, even while the guild remains active. |
| SQL voice activity and participant/channel metadata | Rolling 60-day window. Reports enforce the cutoff at read time; SQL maintenance runs in batches every two minutes. Segments crossing the cutoff are clipped. |
| Disk voice journal | Events expire after 60 days; cleanup under lock. Successfully replayed events leave the buffer. Erasure markers also expire after 60 days. |
| Connected presence | Removed on disconnect or exclusion; also subject to retention cleanup. |
| Expired or struck timers | Deleted after `purgeAfterHours`: 24 hours by default, configurable or disableable. |
| Empty inactive timer boards | Deleted after 30 days without activity. Messages are removed when Discord permits it. |
| Private temporary-voice drafts | Expire 15 minutes after their last renewal, then removed by cleanup. |
| Temporary-voice channel tracking | Records for deleted or failed channels are cleaned after one day; obsolete presence is removed. Templates and their options do not follow this deadline. |
| Timer alerts | Messages removed after expiry, refresh, deletion or replacement by a closer threshold. |
| War-log deliveries | Collection removes deliveries completed more than one day ago and stale generations/wars. |
| Public Foxhole history | Retains the two most recently observed wars; cleaned during collection. |
| Dashboard sessions / OAuth states | Session expires after at most eight hours, or earlier token expiry. OAuth state: ten minutes. Cleaned during Stats maintenance. |
| Diagnostics and metrics | Loki: 30 days; Prometheus: 30 days or 5 GB. Docker logs rotate by size (`10m` × 3 files per hardened container). |
| Standard backups | At most five archives, none older than 30 days; the backup service rotates and deletes them. |

The daily job at **03:00 in `TZ`** (Europe/Paris by default) purges receipts, journals and guilds past their deadline.
It catches missed schedules and retries failures. Timer, Stats, buffer and war-log maintenance have their own triggers.
An outage may delay physical cleanup; Stats reads continue to enforce the 60-day cutoff.

</details>

</details>

## Backups and copies outside the instance

Standard backups encrypt the PostgreSQL dump directly with age. They retain Stats configuration and privacy
preferences, but exclude Stats history and metadata: events, periods, presence, participant names and observed
channels. Admin snapshots, web sessions and OAuth states are also excluded. Backups do not copy `voice-buffer`.
A standard restore therefore does not restore erased voice history.

Other data can remain in an older archive until rotation, for at most 30 days. Archives copied elsewhere by the
operator, Discord messages and downloaded exports need their own lifecycle management. See [disaster recovery](./disaster_recovery).

<details>
<summary>Implementation sources</summary>

Sources: [SQL export](https://github.com/NapoSky/picket/blob/bd8682e7c23fea05bcf73c9ddd7f9234d88f574c/packages/guild/src/infrastructure/postgres-guild-data-export-repository.ts),
[JSON format](https://github.com/NapoSky/picket/blob/bd8682e7c23fea05bcf73c9ddd7f9234d88f574c/packages/guild/src/application/export-guild-data.ts),
[retention](https://github.com/NapoSky/picket/blob/bd8682e7c23fea05bcf73c9ddd7f9234d88f574c/apps/bot/src/composition.ts),
[Stats maintenance](https://github.com/NapoSky/picket/blob/bd8682e7c23fea05bcf73c9ddd7f9234d88f574c/packages/stats/src/infrastructure/postgres-stats-store.ts), and
[backup](https://github.com/NapoSky/picket/blob/bd8682e7c23fea05bcf73c9ddd7f9234d88f574c/deploy/backup/run.sh).

[Temporary voice](https://github.com/NapoSky/picket/blob/bd8682e7c23fea05bcf73c9ddd7f9234d88f574c/packages/persistence/migrations/020_ephemeral_voice.sql),
[private Stats summaries](https://github.com/NapoSky/picket/blob/bd8682e7c23fea05bcf73c9ddd7f9234d88f574c/packages/persistence/migrations/014_stats_admin_snapshot.sql) and
[server lifecycle](https://github.com/NapoSky/picket/blob/bd8682e7c23fea05bcf73c9ddd7f9234d88f574c/packages/guild/src/application/guild-events-use-cases.ts).

</details>
