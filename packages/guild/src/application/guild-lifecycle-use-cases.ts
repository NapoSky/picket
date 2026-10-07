import type { Clock, GuildId, Logger } from '@picket/kernel';
import { purgeCutoff, purgeDate } from '../domain/lifecycle';
import type { GuildLifecycleRepository } from './guild-lifecycle-repository';
import type { AuditActor } from './permission-repository';

/** Date de suppression définitive si la guilde est suspendue, sinon `null`. */
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

/** Demande de suppression (commande) ou départ du bot (événement `guildDelete`) : même chemin, même audit. */
export class RequestGuildDeletion {
  readonly #repository: GuildLifecycleRepository;
  readonly #clock: Clock;
  readonly #retentionDays: number;

  constructor(repository: GuildLifecycleRepository, clock: Clock, retentionDays: number) {
    this.#repository = repository;
    this.#clock = clock;
    this.#retentionDays = retentionDays;
  }

  async execute(guildId: GuildId, actor: AuditActor, action = 'guild.deletion_requested'): Promise<DeletionScheduled> {
    const result = await this.#repository.markInactive(guildId, actor, action, this.#clock.now(), 'requested');
    return { alreadyScheduled: !result.changed, purgeAt: purgeDate(result.inactiveSince, this.#retentionDays) };
  }

  /** Date qu'aurait une suppression demandée maintenant (pour l'avertissement avant confirmation). */
  previewPurgeAt(): Date {
    return purgeDate(this.#clock.now(), this.#retentionDays);
  }
}

/** Annulation (commande) ou retour du bot (événement `guildCreate`). */
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

/** Tâche périodique : une guilde en échec n'empêche ni les suivantes ni le passage suivant. */
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
        // Ne pas réécrire un journal de serveur immédiatement après avoir effacé ses données.
        this.#logger.info({}, 'guild data purged');
      } catch (error) {
        failed.push(guildId);
        this.#logger.error({ guild_id: guildId, err: error }, 'guild purge failed');
      }
    }
    return { purged, failed };
  }
}
