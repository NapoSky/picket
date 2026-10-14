import { DomainError, type ApplicationId, type ChannelId, type MessageId, type RoleId, type Secret } from '@picket/kernel';
import type { PanelView } from './panel';

export interface ReplyFile {
  readonly filename: string;
  readonly bytes: Uint8Array;
}

export interface FileReplyContent {
  readonly content: string;
  readonly file: ReplyFile;
}

export type ReplyContent = string | PanelView | FileReplyContent;

export interface EmbedFieldView {
  readonly name: string;
  readonly value: string;
  readonly inline?: boolean;
}

export interface EmbedView {
  readonly title?: string;
  readonly description?: string;
  readonly fields?: readonly EmbedFieldView[];
  readonly footer?: string;
  /** ISO date displayed beside the footer. */
  readonly timestamp?: string;
  readonly color?: number;
}

export interface ButtonView {
  readonly customId: string;
  /** Unicode emoji; the button has no label. */
  readonly emoji: string;
}

/** Bot message content: the adapter arranges buttons in rows of 5. */
export interface MessageView {
  /** Creation deduplication key (Discord retains nonces for a few minutes). */
  readonly nonce?: string;
  readonly embeds: readonly EmbedView[];
  readonly buttons: readonly ButtonView[];
  /** Text outside embeds (for example, an alert mentioning roles). */
  readonly content?: string;
  /** Only roles actually notified; no other mention is ever resolved. */
  readonly mentionRoleIds?: readonly RoleId[];
  /** No push notification, even for mentioned roles. */
  readonly silent?: boolean;
  /** Suppress link previews for single-line messages. */
  readonly suppressEmbeds?: boolean;
}

export const MAX_BUTTONS_PER_MESSAGE = 25;
export const BUTTONS_PER_ROW = 5;
export const MAX_EMBED_DESCRIPTION = 4096;
export const MAX_EMBEDS_PER_MESSAGE = 10;
export const MAX_EMBED_FIELDS = 25;
export const MAX_FIELD_NAME = 256;
export const MAX_FIELD_VALUE = 1024;
export const MAX_MESSAGE_CONTENT = 2000;
/** Total characters (title, description, fields and footer) across all embeds in a message. */
export const MAX_EMBEDS_TOTAL_LENGTH = 6000;

/** Characters Discord counts towards a message's 6,000-character limit. */
export function embedsLength(embeds: readonly EmbedView[]): number {
  let total = 0;
  for (const embed of embeds) {
    total += (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.length ?? 0);
    for (const field of embed.fields ?? []) total += field.name.length + field.value.length;
  }
  return total;
}

export interface StoredEmbed {
  readonly title: string | null;
  readonly description: string | null;
  readonly footer: string | null;
  readonly color: number | null;
}

export interface StoredMessage {
  readonly id: MessageId;
  readonly channelId: ChannelId;
  readonly embeds: readonly StoredEmbed[];
}

export type DiscordErrorReason =
  | 'unknown_channel'
  | 'unknown_message'
  | 'missing_access'
  | 'missing_permissions'
  | 'cannot_dm'
  | 'rate_limited'
  | 'unavailable'
  | 'unknown';

/** Discord API error mapped to a domain reason (codes 10003, 10008, 50001, 50007, 50013, 429, 5xx). */
export class DiscordApiError extends DomainError {
  readonly code = 'discord_api_error';
  readonly reason: DiscordErrorReason;
  readonly status: number | undefined;
  readonly discordCode: number | string | undefined;

  /** No `cause`: the original error may include an interaction token in its URL. */
  constructor(reason: DiscordErrorReason, message: string, details: { status?: number; discordCode?: number | string } = {}) {
    super(message);
    this.reason = reason;
    this.status = details.status;
    this.discordCode = details.discordCode;
  }
}

/** Bot messages. Every method throws `DiscordApiError`; messages are always sent without mentions. */
export interface Messaging {
  send(channelId: ChannelId, message: MessageView): Promise<MessageId>;
  fetch(channelId: ChannelId, messageId: MessageId): Promise<StoredMessage>;
  edit(channelId: ChannelId, messageId: MessageId, message: MessageView): Promise<void>;
  delete(channelId: ChannelId, messageId: MessageId): Promise<void>;
}

export interface ReplyTarget {
  readonly applicationId: ApplicationId;
  readonly token: Secret;
}

/** Follow-ups for an acknowledged interaction (the token remains valid for 15 minutes). */
export interface InteractionReplies {
  editOriginal(target: ReplyTarget, content: ReplyContent): Promise<void>;
  deleteOriginal(target: ReplyTarget): Promise<void>;
  /** Always ephemeral. */
  followUp(target: ReplyTarget, content: ReplyContent): Promise<void>;
}
