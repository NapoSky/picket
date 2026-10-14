import type { Clock, Logger, OperationalMetrics, MetricComponent } from '@picket/kernel';
import type { Lease, LeaseStore } from './lease-store';

export type StopWork = () => Promise<void>;

export interface LeaderElectorOptions {
  readonly store: LeaseStore;
  readonly name: string;
  readonly holder: string;
  readonly ttlMs: number;
  readonly renewEveryMs: number;
  readonly retryEveryMs: number;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly metrics?: OperationalMetrics;
  readonly component?: MetricComponent;
  /** Start the work reserved for the holder; return how to stop it. */
  readonly onAcquired: (lease: Lease) => Promise<StopWork>;
  /** Interruptible sleep; injectable for tests. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const MAX_BACKOFF_MS = 60_000;

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
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
 * Ensure only one process runs a named task at a time. Stop work as soon as ownership can no longer be
 * proven (lease lost, or renewal unavailable until expiry).
 */
export class LeaderElector {
  readonly #options: LeaderElectorOptions;
  readonly #abort = new AbortController();
  #held: { lease: Lease; stop: StopWork; lastRenewedAt: number } | null = null;
  #failures = 0;
  #backoffUntil = 0;
  #loop: Promise<void> | null = null;

  constructor(options: LeaderElectorOptions) {
    this.#options = options;
  }

  get isLeader(): boolean {
    return this.#held !== null;
  }

  /** One state-machine iteration: acquire if free, otherwise renew. */
  async step(): Promise<void> {
    if (this.#held === null) {
      await this.#tryAcquire();
    } else {
      await this.#renew(this.#held);
    }
  }

  start(): void {
    if (this.#loop) return;
    this.#loop = this.#run();
  }

  async stop(): Promise<void> {
    this.#abort.abort();
    await this.#loop;
    await this.#relinquish(true);
  }

  async #run(): Promise<void> {
    const sleep = this.#options.sleep ?? defaultSleep;
    while (!this.#abort.signal.aborted) {
      try {
        await this.step();
      } catch (error) {
        this.#options.logger.error({ err: error, lease: this.#options.name }, 'leader election step failed');
      }
      const delay = this.#held ? this.#options.renewEveryMs : this.#options.retryEveryMs;
      await sleep(delay, this.#abort.signal);
    }
  }

  async #tryAcquire(): Promise<void> {
    const { store, name, holder, ttlMs, clock, logger } = this.#options;
    if (clock.now().getTime() < this.#backoffUntil) return;

    let lease: Lease | null;
    const started = Date.now();
    try {
      lease = await store.acquire(name, holder, ttlMs);
      this.#options.metrics?.record('lease_acquire', (Date.now() - started) / 1000, lease ? 'success' : 'standby', this.#options.component);
    } catch (error) {
      this.#options.metrics?.record('lease_acquire', (Date.now() - started) / 1000, 'error', this.#options.component);
      logger.warn({ err: error, lease: name }, 'lease acquisition failed');
      return;
    }
    if (!lease) return;

    try {
      const stop = await this.#options.onAcquired(lease);
      this.#held = { lease, stop, lastRenewedAt: clock.now().getTime() };
      this.#failures = 0;
      logger.info({ lease: name, fencing: lease.token.toString() }, 'lease acquired');
    } catch (error) {
      // Yield to other processes and back off: avoid a crash loop that exhausts Discord quotas.
      this.#failures += 1;
      const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(this.#failures, 6));
      this.#backoffUntil = clock.now().getTime() + backoff;
      logger.error({ err: error, lease: name, backoffMs: backoff }, 'work failed to start, releasing the lease');
      await store.release(lease).catch(() => undefined);
    }
  }

  async #renew(held: { lease: Lease; lastRenewedAt: number }): Promise<void> {
    const { store, ttlMs, clock, logger, name } = this.#options;
    const started = Date.now();
    try {
      if (await store.renew(held.lease, ttlMs)) {
        this.#options.metrics?.record('lease_renew', (Date.now() - started) / 1000, 'success', this.#options.component);
        held.lastRenewedAt = clock.now().getTime();
        return;
      }
      logger.warn({ lease: name }, 'lease lost to another holder');
      this.#options.metrics?.record('lease_renew', (Date.now() - started) / 1000, 'rejected', this.#options.component);
      await this.#relinquish(false);
    } catch (error) {
      this.#options.metrics?.record('lease_renew', (Date.now() - started) / 1000, 'error', this.#options.component);
      // Database unavailable: keep working only while the lease cannot have expired.
      const silentFor = clock.now().getTime() - held.lastRenewedAt;
      logger.warn({ err: error, lease: name, silentForMs: silentFor }, 'lease renewal failed');
      if (silentFor >= ttlMs - this.#options.renewEveryMs) await this.#relinquish(false);
    }
  }

  async #relinquish(release: boolean): Promise<void> {
    const held = this.#held;
    if (!held) return;
    this.#held = null;
    try {
      await held.stop();
    } catch (error) {
      this.#options.logger.error({ err: error, lease: this.#options.name }, 'stopping the work failed');
    }
    if (release) await this.#options.store.release(held.lease).catch(() => undefined);
  }
}
