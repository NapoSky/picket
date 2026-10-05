import type { GuildId } from '@picket/kernel';
import type { BoardMaintenance, MaintenanceOutcome } from './board-maintenance';

interface Pending {
  readonly promise: Promise<MaintenanceOutcome>;
  readonly resolve: (outcome: MaintenanceOutcome) => void;
  readonly reject: (error: unknown) => void;
}

/**
 * Une rafale de refresh sur un même board ne produit pas une édition de message par clic : pendant qu'un rendu est
 * en cours, toutes les demandes suivantes partagent un seul rendu, lancé juste après. Le rendu relit toujours
 * l'état le plus récent, donc aucun clic n'est perdu ; entre répliques, c'est le verrou du board qui sérialise.
 */
export class RenderCoalescer {
  readonly #maintenance: BoardMaintenance;
  readonly #running = new Map<string, { next: Pending | null }>();

  constructor(maintenance: BoardMaintenance) {
    this.#maintenance = maintenance;
  }

  request(guildId: GuildId, boardId: string): Promise<MaintenanceOutcome> {
    const entry = this.#running.get(boardId);
    if (entry === undefined) return this.#start(guildId, boardId);
    if (entry.next === null) {
      let resolve!: Pending['resolve'];
      let reject!: Pending['reject'];
      const promise = new Promise<MaintenanceOutcome>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
      });
      entry.next = { promise, resolve, reject };
    }
    return entry.next.promise;
  }

  #start(guildId: GuildId, boardId: string): Promise<MaintenanceOutcome> {
    const entry: { next: Pending | null } = { next: null };
    this.#running.set(boardId, entry);
    const run = this.#maintenance.run(guildId, boardId);
    const settle = (): void => {
      this.#running.delete(boardId);
      const next = entry.next;
      if (next !== null) this.#start(guildId, boardId).then(next.resolve, next.reject);
    };
    run.then(settle, settle);
    return run;
  }
}
