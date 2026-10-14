export interface Lease {
  readonly name: string;
  readonly holder: string;
  /** Fencing token: strictly increases whenever ownership changes. */
  readonly token: bigint;
}

export interface LeaseStore {
  /** `null` if another holder owns the unexpired lease. */
  acquire(name: string, holder: string, ttlMs: number): Promise<Lease | null>;
  /** `false` if ownership changed (the holder must stop immediately). */
  renew(lease: Lease, ttlMs: number): Promise<boolean>;
  release(lease: Lease): Promise<void>;
}
