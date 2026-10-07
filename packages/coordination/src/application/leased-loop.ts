import type { Logger } from '@picket/kernel';
import type { StopWork } from './leader-elector';

export interface LeasedLoopOptions {
  /** Une passe de travail ; une erreur est journalisée et la boucle continue. */
  readonly tick: () => Promise<unknown>;
  readonly intervalMs: number;
  readonly logger: Logger;
  /** Attente interruptible ; injectable pour les tests. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Travail périodique réservé au détenteur d'un bail (voir `LeaderElector.onAcquired`) : la première passe part tout de
 * suite, et l'arrêt attend la fin de la passe en cours pour qu'aucune écriture ne survive à la perte du bail.
 */
export function startLeasedLoop(options: LeasedLoopOptions): StopWork {
  const abort = new AbortController();
  const sleep = options.sleep ?? defaultSleep;
  const loop = (async () => {
    while (!abort.signal.aborted) {
      try {
        await options.tick();
      } catch (error) {
        options.logger.error({ err: error }, 'periodic task failed');
      }
      if (!abort.signal.aborted) await sleep(options.intervalMs, abort.signal);
    }
  })();
  return async () => {
    abort.abort();
    await loop;
  };
}
