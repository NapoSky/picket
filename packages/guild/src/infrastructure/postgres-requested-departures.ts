import { GuildId, type ChannelId } from '@picket/kernel';
import { sql, withTenant, type Db, type Tx } from '@picket/persistence';
import type { RequestedDeparture, RequestedDepartureRepository } from '../application/requested-departures';
import { PostgresSupportGuildEventsRepository } from './postgres-support-guild-events-repository';

interface Row {
  id: string; guild_id: string; registered_at: Date; expected_revision: string; requested_at: Date;
  attempted_at: Date | null; status: RequestedDeparture['status']; acknowledged: boolean;
}
export class PostgresRequestedDepartures implements RequestedDepartureRepository {
  constructor(private readonly db: Db, private readonly channelId: ChannelId | null, private readonly retentionDays: number) {}

  find(guildId: GuildId): Promise<RequestedDeparture | null> {
    return withTenant(this.db, guildId, async trx => {
      const row = (await sql<Row>`SELECT * FROM guild_departure_requests WHERE guild_id=${guildId}`.execute(trx)).rows[0];
      return row ? { id: row.id, guildId, registeredAt: row.registered_at, revision: row.expected_revision,
        requestedAt: row.requested_at, attemptedAt: row.attempted_at, status: row.status, acknowledged: row.acknowledged } : null;
    });
  }
  async pending(): Promise<readonly GuildId[]> {
    return (await sql<{ guild_id: string }>`SELECT guild_id FROM picket_pending_departures()`.execute(this.db)).rows.map(row => GuildId.assert(row.guild_id));
  }
  acknowledge(guildId: GuildId): Promise<void> {
    return withTenant(this.db, guildId, async trx => {
      await sql`UPDATE guild_departure_requests SET acknowledged=true WHERE guild_id=${guildId} AND status='pending'`.execute(trx);
    });
  }
  private async current(trx: Tx, request: RequestedDeparture) {
    const registry = await trx.selectFrom('guild_registry').selectAll().where('guild_id', '=', request.guildId).forUpdate().executeTakeFirst();
    const presence = await trx.selectFrom('guild_support_presence').selectAll().where('guild_id', '=', request.guildId).executeTakeFirst();
    return { registry, presence };
  }
  private async update(trx: Tx, request: RequestedDeparture, status: RequestedDeparture['status']) {
    await sql`UPDATE guild_departure_requests SET status=${status}
      WHERE guild_id=${request.guildId} AND id=${request.id}::uuid`.execute(trx);
  }
  claim(request: RequestedDeparture, now: Date): Promise<boolean> {
    return withTenant(this.db, request.guildId, async trx => {
      const { registry, presence } = await this.current(trx, request);
      if (!registry || registry.registered_at.getTime() !== request.registeredAt.getTime() ||
        registry.inactive_reason !== 'requested' || !registry.inactive_since ||
        String(presence?.revision ?? '0') !== request.revision) {
        await this.update(trx, request, 'returned'); return false;
      }
      return (await sql`UPDATE guild_departure_requests SET status='executing', attempted_at=${now}
        WHERE guild_id=${request.guildId} AND acknowledged AND status='pending' AND id=${request.id}::uuid RETURNING guild_id`.execute(trx)).rows.length === 1;
    });
  }
  finish(request: RequestedDeparture, status: 'left' | 'failed' | 'returned' | 'uncertain'): Promise<void> {
    return withTenant(this.db, request.guildId, async trx => {
      const { registry, presence } = await this.current(trx, request);
      const current = (await sql<{ id: string }>`SELECT id FROM guild_departure_requests WHERE guild_id=${request.guildId}`.execute(trx)).rows[0];
      if (current?.id !== request.id) return;
      const expected = BigInt(request.revision);
      const revision = BigInt(presence?.revision ?? '0');
      if (!registry || registry.registered_at.getTime() !== request.registeredAt.getTime() ||
        registry.inactive_reason !== 'requested' || !registry.inactive_since ||
        revision > expected + 1n || (presence?.present && revision !== expected)) {
        await this.update(trx, request, 'returned'); return;
      }
      if (status === 'left') {
        await new PostgresSupportGuildEventsRepository(this.db).observeInTransaction(trx, request.guildId, false, undefined, false,
          this.channelId ? { channelId: this.channelId, retentionDays: this.retentionDays } : null);
      }
      await this.update(trx, request, status);
    });
  }
}
