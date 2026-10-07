import { ChannelId, GuildId, type MessageId, type UserId } from '@picket/kernel';
import { sql, withTenant, type Db, type Tx } from '@picket/persistence';
import type { AuditDeliveryResult, AuditEvent, GuildAuditRepository } from '../application/publish-guild-audit';

async function schedule(trx: Tx, guildId: GuildId): Promise<void> {
  const first = await trx.selectFrom('guild_audit_delivery').select('next_attempt_at').where('guild_id', '=', guildId)
    .where('completed_at', 'is', null).orderBy('id').executeTakeFirst();
  await trx.updateTable('guild_audit_schedule').set({ wake_at: first?.next_attempt_at ?? null }).where('guild_id', '=', guildId).execute();
}

export class PostgresGuildAuditRepository implements GuildAuditRepository {
  constructor(private readonly db: Db) {}

  recordTodolist(input: { readonly guildId: GuildId; readonly actor: UserId; readonly channelId: ChannelId; readonly messageIds: readonly MessageId[] }): Promise<void> {
    return withTenant(this.db, input.guildId, async (trx) => {
      // Si une purge concurrente a déjà effacé le serveur, ne pas recréer ses données.
      const exists = await trx.selectFrom('guild_registry').select('guild_id').where('guild_id', '=', input.guildId).forKeyShare().executeTakeFirst();
      if (!exists) return;
      await trx.insertInto('guild_audit_log').values({ guild_id: input.guildId, actor_id: input.actor, action: 'todolist.created',
        after: JSON.stringify({ channel_id: input.channelId, messages: input.messageIds.length, message_ids: input.messageIds }),
      }).execute();
    });
  }

  async due(now: Date, limit: number): Promise<readonly GuildId[]> {
    const rows = await this.db.selectFrom('guild_audit_schedule').select('guild_id').where('failure_reason', 'is', null)
      .where('wake_at', '<=', now).orderBy('wake_at').limit(limit).execute();
    return rows.map((row) => GuildId.assert(row.guild_id));
  }

  channel(guildId: GuildId): Promise<ChannelId | null> {
    return withTenant(this.db, guildId, async (trx) => {
      const row = await trx.selectFrom('guild_settings').select('audit_channel_id').where('guild_id', '=', guildId).executeTakeFirst();
      return row?.audit_channel_id ? ChannelId.assert(row.audit_channel_id) : null;
    });
  }

  resume(guildId: GuildId, channelId: ChannelId, actor: UserId): Promise<boolean> {
    return withTenant(this.db, guildId, async (trx) => {
      const settings = await trx.selectFrom('guild_settings').select('audit_channel_id').where('guild_id', '=', guildId).forUpdate().executeTakeFirst();
      if (settings?.audit_channel_id !== channelId) return false;
      await trx.updateTable('guild_audit_schedule').set({ failure_reason: null, failed_at: null }).where('guild_id', '=', guildId).execute();
      await trx.insertInto('guild_audit_log').values({ guild_id: guildId, actor_id: actor, action: 'audit.test', after: JSON.stringify({ channelId }) }).execute();
      await schedule(trx, guildId);
      return true;
    });
  }

  deliver(guildId: GuildId, now: Date, publish: (event: AuditEvent) => Promise<AuditDeliveryResult>): Promise<boolean> {
    return withTenant(this.db, guildId, async (trx) => {
      // Verrou par guilde : protège aussi contre un changement de salon et deux workers concurrents.
      // Seule cette transaction de livraison attend Discord ; les écritures métier ne font aucun appel réseau.
      await sql`SET LOCAL idle_in_transaction_session_timeout = '120s'`.execute(trx);
      const settings = await trx.selectFrom('guild_settings').select(['locale', 'audit_channel_id']).where('guild_id', '=', guildId).forUpdate().skipLocked().executeTakeFirst();
      if (!settings) return false;
      const state = await trx.selectFrom('guild_audit_schedule').select('failure_reason').where('guild_id', '=', guildId).executeTakeFirst();
      if (state?.failure_reason) return false;
      const row = await trx.selectFrom('guild_audit_delivery').selectAll().where('guild_id', '=', guildId).where('completed_at', 'is', null).orderBy('id').forUpdate().executeTakeFirst();
      if (!row) { await schedule(trx, guildId); return false; }
      if (row.next_attempt_at > now) { await schedule(trx, guildId); return false; }
      let event: AuditEvent | null = null;
      const common = { id: row.id, guildId, channelId: ChannelId.assert(row.channel_id), locale: settings.locale, before: null, after: null, detail: null, assetId: null, sourceChannelId: null };
      if (row.audit_id !== null) {
        const source = await trx.selectFrom('guild_audit_log').selectAll().where('guild_id', '=', guildId).where('id', '=', row.audit_id).executeTakeFirst();
        if (source) {
          const todolist = source.action === 'todolist.created';
          const metadata = source.after as { channel_id?: unknown } | null;
          event = { ...common, actor: source.actor_id, action: source.action, before: todolist ? null : source.before, after: todolist ? null : source.after,
            detail: todolist ? source.after : null, sourceChannelId: todolist && typeof metadata?.channel_id === 'string' ? metadata.channel_id : null, at: source.at };
        }
      } else if (row.timer_event_id !== null) {
        const source = await trx.selectFrom('timer_events').selectAll().where('guild_id', '=', guildId).where('id', '=', row.timer_event_id).executeTakeFirst();
        if (source) {
          const board = await trx.selectFrom('timer_boards').select('channel_id').where('guild_id', '=', guildId).where('id', '=', source.board_id).executeTakeFirst();
          event = { ...common, actor: source.actor_id, action: source.action, detail: source.detail, assetId: source.asset_id, sourceChannelId: board?.channel_id ?? null, at: source.at };
        }
      }
      const removal = event?.action === 'settings.audit_channel' && settings.audit_channel_id === null
        && (event.after as { auditChannelId?: unknown } | null)?.auditChannelId === null
        && (event.before as { auditChannelId?: unknown } | null)?.auditChannelId === row.channel_id;
      if (!event || (settings.audit_channel_id !== row.channel_id && !removal) || event.at.getTime() <= now.getTime() - 30 * 86_400_000) {
        await trx.updateTable('guild_audit_delivery').set({ completed_at: now, last_error: 'obsolete' }).where('guild_id', '=', guildId).where('id', '=', row.id).execute();
        await schedule(trx, guildId);
        return true;
      }
      const result = await publish(event);
      const attempts = row.attempts + 1;
      const next = new Date(now.getTime() + Math.min(900_000, 30_000 * 2 ** Math.min(attempts - 1, 5)));
      await trx.updateTable('guild_audit_delivery').set({ attempts,
        ...(result.kind === 'sent' ? { completed_at: now, message_id: result.messageId, last_error: null }
          : { last_error: result.reason, next_attempt_at: result.kind === 'retry' ? next : now }),
      }).where('guild_id', '=', guildId).where('id', '=', row.id).execute();
      if (result.kind === 'blocked') await trx.updateTable('guild_audit_schedule').set({ failure_reason: result.reason, failed_at: now }).where('guild_id', '=', guildId).execute();
      await schedule(trx, guildId);
      return true;
    });
  }
}
