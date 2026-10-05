import { loadConfig, loadMigrationConfig } from '@picket/config';
import {
  DiscordRestCommandsApi,
  INTERACTION_RECEIPT_RETENTION_DAYS,
  PostgresDeployedHashStore,
  PostgresInteractionReceipts,
  deployCommands,
} from '@picket/discord';
import { createI18n } from '@picket/i18n';
import { systemClock } from '@picket/kernel';
import { createLogger } from '@picket/observability';
import { createDatabase, migrate } from '@picket/persistence';
import { buildCommandRegistry, buildPurgeJob } from './composition';

const USAGE = 'Usage: cli <migrate | deploy-commands [--force] | purge>';

async function runMigrate(): Promise<void> {
  const config = loadMigrationConfig(process.env);
  const logger = createLogger({ level: config.logLevel, service: 'picket-cli' });
  const result = await migrate({ connectionString: config.migratorUrl, appRole: config.appRole });
  logger.info({ applied: result.applied, alreadyApplied: result.alreadyApplied }, 'migrations done');
}

async function runDeployCommands(force: boolean): Promise<void> {
  const config = loadConfig(process.env);
  const logger = createLogger({ level: config.logLevel, service: 'picket-cli' });
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
  } finally {
    await database.close();
  }
}

/** À planifier (cron) tant que le job-runner n'existe pas ; code de sortie 1 si une guilde a échoué. */
async function runPurge(): Promise<number> {
  const config = loadConfig(process.env);
  const logger = createLogger({ level: config.logLevel, service: 'picket-cli' });
  const database = createDatabase({ connectionString: config.database.url, maxConnections: 2, applicationName: 'picket-cli' });
  try {
    const report = await buildPurgeJob(database.db, logger, {
      clock: systemClock,
      guildRetentionDays: config.guildRetentionDays,
      i18n: createI18n(),
    }).execute();
    const cutoff = new Date(systemClock.now().getTime() - INTERACTION_RECEIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const receiptsDeleted = await new PostgresInteractionReceipts(database.db).deleteOlderThan(cutoff);
    logger.info({ purged: report.purged.length, failed: report.failed.length, receiptsDeleted }, 'purge done');
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
      console.error(USAGE);
      return 2;
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error('cli failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
