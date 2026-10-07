import { GuildId, RoleId, UserId } from '@picket/kernel';
import { withTenant } from '@picket/persistence';
import {
  HandleRoleDeleted,
  PostgresGuildSettingsRepository,
  PostgresPermissionRepository,
  ResolveAccess,
  ShowPermissions,
  UpdatePermissions,
  everyoneRoleId,
  type PermissionChangeRequest,
} from '@picket/guild';
import { createTestDatabase, queryAsAdmin, type TestDatabase } from '@picket/testing';

const GUILD_A = GuildId.assert('700000000000000021');
const GUILD_B = GuildId.assert('700000000000000022');
const ACTOR = UserId.assert('500000000000000001');
const role = (n: number) => RoleId.assert(`4000000000000001${String(10 + n)}`);
const [r1, r2, r3] = [role(1), role(2), role(3)] as const;

describe('PostgresPermissionRepository (integration)', () => {
  let database: TestDatabase;
  let repository: PostgresPermissionRepository;
  let update: UpdatePermissions;

  beforeAll(async () => {
    database = await createTestDatabase();
    repository = new PostgresPermissionRepository(database.handle.db);
    update = new UpdatePermissions(repository);
  });

  afterAll(async () => {
    await database.drop();
  });

  beforeEach(async () => {
    await queryAsAdmin(database, 'TRUNCATE guild_audit_delivery, guild_audit_schedule, guild_permission_roles, guild_audit_log, guild_settings');
  });

  const change = (guildId: GuildId, request: Partial<PermissionChangeRequest> & Pick<PermissionChangeRequest, 'roleId'>) =>
    update.execute({ guildId, actorId: ACTOR, change: { level: 'officer', action: 'add', confirmed: false, ...request } });

  const audit = (guildId: GuildId) =>
    queryAsAdmin<{ actor_id: string; action: string; before: unknown; after: unknown }>(
      database,
      'SELECT actor_id, action, before, after FROM guild_audit_log WHERE guild_id = $1 ORDER BY id',
      [guildId],
    );

  it('seeds @everyone as member on first access, and only then', async () => {
    expect(await repository.load(GUILD_A)).toEqual({ officer: [], member: [everyoneRoleId(GUILD_A)] });

    await change(GUILD_A, { level: 'member', roleId: everyoneRoleId(GUILD_A), action: 'remove' });
    expect(await repository.load(GUILD_A)).toEqual({ officer: [], member: [] });
  });

  it('seeds the same way whether the first access is a settings read or a permission read', async () => {
    await new PostgresGuildSettingsRepository(database.handle.db).findOrCreate(GUILD_B);
    expect((await repository.load(GUILD_B)).member).toEqual([everyoneRoleId(GUILD_B)]);
  });

  it('seeds exactly once under concurrent first access', async () => {
    await Promise.all(Array.from({ length: 10 }, () => repository.load(GUILD_A)));
    const rows = await queryAsAdmin(database, 'SELECT 1 FROM guild_permission_roles WHERE guild_id = $1', [GUILD_A]);
    expect(rows).toHaveLength(1);
  });

  it('persists a change with a before/after audit entry', async () => {
    const decision = await change(GUILD_A, { roleId: r1 });
    expect(decision.kind).toBe('apply');

    expect(await repository.load(GUILD_A)).toEqual({ officer: [r1], member: [everyoneRoleId(GUILD_A)] });
    expect(await audit(GUILD_A)).toEqual([
      {
        actor_id: ACTOR,
        action: 'permissions.add',
        before: { officer: [], member: [GUILD_A] },
        after: { officer: [r1], member: [GUILD_A] },
      },
    ]);
  });

  it('is idempotent and does not audit a no-op', async () => {
    await change(GUILD_A, { roleId: r1 });
    expect((await change(GUILD_A, { roleId: r1 })).kind).toBe('unchanged');
    expect((await change(GUILD_A, { roleId: r2, action: 'remove' })).kind).toBe('unchanged');
    expect(await audit(GUILD_A)).toHaveLength(1);
  });

  it('XCT-EC-09: concurrent changes serialise; each audit entry chains to the previous state', async () => {
    const roles = Array.from({ length: 8 }, (_v, i) => role(10 + i));
    await Promise.all(roles.map((roleId) => change(GUILD_A, { roleId })));

    const config = await repository.load(GUILD_A);
    expect([...config.officer].sort()).toEqual([...roles].sort());

    const entries = await audit(GUILD_A);
    expect(entries).toHaveLength(roles.length);
    const sizes = entries.map((entry) => ((entry.after as { officer: string[] }).officer).length);
    expect(sizes).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    entries.forEach((entry, index) => {
      expect((entry.before as { officer: string[] }).officer).toHaveLength(index);
    });
  });

  it('removes a deleted role from both levels and audits it as the system', async () => {
    await change(GUILD_A, { level: 'officer', roleId: r1 });
    await change(GUILD_A, { level: 'member', roleId: r1 });

    expect(await new HandleRoleDeleted(repository).execute(GUILD_A, r1)).toBe(true);

    expect(await repository.load(GUILD_A)).toEqual({ officer: [], member: [everyoneRoleId(GUILD_A)] });
    expect((await audit(GUILD_A)).at(-1)).toMatchObject({ actor_id: 'system', action: 'permissions.role_deleted' });
    expect(await new HandleRoleDeleted(repository).execute(GUILD_A, r1)).toBe(false);
  });

  it('isolates guilds: the same role id in two guilds is independent', async () => {
    await change(GUILD_A, { roleId: r1 });
    expect((await repository.load(GUILD_B)).officer).toEqual([]);
    expect(await audit(GUILD_B)).toEqual([]);
  });

  it('resolves access levels end to end from the stored configuration', async () => {
    const resolve = new ResolveAccess(repository);
    await change(GUILD_A, { level: 'officer', roleId: r1 });
    await change(GUILD_A, { level: 'member', roleId: everyoneRoleId(GUILD_A), action: 'remove' });
    await change(GUILD_A, { level: 'member', roleId: r2 });

    const level = (roleIds: RoleId[], permissions: bigint | null) =>
      resolve.execute({ guildId: GUILD_A, roleIds, permissions });
    expect(await level([r1], 0n)).toBe('officer');
    expect(await level([r2], 0n)).toBe('member');
    expect(await level([r3], 0n)).toBeNull();
    expect(await level([], 8n)).toBe('admin');
    expect(await level([r1], null)).toBeNull();

    const overview = await new ShowPermissions(repository).execute({ guildId: GUILD_A, roleIds: [r2], permissions: 0n });
    expect(overview).toMatchObject({ yourLevel: 'member', warnings: [] });
  });

  describe('database-level guarantees', () => {
    it('the application role cannot rewrite or delete audit history', async () => {
      await change(GUILD_A, { roleId: r1 });
      const db = database.handle.db;
      await expect(
        withTenant(db, GUILD_A, (trx) => trx.updateTable('guild_audit_log').set({ action: 'forged' }).execute()),
      ).rejects.toThrow(/permission denied/);
      await expect(withTenant(db, GUILD_A, (trx) => trx.deleteFrom('guild_audit_log').execute())).rejects.toThrow(
        /permission denied/,
      );
      expect(await audit(GUILD_A)).toHaveLength(1);
    });

    it('the application role sees no permission rows without a tenant context', async () => {
      await change(GUILD_A, { roleId: r1 });
      expect(await database.handle.db.selectFrom('guild_permission_roles').selectAll().execute()).toEqual([]);
      expect(await database.handle.db.selectFrom('guild_audit_log').selectAll().execute()).toEqual([]);
    });

    it('rejects an unknown level at the table level', async () => {
      await repository.load(GUILD_A);
      await expect(
        queryAsAdmin(database, "INSERT INTO guild_permission_roles (guild_id, level, role_id) VALUES ($1, 'god', $2)", [GUILD_A, r1]),
      ).rejects.toThrow(/check constraint/);
    });
  });
});
