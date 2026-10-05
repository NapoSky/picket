import { REST, type RESTOptions } from '@discordjs/rest';
import { MessageFlags, Routes } from 'discord-api-types/v10';
import type { InteractionReplies, ReplyTarget } from '../application/messaging';
import { mapRestError } from './rest-messaging';

/** Les routes de webhook portent le jeton d'interaction : pas d'en-tête d'autorisation, et aucune erreur d'origine conservée. */
export class DiscordRestInteractionReplies implements InteractionReplies {
  readonly #rest: REST;

  constructor(options: Partial<RESTOptions> = {}) {
    this.#rest = new REST({ version: '10', timeout: 10_000, retries: 2, ...options });
  }

  async editOriginal(target: ReplyTarget, content: string): Promise<void> {
    try {
      await this.#rest.patch(Routes.webhookMessage(target.applicationId, target.token.reveal(), '@original'), {
        auth: false,
        body: { content, allowed_mentions: { parse: [] } },
      });
    } catch (error) {
      throw mapRestError(error);
    }
  }

  async deleteOriginal(target: ReplyTarget): Promise<void> {
    try {
      await this.#rest.delete(Routes.webhookMessage(target.applicationId, target.token.reveal(), '@original'), { auth: false });
    } catch (error) {
      throw mapRestError(error);
    }
  }

  async followUp(target: ReplyTarget, content: string): Promise<void> {
    try {
      await this.#rest.post(Routes.webhook(target.applicationId, target.token.reveal()), {
        auth: false,
        body: { content, flags: MessageFlags.Ephemeral, allowed_mentions: { parse: [] } },
      });
    } catch (error) {
      throw mapRestError(error);
    }
  }
}
