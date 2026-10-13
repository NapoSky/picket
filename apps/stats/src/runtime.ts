import { setTimeout as sleep } from 'node:timers/promises';
import type { DashboardConfig } from '@picket/config';
import { PostgresDiscordBudget } from '@picket/coordination';
import { createDiscordBotRest } from '@picket/discord';
import type { Logger } from '@picket/kernel';
import { createHealthServer } from '@picket/observability';
import { createDatabase } from '@picket/persistence';
import { DashboardDiscord, DiskVoiceBuffer, PostgresStatsStore, createDashboardServer } from '@picket/stats';
import { createDevelopmentIdentity, type DevelopmentRole } from './development';

/** HTTP-only composition: one bounded SQL pool, no Gateway, jobs or collector. */
export interface StatsServerRuntime {
  readonly dashboard: ReturnType<typeof createDashboardServer> | null;
  readonly health: ReturnType<typeof createHealthServer>;
  close(): Promise<void>;
}
export async function startStatsServer(config: DashboardConfig, logger: Logger,
  options: { readonly developmentRole?: DevelopmentRole; readonly host?: string } = {},
): Promise<StatsServerRuntime> {
  if (options.developmentRole && config.env !== 'development') throw new Error('Simulated Discord identities require NODE_ENV=development');
  const { origin, clientSecret, port } = config.dashboard;
  if (origin && !clientSecret) throw new Error('OAuth client secret required for dashboard');
  const database = origin ? createDatabase({
    connectionString: config.database.url,
    maxConnections: config.database.poolMax,
    applicationName: 'picket-dashboard',
    onPoolError: (error) => logger.error({ err: error }, 'dashboard pool error'),
  }) : null;
  const buffer = new DiskVoiceBuffer(config.stats.bufferPath, config.stats.bufferMaxBytes);
  const rest = database ? createDiscordBotRest(config.discord.botToken,
    { globalRequestsPerSecond: config.discord.restGlobalRps }, new PostgresDiscordBudget(database.db)) : null;
  const store = database ? new PostgresStatsStore(database.db) : null;
  const dashboard = database && store && origin && clientSecret && rest ? createDashboardServer({
    db: database.db, store, buffer, logger,
    identity: options.developmentRole ? createDevelopmentIdentity(database.db, store, options.developmentRole)
      : new DashboardDiscord(config.discord.applicationId, clientSecret.reveal(), `${origin}/auth/callback`, rest),
    applicationId: config.discord.applicationId, origin, encryptionSecret: clientSecret.reveal(),
    ...(options.developmentRole ? { development: {
      role: options.developmentRole,
      authorizationUrl: (state: string) => `/auth/callback?${new URLSearchParams({ code: 'local-development', state })}`,
    } } : {}),
  }) : null;
  let draining = false;
  const health = createHealthServer({ isReady: async () => {
    if (draining) return false;
    if (database) await database.ping();
    return true;
  } });
  const closeHealth = () => new Promise<void>((resolve, reject) => {
    if (!health.listening) return resolve();
    health.close((error) => error ? reject(error) : resolve());
  });
  async function close() {
    draining = true;
    await sleep(config.shutdownDrainMs);
    await dashboard?.close();
    await closeHealth();
    await database?.close();
  }
  try {
    if (dashboard) {
      await buffer.initialize();
      await database!.ping();
      // Live development has no job runner. Prepare its snapshot once at startup.
      if (options.developmentRole === 'admin') await store!.refreshAdminSnapshot();
      await dashboard.listen({ host: options.host ?? '0.0.0.0', port });
    }
    await new Promise<void>((resolve, reject) => {
      health.once('error', reject);
      health.listen(config.healthPort, '0.0.0.0', () => { health.off('error', reject); resolve(); });
    });
  } catch (error) {
    await Promise.allSettled([dashboard?.close(), closeHealth(), database?.close()]);
    throw error;
  }
  logger.info({ enabled: !!dashboard, port, healthPort: config.healthPort, databasePoolMax: database ? config.database.poolMax : 0 }, 'stats HTTP service started');
  return { dashboard, health, close };
}
