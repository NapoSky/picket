import { DiscordApiError, type ButtonView, type DiscordErrorReason, type MessageView, type Messaging } from '@picket/discord';
import { err, ok, type ChannelId, type MessageId, type Result } from '@picket/kernel';
import { letterEmoji } from '../domain/constants';
import { layoutPages, type LayoutError } from '../domain/layout';
import { parseTodolist, type ParseError } from '../domain/parser';
import { itemCustomId } from './custom-ids';
import { openItemIndexes } from '../domain/tick';

export const TODOLIST_COLOR = 0x5865f2;

/** Textes déjà traduits par la présentation. */
export interface PageTexts {
  readonly title: string;
  readonly footer: (page: number, total: number) => string;
}

export interface PreparedTodolist {
  readonly pages: readonly MessageView[];
}

export type PrepareError = ParseError | LayoutError;

export interface PublishFailure {
  readonly reason: DiscordErrorReason;
  /** Pages déjà publiées avant l'échec, retirées au mieux. */
  readonly rolledBack: number;
}

export function itemButtons(openIndexes: readonly number[]): readonly ButtonView[] {
  return openIndexes.map((index) => ({ customId: itemCustomId(index), emoji: letterEmoji(index) }));
}

export function buildPageView(
  description: string,
  texts: PageTexts,
  position: { readonly page: number; readonly total: number } | null,
  openIndexes: readonly number[],
): MessageView {
  return {
    embeds: [
      {
        title: texts.title,
        description,
        ...(position !== null && position.total > 1 ? { footer: texts.footer(position.page, position.total) } : {}),
        color: TODOLIST_COLOR,
      },
    ],
    buttons: itemButtons(openIndexes),
  };
}

export class CreateTodolist {
  readonly #messaging: Messaging;

  constructor(messaging: Messaging) {
    this.#messaging = messaging;
  }

  /** Pur et immédiat : permet de refuser la saisie avant tout accusé de réception différé. */
  prepare(text: string, texts: PageTexts): Result<PreparedTodolist, PrepareError> {
    const parsed = parseTodolist(text);
    if (!parsed.ok) return parsed;
    const laidOut = layoutPages(parsed.value);
    if (!laidOut.ok) return laidOut;
    const total = laidOut.value.length;
    return ok({
      pages: laidOut.value.map((page, index) =>
        buildPageView(page.description, texts, { page: index + 1, total }, openItemIndexes(page.description)),
      ),
    });
  }

  /** Publie les pages dans l'ordre ; en cas d'échec, retire celles déjà publiées pour ne jamais laisser une liste tronquée. */
  async publish(channelId: ChannelId, prepared: PreparedTodolist): Promise<Result<readonly MessageId[], PublishFailure>> {
    const posted: MessageId[] = [];
    try {
      for (const page of prepared.pages) posted.push(await this.#messaging.send(channelId, page));
      return ok(posted);
    } catch (error) {
      let rolledBack = 0;
      for (const id of posted) {
        try {
          await this.#messaging.delete(channelId, id);
          rolledBack += 1;
        } catch {
          // Au mieux : un message resté en place est une page valide, pas un état corrompu.
        }
      }
      if (error instanceof DiscordApiError) return err({ reason: error.reason, rolledBack });
      throw error;
    }
  }
}
