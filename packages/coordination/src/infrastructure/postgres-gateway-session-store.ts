import { sql, type Db } from '@picket/persistence';
import type { GatewaySession, GatewaySessionStore } from '../application/gateway-session-store';
import type { Lease } from '../application/lease-store';

function isSession(value: unknown): value is GatewaySession {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['resumeURL'] === 'string' &&
    typeof candidate['sessionId'] === 'string' &&
    Number.isInteger(candidate['sequence']) &&
    Number.isInteger(candidate['shardCount']) &&
    Number.isInteger(candidate['shardId'])
  );
}

export class PostgresGatewaySessionStore implements GatewaySessionStore {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async load(shardId: number): Promise<GatewaySession | null> {
    const result = await sql<{ session: unknown }>`SELECT session FROM gateway_sessions WHERE shard_id = ${shardId}`.execute(
      this.#db,
    );
    const stored = result.rows[0]?.session;
    return isSession(stored) ? stored : null;
  }

  async save(lease: Lease, session: GatewaySession): Promise<boolean> {
    const result = await sql`
      INSERT INTO gateway_sessions (shard_id, session, lease_token)
      SELECT ${session.shardId}, ${JSON.stringify(session)}::jsonb, ${lease.token.toString()}::bigint
       WHERE EXISTS (
         SELECT 1 FROM leases
          WHERE name = ${lease.name} AND holder = ${lease.holder} AND token = ${lease.token.toString()}::bigint)
      ON CONFLICT (shard_id) DO UPDATE
        SET session = EXCLUDED.session, lease_token = EXCLUDED.lease_token, updated_at = now()
        WHERE gateway_sessions.lease_token <= EXCLUDED.lease_token
      RETURNING shard_id`.execute(this.#db);
    return result.rows.length > 0;
  }

  async clear(lease: Lease, shardId: number): Promise<void> {
    await sql`
      DELETE FROM gateway_sessions
       WHERE shard_id = ${shardId} AND lease_token <= ${lease.token.toString()}::bigint
         AND EXISTS (
           SELECT 1 FROM leases
            WHERE name = ${lease.name} AND holder = ${lease.holder} AND token = ${lease.token.toString()}::bigint)`.execute(
      this.#db,
    );
  }
}
