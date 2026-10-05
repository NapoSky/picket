import { GuildId } from '@picket/kernel';
import { createAppState, withTenant } from '@picket/persistence';
import { createTestDatabase, queryAsAdmin, type TestDatabase } from '@picket/testing';

const GUILD_A = GuildId.assert('700000000000000001');
const GUILD_B = GuildId.assert('700000000000000002');

describe('tenant isolation (RLS, integration)', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  beforeEach(async () => {
    await queryAsAdmin(database, 'TRUNCATE guild_settings');
  });

  const insert = (guildId: GuildId, locale = 'en') =>
    withTenant(database.handle.db, guildId, (trx) =>
      trx.insertInto('guild_settings').values({ guild_id: guildId, locale }).execute(),
    );

  it('shows each tenant only its own rows', async () => {
    await insert(GUILD_A, 'fr');
    await insert(GUILD_B, 'en');

    const seenByA = await withTenant(database.handle.db, GUILD_A, (trx) =>
      trx.selectFrom('guild_settings').select(['guild_id', 'locale']).execute(),
    );
    expect(seenByA).toEqual([{ guild_id: GUILD_A, locale: 'fr' }]);
  });

  it('is fail-closed without a tenant context', async () => {
    await insert(GUILD_A);
    const rows = await database.handle.db.selectFrom('guild_settings').selectAll().execute();
    expect(rows).toEqual([]);
  });

  it('refuses to write a row for another tenant', async () => {
    await expect(
      withTenant(database.handle.db, GUILD_A, (trx) =>
        trx.insertInto('guild_settings').values({ guild_id: GUILD_B }).execute(),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('cannot update or delete another tenant rows', async () => {
    await insert(GUILD_B, 'en');

    const updated = await withTenant(database.handle.db, GUILD_A, (trx) =>
      trx.updateTable('guild_settings').set({ locale: 'hacked' }).where('guild_id', '=', GUILD_B).executeTakeFirst(),
    );
    const deleted = await withTenant(database.handle.db, GUILD_A, (trx) =>
      trx.deleteFrom('guild_settings').where('guild_id', '=', GUILD_B).executeTakeFirst(),
    );

    expect(updated.numUpdatedRows).toBe(0n);
    expect(deleted.numDeletedRows).toBe(0n);
    const rows = await queryAsAdmin<{ locale: string }>(database, 'SELECT locale FROM guild_settings');
    expect(rows).toEqual([{ locale: 'en' }]);
  });

  it('does not leak the tenant context to later queries on pooled connections', async () => {
    await insert(GUILD_A);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await withTenant(database.handle.db, GUILD_A, (trx) => trx.selectFrom('guild_settings').selectAll().execute());
      const leaked = await database.handle.db.selectFrom('guild_settings').selectAll().execute();
      expect(leaked).toEqual([]);
    }
  });

  it('keeps tenants apart under concurrency', async () => {
    const guilds = Array.from({ length: 12 }, (_value, index) => GuildId.assert(`71000000000000${String(1000 + index)}`));
    const results = await Promise.all(
      guilds.map(async (guildId) => {
        await insert(guildId);
        return withTenant(database.handle.db, guildId, (trx) => trx.selectFrom('guild_settings').select('guild_id').execute());
      }),
    );
    results.forEach((rows, index) => expect(rows).toEqual([{ guild_id: guilds[index] }]));
  });

  it('applies the documented defaults to a new tenant', async () => {
    await insert(GUILD_A);
    const [row] = await withTenant(database.handle.db, GUILD_A, (trx) => trx.selectFrom('guild_settings').selectAll().execute());
    expect(row).toMatchObject({
      locale: 'en',
      timezone: 'UTC',
      audit_channel_id: null,
      features: { timers: true, todolists: true, warlog: false },
    });
  });
});

describe('schema conventions (integration)', () => {
  let database: TestDatabase;

  // Tables portant `guild_id` sans contenu de tenant : enumérées par des tâches système.
  const NOT_TENANT_CONTENT = ['guild_registry', 'interaction_receipts', 'timer_schedule'];

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  it('every table with a guild_id column enforces RLS (add a policy or list it as non-tenant)', async () => {
    const tables = await queryAsAdmin<{ table_name: string; rls: boolean; forced: boolean }>(
      database,
      `SELECT c.relname AS table_name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'guild_id' AND NOT a.attisdropped
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY c.relname`,
    );

    expect(tables.length).toBeGreaterThan(0);
    const unprotected = tables
      .filter((table) => !NOT_TENANT_CONTENT.includes(table.table_name))
      .filter((table) => !table.rls || !table.forced)
      .map((table) => table.table_name);
    expect(unprotected).toEqual([]);
  });

  it('the application role owns nothing and cannot bypass RLS', async () => {
    const [role] = await queryAsAdmin<{ rolsuper: boolean; rolbypassrls: boolean }>(
      database,
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'picket_app'",
    );
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });

    const owned = await queryAsAdmin(
      database,
      "SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = 'picket_app' AND c.relnamespace = 'public'::regnamespace",
    );
    expect(owned).toEqual([]);
  });
});

describe('app state (integration)', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  it('stores, overwrites and reads values', async () => {
    const state = createAppState(database.handle.db);
    expect(await state.get('k')).toBeNull();
    await state.set('k', 'v1');
    await state.set('k', 'v2');
    expect(await state.get('k')).toBe('v2');
  });
});
