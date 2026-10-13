import { parseArgs } from 'node:util';
import { loadDashboardConfig, loggingConfig } from '@picket/config';
import { createLogger } from '@picket/observability';
import { startStatsServer } from './runtime';

async function run() {
  // Live authorization comes from Discord; this server accepts no preview-role flags.
  parseArgs();
  const config = loadDashboardConfig(process.env);
  const logger = createLogger({ level: config.logLevel, version: config.version, service: 'picket-stats' });
  process.on('unhandledRejection', (error) => { logger.fatal({ err: error }, 'unhandled rejection'); process.exit(1); });
  process.on('uncaughtException', (error) => { logger.fatal({ err: error }, 'uncaught exception'); process.exit(1); });
  const runtime = await startStatsServer(config, logger);
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
    if (stopping) { process.exit(1); return; }
    stopping = true;
    setTimeout(() => process.exit(1), 30_000).unref();
    logger.info({ signal, drainMs: config.shutdownDrainMs }, 'draining stats HTTP service');
    void runtime.close().then(() => process.exit(0), (error: unknown) => {
      logger.error({ err: error }, 'stats shutdown failed'); process.exit(1);
    });
  });
}
void run().catch((error: unknown) => {
  createLogger({ ...loggingConfig(process.env), service: 'picket-stats' })
    .fatal({ error: error instanceof Error ? error.message : 'Unknown startup error' }, 'stats failed to start');
  process.exit(1);
});
