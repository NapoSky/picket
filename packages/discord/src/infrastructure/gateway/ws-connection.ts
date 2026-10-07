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

/** Seul intent demandé : `Guilds` (non privilégié). Aucun intent de contenu ni de membres. */
const INTENTS = GatewayIntentBits.Guilds;
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
    const stored = await this.#deps.sessions.load(this.#shardId);
    this.#latest = stored && stored.shardCount === this.#shardCount ? { ...stored } : null;
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
      if (event) this.#queue.enqueue(event.type, async () => {
        try { await this.#deps.handler.handle(event); }
        catch (error) {
          if ('guildId' in event) this.#logger.error({ err: error, guild_id: event.guildId, task: event.type }, 'guild event failed');
          else throw error;
        }
      });
    });
    manager.on(WebSocketShardEvents.Closed, (code) => this.#logger.warn({ code }, 'gateway connection closed'));
    manager.on(WebSocketShardEvents.Error, (error) => this.#logger.error({ err: error }, 'gateway error'));
    manager.on(WebSocketShardEvents.SocketError, (error) => this.#logger.error({ err: error }, 'gateway socket error'));
    manager.on(WebSocketShardEvents.Resumed, () => this.#logger.info({}, 'gateway session resumed'));
    manager.on(WebSocketShardEvents.Ready, () => this.#logger.info({}, 'gateway ready'));

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
    await this.#shutdown();
    await this.#queue.drain();
    await this.#flush();
    this.#logger.info({}, 'gateway connection stopped, session kept for the next holder');
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
      this.#dirty = false;
      this.#deps.sessions
        .clear(this.#lease, this.#shardId)
        .catch((error: unknown) => this.#logger.error({ err: error }, 'clearing the session failed'));
      return;
    }
    this.#latest = info;
    this.#dirty = true;
  }

  async #flush(): Promise<void> {
    if (!this.#dirty || this.#latest === null) return;
    this.#dirty = false;
    const saved = await this.#deps.sessions.save(this.#lease, { ...this.#latest, shardId: this.#shardId });
    if (!saved) this.#logger.error({}, 'session write refused: the lease is no longer held');
  }
}

export function createWsShardConnector(
  deps: WsConnectorDependencies,
): (params: ShardConnectionParams) => ShardConnection {
  const shared = { ...deps, rest: deps.rest ?? createDiscordBotRest(deps.token) };
  return (params) => new DiscordWsShardConnection(shared, params);
}
