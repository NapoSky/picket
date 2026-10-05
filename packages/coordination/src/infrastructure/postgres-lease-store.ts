import { sql, type Db } from '@picket/persistence';
import type { Lease, LeaseStore } from '../application/lease-store';

const ttlSeconds = (ttlMs: number): number => ttlMs / 1000;

/** Toutes les comparaisons de temps utilisent l'horloge de Postgres : insensible au décalage entre processus. */
export class PostgresLeaseStore implements LeaseStore {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async acquire(name: string, holder: string, ttlMs: number): Promise<Lease | null> {
    const result = await sql<{ token: string }>`
      INSERT INTO leases (name, holder, token, expires_at)
      VALUES (${name}, ${holder}, 1, now() + ${ttlSeconds(ttlMs)}::double precision * interval '1 second')
      ON CONFLICT (name) DO UPDATE
        SET holder = EXCLUDED.holder, token = leases.token + 1, expires_at = EXCLUDED.expires_at
        WHERE leases.expires_at <= now()
      RETURNING token`.execute(this.#db);
    const row = result.rows[0];
    return row ? { name, holder, token: BigInt(row.token) } : null;
  }

  async renew(lease: Lease, ttlMs: number): Promise<boolean> {
    const result = await sql`
      UPDATE leases
         SET expires_at = now() + ${ttlSeconds(ttlMs)}::double precision * interval '1 second'
       WHERE name = ${lease.name} AND holder = ${lease.holder} AND token = ${lease.token.toString()}::bigint
      RETURNING 1`.execute(this.#db);
    return result.rows.length > 0;
  }

  async release(lease: Lease): Promise<void> {
    await sql`
      UPDATE leases SET expires_at = now()
       WHERE name = ${lease.name} AND holder = ${lease.holder} AND token = ${lease.token.toString()}::bigint`.execute(
      this.#db,
    );
  }
}
