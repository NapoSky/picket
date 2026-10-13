import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { loadDashboardConfig } from '@picket/config';
import { noopLogger } from '@picket/kernel';
import { createTestDatabase, queryAsAdmin } from '@picket/testing';
import { startStatsServer } from '../src/runtime';

describe('dedicated stats HTTP runtime', () => {
  it('rejects simulated identities in a production runtime', async () => {
    const config = loadDashboardConfig({ NODE_ENV: 'production', DISCORD_APPLICATION_ID: '800000000000000001',
      DISCORD_BOT_TOKEN: 'unused-test-token', DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused' });
    await expect(startStatsServer(config, noopLogger, { developmentRole: 'admin' })).rejects.toThrow('NODE_ENV=development');
  });
  it('serves the UI with its own bounded pool, requires authentication and releases resources', async () => {
    const database = await createTestDatabase();
    const directory = await mkdtemp(join(tmpdir(), 'picket-stats-service-'));
    const config = loadDashboardConfig({
      DISCORD_APPLICATION_ID: '800000000000000001', DISCORD_BOT_TOKEN: 'unused-test-token',
      DATABASE_URL: database.appUrl.reveal(), DASHBOARD_URL: 'https://stats.example.org',
      DISCORD_CLIENT_SECRET: 'test-oauth-secret', STATS_BUFFER_PATH: directory, SHUTDOWN_DRAIN_MS: '0',
    });
    let runtime: Awaited<ReturnType<typeof startStatsServer>> | undefined;
    try {
      runtime = await startStatsServer({ ...config, healthPort: 0, dashboard: { ...config.dashboard, port: 0 } }, noopLogger);
      expect(runtime.dashboard).not.toBeNull();
      expect((await runtime.dashboard!.inject('/')).statusCode).toBe(200);
      expect((await runtime.dashboard!.inject('/')).body).not.toContain('Fictitious data');
      expect((await runtime.dashboard!.inject('/api/session')).statusCode).toBe(401);
      expect((await runtime.dashboard!.inject('/auth/discord')).statusCode).toBe(302);
      const address = runtime.health.address() as AddressInfo;
      expect((await fetch(`http://127.0.0.1:${address.port}/readyz`)).status).toBe(200);
      const pools = await queryAsAdmin<{ count: number }>(database,
        "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND application_name='picket-dashboard'");
      expect(pools[0]!.count).toBeGreaterThan(0);
      expect(pools[0]!.count).toBeLessThanOrEqual(2);
      // Only an OAuth state was written. HTTP startup cannot collect voice facts or hold shard leases.
      for (const table of ['stats_voice_events', 'stats_voice_segments', 'leases']) {
        expect((await queryAsAdmin<{ count: number }>(database, `SELECT count(*)::int AS count FROM ${table}`))[0]!.count).toBe(0);
      }
      await runtime.close(); runtime = undefined;
      expect((await queryAsAdmin<{ count: number }>(database,
        "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND application_name='picket-dashboard'"))[0]!.count).toBe(0);
    } finally {
      await runtime?.close(); await database.drop(); await rm(directory, { recursive: true, force: true });
    }
  });
  it('starts only internal health when disabled, without requiring a reachable database', async () => {
    const config = loadDashboardConfig({
      DISCORD_APPLICATION_ID: '800000000000000001', DISCORD_BOT_TOKEN: 'unused-test-token',
      DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused', DASHBOARD_URL: '', SHUTDOWN_DRAIN_MS: '0',
    });
    const runtime = await startStatsServer({ ...config, healthPort: 0 }, noopLogger);
    try {
      expect(runtime.dashboard).toBeNull();
      const address = runtime.health.address() as AddressInfo;
      expect((await fetch(`http://127.0.0.1:${address.port}/readyz`)).status).toBe(200);
    } finally { await runtime.close(); }
  });
});
