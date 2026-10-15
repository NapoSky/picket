import type { Clock, GuildId, Logger } from '@picket/kernel';
import { purgeCutoff, purgeDate } from '../domain/lifecycle';
import type { GuildLifecycleRepository } from './guild-lifecycle-repository';
import type { AuditActor } from './permission-repository';
import type { GuildDepartureExecutor } from './requested-departures';

/** Permanent deletion date if the guild is suspended, otherwise `null`. */
export class GetSuspension {
  readonly #repository: GuildLifecycleRepository;
  readonly #retentionDays: number;

  constructor(repository: GuildLifecycleRepository, retentionDays: number) {
    this.#repository = repository;
    this.#retentionDays = retentionDays;
  }

  async execute(guildId: GuildId): Promise<Date | null> {
    const since = await this.#repository.inactiveSince(guildId);
    return since === null ? null : purgeDate(since, this.#retentionDays);
  }
}

export interface DeletionScheduled {
  readonly alreadyScheduled: boolean;
  readonly purgeAt: Date;
}

/** Administrator confirmation schedules data erasure and makes the bot leave the server. */
export class RequestGuildDeletion {
  readonly #repository: GuildLifecycleRepository;
  readonly #clock: Clock;
  readonly #retentionDays: number;

  constructor(repository: GuildLifecycleRepository, clock: Clock, retentionDays: number,
    private readonly departures: GuildDepartureExecutor) {
    this.#repository = repository;
    this.#clock = clock;
    this.#retentionDays = retentionDays;
  }

  async execute(guildId: GuildId, actor: AuditActor, action = 'guild.deletion_requested',
    onScheduled?: (scheduled: DeletionScheduled) => Promise<void>): Promise<DeletionScheduled> {
    let scheduled!: DeletionScheduled;
    await this.departures.execute(guildId, async () => {
      const result = await this.#repository.markInactive(guildId, actor, action, this.#clock.now(), 'requested');
      scheduled = { alreadyScheduled: !result.changed, purgeAt: purgeDate(result.inactiveSince, this.#retentionDays) };
      // The job-runner holds the same lock: it cannot leave before this acknowledgement.
      await onScheduled?.(scheduled);
    });
    return scheduled;
  }

  /** Deletion date if requested now (for the warning before confirmation). */
  previewPurgeAt(): Date {
    return purgeDate(this.#clock.now(), this.#retentionDays);
  }
}

/** Cancellation (command) or bot return (`guildCreate` event). */
export class CancelGuildDeletion {
  readonly #repository: GuildLifecycleRepository;

  constructor(repository: GuildLifecycleRepository) {
    this.#repository = repository;
  }

  execute(guildId: GuildId, actor: AuditActor, action = 'guild.deletion_cancelled'): Promise<boolean> {
    return this.#repository.reactivate(guildId, actor, action);
  }
}

export interface PurgeReport {
  readonly purged: readonly GuildId[];
  readonly failed: readonly GuildId[];
}

/** Periodic task: one failing guild does not prevent subsequent guilds or passes from running. */
export class PurgeInactiveGuilds {
  readonly #repository: GuildLifecycleRepository;
  readonly #clock: Clock;
  readonly #retentionDays: number;
  readonly #logger: Logger;

  constructor(repository: GuildLifecycleRepository, clock: Clock, retentionDays: number, logger: Logger) {
    this.#repository = repository;
    this.#clock = clock;
    this.#retentionDays = retentionDays;
    this.#logger = logger;
  }

  async execute(batchSize = 50): Promise<PurgeReport> {
    const due = await this.#repository.findPurgeable(purgeCutoff(this.#clock.now(), this.#retentionDays), batchSize);
    const purged: GuildId[] = [];
    const failed: GuildId[] = [];
    for (const guildId of due) {
      try {
        await this.#repository.purge(guildId);
        purged.push(guildId);
        // Never recreate a guild journal immediately after erasing its data.
        this.#logger.info({}, 'guild data purged');
      } catch (error) {
        failed.push(guildId);
        this.#logger.error({ guild_id: guildId, err: error }, 'guild purge failed');
      }
    }
    return { purged, failed };
  }
}
