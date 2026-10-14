import { DomainError } from '@picket/kernel';

export class LockTimeoutError extends DomainError {
  readonly code = 'lock_timeout';
}

/** Mutual exclusion across replicas, without persistent data: the key exists only while locked. */
export interface KeyedLock {
  /**
   * Wait for the lock (up to the configured timeout, otherwise `LockTimeoutError`), run `work`, then release
   * it.
   */
  withLock<T>(key: string, work: () => Promise<T>): Promise<T>;
}
