import { GuildId as GuildIdFactory, type GuildId } from '@picket/kernel';
import { purgeGuildData, withTenant, type Db, type Tx } from '@picket/persistence';
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

  constructor(db: Db) {
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
    return withTenant(this.#db, guildId, async (trx) => {
      if (reason === 'requested') {
        await ensureGuildInitialized(trx, guildId);
      } else {
        const known = await trx.selectFrom('guild_registry').select('guild_id').where('guild_id', '=', guildId).executeTakeFirst();
        if (!known) return { changed: false, inactiveSince: now };
      }

      // Conditionnel : un second appel (ou une réémission d'événement) ne repousse jamais la date d'origine.
      const updated = await trx
        .updateTable('guild_registry')
        .set({ inactive_since: now, inactive_reason: reason })
        .where('guild_id', '=', guildId)
        .where('inactive_since', 'is', null)
        .returning('inactive_since')
        .executeTakeFirst();

      if (updated?.inactive_since) {
        await audit(trx, guildId, actor, action, state(null, null), state(updated.inactive_since, reason));
        return { changed: true, inactiveSince: updated.inactive_since };
      }

      const current = await trx
        .selectFrom('guild_registry')
        .select('inactive_since')
        .where('guild_id', '=', guildId)
        .executeTakeFirstOrThrow();
      return { changed: false, inactiveSince: current.inactive_since ?? now };
    });
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

  purge(guildId: GuildId): Promise<void> {
    return purgeGuildData(this.#db, guildId);
  }
}
