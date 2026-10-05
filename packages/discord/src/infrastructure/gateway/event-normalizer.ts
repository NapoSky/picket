import { GatewayDispatchEvents, type GatewayDispatchPayload } from 'discord-api-types/v10';
import { GuildId, RoleId } from '@picket/kernel';
import type { GatewayEvent } from '../../application/gateway-events';

/** Retourne `null` pour tout ce qui n'intéresse pas l'application ou qui est mal formé. */
export function normalizeDispatch(
  payload: GatewayDispatchPayload,
  shardId: number,
  fallbackShardCount: number,
): GatewayEvent | null {
  switch (payload.t) {
    case GatewayDispatchEvents.Ready: {
      const guildIds: GuildId[] = [];
      for (const guild of payload.d.guilds) {
        const parsed = GuildId.parse(guild.id);
        if (parsed.ok) guildIds.push(parsed.value);
      }
      return { type: 'ready', shardId, shardCount: payload.d.shard?.[1] ?? fallbackShardCount, guildIds };
    }
    case GatewayDispatchEvents.GuildCreate: {
      const guildId = GuildId.parse(payload.d.id);
      return guildId.ok ? { type: 'guild_available', guildId: guildId.value } : null;
    }
    case GatewayDispatchEvents.GuildDelete: {
      // `unavailable: true` = panne Discord, pas un départ du bot.
      if (payload.d.unavailable === true) return null;
      const guildId = GuildId.parse(payload.d.id);
      return guildId.ok ? { type: 'guild_removed', guildId: guildId.value } : null;
    }
    case GatewayDispatchEvents.GuildRoleDelete: {
      const guildId = GuildId.parse(payload.d.guild_id);
      const roleId = RoleId.parse(payload.d.role_id);
      return guildId.ok && roleId.ok ? { type: 'role_deleted', guildId: guildId.value, roleId: roleId.value } : null;
    }
    default:
      return null;
  }
}
