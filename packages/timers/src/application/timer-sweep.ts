import type { Clock, Logger } from '@picket/kernel';
import type { BoardMaintenance } from './board-maintenance';
import type { Features, TimerStore } from './ports';

export interface TimerSweepDeps {
  readonly store: TimerStore;
  readonly maintenance: BoardMaintenance;
  readonly features: Features;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly batchSize?: number;
}

const DEFAULT_BATCH = 25;
const BUSY_RETRY_MS = 15_000;
const FAILURE_RETRY_MS = 5 * 60_000;
const FEATURE_OFF_RECHECK_MS = 60 * 60_000;

/**
 * Passe périodique du rôle `job-runner` (un seul détenteur à la fois, par bail) : traite les boards dont l'heure de
 * réveil est arrivée, c'est-à-dire un rendu resté en attente, un seuil d'alerte, une échéance ou une purge.
 * Rien ne se perd si le processus s'arrête : tout est relu depuis la base à la passe suivante.
 */
export class TimerSweep {
  readonly #deps: TimerSweepDeps;

  constructor(deps: TimerSweepDeps) {
    this.#deps = deps;
  }

  /** Nombre de boards traités. */
  async tick(): Promise<number> {
    const { store, maintenance, features, clock, logger } = this.#deps;
    const now = clock.now();
    const due = await store.dueBoards(now, this.#deps.batchSize ?? DEFAULT_BATCH);
    let processed = 0;
    for (const { guildId, boardId } of due) {
      const later = (ms: number): Date => new Date(clock.now().getTime() + ms);
      try {
        // Fonctionnalité désactivée : aucune requête Discord pour cette guilde, on revérifie plus tard.
        if (!(await features.isEnabled(guildId))) {
          await store.schedule(guildId, boardId, later(FEATURE_OFF_RECHECK_MS));
          continue;
        }
        const outcome = await maintenance.run(guildId, boardId);
        if (outcome.kind === 'busy') await store.schedule(guildId, boardId, later(BUSY_RETRY_MS));
        processed += 1;
      } catch (error) {
        logger.error({ err: error, board_id: boardId, guild_id: guildId }, 'timer sweep failed for a board');
        await store.schedule(guildId, boardId, later(FAILURE_RETRY_MS)).catch(() => undefined);
      }
    }
    return processed;
  }
}
