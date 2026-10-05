import { LeaderElector, type Lease, type LeaseStore } from '@picket/coordination';
import type { Clock, Logger } from '@picket/kernel';

export interface ShardConnection {
  /** Se connecte à Discord (reprend la session précédente si elle est valide). */
  start(): Promise<void>;
  /** Ferme en conservant la session, pour que le prochain détenteur la reprenne sans IDENTIFY. */
  stop(): Promise<void>;
}

export interface ShardConnectionParams {
  readonly shardId: number;
  readonly shardCount: number;
  readonly lease: Lease;
}

export interface ShardRunnerOptions {
  readonly shardCount: number;
  readonly holder: string;
  readonly leases: LeaseStore;
  readonly connect: (params: ShardConnectionParams) => ShardConnection;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly ttlMs?: number;
  readonly renewEveryMs?: number;
  readonly retryEveryMs?: number;
}

export const shardLeaseName = (shardId: number): string => `gateway:shard:${shardId}`;

/**
 * Chaque réplique tente d'obtenir le bail de chaque shard ; celle qui l'obtient tient la connexion Gateway,
 * les autres restent en attente et reprennent la session dès que le bail se libère.
 */
export class ShardRunner {
  readonly #electors: LeaderElector[];

  constructor(options: ShardRunnerOptions) {
    this.#electors = Array.from({ length: options.shardCount }, (_unused, shardId) =>
      new LeaderElector({
        store: options.leases,
        name: shardLeaseName(shardId),
        holder: options.holder,
        ttlMs: options.ttlMs ?? 15_000,
        renewEveryMs: options.renewEveryMs ?? 5_000,
        retryEveryMs: options.retryEveryMs ?? 2_000,
        clock: options.clock,
        logger: options.logger.child({ shard_id: shardId }),
        onAcquired: async (lease) => {
          const connection = options.connect({ shardId, shardCount: options.shardCount, lease });
          await connection.start();
          return () => connection.stop();
        },
      }),
    );
  }

  start(): void {
    for (const elector of this.#electors) elector.start();
  }

  async stop(): Promise<void> {
    await Promise.all(this.#electors.map((elector) => elector.stop()));
  }

  get leaderShards(): number {
    return this.#electors.filter((elector) => elector.isLeader).length;
  }
}
