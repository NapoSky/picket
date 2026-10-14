import { createDatabase, sql } from '@picket/persistence';
import { createTestDatabase } from '@picket/testing';
import type { OperationalMetrics, MetricSignal } from '@picket/kernel';

it('measures real PostgreSQL pool contention and query errors without SQL or tenant labels', async () => {
  const database = await createTestDatabase({ migrate: false });
  const gauges = new Map<MetricSignal, number>();
  const metrics: OperationalMetrics = { record: jest.fn(), set: (name, value) => { gauges.set(name, value); } };
  const observed = createDatabase({ connectionString: database.appUrl, maxConnections: 1, metrics });
  let release!: () => void;
  let acquired!: () => void;
  const locked = new Promise<void>(resolve => { acquired = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  try {
    const first = observed.db.transaction().execute(async () => { acquired(); await hold; });
    await locked;
    const second = observed.ping();
    // Wait for Kysely to request the second connection, without arbitrary SQL sleeps.
    for (let i = 0; i < 100; i++) {
      observed.collectMetrics();
      if (gauges.get('pool_waiting') === 1) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    observed.collectMetrics();
    expect(gauges.get('pool_waiting')).toBe(1);
    release();
    await Promise.all([first, second]);
    await expect(sql`SELECT * FROM private_missing_table`.execute(observed.db)).rejects.toThrow();
    observed.collectMetrics();
    expect(metrics.record).toHaveBeenCalledWith('database_acquire', expect.any(Number), 'success');
    expect(metrics.record).toHaveBeenCalledWith('database_query', expect.any(Number), 'error');
    expect(gauges.get('pool_waiting')).toBe(0);
    expect(JSON.stringify((metrics.record as jest.Mock).mock.calls)).not.toContain('private_missing_table');
  } finally { release?.(); await observed.close(); await database.drop(); }
}, 30_000);
