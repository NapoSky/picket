import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig, loggingConfig, type Role } from '@picket/config';
import { DiscordRestGuildChannels, DiscordRestGuildRoles, DiscordRestInteractionReplies, DiscordRestMessaging, createDiscordBotRest, createInteractionServer } from '@picket/discord';
import { createI18n } from '@picket/i18n';
import { systemClock } from '@picket/kernel';
import { createGuildLogDestination, createHealthServer, createLogger, createMetrics, createMonitoringDestination } from '@picket/observability';
import { createDatabase, PostgresGuildApplicationLogs } from '@picket/persistence';
import { PostgresDiscordBudget, PostgresKeyedLock, startLeasedLoop } from '@picket/coordination';
import { DiskVoiceBuffer,PostgresStatsStore,VoiceCollector } from '@picket/stats';
import { buildJobRunner, buildPipeline, buildShardRunner, buildWarLogRunner } from './composition';
import { PostgresWarStore } from '@picket/warlog';
import { drainBot } from './shutdown';

// Allow the 60 s deferred-work deadline plus reply delivery after proxy drainage.
const SHUTDOWN_WORK_GRACE_MS = 75_000;
const LOCK_POOL_MAX = 2;
const IMPLEMENTED_ROLES: ReadonlySet<Role> = new Set(['http-ingress', 'shard-runner', 'job-runner', 'warlog-poller']);

