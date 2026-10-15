import { GuildId as GuildIdFactory, type GuildId } from '@picket/kernel';
import { purgeGuildData, sql, withTenant, type Db, type Tx } from '@picket/persistence';
import type { DeactivationResult, GuildLifecycleRepository } from '../application/guild-lifecycle-repository';
import type { AuditActor } from '../application/permission-repository';
import type { DeactivationReason } from '../domain/lifecycle';
import { ensureGuildInitialized } from './ensure-guild';

const state = (since: Date | null, reason: DeactivationReason | null) =>
  JSON.stringify({ inactive_since: since?.toISOString() ?? null, inactive_reason: reason });

async function audit(
  trx: Tx,
  guildId: GuildId,
  actor: AuditActor,
  action: string,
  before: string,
  after: string,
): Promise<void> {
  await trx.insertInto('guild_audit_log').values({ guild_id: guildId, actor_id: actor, action, before, after }).execute();
}

export class PostgresGuildLifecycleRepository implements GuildLifecycleRepository {
  readonly #db: Db;

  constructor(db: Db, private readonly beforePurge: (guildId: GuildId) => Promise<void> = async () => undefined) {
    this.#db = db;
  }

  initialize(guildId: GuildId): Promise<void> {
    return withTenant(this.#db, guildId, (trx) => ensureGuildInitialized(trx, guildId));
  }

  async inactiveSince(guildId: GuildId): Promise<Date | null> {
    const row = await this.#db
      .selectFrom('guild_registry')
      .select('inactive_since')
      .where('guild_id', '=', guildId)
      .executeTakeFirst();
    return row?.inactive_since ?? null;
  }

  markInactive(
    guildId: GuildId,
    actor: AuditActor,
    action: string,
    now: Date,
    reason: DeactivationReason,
  ): Promise<DeactivationResult> {
    return withTenant(this.#db, guildId, trx => this.markInactiveInTransaction(trx, guildId, actor, action, now, reason));
  }

  /** Operator finalization holds the registry lock through lifecycle, presence and notification changes. */
  async markInactiveInTransaction(trx: Tx, guildId: GuildId, actor: AuditActor, action: string, now: Date, reason: DeactivationReason): Promise<DeactivationResult> {
    if (reason === 'requested') {
      await ensureGuildInitialized(trx, guildId);
    } else {
      const known = await trx.selectFrom('guild_registry').select('guild_id').where('guild_id', '=', guildId).executeTakeFirst();
      if (!known) return { changed: false, inactiveSince: now };
    }

    // Conditional: a repeated call or event never postpones the original date.
    const updated = await trx
      .updateTable('guild_registry')
      .set({ inactive_since: now, inactive_reason: reason })
      .where('guild_id', '=', guildId)
      .where('inactive_since', 'is', null)
      .returning('inactive_since')
      .executeTakeFirst();

    if (updated?.inactive_since) {
      await audit(trx, guildId, actor, action, state(null, null), state(updated.inactive_since, reason));
    }

    const current = await trx
      .selectFrom('guild_registry')
      .select(['inactive_since', 'inactive_reason'])
      .where('guild_id', '=', guildId)
      .executeTakeFirstOrThrow();
    if (reason === 'requested' && current.inactive_reason === 'requested') {
      // The deletion schedule and departure intent must commit together.
      await sql`INSERT INTO guild_departure_requests(guild_id, registered_at, expected_revision, requested_at)
        SELECT r.guild_id, r.registered_at, COALESCE(p.revision, 0), r.inactive_since
        FROM guild_registry r LEFT JOIN guild_support_presence p USING(guild_id)
        WHERE r.guild_id=${guildId} ON CONFLICT(guild_id) DO NOTHING`.execute(trx);
    }
    return { changed: !!updated?.inactive_since, inactiveSince: current.inactive_since ?? now };
  }

  reactivate(guildId: GuildId, actor: AuditActor, action: string, onlyReason?: DeactivationReason): Promise<boolean> {
    return withTenant(this.#db, guildId, async (trx) => {
      const previous = await trx
        .selectFrom('guild_registry')
        .select(['inactive_since', 'inactive_reason'])
        .where('guild_id', '=', guildId)
        .forUpdate()
        .executeTakeFirst();
      if (!previous?.inactive_since || !previous.inactive_reason) return false;
      if (onlyReason !== undefined && previous.inactive_reason !== onlyReason) return false;

      await trx
        .updateTable('guild_registry')
        .set({ inactive_since: null, inactive_reason: null })
        .where('guild_id', '=', guildId)
        .execute();
      await sql`DELETE FROM guild_departure_requests WHERE guild_id=${guildId}`.execute(trx);
      await audit(
        trx,
        guildId,
        actor,
        action,
        state(previous.inactive_since, previous.inactive_reason),
        state(null, null),
      );
      return true;
    });
  }

  async listActive(): Promise<GuildId[]> {
    const rows = await this.#db.selectFrom('guild_registry').select('guild_id').where('inactive_since', 'is', null).execute();
    return rows.flatMap((row) => {
      const parsed = GuildIdFactory.parse(row.guild_id);
      return parsed.ok ? [parsed.value] : [];
    });
  }

  async findPurgeable(cutoff: Date, limit: number): Promise<GuildId[]> {
    const rows = await this.#db
      .selectFrom('guild_registry')
      .select('guild_id')
      .where('inactive_since', '<=', cutoff)
      .orderBy('inactive_since')
      .limit(limit)
      .execute();
    return rows.flatMap((row) => {
      const parsed = GuildIdFactory.parse(row.guild_id);
      return parsed.ok ? [parsed.value] : [];
    });
  }

  async purge(guildId: GuildId): Promise<void> {
    // A failed external erasure leaves the registry entry available for retry.
    await this.beforePurge(guildId);
    await purgeGuildData(this.#db, guildId);
  }
}
