import { ChannelType, GatewayDispatchEvents, type GatewayDispatchPayload } from 'discord-api-types/v10';
import { ChannelId, GuildId, RoleId, UserId } from '@picket/kernel';
import type { GatewayEvent } from '../../application/gateway-events';

/** Return `null` for malformed events or events irrelevant to the application. */
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
      if (!guildId.ok) return null;
      const name = typeof payload.d.name === 'string' ? { name: payload.d.name } : {};
      if (!Array.isArray(payload.d.voice_states)) return { type: 'guild_available', guildId: guildId.value, ...name };
      const voiced=new Set(payload.d.voice_states.map(s=>s.user_id));
      const members = new Map((payload.d.members ?? []).filter(m=>voiced.has(m.user.id)).map(m=>[m.user.id,m]));
      const people = payload.d.voice_states.flatMap(state=>{
        if (!UserId.parse(state.user_id).ok || (state.channel_id!==null && !ChannelId.parse(state.channel_id).ok)) return [];
        const member = state.member ?? members.get(state.user_id);
        return [{userId:state.user_id,channelId:state.channel_id,roles:member?.roles ?? [],rolesKnown:member!==undefined,bot:member?.user?.bot ?? false,name:member?.nick ?? member?.user?.global_name ?? member?.user?.username ?? state.user_id}];
      });
      return {type:'guild_available',guildId:guildId.value,...name,voiceSnapshot:{name:payload.d.name,afkChannelId:payload.d.afk_channel_id,people,channels:Object.fromEntries((payload.d.channels ?? []).map(c=>[c.id,c.name]))}};
    }
    case GatewayDispatchEvents.GuildUpdate: {
      const guildId=GuildId.parse(payload.d.id);
      return guildId.ok ? {type:'guild_voice_metadata',guildId:guildId.value,name:payload.d.name,afkChannelId:payload.d.afk_channel_id} : null;
    }
    case GatewayDispatchEvents.VoiceStateUpdate: {
      const guildId=GuildId.parse(payload.d.guild_id); const userId=UserId.parse(payload.d.user_id);
      if (!guildId.ok || !userId.ok || (payload.d.channel_id!==null && !ChannelId.parse(payload.d.channel_id).ok)) return null;
      const member=payload.d.member;
      return {type:'voice_state',guildId:guildId.value,person:{userId:userId.value,channelId:payload.d.channel_id,roles:member?.roles ?? [],rolesKnown:member!==undefined,bot:member?.user?.bot ?? false,name:member?.nick ?? member?.user?.global_name ?? member?.user?.username ?? userId.value}};
    }
    case GatewayDispatchEvents.GuildMemberUpdate: {
      const guildId=GuildId.parse(payload.d.guild_id); const userId=UserId.parse(payload.d.user.id);
      return guildId.ok && userId.ok ? {type:'voice_member',guildId:guildId.value,userId:userId.value,roles:payload.d.roles,bot:payload.d.user.bot ?? false,name:payload.d.nick ?? payload.d.user.global_name ?? payload.d.user.username} : null;
    }
    case GatewayDispatchEvents.GuildMemberRemove: {
      const guildId=GuildId.parse(payload.d.guild_id); const userId=UserId.parse(payload.d.user.id);
      return guildId.ok && userId.ok ? {type:'voice_member_removed',guildId:guildId.value,userId:userId.value} : null;
    }
    case GatewayDispatchEvents.GuildDelete: {
      // `unavailable: true` means a Discord outage, not removal of the bot.
      const guildId = GuildId.parse(payload.d.id);
      if (payload.d.unavailable === true) return guildId.ok ? {type:'guild_voice_unavailable',guildId:guildId.value} : null;
      return guildId.ok ? { type: 'guild_removed', guildId: guildId.value } : null;
    }
    case GatewayDispatchEvents.GuildRoleDelete: {
      const guildId = GuildId.parse(payload.d.guild_id);
      const roleId = RoleId.parse(payload.d.role_id);
      return guildId.ok && roleId.ok ? { type: 'role_deleted', guildId: guildId.value, roleId: roleId.value } : null;
    }
    case GatewayDispatchEvents.ChannelUpdate:
    case GatewayDispatchEvents.ChannelDelete: {
      if (payload.t === GatewayDispatchEvents.ChannelUpdate && payload.d.type === ChannelType.GuildText) return null;
      const guildId = GuildId.parse('guild_id' in payload.d ? payload.d.guild_id : undefined);
      const channelId = ChannelId.parse(payload.d.id);
      return guildId.ok && channelId.ok ? { type: 'channel_unusable', guildId: guildId.value, channelId: channelId.value,deleted:payload.t===GatewayDispatchEvents.ChannelDelete,...('name' in payload.d && typeof payload.d.name==='string' ? {name:payload.d.name} : {}) } : null;
    }
    default:
      return null;
  }
}