async function run(): Promise<void> {
  const config = loadConfig(process.env);
  const metrics = createMetrics({ service: 'picket', version: config.version });
  const monitoring = createMonitoringDestination(process.stdout, metrics);
  let logger = createLogger({ level: config.logLevel, service: 'picket', version: config.version, destination: monitoring });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled rejection');
    process.exit(1);
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    process.exit(1);
  });

  const unsupported = config.roles.filter((role) => !IMPLEMENTED_ROLES.has(role));
  if (unsupported.length > 0) throw new Error(`Roles not implemented yet: ${unsupported.join(', ')}`);

  const database = createDatabase({
    connectionString: config.database.url,
    maxConnections: config.database.poolMax,
    applicationName: 'picket',
    onPoolError: (error) => logger.error({ err: error }, 'database pool error'),
    metrics,
  });
  const lockDatabase = createDatabase({
    connectionString: config.database.url,
    maxConnections: LOCK_POOL_MAX,
    applicationName: 'picket-locks',
    onPoolError: (error) => logger.error({ err: error }, 'lock pool error'),
    metrics, metricsComponent: 'locks',
  });
  const guildLogs = new PostgresGuildApplicationLogs(database.db);
  const logDestination = createGuildLogDestination({ version: config.version, append: (entries) => guildLogs.append(entries), monitoring, diagnostics: { write: () => undefined } });
  logger = createLogger({ level: config.logLevel, service: 'picket', version: config.version, destination: logDestination.destination });
  const rest = createDiscordBotRest(config.discord.botToken, { globalRequestsPerSecond: config.discord.restGlobalRps }, new PostgresDiscordBudget(database.db), metrics);
  const discord = {
    messaging: new DiscordRestMessaging(config.discord.botToken, {}, rest),
    replies: new DiscordRestInteractionReplies({}, metrics),
    guildRoles: new DiscordRestGuildRoles(config.discord.botToken, {}, rest),
    guildChannels: new DiscordRestGuildChannels(config.discord.botToken, {}, rest),
  };
  const statsStore=new PostgresStatsStore(database.db);
  const voiceBuffer=new DiskVoiceBuffer(config.stats.bufferPath,config.stats.bufferMaxBytes, () => new Date(), metrics);
  await voiceBuffer.initialize();
  const voiceCollector=new VoiceCollector(statsStore,voiceBuffer,logger,()=>new Date(),rest);
  voiceCollector.shardCount=config.shardCount;
  const composition = {
    timeZone: config.timeZone,
    statsAdminRefreshCron: config.statsAdminRefreshCron,
    clock: systemClock,
    guildRetentionDays: config.guildRetentionDays,
    supportGuildEventsChannelId: config.supportGuildEventsChannelId,
    i18n: createI18n(),
    discord,
    metrics,
    locks: new PostgresKeyedLock(lockDatabase.db),
    flushGuildLogs: () => logDestination.flush(),
    stats:{store:statsStore,buffer:voiceBuffer,collector:voiceCollector,dashboardUrl:config.dashboard.origin},
  };

  let draining = false;
  const isReady = async () => {
    if (draining) return false;
    let ready = false;
    try { await database.ping(); ready = !draining && logDestination.healthy; } catch { /* measured below */ }
    metrics.set('ready', Number(ready));
    metrics.set('draining', Number(draining));
    return ready;
  };
  const health = createHealthServer({ isReady, metrics });

  const interactions = config.roles.includes('http-ingress')
    ? createInteractionServer({
        publicKey: config.discord.publicKey,
        pipeline: buildPipeline(database.db, logger, composition),
        replies: discord.replies,
        logger,
        clock: systemClock,
        metrics,
      })
    : null;
  const holder = `${hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`;
  const shards = config.roles.includes('shard-runner')
    ? buildShardRunner(database.db, logger, {
        ...composition,
        botToken: config.discord.botToken,
        shardCount: config.shardCount,
        holder,
        rest,
      })
    : null;
  const jobs = config.roles.includes('job-runner') ? buildJobRunner(database.db, logger, { ...composition, holder }) : null;
  const warlog = config.roles.includes('warlog-poller') ? buildWarLogRunner(database.db, logger, { ...composition, holder,
    apiUrl: config.warlog.apiUrl, pollIntervalMs: config.warlog.pollIntervalMs, version: config.version,
  }) : null;
  metrics.set('shards_expected', shards ? config.shardCount : 0, 'gateway');
  metrics.set('shards_connected', 0, 'gateway');
  for (const component of ['job-runner', 'warlog-poller'] as const) {
    metrics.set('role_enabled', Number(config.roles.includes(component)), component);
  }
  metrics.collect(async () => {
    database.collectMetrics();
    lockDatabase.collectMetrics();
    await Promise.all([isReady(), voiceBuffer.collectMetrics()]);
    metrics.set('role_leader', Number(jobs?.isLeader ?? false), 'job-runner');
    metrics.set('role_leader', Number(warlog?.isLeader ?? false), 'warlog-poller');
    if (warlog?.isLeader) {
      const state = await new PostgresWarStore(database.db).operationalState();
      metrics.set('war_pending_guilds', state.pendingGuilds, 'warlog-poller');
      metrics.set('war_delivery_overdue', state.overdueSeconds, 'warlog-poller');
    } else {
      metrics.set('war_pending_guilds', 0, 'warlog-poller');
      metrics.set('war_delivery_overdue', 0, 'warlog-poller');
    }
  });

  await interactions?.listen({ host: '0.0.0.0', port: config.http.port });
  await new Promise<void>((resolve) => health.listen(config.http.healthPort, '0.0.0.0', resolve));
  shards?.start();
  jobs?.start();
  warlog?.start();
  const stopVoice=startLeasedLoop({tick:()=>voiceCollector.tick(),intervalMs:10_000,logger,metrics,component:'voice'});
  const stopVoiceNames=startLeasedLoop({tick:()=>voiceCollector.refreshMetadata(),intervalMs:10_000,logger,metrics,component:'voice-metadata'});
  logger.info(
    { roles: config.roles, port: config.http.port, healthPort: config.http.healthPort, shardCount: config.shardCount, restGlobalRps: config.discord.restGlobalRps, databasePoolMax: config.database.poolMax, lockPoolMax: LOCK_POOL_MAX },
    'picket started',
  );

  let stopping = false;
  const stop = async (signal: string): Promise<void> => {
    if (stopping) {
      logger.warn({ signal }, 'second signal, exiting immediately');
      process.exit(1);
    }
    stopping = true;
    setTimeout(() => process.exit(1), config.shutdownDrainMs + SHUTDOWN_WORK_GRACE_MS).unref();
    await drainBot({
      beginDrain: () => {
        draining = true;
        metrics.set('ready', 0);
        metrics.set('draining', 1);
        logger.info({ signal, drainMs: config.shutdownDrainMs }, 'draining');
      },
      stopBackground: async () => {
        // Release shard ownership promptly, while HTTP independently drains.
        const results = await Promise.allSettled([
          (async () => {
            await shards?.stop();
            await Promise.all([stopVoice(), stopVoiceNames()]);
            await voiceCollector.shutdown();
          })(),
          jobs?.stop(), warlog?.stop(),
        ]);
        const errors = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
        if (errors.length) throw new AggregateError(errors, 'Background shutdown failed');
      },
      waitForProxy: () => sleep(config.shutdownDrainMs),
      closeInteractions: async () => { await interactions?.close(); },
      closeInfrastructure: async () => {
        await new Promise<void>((resolve) => health.close(() => resolve()));
        await logDestination.close();
        await Promise.all([database.close(), lockDatabase.close()]);
        metrics.close();
      },
    });
    logger.info({}, 'stopped');
    process.exit(0);
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      stop(signal).catch((error: unknown) => {
        logger.error({ err: error }, 'shutdown failed');
        process.exit(1);
      });
    });
  }
}

run().catch((error: unknown) => {
  createLogger({ ...loggingConfig(process.env), service: 'picket', destination: createMonitoringDestination() })
    .fatal({ error: error instanceof Error ? error.message : 'Unknown startup error' }, 'picket failed to start');
  process.exit(1);
});
