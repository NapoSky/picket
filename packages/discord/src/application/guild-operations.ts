import type { ChannelId, GuildId, UserId } from '@picket/kernel';

export interface OperatorScope {
  readonly guildId: GuildId;
  /** Configured notification channel used to resolve the support guild, not the invocation channel. */
  readonly channelId: ChannelId;
  readonly ownerId: UserId;
  readonly ownerName: string;
}

/** Service ownership is independent of tenant roles and Discord server permissions. */
export interface GuildOperationsDiscord {
  scope(channelId: ChannelId, fresh?: boolean): Promise<OperatorScope>;
  /** Only Discord's explicit Unknown Guild response means absent; access/transport errors throw. */
  guild(guildId: GuildId): Promise<{ readonly name: string; readonly locale?: string | null } | null>;
  leave(guildId: GuildId, notAfter?: Date): Promise<void>;
}
