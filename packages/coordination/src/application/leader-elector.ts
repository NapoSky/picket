import type { Clock, Logger } from '@picket/kernel';
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
  /** Démarre le travail réservé au détenteur ; retourne comment l'arrêter. */
  readonly onAcquired: (lease: Lease) => Promise<StopWork>;
  /** Attente interruptible ; injectable pour les tests. */
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
 * Garantit qu'un seul processus à la fois exécute un travail nommé. Dès qu'il ne peut plus prouver
 * qu'il détient le verrou (perdu, ou renouvellement impossible jusqu'à l'expiration), il arrête son travail.
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

  /** Une itération de la machine à états : acquérir si libre, renouveler si détenu. */
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
    try {
      lease = await store.acquire(name, holder, ttlMs);
    } catch (error) {
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
      // Rend la main aux autres processus et temporise : évite une boucle de crash qui épuiserait les quotas Discord.
      this.#failures += 1;
      const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(this.#failures, 6));
      this.#backoffUntil = clock.now().getTime() + backoff;
      logger.error({ err: error, lease: name, backoffMs: backoff }, 'work failed to start, releasing the lease');
      await store.release(lease).catch(() => undefined);
    }
  }

  async #renew(held: { lease: Lease; lastRenewedAt: number }): Promise<void> {
    const { store, ttlMs, clock, logger, name } = this.#options;
    try {
      if (await store.renew(held.lease, ttlMs)) {
        held.lastRenewedAt = clock.now().getTime();
        return;
      }
      logger.warn({ lease: name }, 'lease lost to another holder');
      await this.#relinquish(false);
    } catch (error) {
      // Base injoignable : on garde le travail tant que le verrou ne peut pas avoir expiré.
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
