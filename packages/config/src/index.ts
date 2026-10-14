import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ApplicationId, DomainError, Secret } from '@picket/kernel';
import { latestCronSchedule } from './schedule';
export { latestCronSchedule } from './schedule';

export const ROLES = ['http-ingress', 'shard-runner', 'job-runner', 'warlog-poller'] as const;
export type Role = (typeof ROLES)[number];

export type Env = Readonly<Record<string, string | undefined>>;

export class ConfigError extends DomainError {
  readonly code = 'invalid_config';
}

// Variables that can be supplied as files (Docker secrets) through `<NAME>_FILE`.
const FILE_SECRET_KEYS = ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_SECRET', 'DATABASE_URL', 'DATABASE_MIGRATOR_URL'] as const;

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

const baseEnvSchema = z.object({
  TZ: z.string().refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }).default('Europe/Paris'),
  STATS_ADMIN_REFRESH_CRON: z.string().refine(value => { try { latestCronSchedule(value, new Date(), 'UTC'); return true; } catch { return false; } }).default('0 0,12 * * *'),
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
  WAR_API_URL: z.url({ protocol: /^https$/ }).default('https://war-service-live.foxholeservices.com'),
  WAR_LOG_POLL_INTERVAL: z.coerce.number().int().min(5).max(300).default(15),
  DASHBOARD_URL: z.preprocess((value) => value === '' ? undefined : value, z.url().optional()),
  DASHBOARD_PORT: port.default(8082),
  DASHBOARD_POOL_MAX: z.coerce.number().int().min(1).max(10).default(2),
  DISCORD_CLIENT_SECRET: z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional()),
  STATS_BUFFER_PATH: z.string().min(1).default('./data/voice-buffer'),
  STATS_BUFFER_MAX_MIB: z.coerce.number().int().min(1).max(1024).default(128),
});

function checkDashboardOrigin(data: { NODE_ENV: string; DASHBOARD_URL?: string | undefined }, context: z.RefinementCtx) {
  if (!data.DASHBOARD_URL) return;
  const url = new URL(data.DASHBOARD_URL);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
    !(url.protocol === 'https:' || (data.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    context.addIssue({ code: 'custom', path: ['DASHBOARD_URL'], message: 'HTTPS origin required' });
  }
}

// The bot needs only the public URL for links; OAuth credentials belong to the HTTP service.
const envSchema = baseEnvSchema.superRefine(checkDashboardOrigin);
const dashboardEnvSchema = baseEnvSchema.pick({
  NODE_ENV: true, LOG_LEVEL: true, PICKET_VERSION: true, HEALTH_PORT: true, SHUTDOWN_DRAIN_MS: true,
  DISCORD_APPLICATION_ID: true, DISCORD_BOT_TOKEN: true, DISCORD_REST_GLOBAL_RPS: true, DATABASE_URL: true,
  DASHBOARD_URL: true, DASHBOARD_PORT: true, DASHBOARD_POOL_MAX: true, DISCORD_CLIENT_SECRET: true,
  STATS_BUFFER_PATH: true, STATS_BUFFER_MAX_MIB: true,
}).superRefine((data, context) => {
  checkDashboardOrigin(data, context);
  if (data.DASHBOARD_URL && !data.DISCORD_CLIENT_SECRET) {
    context.addIssue({ code: 'custom', path: ['DISCORD_CLIENT_SECRET'], message: 'Required for dashboard' });
  }
});

const migrationEnvSchema = z.object({
  LOG_LEVEL: logLevel,
  PICKET_VERSION: version,
  DATABASE_MIGRATOR_URL: postgresUrl,
  DATABASE_APP_ROLE: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/).default('picket_app'),
});

export interface AppConfig {
  readonly timeZone: string;
  readonly statsAdminRefreshCron: string;
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
  /** Delay between guild deactivation and permanent deletion of its data. */
  readonly guildRetentionDays: number;
  /** Total Gateway shard count; each shard has its own lease and a single active connection. */
  readonly shardCount: number;
  readonly warlog: { readonly apiUrl: string; readonly pollIntervalMs: number };
  readonly stats: {readonly bufferPath:string;readonly bufferMaxBytes:number};
  readonly dashboard: {readonly origin:string|null;readonly port:number;readonly poolMax:number;readonly clientSecret:Secret|null};
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

/** Validate the environment; error messages never include values. */
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
    timeZone: data.TZ,
    statsAdminRefreshCron: data.STATS_ADMIN_REFRESH_CRON,
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
    warlog: { apiUrl: data.WAR_API_URL, pollIntervalMs: data.WAR_LOG_POLL_INTERVAL * 1000 },
    stats:{bufferPath:data.STATS_BUFFER_PATH,bufferMaxBytes:data.STATS_BUFFER_MAX_MIB*1024*1024},
    dashboard:{origin:data.DASHBOARD_URL ? new URL(data.DASHBOARD_URL).origin : null,port:data.DASHBOARD_PORT,poolMax:data.DASHBOARD_POOL_MAX,clientSecret:data.DISCORD_CLIENT_SECRET ? new Secret(data.DISCORD_CLIENT_SECRET) : null},
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

/** Dedicated stats HTTP process: no Gateway role or interaction public key required. */
export interface DashboardConfig {
  readonly env: AppConfig['env'];
  readonly logLevel: AppConfig['logLevel'];
  readonly version: string;
  readonly healthPort: number;
  readonly shutdownDrainMs: number;
  readonly discord: Pick<AppConfig['discord'], 'applicationId' | 'botToken' | 'restGlobalRps'>;
  readonly database: AppConfig['database'];
  readonly stats: AppConfig['stats'];
  readonly dashboard: AppConfig['dashboard'];
}

export function loadDashboardConfig(env: Env, options: LoadConfigOptions = {}): DashboardConfig {
  const data = parseEnv(dashboardEnvSchema, env, options);
  return {
    env: data.NODE_ENV,
    logLevel: data.LOG_LEVEL, version: data.PICKET_VERSION, healthPort: data.HEALTH_PORT,
    shutdownDrainMs: data.SHUTDOWN_DRAIN_MS,
    discord: { applicationId: ApplicationId.assert(data.DISCORD_APPLICATION_ID), botToken: new Secret(data.DISCORD_BOT_TOKEN), restGlobalRps: Math.min(data.DISCORD_REST_GLOBAL_RPS, 5) },
    database: { url: new Secret(data.DATABASE_URL), poolMax: data.DASHBOARD_POOL_MAX },
    stats: { bufferPath: data.STATS_BUFFER_PATH, bufferMaxBytes: data.STATS_BUFFER_MAX_MIB * 1024 * 1024 },
    dashboard: { origin: data.DASHBOARD_URL ? new URL(data.DASHBOARD_URL).origin : null, port: data.DASHBOARD_PORT, poolMax: data.DASHBOARD_POOL_MAX, clientSecret: data.DISCORD_CLIENT_SECRET ? new Secret(data.DISCORD_CLIENT_SECRET) : null },
  };
}
