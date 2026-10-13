import { createDiscordBotRest, type DiscordBotRestClient } from '../bot-rest';
import { CloseCodes, WebSocketManager, WebSocketShardEvents, type SessionInfo } from '@discordjs/ws';
import { GatewayIntentBits } from 'discord-api-types/v10';
import type { GatewaySessionStore } from '@picket/coordination';
import type { Lease } from '@picket/coordination';
import type { Logger, Secret } from '@picket/kernel';
import type { GatewayEventHandler } from '../../application/gateway-events';
import { normalizeDispatch } from './event-normalizer';
import { SerialQueue } from './serial-queue';
import type { ShardConnection, ShardConnectionParams } from './shard-runner';

export interface WsConnectorDependencies {
  readonly token: Secret;
  readonly rest?: DiscordBotRestClient;
  readonly sessions: GatewaySessionStore;
  readonly handler: GatewayEventHandler;
  readonly logger: Logger;
  readonly flushEveryMs?: number;
}

/** Voice collection plus exact role changes. Message content and presence are unnecessary. */
const INTENTS =
  GatewayIntentBits.Guilds | GatewayIntentBits.GuildVoiceStates | GatewayIntentBits.GuildMembers;
type SharedWsConnectorDependencies = WsConnectorDependencies & { readonly rest: DiscordBotRestClient };

