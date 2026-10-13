import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { loadDashboardConfig, loggingConfig } from '@picket/config';
import { createLogger } from '@picket/observability';
import { startStatsServer } from './runtime';
import type { DevelopmentRole } from './development';

async function run() {
  const { values, positionals } = parseArgs({ options: { host: { type: 'boolean' }, port: { type: 'string' } }, allowPositionals: true });
  const [role = 'admin'] = positionals;
  if (positionals.length > 1 || !['member', 'officer', 'admin'].includes(role)) throw new Error('Usage: pnpm stats:dev:live [member|officer|admin] [--host] [--port <port>]');
  if (process.env.NODE_ENV !== 'development') throw new Error('Live development requires NODE_ENV=development');
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Live development requires a local PostgreSQL database');
  const port = values.port ?? process.env.DASHBOARD_PORT ?? '8082';
  const config = loadDashboardConfig({ ...process.env,
    DASHBOARD_PORT: port, HEALTH_PORT: process.env.HEALTH_PORT ?? '8084',
    DASHBOARD_URL: `http://localhost:${port}`,
    // This key encrypts local simulated sessions; it is not a Discord OAuth credential.
    DISCORD_CLIENT_SECRET: randomBytes(32).toString('hex'), DISCORD_CLIENT_SECRET_FILE: undefined,
    DISCORD_APPLICATION_ID: '800000000000000001', DISCORD_BOT_TOKEN: 'unused-development-token', DISCORD_BOT_TOKEN_FILE: undefined,
    SHUTDOWN_DRAIN_MS: '0',
  });
  const logger = createLogger({ level: config.logLevel, version: config.version, service: 'picket-stats-dev' });
  const runtime = await startStatsServer(config, logger, { developmentRole: role as DevelopmentRole, host: values.host ? '0.0.0.0' : '127.0.0.1' });
  logger.info({ role, host: values.host ? '0.0.0.0' : '127.0.0.1', port: config.dashboard.port }, 'live PostgreSQL dashboard ready; Discord identity is simulated');
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
    if (stopping) { process.exit(1); return; }
    stopping = true;
    setTimeout(() => process.exit(1), 30_000).unref();
    void runtime.close().then(() => process.exit(0), (error: unknown) => { logger.error({ err: error }, 'development shutdown failed'); process.exit(1); });
  });
}
void run().catch((error: unknown) => {
  createLogger({ ...loggingConfig(process.env), service: 'picket-stats-dev' })
    .fatal({ error: error instanceof Error ? error.message : 'Unknown startup error' }, 'live development failed to start');
  process.exit(1);
});
