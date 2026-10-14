import { ConfigError, loadConfig, loadDashboardConfig, loadMigrationConfig, loggingConfig, type Env } from '@picket/config';

const valid: Env = {
  DISCORD_APPLICATION_ID: '123456789012345678',
  DISCORD_PUBLIC_KEY: 'a'.repeat(64),
  DISCORD_BOT_TOKEN: 'bot-token-value',
  DATABASE_URL: 'postgres://picket:pw-secret@db:5432/picket',
};

describe('loadConfig', () => {
  it('disables support notifications when the channel is absent or empty', () => {
    expect(loadConfig(valid).supportGuildEventsChannelId).toBeNull();
    expect(loadConfig({ ...valid, SUPPORT_GUILD_EVENTS_CHANNEL_ID: '' }).supportGuildEventsChannelId).toBeNull();
  });

  it('accepts a support channel ID and rejects malformed values without echoing them', () => {
    expect(loadConfig({ ...valid, SUPPORT_GUILD_EVENTS_CHANNEL_ID: '600000000000000001' }).supportGuildEventsChannelId)
      .toBe('600000000000000001');
    for (const value of ['123', 'name', 'https://discord.com/channels/a/b', '600000000000000001\n']) {
      expect(() => loadConfig({ ...valid, SUPPORT_GUILD_EVENTS_CHANNEL_ID: value })).toThrow(ConfigError);
    }
  });
  it('allows the bot to publish a dashboard link without mounting OAuth credentials', () => {
    const config = loadConfig({ ...valid, DASHBOARD_URL: 'https://stats.example.org' });
    expect(config.dashboard.origin).toBe('https://stats.example.org');
    expect(config.dashboard.clientSecret).toBeNull();
  });
  it('accepts the main Compose empty dashboard and secret placeholder', () => {
    const config = loadConfig({ ...valid, DASHBOARD_URL: '', DISCORD_CLIENT_SECRET_FILE: '/run/secrets/oauth' }, { readFile: () => '' });
    expect(config.dashboard.origin).toBeNull();
    expect(config.dashboard.clientSecret).toBeNull();
  });

  it('requires the actual OAuth credential when the dashboard is enabled', () => {
    const env = { ...valid, DASHBOARD_URL: 'https://stats.example.org', DISCORD_CLIENT_SECRET_FILE: '/run/secrets/oauth' };
    expect(() => loadDashboardConfig(env, { readFile: () => '' })).toThrow(/DISCORD_CLIENT_SECRET/);
    const config = loadDashboardConfig(env, { readFile: () => 'oauth-credential\n' });
    expect(config.dashboard.origin).toBe('https://stats.example.org');
    expect(config.dashboard.clientSecret?.reveal()).toBe('oauth-credential');
    expect(config.discord.applicationId).toBe(valid.DISCORD_APPLICATION_ID);
    expect(JSON.stringify(config)).not.toContain('oauth-credential');
    expect(() => loadDashboardConfig({ ...env, DISCORD_CLIENT_SECRET: 'duplicate' }, { readFile: () => 'oauth-credential' })).toThrow(/mutually exclusive/);
  });

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
    expect(config.warlog).toEqual({ apiUrl: 'https://war-service-live.foxholeservices.com', pollIntervalMs: 15_000 });
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

describe('dedicated dashboard configuration', () => {
  it('needs no interaction public key or Gateway roles and uses only the dashboard pool budget', () => {
    const { DISCORD_PUBLIC_KEY: _unused, ...env } = valid;
    const config = loadDashboardConfig({ ...env, DASHBOARD_URL: 'https://stats.example.org', DISCORD_CLIENT_SECRET: 'oauth-secret', DATABASE_POOL_MAX: '40', DASHBOARD_POOL_MAX: '2', ROLES: 'unused-by-http' });
    expect(config.database.poolMax).toBe(2);
    expect(config.discord.restGlobalRps).toBe(5);
    expect(config.dashboard.origin).toBe('https://stats.example.org');
  });
  it('keeps the HTTP service disabled with an empty host and OAuth placeholder', () => {
    const config = loadDashboardConfig({ ...valid, DASHBOARD_URL: '', DISCORD_CLIENT_SECRET: '' });
    expect(config.dashboard.origin).toBeNull();
    expect(config.dashboard.clientSecret).toBeNull();
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
