import { DiscordAPIError, HTTPError, RateLimitError, REST, type RESTOptions } from '@discordjs/rest';
import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  Routes,
  type APIMessage,
  type RESTPatchAPIChannelMessageJSONBody,
  type RESTPostAPIChannelMessageJSONBody,
} from 'discord-api-types/v10';
import { ChannelId, MessageId, type Secret } from '@picket/kernel';
import {
  BUTTONS_PER_ROW,
  DiscordApiError,
  MAX_BUTTONS_PER_MESSAGE,
  MAX_EMBED_DESCRIPTION,
  MAX_EMBED_FIELDS,
  MAX_EMBEDS_PER_MESSAGE,
  MAX_EMBEDS_TOTAL_LENGTH,
  MAX_FIELD_NAME,
  MAX_FIELD_VALUE,
  MAX_MESSAGE_CONTENT,
  embedsLength,
  type DiscordErrorReason,
  type MessageView,
  type Messaging,
  type StoredMessage,
} from '../application/messaging';

const CODE_TO_REASON: Readonly<Record<number, DiscordErrorReason>> = {
  10003: 'unknown_channel',
  10008: 'unknown_message',
  50001: 'missing_access',
  50007: 'cannot_dm',
  50013: 'missing_permissions',
};

const NETWORK_ERROR_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']);

/** Ramène toute erreur du client REST à une erreur de domaine, sans conserver l'erreur d'origine (jeton possible dans l'URL). */
export function mapRestError(error: unknown): DiscordApiError {
  if (error instanceof DiscordApiError) return error;
  if (error instanceof DiscordAPIError) {
    const code = typeof error.code === 'number' ? error.code : undefined;
    const reason: DiscordErrorReason =
      (code !== undefined ? CODE_TO_REASON[code] : undefined) ??
      (error.status === 429 ? 'rate_limited' : error.status >= 500 ? 'unavailable' : 'unknown');
    return new DiscordApiError(reason, `Discord API error ${String(error.code)}`, { status: error.status, discordCode: error.code });
  }
  if (error instanceof RateLimitError) return new DiscordApiError('rate_limited', 'Discord rate limit', { status: 429 });
  if (error instanceof HTTPError) {
    return new DiscordApiError(error.status >= 500 ? 'unavailable' : 'unknown', `Discord HTTP error ${error.status}`, {
      status: error.status,
    });
  }
  // Pas d'`instanceof Error` : une erreur de Node peut venir d'un autre contexte d'exécution.
  const candidate = typeof error === 'object' && error !== null ? (error as { name?: unknown; code?: unknown; cause?: unknown }) : null;
  const causeCode = (candidate?.cause as { code?: unknown } | null | undefined)?.code;
  const isNetworkCode = (code: unknown): boolean => typeof code === 'string' && NETWORK_ERROR_CODES.has(code);
  if (
    candidate !== null &&
    (candidate.name === 'AbortError' || candidate.name === 'TimeoutError' || isNetworkCode(candidate.code) || isNetworkCode(causeCode))
  ) {
    return new DiscordApiError('unavailable', 'Discord unreachable');
  }
  return new DiscordApiError('unknown', 'Unexpected Discord client error');
}

