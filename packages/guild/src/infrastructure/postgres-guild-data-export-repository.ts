import type { GuildId } from '@picket/kernel';
import { purgeExpiredJournals, sql, withTenant, type Db, type Schema } from '@picket/persistence';
import type { GuildDataExportRepository, GuildDataRows } from '../application/export-guild-data';

/** Liste explicite : les tables globales et les secrets ne font jamais partie d'un export de serveur. */
export const GUILD_EXPORT_TABLES = {
  guild_settings: ['guild_id'],
  guild_registry: ['guild_id'],
  guild_permission_roles: ['guild_id', 'level', 'role_id'],
  guild_audit_log: ['id'],
  guild_application_logs: ['id'],
  interaction_receipts: ['interaction_id'],
  timer_boards: ['id'],
  timer_board_messages: ['board_id', 'page'],
  timer_assets: ['id'],
  timer_events: ['id'],
  timer_alerts: ['asset_id', 'due_at', 'threshold_min'],
  timer_schedule: ['board_id'],
} as const satisfies Partial<Record<keyof Schema, readonly string[]>>;

const BATCH_SIZE = 100;

export class PostgresGuildDataExportRepository implements GuildDataExportRepository {
  constructor(private readonly db: Db, private readonly flushLogs: () => Promise<void> = async () => undefined) {}

  async read(guildId: GuildId, maxBytes: number): Promise<GuildDataRows | null> {
    await this.flushLogs();
    await purgeExpiredJournals(this.db, guildId);
    return withTenant(this.db, guildId, async (trx) => {
      const data: Record<string, unknown[]> = {};
      let bytes = 0;
      for (const table of Object.keys(GUILD_EXPORT_TABLES) as (keyof typeof GUILD_EXPORT_TABLES)[]) {
        const records: unknown[] = [];
        let query = trx.selectFrom(table).selectAll().where('guild_id', '=', guildId);
        for (const column of GUILD_EXPORT_TABLES[table]) query = query.orderBy(sql.ref(column), 'asc');
        // La transaction garde le même instantané et l'ordre des clés primaires évite pertes et doublons.
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
      return data;
    }, { readOnlySnapshot: true });
  }
}
