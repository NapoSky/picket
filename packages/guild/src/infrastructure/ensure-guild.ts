import type { GuildId } from '@picket/kernel';
import type { Tx } from '@picket/persistence';

/**
 * Register the guild, then create settings and, only for the first creator, the default `member` level
 * (@everyone). Safe under concurrency: a second insert waits for the first, then does nothing.
 */
export async function ensureGuildInitialized(trx: Tx, guildId: GuildId): Promise<void> {
  await trx
    .insertInto('guild_registry')
    .values({ guild_id: guildId })
    .onConflict((conflict) => conflict.column('guild_id').doNothing())
    .execute();

  const created = await trx
    .insertInto('guild_settings')
    .values({ guild_id: guildId })
    .onConflict((conflict) => conflict.column('guild_id').doNothing())
    .returning('guild_id')
    .executeTakeFirst();

  if (created) {
    await trx
      .insertInto('guild_permission_roles')
      .values({ guild_id: guildId, level: 'member', role_id: guildId })
      .onConflict((conflict) => conflict.doNothing())
      .execute();
  }
}
