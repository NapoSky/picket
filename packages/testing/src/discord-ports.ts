import { setTimeout as sleep } from 'node:timers/promises';
import {
  ComponentRegistry,
  DiscordApiError,
  type ButtonView,
  type DiscordErrorReason,
  type FeatureGate,
  type InteractionReplies,
  type MessageView,
  type Messaging,
  type ReplyTarget,
  type StoredMessage,
} from '@picket/discord';
import { ChannelId, MessageId } from '@picket/kernel';

export const allFeaturesEnabled: FeatureGate = { isEnabled: async () => true };

export const noComponents = new ComponentRegistry([]);

type Operation = 'send' | 'fetch' | 'edit' | 'delete';

interface Stored {
  message: StoredMessage;
  buttons: readonly ButtonView[];
}

/** Adaptateur de messagerie en mémoire : mêmes erreurs typées que l'adaptateur REST, pannes et latence injectables. */
export class InMemoryMessaging implements Messaging {
  readonly #messages = new Map<string, Stored>();
  readonly #failures: { operation: Operation; reason: DiscordErrorReason; remaining: number }[] = [];
  #counter = 0;
  /** Appels reçus, dans l'ordre (`send`, `fetch:<id>`, `edit:<id>`, `delete:<id>`). */
  readonly calls: string[] = [];
  /** Latence de lecture et d'écriture : ouvre la fenêtre de course que le verrou doit fermer. */
  latencyMs = 0;

  /** Fait échouer les `count` prochains appels de `operation`. */
  failNext(operation: Operation, reason: DiscordErrorReason, count = 1): void {
    this.#failures.push({ operation, reason, remaining: count });
  }

  #check(operation: Operation): void {
    const failure = this.#failures.find((candidate) => candidate.operation === operation && candidate.remaining > 0);
    if (failure) {
      failure.remaining -= 1;
      throw new DiscordApiError(failure.reason, `injected ${operation} failure`);
    }
  }

  #key(channelId: ChannelId, messageId: MessageId): string {
    return `${channelId}:${messageId}`;
  }

  #stored(channelId: ChannelId, messageId: MessageId): Stored {
    const stored = this.#messages.get(this.#key(channelId, messageId));
    if (!stored) throw new DiscordApiError('unknown_message', 'Unknown Message');
    return stored;
  }

  /** Messages encore présents dans un canal, dans l'ordre de publication. */
  list(channelId: ChannelId): readonly { id: MessageId; description: string; buttons: readonly ButtonView[]; footer: string | null }[] {
    return [...this.#messages.values()]
      .filter((stored) => stored.message.channelId === channelId)
      .map((stored) => ({
        id: stored.message.id,
        description: stored.message.embeds[0]?.description ?? '',
        buttons: stored.buttons,
        footer: stored.message.embeds[0]?.footer ?? null,
      }));
  }

  /** Simule une suppression faite par un humain. */
  remove(channelId: ChannelId, messageId: MessageId): void {
    this.#messages.delete(this.#key(channelId, messageId));
  }

  async send(channelId: ChannelId, message: MessageView): Promise<MessageId> {
    this.calls.push('send');
    this.#check('send');
    this.#counter += 1;
    const id = MessageId.assert(String(900000000000000000n + BigInt(this.#counter)));
    this.#messages.set(this.#key(channelId, id), { message: toStored(id, channelId, message), buttons: message.buttons });
    return id;
  }

  async fetch(channelId: ChannelId, messageId: MessageId): Promise<StoredMessage> {
    this.calls.push(`fetch:${messageId}`);
    this.#check('fetch');
    const stored = this.#stored(channelId, messageId);
    // Instantané pris avant la latence : c'est ce que verrait un client concurrent.
    const snapshot = stored.message;
    if (this.latencyMs > 0) await sleep(this.latencyMs);
    return snapshot;
  }

  async edit(channelId: ChannelId, messageId: MessageId, message: MessageView): Promise<void> {
    this.calls.push(`edit:${messageId}`);
    this.#check('edit');
    if (this.latencyMs > 0) await sleep(this.latencyMs);
    this.#stored(channelId, messageId);
    this.#messages.set(this.#key(channelId, messageId), {
      message: toStored(messageId, channelId, message),
      buttons: message.buttons,
    });
  }

  async delete(channelId: ChannelId, messageId: MessageId): Promise<void> {
    this.calls.push(`delete:${messageId}`);
    this.#check('delete');
    this.#stored(channelId, messageId);
    this.#messages.delete(this.#key(channelId, messageId));
  }
}

function toStored(id: MessageId, channelId: ChannelId, message: MessageView): StoredMessage {
  return {
    id,
    channelId,
    embeds: message.embeds.map((embed) => ({
      title: embed.title ?? null,
      description: embed.description,
      footer: embed.footer ?? null,
      color: embed.color ?? null,
    })),
  };
}

export interface RecordedReply {
  readonly action: 'editOriginal' | 'deleteOriginal' | 'followUp';
  readonly target: ReplyTarget;
  readonly content: string | null;
}

export class InMemoryInteractionReplies implements InteractionReplies {
  readonly replies: RecordedReply[] = [];
  failWith: DiscordApiError | null = null;

  async editOriginal(target: ReplyTarget, content: string): Promise<void> {
    this.#record({ action: 'editOriginal', target, content });
  }

  async deleteOriginal(target: ReplyTarget): Promise<void> {
    this.#record({ action: 'deleteOriginal', target, content: null });
  }

  async followUp(target: ReplyTarget, content: string): Promise<void> {
    this.#record({ action: 'followUp', target, content });
  }

  #record(reply: RecordedReply): void {
    if (this.failWith) throw this.failWith;
    this.replies.push(reply);
  }

  /** Contenus livrés, dans l'ordre. */
  get contents(): readonly (string | null)[] {
    return this.replies.map((reply) => reply.content);
  }
}

/** Verrou par clé en mémoire : les appels d'une même clé s'exécutent l'un après l'autre. */
export class InMemoryKeyedLock {
  readonly #tails = new Map<string, Promise<unknown>>();

  withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    const run = previous.then(work, work);
    this.#tails.set(
      key,
      run.catch(() => undefined),
    );
    return run;
  }
}
