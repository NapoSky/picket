import { GuildId, UserId } from '@picket/kernel';
import { PostgresGuildLifecycleRepository, PostgresPermissionRepository } from '@picket/guild';
import { createTestDatabase, queryAsAdmin, type TestDatabase } from '@picket/testing';

const GUILD_A = GuildId.assert('700000000000000031');
const GUILD_B = GuildId.assert('700000000000000032');
const ACTOR = UserId.assert('500000000000000001');
const T0 = new Date('2026-10-05T12:00:00Z');

describe('PostgresGuildLifecycleRepository (integration)', () => {
  let database: TestDatabase;
  let lifecycle: PostgresGuildLifecycleRepository;
  let permissions: PostgresPermissionRepository;

  beforeAll(async () => {
    database = await createTestDatabase();
    lifecycle = new PostgresGuildLifecycleRepository(database.handle.db);
    permissions = new PostgresPermissionRepository(database.handle.db);
  });

  afterAll(async () => {
    await database.drop();
  });

  beforeEach(async () => {
    await queryAsAdmin(database, 'TRUNCATE guild_registry, guild_settings, guild_permission_roles, guild_audit_log');
  });

  const audit = (guildId: GuildId) =>
    queryAsAdmin<{ actor_id: string; action: string; before: unknown; after: unknown }>(
      database,
      'SELECT actor_id, action, before, after FROM guild_audit_log WHERE guild_id = $1 ORDER BY id',
      [guildId],
    );

  it('treats an unknown or active guild as not inactive', async () => {
    expect(await lifecycle.inactiveSince(GUILD_A)).toBeNull();
    await permissions.load(GUILD_A);
    expect(await lifecycle.inactiveSince(GUILD_A)).toBeNull();
  });

  it('marks a guild inactive once, audits it, and keeps the original date afterwards', async () => {
    expect(await lifecycle.markInactive(GUILD_A, ACTOR, 'guild.deletion_requested', T0, 'requested')).toEqual({
      changed: true,
      inactiveSince: T0,
    });
    const later = new Date(T0.getTime() + 86_400_000);
    expect(await lifecycle.markInactive(GUILD_A, 'system', 'guild.left', later, 'left')).toEqual({
      changed: false,
      inactiveSince: T0,
    });

    expect(await lifecycle.inactiveSince(GUILD_A)).toEqual(T0);
    expect(await audit(GUILD_A)).toEqual([
      {
        actor_id: ACTOR,
        action: 'guild.deletion_requested',
        before: { inactive_since: null, inactive_reason: null },
        after: { inactive_since: T0.toISOString(), inactive_reason: 'requested' },
      },
    ]);
  });

  it('records the date of the first of several concurrent requests, with a single audit entry', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_v, i) =>
        lifecycle.markInactive(GUILD_A, ACTOR, 'guild.deletion_requested', new Date(T0.getTime() + i * 1000), 'requested'),
      ),
    );
    expect(results.filter((result) => result.changed)).toHaveLength(1);
    expect(new Set(results.map((result) => result.inactiveSince.getTime())).size).toBe(1);
    expect(await audit(GUILD_A)).toHaveLength(1);
  });

  it('reactivates a suspended guild with an audit entry, and is a no-op otherwise', async () => {
    expect(await lifecycle.reactivate(GUILD_A, ACTOR, 'guild.deletion_cancelled')).toBe(false);
    await lifecycle.markInactive(GUILD_A, ACTOR, 'guild.deletion_requested', T0, 'requested');

    expect(await lifecycle.reactivate(GUILD_A, ACTOR, 'guild.deletion_cancelled')).toBe(true);
    expect(await lifecycle.reactivate(GUILD_A, ACTOR, 'guild.deletion_cancelled')).toBe(false);
    expect(await lifecycle.inactiveSince(GUILD_A)).toBeNull();
    expect((await audit(GUILD_A)).map((entry) => entry.action)).toEqual([
      'guild.deletion_requested',
      'guild.deletion_cancelled',
    ]);
  });

  it('lists only guilds inactive since the cutoff, oldest first, within the limit', async () => {
    const day = (n: number) => new Date(T0.getTime() + n * 86_400_000);
    const guilds = [1, 2, 3].map((n) => GuildId.assert(`70000000000000004${n}`));
    await lifecycle.markInactive(guilds[2] as GuildId, 'system', 'a', day(3), 'left');
    await lifecycle.markInactive(guilds[0] as GuildId, 'system', 'a', day(1), 'requested');
    await lifecycle.markInactive(guilds[1] as GuildId, 'system', 'a', day(2), 'requested');
    await permissions.load(GUILD_B);

    expect(await lifecycle.findPurgeable(day(2), 10)).toEqual([guilds[0], guilds[1]]);
    expect(await lifecycle.findPurgeable(day(3), 2)).toEqual([guilds[0], guilds[1]]);
    expect(await lifecycle.findPurgeable(day(0), 10)).toEqual([]);
  });

  describe('departure and return (Gateway events)', () => {
    it('initialises a guild idempotently, with its default permissions', async () => {
      await Promise.all([lifecycle.initialize(GUILD_A), lifecycle.initialize(GUILD_A), lifecycle.initialize(GUILD_A)]);
      expect(await queryAsAdmin(database, 'SELECT 1 FROM guild_settings WHERE guild_id = $1', [GUILD_A])).toHaveLength(1);
      expect(await lifecycle.listActive()).toEqual([GUILD_A]);
    });

    it('ignores the departure of a guild it never knew, creating nothing', async () => {
      const result = await lifecycle.markInactive(GUILD_B, 'system', 'guild.left', T0, 'left');
      expect(result.changed).toBe(false);
      expect(await queryAsAdmin(database, 'SELECT 1 FROM guild_registry')).toEqual([]);
      expect(await queryAsAdmin(database, 'SELECT 1 FROM guild_settings')).toEqual([]);
    });

    it('records a departure with its reason, and lists the guild as no longer active', async () => {
      await lifecycle.initialize(GUILD_A);
      await lifecycle.initialize(GUILD_B);
      expect((await lifecycle.markInactive(GUILD_A, 'system', 'guild.left', T0, 'left')).changed).toBe(true);

      expect(await lifecycle.listActive()).toEqual([GUILD_B]);
      expect(await queryAsAdmin(database, 'SELECT inactive_reason FROM guild_registry WHERE guild_id = $1', [GUILD_A])).toEqual([
        { inactive_reason: 'left' },
      ]);
    });

    it('only reactivates a departure when the bot comes back, never a deletion requested by an administrator', async () => {
      await lifecycle.markInactive(GUILD_A, ACTOR, 'guild.deletion_requested', T0, 'requested');
      expect(await lifecycle.reactivate(GUILD_A, 'system', 'guild.rejoined', 'left')).toBe(false);
      expect(await lifecycle.inactiveSince(GUILD_A)).toEqual(T0);

      await lifecycle.initialize(GUILD_B);
      await lifecycle.markInactive(GUILD_B, 'system', 'guild.left', T0, 'left');
      expect(await lifecycle.reactivate(GUILD_B, 'system', 'guild.rejoined', 'left')).toBe(true);
      expect(await lifecycle.inactiveSince(GUILD_B)).toBeNull();
    });

    it('keeps the database consistent: a reason always accompanies a date', async () => {
      await lifecycle.initialize(GUILD_A);
      await expect(
        queryAsAdmin(database, "UPDATE guild_registry SET inactive_since = now() WHERE guild_id = $1", [GUILD_A]),
      ).rejects.toThrow(/guild_registry_inactive_consistent/);
    });
  });

  describe('purge', () => {
    it('erases every table holding the guild data and leaves other guilds untouched', async () => {
      for (const guildId of [GUILD_A, GUILD_B]) {
        await permissions.modify(guildId, ACTOR, 'permissions.add', (current) => ({
          kind: 'apply',
          next: { ...current, officer: [...current.officer, '400000000000000099' as never] },
        }));
        await queryAsAdmin(database, 'INSERT INTO interaction_receipts (interaction_id, guild_id) VALUES ($1, $2)', [
          `93${guildId}`,
          guildId,
        ]);
      }
      await lifecycle.markInactive(GUILD_A, ACTOR, 'guild.deletion_requested', T0, 'requested');

      await lifecycle.purge(GUILD_A);

      for (const table of ['guild_settings', 'guild_permission_roles', 'guild_audit_log', 'guild_registry', 'interaction_receipts']) {
        expect(await queryAsAdmin(database, `SELECT 1 FROM ${table} WHERE guild_id = $1`, [GUILD_A])).toEqual([]);
        expect((await queryAsAdmin(database, `SELECT 1 FROM ${table} WHERE guild_id = $1`, [GUILD_B])).length).toBeGreaterThan(0);
      }
    });

    it('is idempotent', async () => {
      await lifecycle.markInactive(GUILD_A, ACTOR, 'guild.deletion_requested', T0, 'requested');
      await lifecycle.purge(GUILD_A);
      await expect(lifecycle.purge(GUILD_A)).resolves.toBeUndefined();
    });

    it('does not leave a tenant context behind on the connection that ran it', async () => {
      await permissions.load(GUILD_B);
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await lifecycle.purge(GUILD_A);
        expect(await database.handle.db.selectFrom('guild_permission_roles').selectAll().execute()).toEqual([]);
      }
    });

    it('is the only way for the application role to delete audit history', async () => {
      await permissions.modify(GUILD_A, ACTOR, 'permissions.add', (current) => ({ kind: 'apply', next: current }));
      await expect(
        database.handle.db.deleteFrom('guild_audit_log').where('guild_id', '=', GUILD_A).execute(),
      ).rejects.toThrow(/permission denied/);
      await lifecycle.purge(GUILD_A);
      expect(await audit(GUILD_A)).toEqual([]);
    });
  });
});
