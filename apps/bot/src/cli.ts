import { loadConfig, loadMigrationConfig, loggingConfig } from '@picket/config';
import {
  DiscordRestCommandsApi,
  PostgresDeployedHashStore,
  deployCommands,
  deployOperatorCommands,
  DiscordRestGuildOperations,
  createDiscordBotRest,
} from '@picket/discord';
import { createI18n } from '@picket/i18n';
import { systemClock } from '@picket/kernel';
import { createLogger } from '@picket/observability';
import { createDatabase, migrate } from '@picket/persistence';
import { buildCommandRegistry, buildOperatorRegistry, buildRetentionJob } from './composition';
import { createAppState } from '@picket/persistence';
import { DiskVoiceBuffer, PostgresStatsStore } from '@picket/stats';

const USAGE = 'Usage: cli <migrate | deploy-commands [--force] | purge>';

async function runMigrate(): Promise<void> {
  const config = loadMigrationConfig(process.env);
  const logger = createLogger({ level: config.logLevel, service: 'picket-cli', version: config.version });
  const result = await migrate({ connectionString: config.migratorUrl, appRole: config.appRole });
  logger.info({ applied: result.applied, alreadyApplied: result.alreadyApplied }, 'migrations done');
}

async function runDeployCommands(force: boolean): Promise<void> {
  const config = loadConfig(process.env);
  const logger = createLogger({ level: config.logLevel, service: 'picket-cli', version: config.version });
  const database = createDatabase({ connectionString: config.database.url, maxConnections: 2, applicationName: 'picket-cli' });
  try {
    const result = await deployCommands({
      registry: buildCommandRegistry(database.db, {
        clock: systemClock,
        guildRetentionDays: config.guildRetentionDays,
        i18n: createI18n(),
      }),
      api: new DiscordRestCommandsApi(config.discord.applicationId, config.discord.botToken),
      store: new PostgresDeployedHashStore(database.db, config.discord.applicationId),
      force,
    });
    logger.info({ ...result }, result.deployed ? 'commands deployed' : 'commands unchanged, nothing to deploy');
    const state = createAppState(database.db);
    const opsKey = `operator_commands:${config.discord.applicationId}`;
    try {
      const operatorResult = await deployOperatorCommands({
        registry: buildOperatorRegistry(database.db, { clock: systemClock, guildRetentionDays: config.guildRetentionDays, i18n: createI18n() }),
        api: new DiscordRestCommandsApi(config.discord.applicationId, config.discord.botToken),
        discord: new DiscordRestGuildOperations(createDiscordBotRest(config.discord.botToken)),
        channelId: config.supportGuildEventsChannelId,
        store: { get: () => state.get(opsKey), set: hash => state.set(opsKey, hash) }, force,
      });
      logger.info({ ...operatorResult }, 'operator commands deployment checked');
    } catch {
      // Optional operations must not prevent the public bot from being deployed.
      logger.warn({}, 'operator commands unavailable: deployment will be retried on the next deploy-commands run');
    }
  } finally {
    await database.close();
  }
}

/** One-off cleanup; also executed automatically by the job runner. */
async function runPurge(): Promise<number> {
  const config = loadConfig(process.env);
  const logger = createLogger({ level: config.logLevel, service: 'picket-cli', version: config.version });
  const database = createDatabase({ connectionString: config.database.url, maxConnections: 2, applicationName: 'picket-cli' });
  try {
    const report = await buildRetentionJob(database.db, logger, {
      clock: systemClock,
      guildRetentionDays: config.guildRetentionDays,
      i18n: createI18n(),
      stats: {
        store: new PostgresStatsStore(database.db),
        buffer: new DiskVoiceBuffer(config.stats.bufferPath, config.stats.bufferMaxBytes),
        dashboardUrl: config.dashboard.origin,
      },
    }).execute();
    logger.info({ ...report, purged: report.purged.length, failed: report.failed.length }, 'purge done');
    return report.failed.length > 0 ? 1 : 0;
  } finally {
    await database.close();
  }
}

async function main(): Promise<number> {
  const [command, ...flags] = process.argv.slice(2);
  switch (command) {
    case 'migrate':
      await runMigrate();
      return 0;
    case 'deploy-commands':
      await runDeployCommands(flags.includes('--force'));
      return 0;
    case 'purge':
      return runPurge();
    default:
      createLogger({ ...loggingConfig(process.env), service: 'picket-cli' }).error({}, USAGE);
      return 2;
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    createLogger({ ...loggingConfig(process.env), service: 'picket-cli' })
      .fatal({ error: error instanceof Error ? error.message : 'Unknown CLI error' }, 'cli failed');
    process.exit(1);
  },
);
