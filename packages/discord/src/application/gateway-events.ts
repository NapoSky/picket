import type { GuildId, RoleId } from '@picket/kernel';

/** Événements Gateway normalisés : aucun type `discord-api-types` n'en sort. */
export type GatewayEvent =
  | {
      readonly type: 'ready';
      readonly shardId: number;
      readonly shardCount: number;
      /** Tous les serveurs du shard, y compris ceux momentanément indisponibles. */
      readonly guildIds: readonly GuildId[];
    }
  | { readonly type: 'guild_available'; readonly guildId: GuildId }
  /** Le bot a été retiré du serveur (jamais émis pour une simple indisponibilité). */
  | { readonly type: 'guild_removed'; readonly guildId: GuildId }
  | { readonly type: 'role_deleted'; readonly guildId: GuildId; readonly roleId: RoleId };

export interface GatewayEventHandler {
  handle(event: GatewayEvent): Promise<void>;
}
