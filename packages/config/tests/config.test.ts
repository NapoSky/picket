import { ConfigError, loadConfig, loadMigrationConfig, loggingConfig, type Env } from '@picket/config';

const valid: Env = {
  DISCORD_APPLICATION_ID: '123456789012345678',
  DISCORD_PUBLIC_KEY: 'a'.repeat(64),
  DISCORD_BOT_TOKEN: 'bot-token-value',
  DATABASE_URL: 'postgres://picket:pw-secret@db:5432/picket',
};

describe('loadConfig', () => {
  it('applies documented defaults', () => {
    const config = loadConfig(valid);
    expect(config.env).toBe('production');
    expect(config.http).toEqual({ port: 8080, healthPort: 8081 });
    expect(config.roles).toEqual(['http-ingress']);
    expect(config.shutdownDrainMs).toBe(10_000);
    expect(config.database.poolMax).toBe(10);
    expect(config.guildRetentionDays).toBe(30);
    expect(config.shardCount).toBe(1);
    expect(config.discord.restGlobalRps).toBe(20);
    expect(config.version).toBe('unknown');
  });

  it('accepts an immutable image reference and preserves it for bootstrap and migration logs', () => {
    const image = 'ghcr.io/example/picket@sha256:' + 'a'.repeat(64);
    expect(loadConfig({ ...valid, PICKET_VERSION: image }).version).toBe(image);
    expect(loadMigrationConfig({ DATABASE_MIGRATOR_URL: valid.DATABASE_URL, PICKET_VERSION: image }).version).toBe(image);
    expect(loggingConfig({ PICKET_VERSION: image, LOG_LEVEL: 'bad' })).toEqual({ level: 'info', version: image });
    expect(loggingConfig({ PICKET_VERSION: 'bad\nvalue' }).version).toBe('unknown');
  });

  it('bounds the REST budget and PostgreSQL pool independently', () => {
    const config = loadConfig({ ...valid, DISCORD_REST_GLOBAL_RPS: '10', DATABASE_POOL_MAX: '5' });
    expect(config.discord.restGlobalRps).toBe(10);
    expect(config.database.poolMax).toBe(5);
    for (const value of ['0', '-1', '41', 'abc', '1.5']) {
      expect(() => loadConfig({ ...valid, DISCORD_REST_GLOBAL_RPS: value })).toThrow(ConfigError);
    }
    for (const value of ['0', '101', 'abc', '1.5']) {
      expect(() => loadConfig({ ...valid, DATABASE_POOL_MAX: value })).toThrow(ConfigError);
    }
  });

  it('bounds the shard count', () => {
    expect(loadConfig({ ...valid, SHARD_COUNT: '4' }).shardCount).toBe(4);
    for (const value of ['0', '-1', '257', 'x']) {
      expect(() => loadConfig({ ...valid, SHARD_COUNT: value })).toThrow(ConfigError);
    }
  });

  it('bounds the guild retention period', () => {
    expect(loadConfig({ ...valid, GUILD_RETENTION_DAYS: '90' }).guildRetentionDays).toBe(90);
    for (const value of ['0', '-1', '366', 'abc', '1.5']) {
      expect(() => loadConfig({ ...valid, GUILD_RETENTION_DAYS: value })).toThrow(ConfigError);
    }
  });

  it('parses roles and rejects unknown ones', () => {
    expect(loadConfig({ ...valid, ROLES: 'shard-runner, warlog-poller' }).roles).toEqual([
      'shard-runner',
      'warlog-poller',
    ]);
    expect(() => loadConfig({ ...valid, ROLES: 'http-ingress,nope' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...valid, ROLES: ' , ' })).toThrow(ConfigError);
  });

  it('reads secrets from *_FILE and trims the trailing newline', () => {
    const { DISCORD_BOT_TOKEN: _omit, ...rest } = valid;
    const config = loadConfig(
      { ...rest, DISCORD_BOT_TOKEN_FILE: '/run/secrets/token' },
      { readFile: () => 'from-file\n' },
    );
    expect(config.discord.botToken.reveal()).toBe('from-file');
  });

  it('refuses a variable and its _FILE counterpart together', () => {
    expect(() => loadConfig({ ...valid, DISCORD_BOT_TOKEN_FILE: '/x' }, { readFile: () => 'y' })).toThrow(
      /mutually exclusive/,
    );
  });

  it('reports an unreadable secret file without leaking content', () => {
    const { DATABASE_URL: _omit, ...rest } = valid;
    expect(() =>
      loadConfig({ ...rest, DATABASE_URL_FILE: '/missing' }, {
        readFile: () => {
          throw new Error('ENOENT');
        },
      }),
    ).toThrow(ConfigError);
  });

  it('rejects invalid values and never echoes them', () => {
    const attempt = () =>
      loadConfig({ ...valid, DATABASE_URL: 'mysql://user:topsecret@host/db', DISCORD_PUBLIC_KEY: 'short' });
    expect(attempt).toThrow(ConfigError);
    try {
      attempt();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('DISCORD_PUBLIC_KEY');
      expect(message).not.toContain('topsecret');
    }
  });

  it('wraps sensitive values in Secret', () => {
    const config = loadConfig(valid);
    expect(JSON.stringify(config)).not.toContain('pw-secret');
    expect(JSON.stringify(config)).not.toContain('bot-token-value');
    expect(config.database.url.reveal()).toBe(valid['DATABASE_URL']);
  });
});

describe('loadMigrationConfig', () => {
  const env = { DATABASE_MIGRATOR_URL: 'postgres://migrator:pw@db:5432/picket' };

  it('needs only the migrator connection and defaults the application role', () => {
    const config = loadMigrationConfig(env);
    expect(config.appRole).toBe('picket_app');
    expect(config.migratorUrl.reveal()).toBe(env.DATABASE_MIGRATOR_URL);
  });

  it('reads the migrator url from a file', () => {
    const config = loadMigrationConfig({ DATABASE_MIGRATOR_URL_FILE: '/run/secrets/m' }, { readFile: () => `${env.DATABASE_MIGRATOR_URL}\n` });
    expect(config.migratorUrl.reveal()).toBe(env.DATABASE_MIGRATOR_URL);
  });

  it('rejects an unsafe application role name', () => {
    expect(() => loadMigrationConfig({ ...env, DATABASE_APP_ROLE: 'x"; DROP TABLE y;--' })).toThrow(ConfigError);
  });
});
