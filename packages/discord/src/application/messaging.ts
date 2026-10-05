import { DomainError, type ApplicationId, type ChannelId, type MessageId, type RoleId, type Secret } from '@picket/kernel';

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
  /** Date ISO affichée à côté du pied de page. */
  readonly timestamp?: string;
  readonly color?: number;
}

export interface ButtonView {
  readonly customId: string;
  /** Emoji Unicode ; le bouton n'a pas de libellé. */
  readonly emoji: string;
}

/** Contenu d'un message du bot : les boutons sont répartis par lignes de 5 par l'adaptateur. */
export interface MessageView {
  readonly embeds: readonly EmbedView[];
  readonly buttons: readonly ButtonView[];
  /** Texte hors embed (par exemple une alerte qui mentionne des rôles). */
  readonly content?: string;
  /** Seuls rôles qui seront réellement notifiés ; aucune autre mention n'est jamais résolue. */
  readonly mentionRoleIds?: readonly RoleId[];
  /** Sans notification push, même pour les rôles mentionnés. */
  readonly silent?: boolean;
}

export const MAX_BUTTONS_PER_MESSAGE = 25;
export const BUTTONS_PER_ROW = 5;
export const MAX_EMBED_DESCRIPTION = 4096;
export const MAX_EMBEDS_PER_MESSAGE = 10;
export const MAX_EMBED_FIELDS = 25;
export const MAX_FIELD_NAME = 256;
export const MAX_FIELD_VALUE = 1024;
export const MAX_MESSAGE_CONTENT = 2000;
/** Total de caractères (titre, description, champs, pied de page) de tous les embeds d'un même message. */
export const MAX_EMBEDS_TOTAL_LENGTH = 6000;

/** Caractères que Discord compte dans la limite des 6 000 d'un message. */
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

/** Erreur de l'API Discord ramenée à une raison de domaine (codes 10003, 10008, 50001, 50007, 50013, 429, 5xx). */
export class DiscordApiError extends DomainError {
  readonly code = 'discord_api_error';
  readonly reason: DiscordErrorReason;
  readonly status: number | undefined;
  readonly discordCode: number | string | undefined;

  /** Pas de `cause` : l'erreur d'origine peut contenir un jeton d'interaction dans son URL. */
  constructor(reason: DiscordErrorReason, message: string, details: { status?: number; discordCode?: number | string } = {}) {
    super(message);
    this.reason = reason;
    this.status = details.status;
    this.discordCode = details.discordCode;
  }
}

/** Messages du bot. Toute méthode lève `DiscordApiError` ; le message est toujours envoyé sans aucune mention. */
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

/** Suites d'une interaction déjà acquittée (le jeton reste valable 15 minutes). */
export interface InteractionReplies {
  editOriginal(target: ReplyTarget, content: string): Promise<void>;
  deleteOriginal(target: ReplyTarget): Promise<void>;
  /** Toujours éphémère. */
  followUp(target: ReplyTarget, content: string): Promise<void>;
}
