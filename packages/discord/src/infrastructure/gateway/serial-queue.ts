import type { Logger } from '@picket/kernel';

/** Exécute les tâches une à une dans l'ordre d'arrivée ; une erreur est journalisée et ne bloque pas la suite. */
export class SerialQueue {
  readonly #logger: Logger;
  #tail: Promise<void> = Promise.resolve();

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  enqueue(label: string, task: () => Promise<void>): void {
    this.#tail = this.#tail.then(task).catch((error: unknown) => {
      this.#logger.error({ err: error, task: label }, 'queued task failed');
    });
  }

  /** Attend que tout ce qui a été mis en file soit terminé. */
  drain(): Promise<void> {
    return this.#tail;
  }
}
