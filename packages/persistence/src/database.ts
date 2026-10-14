import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import { Pool } from 'pg';
import type { GuildId, Secret, OperationalMetrics, MetricComponent } from '@picket/kernel';
import type { Schema } from './schema';

export type Db = Kysely<Schema>;
export type Tx = Transaction<Schema>;

export interface DatabaseHandle {
  readonly db: Db;
  ping(): Promise<void>;
  close(): Promise<void>;
  collectMetrics(): void;
}

export interface CreateDatabaseOptions {
  readonly connectionString: Secret;
  readonly maxConnections?: number;
  readonly applicationName?: string;
  readonly onPoolError?: (error: Error) => void;
  readonly metrics?: OperationalMetrics;
  readonly metricsComponent?: MetricComponent;
}

export function createDatabase(options: CreateDatabaseOptions): DatabaseHandle {
  const metricLabels: [] | [MetricComponent] = options.metricsComponent ? [options.metricsComponent] : [];
  const pool = new Pool({
    connectionString: options.connectionString.reveal(),
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
    idle_in_transaction_session_timeout: 15_000,
    ...(options.applicationName !== undefined ? { application_name: options.applicationName } : {}),
  });
  // Without an error listener, a disconnection on an idle connection would crash the process.
  pool.on('error', (error) => options.onPoolError?.(error));

  const db = new Kysely<Schema>({ dialect: new PostgresDialect({ pool: {
    options: pool.options,
    end: () => pool.end(),
    connect: async () => {
      const started = Date.now();
      try {
        const client = await pool.connect();
        options.metrics?.record('database_acquire', (Date.now() - started) / 1000, 'success', ...metricLabels);
        return client;
      } catch (error) {
        options.metrics?.record('database_acquire', (Date.now() - started) / 1000, 'error', ...metricLabels);
        throw error;
      }
    },
  } }), log: event => {
    options.metrics?.record('database_query', event.queryDurationMillis / 1000, event.level === 'error' ? 'error' : 'success', ...metricLabels);
  } });
  return {
    db,
    ping: async () => {
      await sql`SELECT 1`.execute(db);
    },
    close: () => db.destroy(),
    collectMetrics: () => {
      options.metrics?.set('pool_total', pool.totalCount, ...metricLabels);
      options.metrics?.set('pool_idle', pool.idleCount, ...metricLabels);
      options.metrics?.set('pool_waiting', pool.waitingCount, ...metricLabels);
      options.metrics?.set('pool_max', options.maxConnections ?? 10, ...metricLabels);
    },
  };
}

/**
 * All tenant-data reads and writes go through here. PostgreSQL RLS filters on `app.guild_id`, set only for
 * the transaction's duration.
 */
export function withTenant<T>(db: Db, guildId: GuildId, work: (trx: Tx) => Promise<T>, options: { readonly readOnlySnapshot?: boolean } = {}): Promise<T> {
  const transaction = options.readOnlySnapshot ? db.transaction().setIsolationLevel('repeatable read') : db.transaction();
  return transaction.execute(async (trx) => {
    if (options.readOnlySnapshot) await sql`SET TRANSACTION READ ONLY`.execute(trx);
    await sql`SELECT set_config('app.guild_id', ${guildId}, true)`.execute(trx);
    return work(trx);
  });
}

/** Permanently delete all guild data (SQL function `purge_guild`, see migration 003). */
export async function purgeGuildData(db: Db, guildId: GuildId): Promise<void> {
  await sql`SELECT purge_guild(${guildId})`.execute(db);
}
