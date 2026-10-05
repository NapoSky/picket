import type { GatewayEvent, GatewayEventHandler } from '@picket/discord';
import type { Logger } from '@picket/kernel';
import type {
  HandleGuildAvailable,
  HandleGuildRemoved,
  ReconcileGuilds,
} from '../../application/guild-events-use-cases';
import type { HandleRoleDeleted } from '../../application/permissions-use-cases';

export interface GuildEventUseCases {
  readonly available: HandleGuildAvailable;
  readonly removed: HandleGuildRemoved;
  readonly reconcile: ReconcileGuilds;
  readonly roleDeleted: HandleRoleDeleted;
}

export function createGuildEventHandler(useCases: GuildEventUseCases, logger: Logger): GatewayEventHandler {
  return {
    async handle(event: GatewayEvent): Promise<void> {
      switch (event.type) {
        case 'ready': {
          const departed = await useCases.reconcile.execute({
            shardId: event.shardId,
            shardCount: event.shardCount,
            presentGuildIds: event.guildIds,
          });
          logger.info(
            { shard_id: event.shardId, guilds: event.guildIds.length, departed: departed.length },
            'guilds reconciled after connection',
          );
          return;
        }
        case 'guild_available':
          await useCases.available.execute(event.guildId);
          return;
        case 'guild_removed':
          if (await useCases.removed.execute(event.guildId)) {
            logger.info({ guild_id: event.guildId }, 'bot removed from guild, data kept until retention ends');
          }
          return;
        case 'role_deleted':
          if (await useCases.roleDeleted.execute(event.guildId, event.roleId)) {
            logger.info({ guild_id: event.guildId, role_id: event.roleId }, 'deleted role removed from access levels');
          }
          return;
      }
    },
  };
}