class DiscordWsShardConnection implements ShardConnection {
  readonly #deps: SharedWsConnectorDependencies;
  readonly #shardId: number;
  readonly #shardCount: number;
  readonly #lease: Lease;
  readonly #logger: Logger;
  readonly #queue: SerialQueue;
  #manager: WebSocketManager | null = null;
  #latest: SessionInfo | null = null;
  #delivered: SessionInfo | null = null;
  #replaying = false;
  #blocked = false;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #dirty = false;
  #preserving = false;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: SharedWsConnectorDependencies, params: ShardConnectionParams) {
    this.#deps = deps;
    this.#shardId = params.shardId;
    this.#shardCount = params.shardCount;
    this.#lease = params.lease;
    this.#logger = deps.logger.child({ shard_id: params.shardId });
    this.#queue = new SerialQueue(this.#logger);
  }

  async start(): Promise<void> {
    if (this.#preserving) return;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#queue.drain();
    await this.#flush();
    const stored = await this.#deps.sessions.load(this.#shardId);
    if(this.#preserving) return;
    this.#latest = stored && stored.shardCount === this.#shardCount ? { ...stored } : null;
    this.#delivered = this.#latest;
    this.#replaying = this.#latest !== null;
    await this.#deps.handler.connectionChanged?.(this.#shardId, false, this.#lease);
    if(this.#preserving) return;
    this.#blocked = false;
    this.#logger.info({ resuming: this.#latest !== null }, 'connecting to the gateway');

    const token = this.#deps.token.reveal();
    const manager = new WebSocketManager({
      token,
      intents: INTENTS,
      rest: this.#deps.rest,
      shardCount: this.#shardCount,
      shardIds: [this.#shardId],
      retrieveSessionInfo: () => this.#latest,
      updateSessionInfo: (_shardId, info) => this.#remember(info),
    });
    this.#manager = manager;

    manager.on(WebSocketShardEvents.Dispatch, (payload, shardId) => {
      const event = normalizeDispatch(payload, shardId, this.#shardCount);
      const receivedAt = new Date();
      const info = this.#latest ? { ...this.#latest, sequence: payload.s } : null;
      const replayed = this.#replaying;
      this.#queue.enqueue(event?.type ?? 'dispatch_checkpoint', async () => {
        if (this.#blocked) return;
        try {
          if (event)
            await this.#deps.handler.handle(event, {
              key: `${info?.sessionId ?? `fresh:${this.#lease.token}`}:${shardId}:${payload.s}`,
              shardId,
              at: receivedAt,
              replayed,
              lease: this.#lease,
            });
          if (info) {
            this.#delivered = info;
            this.#dirty = true;
          }
        } catch (error) {
          // Never acknowledge a later sequence after an event failed both SQL and durable buffering.
          this.#blocked = true;
          this.#logger.error(
            { err: error, task: event?.type },
            'gateway processing paused: event was not durably handled',
          );
          void Promise.resolve(
            manager.destroy({ code: CloseCodes.Resuming, reason: 'durable consumer unavailable' }),
          )
            .then(() => this.#scheduleRetry())
            .catch(() => this.#scheduleRetry());
        }
      });
    });
    manager.on(WebSocketShardEvents.Closed, (code) => {
      this.#replaying = true;
      this.#logger.warn({ code }, 'gateway connection closed');
      this.#queue.enqueue('voice_disconnected', async () => {
        await this.#deps.handler.connectionChanged?.(this.#shardId, false, this.#lease);
      });
    });
    manager.on(WebSocketShardEvents.Error, (error) => this.#logger.error({ err: error }, 'gateway error'));
    manager.on(WebSocketShardEvents.SocketError, (error) =>
      this.#logger.error({ err: error }, 'gateway socket error'),
    );
    manager.on(WebSocketShardEvents.Resumed, () => {
      this.#replaying = false;
      this.#logger.info({}, 'gateway session resumed');
      this.#queue.enqueue('voice_resumed', async () => {
        await this.#deps.handler.connectionChanged?.(this.#shardId, true, this.#lease);
      });
    });
    manager.on(WebSocketShardEvents.Ready, () => {
      this.#replaying = false;
      this.#logger.info({}, 'gateway ready');
      this.#queue.enqueue('voice_ready', async () => {
        await this.#deps.handler.connectionChanged?.(this.#shardId, true, this.#lease);
      });
    });

    this.#timer = setInterval(() => {
      this.#flush().catch((error: unknown) => this.#logger.error({ err: error }, 'session flush failed'));
    }, this.#deps.flushEveryMs ?? 5_000);
    this.#timer.unref();

    try {
      await manager.connect();
    } catch (error) {
      await this.#shutdown().catch(() => undefined);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.#preserving = true;
    if (this.#retry) clearTimeout(this.#retry);
    await this.#shutdown();
    await this.#queue.drain();
    await this.#flush();
    this.#logger.info({}, 'gateway connection stopped, session kept for the next holder');
  }
  #scheduleRetry(): void {
    if (this.#preserving || this.#retry) return;
    this.#retry = setTimeout(() => {
      this.#retry = null;
      this.start().catch((error) => {
        this.#logger.warn({ err: error }, 'durable gateway retry pending');
        this.#scheduleRetry();
      });
    }, 5_000);
    this.#retry.unref();
  }

  async #shutdown(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    const manager = this.#manager;
    this.#manager = null;
    // Un code autre que 1000/1001 laisse la session valide côté Discord, donc reprenable.
    await manager?.destroy({ code: CloseCodes.Resuming, reason: 'handoff' });
  }

  /** La bibliothèque appelle ceci à chaque paquet : on mémorise et on écrit en base par lots. */
  #remember(info: SessionInfo | null): void {
    if (info === null) {
      if (this.#preserving) return;
      // Session invalidée par Discord : ne jamais tenter de la reprendre.
      this.#latest = null;
      this.#delivered = null;
      this.#dirty = false;
      this.#deps.sessions
        .clear(this.#lease, this.#shardId)
        .catch((error: unknown) => this.#logger.error({ err: error }, 'clearing the session failed'));
      return;
    }
    this.#latest = info;
  }

  async #flush(): Promise<void> {
    if (!this.#dirty || this.#delivered === null) return;
    this.#dirty = false;
    let saved: boolean;
    try {
      saved = await this.#deps.sessions.save(this.#lease, { ...this.#delivered, shardId: this.#shardId });
    } catch (error) {
      this.#dirty = true;
      throw error;
    }
    if (!saved) this.#logger.error({}, 'session write refused: the lease is no longer held');
  }
}

export function createWsShardConnector(
  deps: WsConnectorDependencies,
): (params: ShardConnectionParams) => ShardConnection {
  const shared = { ...deps, rest: deps.rest ?? createDiscordBotRest(deps.token) };
  return (params) => new DiscordWsShardConnection(shared, params);
}
