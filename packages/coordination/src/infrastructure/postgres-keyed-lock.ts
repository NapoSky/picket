import { sql, type Db } from '@picket/persistence';
import { LockTimeoutError, type KeyedLock } from '../application/keyed-lock';

const LOCK_NOT_AVAILABLE = '55P03';
const DEFAULT_TIMEOUT_MS = 10_000;
// REST calls under the lock leave the transaction idle: the pool's 15 s limit would terminate it.
const IDLE_IN_TRANSACTION_MS = 120_000;

/**
 * Transaction advisory lock: PostgreSQL releases it when the replica dies (connection closed), so it never
 * remains locked indefinitely. Keep the transaction open during `work` (short REST calls). When work uses
 * SQL (including the REST budget), db must use a dedicated lock pool; callbacks must never acquire another
 * connection from this pool.
 */
export class PostgresKeyedLock implements KeyedLock {
  readonly #db: Db;
  readonly #timeoutMs: number;

  constructor(db: Db, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.#db = db;
    this.#timeoutMs = timeoutMs;
  }

  withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    return this.#db.transaction().execute(async (trx) => {
      try {
        await sql`SELECT set_config('lock_timeout', ${`${this.#timeoutMs}ms`}, true)`.execute(trx);
        await sql`SELECT set_config('idle_in_transaction_session_timeout', ${`${IDLE_IN_TRANSACTION_MS}ms`}, true)`.execute(trx);
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`picket:${key}`}, 0))`.execute(trx);
      } catch (error) {
        if ((error as { code?: unknown }).code === LOCK_NOT_AVAILABLE) throw new LockTimeoutError(`Lock timeout on ${key}`);
        throw error;
      }
      return work();
    });
  }
}
