import type { Clock, GuildId } from '@picket/kernel';
import { shardOf } from '../domain/lifecycle';
import type { GuildLifecycleRepository } from './guild-lifecycle-repository';

/**
 * The bot joins or rediscovers a guild (Discord also emits this event for every guild at connection time).
 * Never cancel administrator-requested deletion here; only undo a previous departure.
 */
export class HandleGuildAvailable {
  readonly #repository: GuildLifecycleRepository;

  constructor(repository: GuildLifecycleRepository) {
    this.#repository = repository;
  }

  async execute(guildId: GuildId): Promise<void> {
    await this.#repository.initialize(guildId);
    await this.#repository.reactivate(guildId, 'system', 'guild.rejoined', 'left');
  }
}

/** The bot was removed from a guild: retain its data for the retention period. */
export class HandleGuildRemoved {
  readonly #repository: GuildLifecycleRepository;
  readonly #clock: Clock;

  constructor(repository: GuildLifecycleRepository, clock: Clock) {
    this.#repository = repository;
    this.#clock = clock;
  }

  async execute(guildId: GuildId, action = 'guild.left'): Promise<boolean> {
    const result = await this.#repository.markInactive(guildId, 'system', action, this.#clock.now(), 'left');
    return result.changed;
  }
}

export interface ReconcileRequest {
  readonly shardId: number;
  readonly shardCount: number;
  /** Guilds listed by Discord at connection time: unavailable guilds are still included. */
  readonly presentGuildIds: readonly GuildId[];
}

/**
 * Catch up departures that occurred while the bot was offline. Present guilds are handled by their own
 * creation event; never mistake temporarily unavailable guilds for departures.
 */
export class ReconcileGuilds {
  readonly #repository: GuildLifecycleRepository;
  readonly #removed: HandleGuildRemoved;

  constructor(repository: GuildLifecycleRepository, removed: HandleGuildRemoved) {
    this.#repository = repository;
    this.#removed = removed;
  }

  async execute(request: ReconcileRequest): Promise<readonly GuildId[]> {
    const present = new Set<string>(request.presentGuildIds);
    const departed: GuildId[] = [];
    for (const guildId of await this.#repository.listActive()) {
      if (shardOf(guildId, request.shardCount) !== request.shardId || present.has(guildId)) continue;
      if (await this.#removed.execute(guildId, 'guild.left_while_offline')) departed.push(guildId);
    }
    return departed;
  }
}
