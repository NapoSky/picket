import { GuildId, type ChannelId } from '@picket/kernel';
import { sql, withTenant, type Db, type Tx } from '@picket/persistence';
import type { SupportDelivery, SupportGuildChange, SupportGuildEventsRepository } from '../application/support-guild-events';
import { ensureGuildInitialized } from './ensure-guild';

export class PostgresSupportGuildEventsRepository implements SupportGuildEventsRepository {
  constructor(private readonly db: Db) {}

  seed(guildId: GuildId): Promise<void> {
    return withTenant(this.db, guildId, async (trx) => {
      await ensureGuildInitialized(trx, guildId);
      await trx.insertInto('guild_support_presence').values({ guild_id: guildId, name: '', present: true })
        .onConflict(c => c.column('guild_id').doNothing()).execute();
    });
  }

  async presentGuildIds(): Promise<readonly GuildId[]> {
    const rows = await sql<{ guild_id: string }>`SELECT guild_id FROM picket_support_present_guilds()`.execute(this.db);
    return rows.rows.map(row => GuildId.assert(row.guild_id));
  }

  rename(guildId: GuildId, name: string): Promise<void> {
    return withTenant(this.db, guildId, async (trx) => {
      await trx.updateTable('guild_support_presence').set({ name }).where('guild_id', '=', guildId).execute();
    });
  }

  observe(guildId: GuildId, present: boolean, name: string | undefined, offline: boolean,
    notification: { readonly channelId: ChannelId; readonly format: (change: SupportGuildChange) => string } | null): Promise<void> {
    return withTenant(this.db, guildId, trx => this.observeInTransaction(trx, guildId, present, name, offline, notification));
  }

  async observeInTransaction(trx: Tx, guildId: GuildId, present: boolean, name: string | undefined, offline: boolean,
    notification: { readonly channelId: ChannelId; readonly format: (change: SupportGuildChange) => string } | null): Promise<void> {
    // Lifecycle and purge use this row too; unknown/deleted guilds must never be recreated by a departure.
    const guild = await trx.selectFrom('guild_registry').select(['inactive_since', 'inactive_reason'])
      .where('guild_id', '=', guildId).forUpdate().executeTakeFirst();
    if (!guild) return;
    const previous = await trx.selectFrom('guild_support_presence').selectAll().where('guild_id', '=', guildId).executeTakeFirst();
    const currentName = name ?? previous?.name ?? '';
    await trx.insertInto('guild_support_presence').values({ guild_id: guildId, present, name: currentName })
      .onConflict(c => c.column('guild_id').doUpdateSet({ present, name: currentName })).execute();
    if (previous?.present === present || (!previous && !present) || notification === null) return;
    const operator = !present && previous ? (await sql<{ actor_name: string; reason: string }>`
      SELECT actor_name, reason FROM operator_departures WHERE target_id=${guildId}
        AND expected_revision=${previous.revision}::bigint AND status IN ('executing','uncertain','left','absent')
        AND requested_at IS NOT NULL ORDER BY requested_at DESC LIMIT 1`.execute(trx)).rows[0] : undefined;
    const change: SupportGuildChange = {
      kind: present ? previous ? 'returned' : 'joined' : 'left', name: currentName,
      inactiveSince: guild.inactive_since, deletionRequested: guild.inactive_reason === 'requested', detectedOffline: offline,
      ...(operator ? { operator: { name: operator.actor_name, reason: operator.reason } } : {}),
    };
    // State transition and delivery are committed together, so repeats cannot enqueue twice.
    await trx.insertInto('support_guild_deliveries').values({ channel_id: notification.channelId, content: notification.format(change) }).execute();
  }

  deliver(channelId: ChannelId, now: Date, publish: (delivery: SupportDelivery) => Promise<string | null>): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      // Also serialize overlapping job-runner leases; preserve arrival/departure order across replicas.
      const lock = await sql<{ acquired: boolean }>`SELECT pg_try_advisory_xact_lock(739102864) AS acquired`.execute(trx);
      if (!lock.rows[0]?.acquired) return false;
      await sql`SET LOCAL idle_in_transaction_session_timeout = '120s'`.execute(trx);
      // A destination change must not send old pending messages to the previous salon.
      await trx.deleteFrom('support_guild_deliveries').where('channel_id', '!=', channelId).execute();
      const row = await trx.selectFrom('support_guild_deliveries').selectAll().orderBy('id').forUpdate().executeTakeFirst();
      if (!row || row.next_attempt_at > now) return false;
      const reason = await publish({ id: row.id, content: row.content, attempts: row.attempts, lastError: row.last_error });
      if (reason === null) {
        await trx.deleteFrom('support_guild_deliveries').where('id', '=', row.id).execute();
        return true;
      }
      const attempts = row.attempts + 1;
      const delay = Math.min(900_000, 30_000 * 2 ** Math.min(attempts - 1, 5));
      await trx.updateTable('support_guild_deliveries').set({ attempts, last_error: reason, next_attempt_at: new Date(now.getTime() + delay) })
        .where('id', '=', row.id).execute();
      return false;
    });
  }
}
