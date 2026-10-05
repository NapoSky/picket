import type { Clock, GuildId } from '@picket/kernel';
import { shardOf } from '../domain/lifecycle';
import type { GuildLifecycleRepository } from './guild-lifecycle-repository';

/**
 * Le bot rejoint un serveur, ou le retrouve (Discord émet aussi cet événement pour chaque serveur à la connexion).
 * Une suppression demandée par un administrateur n'est jamais annulée ici ; seul un départ précédent l'est.
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

/** Le bot a été retiré d'un serveur : ses données sont conservées pendant la période de rétention. */
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
  /** Serveurs listés par Discord à la connexion : un serveur indisponible y figure toujours. */
  readonly presentGuildIds: readonly GuildId[];
}

/**
 * Rattrape les départs survenus pendant que le bot était hors ligne. Les serveurs présents sont traités
 * par leur propre événement de création, et les serveurs temporairement indisponibles ne sont jamais
 * confondus avec un départ.
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
