import type { GuildId } from '@picket/kernel';
import type { Tx } from '@picket/persistence';

/**
 * Enregistre la guilde puis crée ses réglages et, pour le seul créateur, le niveau `member` par défaut (@everyone).
 * Sûr en concurrence : un second insert attend le premier, puis ne fait rien.
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
