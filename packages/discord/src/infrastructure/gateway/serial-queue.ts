import type { Logger } from '@picket/kernel';

/** Run tasks sequentially in arrival order; log errors without blocking subsequent tasks. */
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

  /** Wait for all queued work to finish. */
  drain(): Promise<void> {
    return this.#tail;
  }
}
