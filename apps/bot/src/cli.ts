import { loadConfig, loadMigrationConfig, loggingConfig } from '@picket/config';
import {
  DiscordRestCommandsApi,
  PostgresDeployedHashStore,
  deployCommands,
} from '@picket/discord';
import { createI18n } from '@picket/i18n';
import { systemClock } from '@picket/kernel';
import { createLogger } from '@picket/observability';
import { createDatabase, migrate } from '@picket/persistence';
import { buildCommandRegistry, buildRetentionJob } from './composition';

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
  } finally {
    await database.close();
  }
}

/** Nettoyage ponctuel ; également exécuté automatiquement par le job-runner. */
async function runPurge(): Promise<number> {
  const config = loadConfig(process.env);
  const logger = createLogger({ level: config.logLevel, service: 'picket-cli', version: config.version });
  const database = createDatabase({ connectionString: config.database.url, maxConnections: 2, applicationName: 'picket-cli' });
  try {
    const report = await buildRetentionJob(database.db, logger, {
      clock: systemClock,
      guildRetentionDays: config.guildRetentionDays,
      i18n: createI18n(),
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
