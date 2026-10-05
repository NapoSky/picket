import { ChannelId, GuildId, UserId } from '@picket/kernel';
import { PostgresGuildSettingsRepository, UpdateGuildSettings, type SettingsChange } from '@picket/guild';
import { createTestDatabase, queryAsAdmin, type TestDatabase } from '@picket/testing';

describe('PostgresGuildSettingsRepository (integration)', () => {
  let database: TestDatabase;
  let repository: PostgresGuildSettingsRepository;

  beforeAll(async () => {
    database = await createTestDatabase();
    repository = new PostgresGuildSettingsRepository(database.handle.db);
  });

  afterAll(async () => {
    await database.drop();
  });

  it('creates default settings on first access', async () => {
    const guildId = GuildId.assert('700000000000000011');
    const settings = await repository.findOrCreate(guildId);

    expect(settings).toMatchObject({
      guildId,
      locale: null,
      timezone: 'UTC',
      auditChannelId: null,
      features: { timers: true, todolists: true, warlog: false },
    });
    expect(settings.installedAt).toBeInstanceOf(Date);
  });

  it('is idempotent and safe under concurrency', async () => {
    const guildId = GuildId.assert('700000000000000012');
    const results = await Promise.all(Array.from({ length: 10 }, () => repository.findOrCreate(guildId)));

    const rows = await queryAsAdmin(database, 'SELECT 1 FROM guild_settings WHERE guild_id = $1', [guildId]);
    expect(rows).toHaveLength(1);
    expect(new Set(results.map((settings) => settings.installedAt.getTime())).size).toBe(1);
  });

  it('keeps existing customisations untouched', async () => {
    const guildId = GuildId.assert('700000000000000013');
    await repository.findOrCreate(guildId);
    await queryAsAdmin(
      database,
      `UPDATE guild_settings SET locale = 'fr', audit_channel_id = '600000000000000001',
         features = '{"timers": false, "todolists": true, "warlog": true, "unknown": true}' WHERE guild_id = $1`,
      [guildId],
    );

    const settings = await repository.findOrCreate(guildId);

    expect(settings).toMatchObject({
      locale: 'fr',
      auditChannelId: '600000000000000001',
      features: { timers: false, todolists: true, warlog: true },
    });
    expect(Object.keys(settings.features)).toEqual(['timers', 'todolists', 'warlog']);
  });

  it('ignores a malformed audit channel id instead of failing the command', async () => {
    const guildId = GuildId.assert('700000000000000014');
    await repository.findOrCreate(guildId);
    await queryAsAdmin(database, "UPDATE guild_settings SET audit_channel_id = 'garbage' WHERE guild_id = $1", [guildId]);
    expect((await repository.findOrCreate(guildId)).auditChannelId).toBeNull();
  });

  describe('modify', () => {
    const actor = UserId.assert('500000000000000009');
    const apply = (guildId: GuildId, change: SettingsChange) =>
      new UpdateGuildSettings(repository, ['en', 'fr']).execute({ guildId, actorId: actor, change });
    const audit = (guildId: GuildId) =>
      queryAsAdmin<{ actor_id: string; action: string; before: Record<string, unknown>; after: Record<string, unknown> }>(
        database,
        "SELECT actor_id, action, before, after FROM guild_audit_log WHERE guild_id = $1 AND action LIKE 'settings.%' ORDER BY id",
        [guildId],
      );

    it('persists each setting and journals before and after', async () => {
      const guildId = GuildId.assert('700000000000000021');
      await apply(guildId, { kind: 'language', locale: 'fr' });
      await apply(guildId, { kind: 'timezone', timezone: 'europe/paris' });
      await apply(guildId, { kind: 'audit_channel', channelId: ChannelId.assert('600000000000000002') });
      await apply(guildId, { kind: 'feature', feature: 'warlog', enabled: true });

      expect(await repository.findOrCreate(guildId)).toMatchObject({
        locale: 'fr',
        timezone: 'Europe/Paris',
        auditChannelId: '600000000000000002',
        features: { timers: true, todolists: true, warlog: true },
      });
      const entries = await audit(guildId);
      expect(entries.map((entry) => entry.action)).toEqual([
        'settings.language',
        'settings.timezone',
        'settings.audit_channel',
        'settings.feature',
      ]);
      expect(entries[0]).toMatchObject({ actor_id: actor, before: { language: null }, after: { language: 'fr' } });
      expect(entries[3]?.after).toMatchObject({ features: { warlog: true } });
    });

    it('writes nothing, not even an audit entry, for an unchanged or rejected change', async () => {
      const guildId = GuildId.assert('700000000000000022');
      expect((await apply(guildId, { kind: 'timezone', timezone: 'UTC' })).kind).toBe('unchanged');
      expect((await apply(guildId, { kind: 'timezone', timezone: 'Nowhere/Land' })).kind).toBe('rejected');
      expect((await apply(guildId, { kind: 'language', locale: 'xx' })).kind).toBe('rejected');
      expect(await audit(guildId)).toHaveLength(0);
    });

    it('keeps unknown feature flags stored in the database', async () => {
      const guildId = GuildId.assert('700000000000000023');
      await repository.findOrCreate(guildId);
      await queryAsAdmin(database, `UPDATE guild_settings SET features = '{"timers": true, "future": true}' WHERE guild_id = $1`, [guildId]);
      await apply(guildId, { kind: 'feature', feature: 'todolists', enabled: true });
      const [row] = await queryAsAdmin<{ features: Record<string, boolean> }>(
        database,
        'SELECT features FROM guild_settings WHERE guild_id = $1',
        [guildId],
      );
      expect(row?.features).toMatchObject({ future: true, todolists: true });
    });

    it('serialises concurrent changes: every audit entry chains on the previous value', async () => {
      const guildId = GuildId.assert('700000000000000024');
      await Promise.all([
        apply(guildId, { kind: 'feature', feature: 'timers', enabled: false }),
        apply(guildId, { kind: 'feature', feature: 'todolists', enabled: false }),
        apply(guildId, { kind: 'feature', feature: 'warlog', enabled: true }),
      ]);
      expect((await repository.findOrCreate(guildId)).features).toEqual({ timers: false, todolists: false, warlog: true });
      const entries = await audit(guildId);
      expect(entries).toHaveLength(3);
      for (let index = 1; index < entries.length; index += 1) {
        expect(entries[index]?.before).toEqual(entries[index - 1]?.after);
      }
    });

    it('does not leak a language across guilds and creates nothing when reading it', async () => {
      const forced = GuildId.assert('700000000000000025');
      const other = GuildId.assert('700000000000000026');
      await apply(forced, { kind: 'language', locale: 'fr' });
      await repository.findOrCreate(other);

      expect(await repository.find(forced)).toBe('fr');
      expect(await repository.find(other)).toBeNull();

      const unknown = GuildId.assert('700000000000000027');
      expect(await repository.find(unknown)).toBeNull();
      expect(await queryAsAdmin(database, 'SELECT 1 FROM guild_settings WHERE guild_id = $1', [unknown])).toHaveLength(0);
    });
  });
});
