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
  type ReplyContent,
  type StoredMessage,
} from '@picket/discord';
import { ChannelId, MessageId } from '@picket/kernel';

export const allFeaturesEnabled: FeatureGate = { isEnabled: async () => true };

export const noComponents = new ComponentRegistry([]);

type Operation = 'send' | 'fetch' | 'edit' | 'delete';

interface Stored {
  message: StoredMessage;
  buttons: readonly ButtonView[];
  view: MessageView;
}

/** In-memory messaging adapter: same typed errors as REST, with injectable failures and latency. */
export class InMemoryMessaging implements Messaging {
  readonly #messages = new Map<string, Stored>();
  readonly #failures: { operation: Operation; reason: DiscordErrorReason; remaining: number }[] = [];
  #counter = 0;
  /** Received calls in order (`send`, `fetch:<id>`, `edit:<id>`, `delete:<id>`). */
  readonly calls: string[] = [];
  /** Read/write latency: opens the race window the lock must prevent. */
  latencyMs = 0;

  /** Fail the next `count` calls to `operation`. */
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

  /** Messages still present in a channel, in publication order. */
  list(channelId: ChannelId): readonly {
    id: MessageId;
    description: string;
    buttons: readonly ButtonView[];
    footer: string | null;
    view: MessageView;
  }[] {
    return [...this.#messages.values()]
      .filter((stored) => stored.message.channelId === channelId)
      .map((stored) => ({
        id: stored.message.id,
        description: stored.message.embeds[0]?.description ?? '',
        buttons: stored.buttons,
        footer: stored.message.embeds[0]?.footer ?? null,
        view: stored.view,
      }));
  }

  /** Simulate deletion by a human. */
  remove(channelId: ChannelId, messageId: MessageId): void {
    this.#messages.delete(this.#key(channelId, messageId));
  }

  async send(channelId: ChannelId, message: MessageView): Promise<MessageId> {
    this.calls.push('send');
    this.#check('send');
    this.#counter += 1;
    const id = MessageId.assert(String(900000000000000000n + BigInt(this.#counter)));
    this.#messages.set(this.#key(channelId, id), { message: toStored(id, channelId, message), buttons: message.buttons, view: message });
    return id;
  }

  async fetch(channelId: ChannelId, messageId: MessageId): Promise<StoredMessage> {
    this.calls.push(`fetch:${messageId}`);
    this.#check('fetch');
    const stored = this.#stored(channelId, messageId);
    // Snapshot taken before latency: what a concurrent client would see.
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
      view: message,
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
      description: embed.description ?? null,
      footer: embed.footer ?? null,
      color: embed.color ?? null,
    })),
  };
}

export interface RecordedReply {
  readonly action: 'editOriginal' | 'deleteOriginal' | 'followUp';
  readonly target: ReplyTarget;
  readonly content: ReplyContent | null;
}

export class InMemoryInteractionReplies implements InteractionReplies {
  readonly replies: RecordedReply[] = [];
  failWith: DiscordApiError | null = null;

  async editOriginal(target: ReplyTarget, content: ReplyContent): Promise<void> {
    this.#record({ action: 'editOriginal', target, content });
  }

  async deleteOriginal(target: ReplyTarget): Promise<void> {
    this.#record({ action: 'deleteOriginal', target, content: null });
  }

  async followUp(target: ReplyTarget, content: ReplyContent): Promise<void> {
    this.#record({ action: 'followUp', target, content });
  }

  #record(reply: RecordedReply): void {
    if (this.failWith) throw this.failWith;
    this.replies.push(reply);
  }

  /** Delivered content in order. */
  get contents(): readonly (ReplyContent | null)[] {
    return this.replies.map((reply) => reply.content);
  }
}

/** In-memory keyed lock: calls for the same key execute sequentially. */
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
