import type { Logger, OperationalMetrics, MetricComponent } from '@picket/kernel';
import type { StopWork } from './leader-elector';

export interface LeasedLoopOptions {
  /** One work pass; log an error and continue the loop. */
  readonly tick: () => Promise<unknown>;
  readonly intervalMs: number;
  readonly logger: Logger;
  readonly metrics?: OperationalMetrics;
  readonly component?: MetricComponent;
  /** Interruptible sleep; injectable for tests. */
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
 * Periodic work reserved for a lease holder (see `LeaderElector.onAcquired`). Run the first pass
 * immediately; shutdown waits for the current pass so no write survives loss of ownership.
 */
export function startLeasedLoop(options: LeasedLoopOptions): StopWork {
  const abort = new AbortController();
  const sleep = options.sleep ?? defaultSleep;
  options.metrics?.set('loop_active', 1, options.component);
  options.metrics?.set('loop_interval', options.intervalMs / 1000, options.component);
  options.metrics?.set('loop_last_success', Date.now() / 1000, options.component);
  const loop = (async () => {
    while (!abort.signal.aborted) {
      const started = Date.now();
      let failed = false;
      try {
        await options.tick();
        options.metrics?.set('loop_last_success', Date.now() / 1000, options.component);
      } catch (error) {
        failed = true;
        options.logger.error({ err: error }, 'periodic task failed');
      } finally {
        options.metrics?.record('loop', (Date.now() - started) / 1000, failed ? 'error' : 'success', options.component);
      }
      if (!abort.signal.aborted) await sleep(options.intervalMs, abort.signal);
    }
  })();
  return async () => {
    abort.abort();
    await loop;
    options.metrics?.set('loop_active', 0, options.component);
  };
}
