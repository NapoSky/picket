import type { ChannelId, GuildId, MessageId, UserId } from '@picket/kernel';

/** Métadonnées de publication uniquement ; le contenu reste dans Discord. */
export interface TodolistCreationObserver {
  record(input: { readonly guildId: GuildId; readonly actor: UserId; readonly channelId: ChannelId; readonly messageIds: readonly MessageId[] }): Promise<void>;
}
