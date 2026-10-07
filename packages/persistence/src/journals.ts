import { sql } from 'kysely';
import type { GuildApplicationLog, GuildId } from '@picket/kernel';
import { withTenant, type Db } from './database';

export class PostgresGuildApplicationLogs {
  constructor(private readonly db: Db) {}

  async append(entries: readonly GuildApplicationLog[]): Promise<void> {
    const guilds = new Map<GuildId, GuildApplicationLog[]>();
    for (const entry of entries) {
      const batch = guilds.get(entry.guildId) ?? [];
      batch.push(entry);
      guilds.set(entry.guildId, batch);
    }
    for (const [guildId, batch] of guilds) {
      await withTenant(this.db, guildId, async (trx) => {
        // Ne jamais recréer des données après une purge. Le verrou et la FK protègent aussi les répliques concurrentes.
        const guild = await trx.selectFrom('guild_registry').select('guild_id').where('guild_id', '=', guildId).forKeyShare().executeTakeFirst();
        if (guild === undefined) return;
        const { rows: [row] } = await sql<{ cutoff: Date }>`SELECT CURRENT_TIMESTAMP - INTERVAL '30 days' AS cutoff`.execute(trx);
        const recent = batch.filter((entry) => entry.at > row!.cutoff);
        if (recent.length === 0) return;
        await trx.insertInto('guild_application_logs').values(recent.map((entry) => ({
          id: entry.id, guild_id: entry.guildId, at: entry.at, record: JSON.stringify(entry.record),
        }))).onConflict((conflict) => conflict.column('id').doNothing()).execute();
      });
    }
  }
}

export interface JournalPurgeReport {
  readonly auditDeleted: number;
  readonly timerEventsDeleted: number;
  readonly applicationLogsDeleted: number;
}

/** La fonction privilégiée ne permet que la suppression des entrées âgées d'au moins 30 jours. */
export async function purgeExpiredJournals(db: Db, guildId?: GuildId): Promise<JournalPurgeReport> {
  const { rows: [row] } = await sql<{ audit_deleted: string; timer_events_deleted: string; application_logs_deleted: string }>`SELECT * FROM purge_expired_journals(${guildId ?? null}::text)`.execute(db);
  return { auditDeleted: Number(row!.audit_deleted), timerEventsDeleted: Number(row!.timer_events_deleted), applicationLogsDeleted: Number(row!.application_logs_deleted) };
}
