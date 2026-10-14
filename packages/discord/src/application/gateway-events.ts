import type { ChannelId, GuildId, RoleId } from '@picket/kernel';
import type { Lease } from '@picket/coordination';

export interface GatewayVoicePerson {
  readonly userId: string; readonly channelId: string | null; readonly roles: readonly string[];
  readonly bot: boolean; readonly name: string;
  readonly rolesKnown?:boolean;
}
export interface GatewayVoiceSnapshot {
  readonly name: string; readonly afkChannelId: string | null;
  readonly people: readonly GatewayVoicePerson[];
  readonly channels: Readonly<Record<string,string>>;
}
export interface GatewayDelivery {
  readonly key: string; readonly shardId: number; readonly at: Date;
  readonly replayed: boolean; readonly lease: Lease;
}

/** Normalized Gateway events: no `discord-api-types` types escape this boundary. */
export type GatewayEvent =
  | {
      readonly type: 'ready';
      readonly shardId: number;
      readonly shardCount: number;
      /** All guilds on the shard, including temporarily unavailable guilds. */
      readonly guildIds: readonly GuildId[];
    }
  | { readonly type: 'guild_available'; readonly guildId: GuildId; readonly voiceSnapshot?: GatewayVoiceSnapshot }
  | { readonly type:'guild_voice_unavailable'; readonly guildId:GuildId }
  | { readonly type: 'guild_voice_metadata'; readonly guildId: GuildId; readonly name: string; readonly afkChannelId: string | null }
  | { readonly type: 'voice_state'; readonly guildId: GuildId; readonly person: GatewayVoicePerson }
  | { readonly type: 'voice_member'; readonly guildId: GuildId; readonly userId: string; readonly roles: readonly string[]; readonly bot: boolean; readonly name: string }
  | { readonly type: 'voice_member_removed'; readonly guildId: GuildId; readonly userId: string }
  /** The bot was removed from the guild (never emitted for temporary unavailability). */
  | { readonly type: 'guild_removed'; readonly guildId: GuildId }
  | { readonly type: 'channel_unusable'; readonly guildId: GuildId; readonly channelId: ChannelId; readonly deleted?: boolean; readonly name?: string }
  | { readonly type: 'role_deleted'; readonly guildId: GuildId; readonly roleId: RoleId };

export interface GatewayEventHandler {
  handle(event: GatewayEvent, delivery?: GatewayDelivery): Promise<void>;
  /** Called after a disconnect or fresh process resume; updates run on the dispatch queue. */
  connectionChanged?(shardId: number, connected: boolean, lease: Lease): Promise<void>;
}
