import { DiscordApiError, type DiscordErrorReason, type Messaging } from '@picket/discord';
import { LockTimeoutError, type KeyedLock } from '@picket/coordination';
import type { ChannelId, MessageId } from '@picket/kernel';
import { tickItem } from '../domain/tick';
import { itemButtons } from './create-todolist';

export type TickResult =
  | { readonly kind: 'updated' }
  /** Last item on the page: delete the message. `page`/`total` come from its footer (1/1 for a single page). */
  | { readonly kind: 'completed'; readonly page: number; readonly total: number }
  /** Item no longer open: another click got there first, or the button is stale. */
  | { readonly kind: 'already_done' }
  /** The message no longer has a readable embed. */
  | { readonly kind: 'unreadable' }
  /** The message was deleted meanwhile. */
  | { readonly kind: 'gone' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'discord_error'; readonly reason: DiscordErrorReason };

const FOOTER_POSITION = /(\d+)\s*\/\s*(\d+)/u;

function footerPosition(footer: string | null): { page: number; total: number } {
  const match = footer === null ? null : FOOTER_POSITION.exec(footer);
  return match ? { page: Number(match[1]), total: Number(match[2]) } : { page: 1, total: 1 };
}

/**
 * A click mutates the message itself without stored data: lock per message, reread fresh state (never the
 * interaction snapshot, stale under concurrent clicks), then modify only the clicked line.
 */
export class TickTodolistItem {
  readonly #messaging: Messaging;
  readonly #lock: KeyedLock;

  constructor(messaging: Messaging, lock: KeyedLock) {
    this.#messaging = messaging;
    this.#lock = lock;
  }

  async execute(channelId: ChannelId, messageId: MessageId, index: number): Promise<TickResult> {
    try {
      return await this.#lock.withLock(`todolist:${messageId}`, () => this.#tick(channelId, messageId, index));
    } catch (error) {
      if (error instanceof LockTimeoutError) return { kind: 'busy' };
      if (error instanceof DiscordApiError) {
        return error.reason === 'unknown_message' || error.reason === 'unknown_channel'
          ? { kind: 'gone' }
          : { kind: 'discord_error', reason: error.reason };
      }
      throw error;
    }
  }

  async #tick(channelId: ChannelId, messageId: MessageId, index: number): Promise<TickResult> {
    const message = await this.#messaging.fetch(channelId, messageId);
    const embed = message.embeds[0];
    if (embed === undefined || embed.description === null || embed.description === '') return { kind: 'unreadable' };

    const outcome = tickItem(embed.description, index);
    if (outcome.kind === 'not_found') return { kind: 'already_done' };

    const position = footerPosition(embed.footer);
    if (outcome.kind === 'completed') {
      await this.#messaging.delete(channelId, messageId);
      return { kind: 'completed', ...position };
    }

    // Preserve the message's title, footer and color, regardless of the clicking user's locale.
    await this.#messaging.edit(channelId, messageId, {
      embeds: [
        {
          ...(embed.title !== null ? { title: embed.title } : {}),
          description: outcome.description,
          ...(embed.footer !== null ? { footer: embed.footer } : {}),
          ...(embed.color !== null ? { color: embed.color } : {}),
        },
      ],
      buttons: itemButtons(outcome.openIndexes),
    });
    return { kind: 'updated' };
  }
}
