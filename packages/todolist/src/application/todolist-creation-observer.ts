import type { ChannelId, GuildId, MessageId, UserId } from '@picket/kernel';

/** Publication metadata only; content stays in Discord. */
export interface TodolistCreationObserver {
  record(input: { readonly guildId: GuildId; readonly actor: UserId; readonly channelId: ChannelId; readonly messageIds: readonly MessageId[] }): Promise<void>;
}