/** Corps REST d'un message du bot : seules les mentions de rôles explicitement demandées sont résolues, boutons en lignes de 5. */
export function toRestMessage(view: MessageView): RESTPostAPIChannelMessageJSONBody & RESTPatchAPIChannelMessageJSONBody {
  if (view.buttons.length > MAX_BUTTONS_PER_MESSAGE) throw new RangeError('Too many buttons for one message');
  if (view.embeds.length > MAX_EMBEDS_PER_MESSAGE) throw new RangeError('Too many embeds for one message');
  if (embedsLength(view.embeds) > MAX_EMBEDS_TOTAL_LENGTH) throw new RangeError('Embeds too long for one message');
  if ((view.content?.length ?? 0) > MAX_MESSAGE_CONTENT) throw new RangeError('Message content too long');
  for (const embed of view.embeds) {
    if ((embed.description?.length ?? 0) > MAX_EMBED_DESCRIPTION) throw new RangeError('Embed description too long');
    if ((embed.fields?.length ?? 0) > MAX_EMBED_FIELDS) throw new RangeError('Too many embed fields');
    for (const field of embed.fields ?? []) {
      if (field.name.length > MAX_FIELD_NAME || field.value.length > MAX_FIELD_VALUE) throw new RangeError('Embed field too long');
    }
  }
  const components = [];
  for (let start = 0; start < view.buttons.length; start += BUTTONS_PER_ROW) {
    components.push({
      type: ComponentType.ActionRow as const,
      components: view.buttons.slice(start, start + BUTTONS_PER_ROW).map((button) => ({
        type: ComponentType.Button as const,
        style: ButtonStyle.Secondary as const,
        custom_id: button.customId,
        emoji: { name: button.emoji },
      })),
    });
  }
  return {
    ...(view.content !== undefined ? { content: view.content } : {}),
    embeds: view.embeds.map((embed) => ({
      ...(embed.title !== undefined ? { title: embed.title } : {}),
      ...(embed.description !== undefined && embed.description !== '' ? { description: embed.description } : {}),
      ...(embed.fields !== undefined && embed.fields.length > 0
        ? { fields: embed.fields.map((field) => ({ name: field.name, value: field.value, inline: field.inline ?? false })) }
        : {}),
      ...(embed.footer !== undefined ? { footer: { text: embed.footer } } : {}),
      ...(embed.color !== undefined ? { color: embed.color } : {}),
    })),
    components,
    allowed_mentions: { parse: [], ...(view.mentionRoleIds !== undefined && view.mentionRoleIds.length > 0 ? { roles: [...view.mentionRoleIds] } : {}) },
    ...(view.silent === true ? { flags: MessageFlags.SuppressNotifications } : {}),
  };
}

function toStoredMessage(message: APIMessage): StoredMessage {
  const id = MessageId.parse(message.id);
  const channelId = ChannelId.parse(message.channel_id);
  if (!id.ok || !channelId.ok) throw new DiscordApiError('unknown', 'Malformed message identifiers');
  return {
    id: id.value,
    channelId: channelId.value,
    embeds: message.embeds.map((embed) => ({
      title: embed.title ?? null,
      description: embed.description ?? null,
      footer: embed.footer?.text ?? null,
      color: embed.color ?? null,
    })),
  };
}

export class DiscordRestMessaging implements Messaging {
  readonly #rest: REST;

  constructor(botToken: Secret, options: Partial<RESTOptions> = {}) {
    this.#rest = new REST({ version: '10', timeout: 10_000, retries: 2, ...options }).setToken(botToken.reveal());
  }

  async send(channelId: ChannelId, message: MessageView): Promise<MessageId> {
    try {
      const created = (await this.#rest.post(Routes.channelMessages(channelId), { body: toRestMessage(message) })) as APIMessage;
      const id = MessageId.parse(created.id);
      if (!id.ok) throw new DiscordApiError('unknown', 'Malformed message identifier');
      return id.value;
    } catch (error) {
      throw mapRestError(error);
    }
  }

  async fetch(channelId: ChannelId, messageId: MessageId): Promise<StoredMessage> {
    try {
      return toStoredMessage((await this.#rest.get(Routes.channelMessage(channelId, messageId))) as APIMessage);
    } catch (error) {
      throw mapRestError(error);
    }
  }

  async edit(channelId: ChannelId, messageId: MessageId, message: MessageView): Promise<void> {
    try {
      await this.#rest.patch(Routes.channelMessage(channelId, messageId), { body: toRestMessage(message) });
    } catch (error) {
      throw mapRestError(error);
    }
  }

  async delete(channelId: ChannelId, messageId: MessageId): Promise<void> {
    try {
      await this.#rest.delete(Routes.channelMessage(channelId, messageId));
    } catch (error) {
      throw mapRestError(error);
    }
  }
}
