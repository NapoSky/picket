import type { GuildOperationsDiscord } from '@picket/discord';
import { type Clock, type GuildId, type Logger } from '@picket/kernel';
import type { OpsLock } from './guild-operations';

export interface RequestedDeparture {
  readonly id: string;
  readonly guildId: GuildId;
  readonly registeredAt: Date;
  readonly revision: string;
  readonly requestedAt: Date;
  readonly attemptedAt: Date | null;
  readonly status: 'pending' | 'executing' | 'uncertain' | 'left' | 'failed' | 'returned';
}
export interface RequestedDepartureRepository {
  find(guildId: GuildId): Promise<RequestedDeparture | null>;
  pending(): Promise<readonly GuildId[]>;
  /** Recheck the deletion request and membership generation under the registry lock. */
  claim(request: RequestedDeparture, now: Date): Promise<boolean>;
  finish(request: RequestedDeparture, status: 'left' | 'failed' | 'returned' | 'uncertain'): Promise<void>;
}
export interface GuildDepartureExecutor {
  /** Record consent and acknowledge it while holding the dispatch lock, before any worker can leave. */
  execute(guildId: GuildId, beforeDispatch?: () => Promise<void>): Promise<void>;
}

/** Administrator consent is recorded by RequestGuildDeletion; execution never depends on support ownership. */
export class ExecuteRequestedDepartures implements GuildDepartureExecutor {
  private readonly warnings = new Set<GuildId>();
  constructor(private readonly repository: RequestedDepartureRepository,
    private readonly discord: Pick<GuildOperationsDiscord, 'guild' | 'leave'>,
    private readonly lock: OpsLock, private readonly clock: Clock, private readonly logger: Logger) {}

  async execute(guildId: GuildId, beforeDispatch?: () => Promise<void>): Promise<void> {
    // Serialize with operator departures too, across replicas and both command paths.
    await this.lock.withLock(`ops:${guildId}`, async () => {
      await beforeDispatch?.();
      const request = await this.repository.find(guildId);
      if (!request || !['pending', 'executing', 'uncertain'].includes(request.status)) return;
      if (request.status !== 'pending' && (!request.attemptedAt ||
        this.clock.now().getTime() - request.attemptedAt.getTime() < 30_000)) return;
      try {
        const live = await this.discord.guild(guildId);
        if (!live) { await this.repository.finish(request, 'left'); this.warnings.delete(guildId); return; }
        if (request.status !== 'pending') {
          await this.repository.finish(request, 'failed');
          this.logger.warn({}, 'requested guild departure not confirmed; no additional DELETE is sent');
          return;
        }
        if (!await this.repository.claim(request, this.clock.now())) return;
        try { await this.discord.leave(guildId); }
        catch {
          await this.repository.finish(request, 'uncertain');
          this.logger.warn({}, 'requested guild departure uncertain; presence will be checked without repeating DELETE');
          return;
        }
        await this.repository.finish(request, 'left');
        this.warnings.delete(guildId);
      } catch {
        if (!this.warnings.has(guildId)) {
          this.warnings.add(guildId);
          this.logger.warn({}, 'requested guild departure will resume; no dispatched DELETE is repeated');
        }
      }
    });
  }

  async recover(): Promise<void> {
    for (const guildId of await this.repository.pending()) {
      try { await this.execute(guildId); }
      catch { this.logger.warn({}, 'requested guild departure recovery failed'); }
    }
  }
}
