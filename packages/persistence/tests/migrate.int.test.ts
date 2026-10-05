import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS_DIR, MigrationError, migrate } from '@picket/persistence';
import { APP_ROLE, createTestDatabase, queryAsAdmin, type TestDatabase } from '@picket/testing';

describe('migrate (integration)', () => {
  let database: TestDatabase;
  let directory: string;

  beforeEach(async () => {
    database = await createTestDatabase({ migrate: false });
    directory = await mkdtemp(join(tmpdir(), 'picket-migrations-'));
  });

  afterEach(async () => {
    await database.drop();
    await rm(directory, { recursive: true, force: true });
  });

  const run = (dir = MIGRATIONS_DIR) =>
    migrate({ connectionString: database.migratorUrl, migrationsDir: dir, appRole: APP_ROLE });

  it('applies every migration once and is a no-op afterwards', async () => {
    const first = await run();
    expect(first.applied).toEqual([
      '001_init',
      '002_permissions',
      '003_guild_lifecycle',
      '004_coordination',
      '005_guild_locale_auto',
    ]);

    const second = await run();
    expect(second).toEqual({ applied: [], alreadyApplied: 5 });
  });

  it('serialises concurrent runs with the advisory lock', async () => {
    const results = await Promise.all([run(), run(), run()]);
    const applied = results.flatMap((result) => [...result.applied]);
    expect(applied).toEqual([
      '001_init',
      '002_permissions',
      '003_guild_lifecycle',
      '004_coordination',
      '005_guild_locale_auto',
    ]);
  });

  it('refuses a migration modified after being applied', async () => {
    await writeFile(join(directory, '001_a.sql'), 'CREATE TABLE a (id int);');
    await run(directory);
    await writeFile(join(directory, '001_a.sql'), 'CREATE TABLE a (id int, extra int);');
    await expect(run(directory)).rejects.toThrow(/modified after being applied/);
  });

  it('rolls back a failing migration entirely and does not record it', async () => {
    await writeFile(join(directory, '001_ok.sql'), 'CREATE TABLE ok (id int);');
    await writeFile(join(directory, '002_bad.sql'), 'CREATE TABLE half_done (id int); SELECT 1/0;');

    await expect(run(directory)).rejects.toBeInstanceOf(MigrationError);

    const tables = await queryAsAdmin<{ table_name: string }>(
      database,
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    expect(tables.map((row) => row.table_name)).toEqual(expect.arrayContaining(['ok', 'schema_migrations']));
    expect(tables.map((row) => row.table_name)).not.toContain('half_done');

    const recorded = await queryAsAdmin<{ version: string }>(database, 'SELECT version FROM schema_migrations');
    expect(recorded.map((row) => row.version)).toEqual(['001_ok']);
  });

  it('ignores files that do not follow the naming convention', async () => {
    await writeFile(join(directory, '001_ok.sql'), 'SELECT 1;');
    await writeFile(join(directory, 'notes.sql'), 'DROP DATABASE postgres;');
    await writeFile(join(directory, '1_short.sql'), 'DROP DATABASE postgres;');
    expect((await run(directory)).applied).toEqual(['001_ok']);
  });

  it.each(['Robert"; DROP TABLE x;--', 'UPPER', '1abc', '', 'a'.repeat(64)])(
    'rejects the unsafe role name %p',
    async (appRole) => {
      await expect(
        migrate({ connectionString: database.migratorUrl, migrationsDir: directory, appRole }),
      ).rejects.toBeInstanceOf(MigrationError);
    },
  );
});
