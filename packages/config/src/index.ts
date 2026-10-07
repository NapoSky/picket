import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ApplicationId, DomainError, Secret } from '@picket/kernel';

export const ROLES = ['http-ingress', 'shard-runner', 'job-runner', 'warlog-poller'] as const;
export type Role = (typeof ROLES)[number];

export type Env = Readonly<Record<string, string | undefined>>;

export class ConfigError extends DomainError {
  readonly code = 'invalid_config';
}

// Variables pouvant être fournies par fichier (Docker secrets) via `<NOM>_FILE`.
const FILE_SECRET_KEYS = ['DISCORD_BOT_TOKEN', 'DATABASE_URL', 'DATABASE_MIGRATOR_URL'] as const;

const port = z.coerce.number().int().min(1).max(65535);
const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });
const logLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info');
const version = z.string().min(1).max(256).regex(/^[a-zA-Z0-9._/@:-]+$/).default('unknown');

const csvRoles = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.enum(ROLES)).min(1));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  LOG_LEVEL: logLevel,
  PICKET_VERSION: version,
  HTTP_PORT: port.default(8080),
  HEALTH_PORT: port.default(8081),
  SHUTDOWN_DRAIN_MS: z.coerce.number().int().min(0).max(120_000).default(10_000),
  ROLES: csvRoles.default(['http-ingress']),
  DISCORD_APPLICATION_ID: z.string().regex(/^\d{15,25}$/),
  DISCORD_PUBLIC_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/),
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_REST_GLOBAL_RPS: z.coerce.number().int().min(1).max(40).default(20),
  DATABASE_URL: postgresUrl,
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  GUILD_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  SHARD_COUNT: z.coerce.number().int().min(1).max(256).default(1),
});

const migrationEnvSchema = z.object({
  LOG_LEVEL: logLevel,
  PICKET_VERSION: version,
  DATABASE_MIGRATOR_URL: postgresUrl,
  DATABASE_APP_ROLE: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/).default('picket_app'),
});

export interface AppConfig {
  readonly env: 'development' | 'test' | 'production';
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  readonly version: string;
  readonly http: { readonly port: number; readonly healthPort: number };
  readonly shutdownDrainMs: number;
  readonly roles: readonly Role[];
  readonly discord: {
    readonly applicationId: ApplicationId;
    readonly publicKey: string;
    readonly botToken: Secret;
    readonly restGlobalRps: number;
  };
  readonly database: { readonly url: Secret; readonly poolMax: number };
  /** Délai entre la désactivation d'une guilde et la suppression définitive de ses données. */
  readonly guildRetentionDays: number;
  /** Nombre total de shards Gateway ; chaque shard a son bail et une seule connexion active. */
  readonly shardCount: number;
}

export interface MigrationConfig {
  readonly logLevel: AppConfig['logLevel'];
  readonly version: string;
  readonly migratorUrl: Secret;
  readonly appRole: string;
}

export interface LoadConfigOptions {
  readonly readFile?: (path: string) => string;
}

function resolveFileSecrets(env: Env, readFile: (path: string) => string): Record<string, string | undefined> {
  const resolved: Record<string, string | undefined> = { ...env };
  for (const key of FILE_SECRET_KEYS) {
    const filePath = env[`${key}_FILE`];
    if (filePath === undefined || filePath === '') continue;
    if (env[key] !== undefined && env[key] !== '') {
      throw new ConfigError(`${key} and ${key}_FILE are mutually exclusive`);
    }
    try {
      resolved[key] = readFile(filePath).replace(/\r?\n$/, '');
    } catch (cause) {
      throw new ConfigError(`Cannot read ${key}_FILE (${filePath})`, { cause });
    }
  }
  return resolved;
}

/** Valide l'environnement ; les messages d'erreur ne contiennent jamais les valeurs. */
function parseEnv<T extends z.ZodType>(schema: T, env: Env, options: LoadConfigOptions): z.output<T> {
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const parsed = schema.safeParse(resolveFileSecrets(env, readFile));
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')} (${issue.code})`);
    throw new ConfigError(`Invalid configuration: ${problems.join(', ')}`);
  }
  return parsed.data;
}

export function loadConfig(env: Env, options: LoadConfigOptions = {}): AppConfig {
  const data = parseEnv(envSchema, env, options);
  return {
    env: data.NODE_ENV,
    logLevel: data.LOG_LEVEL,
    version: data.PICKET_VERSION,
    http: { port: data.HTTP_PORT, healthPort: data.HEALTH_PORT },
    shutdownDrainMs: data.SHUTDOWN_DRAIN_MS,
    roles: data.ROLES,
    discord: {
      applicationId: ApplicationId.assert(data.DISCORD_APPLICATION_ID),
      publicKey: data.DISCORD_PUBLIC_KEY.toLowerCase(),
      botToken: new Secret(data.DISCORD_BOT_TOKEN),
      restGlobalRps: data.DISCORD_REST_GLOBAL_RPS,
    },
    database: { url: new Secret(data.DATABASE_URL), poolMax: data.DATABASE_POOL_MAX },
    guildRetentionDays: data.GUILD_RETENTION_DAYS,
    shardCount: data.SHARD_COUNT,
  };
}

export function loadMigrationConfig(env: Env, options: LoadConfigOptions = {}): MigrationConfig {
  const data = parseEnv(migrationEnvSchema, env, options);
  return {
    logLevel: data.LOG_LEVEL,
    version: data.PICKET_VERSION,
    migratorUrl: new Secret(data.DATABASE_MIGRATOR_URL),
    appRole: data.DATABASE_APP_ROLE,
  };
}

/** Safe bootstrap identity, also available when the full configuration fails validation. */
export function loggingConfig(env: Env): { readonly level: AppConfig['logLevel']; readonly version: string } {
  const parsedLevel = logLevel.safeParse(env.LOG_LEVEL);
  const parsedVersion = version.safeParse(env.PICKET_VERSION);
  return {
    level: parsedLevel.success ? parsedLevel.data : 'info',
    version: parsedVersion.success ? parsedVersion.data : 'unknown',
  };
}
