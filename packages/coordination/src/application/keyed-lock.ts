import { DomainError } from '@picket/kernel';

export class LockTimeoutError extends DomainError {
  readonly code = 'lock_timeout';
}

/** Exclusion mutuelle entre répliques, sans aucune donnée stockée : la clé n'existe que le temps du verrou. */
export interface KeyedLock {
  /** Attend le verrou (au plus le délai configuré, sinon `LockTimeoutError`), exécute `work`, puis le libère. */
  withLock<T>(key: string, work: () => Promise<T>): Promise<T>;
}
