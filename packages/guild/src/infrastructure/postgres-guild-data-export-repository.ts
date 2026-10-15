import type { GuildId } from '@picket/kernel';
import { purgeExpiredJournals, sql, withTenant, type Db, type Schema } from '@picket/persistence';
import type { GuildDataExportRepository, GuildDataRows } from '../application/export-guild-data';

/** Explicit list: global tables and secrets never belong in a guild export. */
export const GUILD_EXPORT_TABLES = {
  stats_settings:['guild_id'],
  stats_privacy:['guild_id','user_id'],
  guild_settings: ['guild_id'],
  guild_registry: ['guild_id'],
  guild_support_presence: ['guild_id'],
  guild_permission_roles: ['guild_id', 'level', 'role_id'],
  guild_audit_log: ['id'],
  guild_application_logs: ['id'],
  guild_audit_delivery: ['id'],
  guild_audit_schedule: ['guild_id'],
  interaction_receipts: ['interaction_id'],
  timer_boards: ['id'],
  timer_board_messages: ['board_id', 'page'],
  timer_assets: ['id'],
  timer_events: ['id'],
  timer_alerts: ['asset_id', 'due_at', 'threshold_min'],
  timer_schedule: ['board_id'],
  warlog_subscriptions: ['guild_id'],
  warlog_deliveries: ['id'],
  warlog_hooks: ['guild_id', 'war_number', 'board_id'],
  warlog_hook_jobs: ['guild_id', 'war_number'],
  warlog_schedule: ['guild_id'],
} as const satisfies Partial<Record<keyof Schema, readonly string[]>>;

const BATCH_SIZE = 100;
/** Internal voice facts feed member summaries; they are never shipped as rows. */
export const GUILD_EXPORT_INTERNAL_TABLES = ['stats_users', 'stats_channels', 'stats_voice_events', 'stats_voice_segments', 'stats_voice_presence', 'guild_departure_requests'] as const;
const statsCutoff = sql`CURRENT_TIMESTAMP - INTERVAL '60 days'`;

export interface GuildExportOptions {
  readonly pendingVoice?: (guildId: GuildId, maxBytes: number) => Promise<readonly { key: string; at: string; guildId: string; userId: string; name: string }[] | null>;
}

export class PostgresGuildDataExportRepository implements GuildDataExportRepository {
  constructor(private readonly db: Db, private readonly flushLogs: () => Promise<void> = async () => undefined,
    private readonly options: GuildExportOptions = {}) {}

  async read(guildId: GuildId, maxBytes: number): Promise<GuildDataRows | null> {
    await this.flushLogs();
    // Capture pending facts before the SQL snapshot: a concurrent replay cannot
    // remove a fact from both sources. Keys already committed are removed below.
    const pending = await this.options.pendingVoice?.(guildId, Number.MAX_SAFE_INTEGER);
    if (pending === null) return null;
    await purgeExpiredJournals(this.db, guildId);
    return withTenant(this.db, guildId, async (trx) => {
      const data: Record<string, unknown[]> = {};
      let bytes = 0;
      for (const table of Object.keys(GUILD_EXPORT_TABLES) as (keyof typeof GUILD_EXPORT_TABLES)[]) {
        const records: unknown[] = [];
        let query = trx.selectFrom(table).selectAll().where('guild_id', '=', guildId);
        if (table === 'stats_settings')
          query = query.select([
            sql<Date | null>`CASE WHEN observed_through > ${statsCutoff} THEN observed_through END`.as('observed_through'),
            sql<Date | null>`CASE WHEN interrupted_at > ${statsCutoff} THEN interrupted_at END`.as('interrupted_at'),
          ]);
        for (const column of GUILD_EXPORT_TABLES[table]) query = query.orderBy(sql.ref(column), 'asc');
        // The transaction keeps the same snapshot; primary-key ordering prevents omissions and duplicates.
        for (let offset = 0; ; offset += BATCH_SIZE) {
          const batch = await query.limit(BATCH_SIZE).offset(offset).execute();
          for (const row of batch) {
            bytes += Buffer.byteLength(JSON.stringify(row, null, 2), 'utf8');
            if (bytes > maxBytes) return null;
            records.push(row);
          }
          if (batch.length < BATCH_SIZE) break;
        }
        data[table] = records;
      }
      const members = new Map<string, { userId: string; username: string; totalSeconds: number;
        lastActivityDate: string | null; pendingEvents: number; lastPendingActivityDate: string | null }>();
      const iso = (date: Date) => date.toISOString().replace('Z', '+00:00');
      const rows = (await sql<{ user_id: string; username: string; seconds: string; last_activity: Date }>`
        SELECT s.user_id,COALESCE(MAX(u.name),s.user_id) AS username,
          SUM(GREATEST(0,EXTRACT(EPOCH FROM LEAST(COALESCE(s.ended_at,s.confirmed_through),CURRENT_TIMESTAMP)
            -GREATEST(s.started_at,${statsCutoff})))) AS seconds,
          MAX(LEAST(COALESCE(s.ended_at,s.confirmed_through),CURRENT_TIMESTAMP)) AS last_activity
        FROM stats_voice_segments s LEFT JOIN stats_users u
          ON u.guild_id=s.guild_id AND u.user_id=s.user_id AND u.last_seen_at>${statsCutoff}
        WHERE s.guild_id=${guildId} AND s.started_at<CURRENT_TIMESTAMP AND COALESCE(s.ended_at,s.confirmed_through)>${statsCutoff}
        GROUP BY s.user_id ORDER BY s.user_id`.execute(trx)).rows;
      for (const row of rows) members.set(row.user_id, { userId: row.user_id, username: row.username,
        totalSeconds: Number(row.seconds), lastActivityDate: iso(row.last_activity), pendingEvents: 0, lastPendingActivityDate: null });
      if (pending) {
        const committed = new Set<string>();
        for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
          const rows = await trx.selectFrom('stats_voice_events').select('event_key').where('guild_id', '=', guildId)
            .where('event_key', 'in', pending.slice(offset, offset + BATCH_SIZE).map((event) => event.key)).execute();
          rows.forEach((row) => committed.add(row.event_key));
        }
        const retainedFrom = Date.now() - 60 * 86400_000;
        for (const event of pending) {
          if (event.guildId !== guildId || committed.has(event.key) || Date.parse(event.at) <= retainedFrom) continue;
          const member = members.get(event.userId) ?? { userId: event.userId, username: event.name || event.userId,
            totalSeconds: 0, lastActivityDate: null, pendingEvents: 0, lastPendingActivityDate: null };
          member.pendingEvents++;
          if (!member.lastPendingActivityDate || Date.parse(event.at) > Date.parse(member.lastPendingActivityDate)) {
            member.lastPendingActivityDate = iso(new Date(event.at));
            if (event.name && (!member.lastActivityDate || Date.parse(event.at) >= Date.parse(member.lastActivityDate))) member.username = event.name;
          }
          members.set(event.userId, member);
        }
      }
      data.stats_members = [...members.values()].sort((a, b) => a.userId.localeCompare(b.userId));
      data.stats_summary = [{ retentionDays: 60, members: members.size,
        totalSeconds: [...members.values()].reduce((sum, member) => sum + member.totalSeconds, 0),
        pendingEvents: [...members.values()].reduce((sum, member) => sum + member.pendingEvents, 0) }];
      for (const row of [...data.stats_members, ...data.stats_summary]) {
        bytes += Buffer.byteLength(JSON.stringify(row, null, 2), 'utf8'); if (bytes > maxBytes) return null;
      }
      return data;
    }, { readOnlySnapshot: true });
  }
}
