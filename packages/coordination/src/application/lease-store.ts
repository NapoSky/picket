export interface Lease {
  readonly name: string;
  readonly holder: string;
  /** Jeton de fencing : strictement croissant à chaque changement de détenteur. */
  readonly token: bigint;
}

export interface LeaseStore {
  /** `null` si le verrou est détenu par un autre et n'a pas expiré. */
  acquire(name: string, holder: string, ttlMs: number): Promise<Lease | null>;
  /** `false` si le verrou a changé de main (le détenteur doit cesser immédiatement). */
  renew(lease: Lease, ttlMs: number): Promise<boolean>;
  release(lease: Lease): Promise<void>;
}
