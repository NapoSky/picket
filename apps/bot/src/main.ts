import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig, type Role } from '@picket/config';
import { DiscordRestGuildRoles, DiscordRestInteractionReplies, DiscordRestMessaging, createInteractionServer } from '@picket/discord';
import { createI18n } from '@picket/i18n';
import { systemClock } from '@picket/kernel';
import { createGuildLogDestination, createHealthServer, createLogger } from '@picket/observability';
import { createDatabase, PostgresGuildApplicationLogs } from '@picket/persistence';
import { buildJobRunner, buildPipeline, buildShardRunner } from './composition';

const FORCE_EXIT_AFTER_MS = 30_000;
const IMPLEMENTED_ROLES: ReadonlySet<Role> = new Set(['http-ingress', 'shard-runner', 'job-runner']);

async function run(): Promise<void> {
  const config = loadConfig(process.env);
  let logger = createLogger({ level: config.logLevel, service: 'picket' });

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
  });
  const guildLogs = new PostgresGuildApplicationLogs(database.db);
  const logDestination = createGuildLogDestination({ append: (entries) => guildLogs.append(entries) });
  logger = createLogger({ level: config.logLevel, service: 'picket', destination: logDestination.destination });
  const discord = {
    messaging: new DiscordRestMessaging(config.discord.botToken),
    replies: new DiscordRestInteractionReplies(),
    guildRoles: new DiscordRestGuildRoles(config.discord.botToken),
  };
  const composition = {
    clock: systemClock,
    guildRetentionDays: config.guildRetentionDays,
    i18n: createI18n(),
    discord,
    flushGuildLogs: () => logDestination.flush(),
  };

  let draining = false;
  const health = createHealthServer({
    isReady: async () => {
      if (draining || !logDestination.healthy) return false;
      await database.ping();
      return true;
    },
  });

  const interactions = config.roles.includes('http-ingress')
    ? createInteractionServer({
        publicKey: config.discord.publicKey,
        pipeline: buildPipeline(database.db, logger, composition),
        replies: discord.replies,
        logger,
        clock: systemClock,
      })
    : null;
  const holder = `${hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`;
  const shards = config.roles.includes('shard-runner')
    ? buildShardRunner(database.db, logger, {
        ...composition,
        botToken: config.discord.botToken,
        shardCount: config.shardCount,
        holder,
      })
    : null;
  const jobs = config.roles.includes('job-runner') ? buildJobRunner(database.db, logger, { ...composition, holder }) : null;

  await interactions?.listen({ host: '0.0.0.0', port: config.http.port });
  await new Promise<void>((resolve) => health.listen(config.http.healthPort, '0.0.0.0', resolve));
  shards?.start();
  jobs?.start();
  logger.info(
    { roles: config.roles, port: config.http.port, healthPort: config.http.healthPort, shardCount: config.shardCount },
    'picket started',
  );

  let stopping = false;
  const stop = async (signal: string): Promise<void> => {
    if (stopping) {
      logger.warn({ signal }, 'second signal, exiting immediately');
      process.exit(1);
    }
    stopping = true;
    setTimeout(() => process.exit(1), FORCE_EXIT_AFTER_MS).unref();

    // Cède d'abord les baux Gateway : une autre réplique reprend la session pendant que celle-ci se vide.
    await shards?.stop();
    // Les passes périodiques s'achèvent avant la fermeture de la base : le bail est rendu à la réplique suivante.
    await jobs?.stop();

    // Laisse le reverse proxy retirer cette réplique (readiness KO) avant de refuser des connexions.
    draining = true;
    logger.info({ signal, drainMs: config.shutdownDrainMs }, 'draining');
    await sleep(config.shutdownDrainMs);
    await interactions?.close();
    await new Promise<void>((resolve) => health.close(() => resolve()));
    await logDestination.close();
    await database.close();
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
  console.error('picket failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
