import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { createTestDatabase, queryAsAdmin, ADMIN_URL_ENV, APP_ROLE, APP_PASSWORD, MIGRATOR_ROLE, MIGRATOR_PASSWORD, type TestDatabase } from '@picket/testing';

// Build the actual production backup image; no fake encoder or export implementation.
describe('encrypted backup image (PostgreSQL 18)', () => {
  let source: TestDatabase;
  let destination: TestDatabase;
  let backup: StartedTestContainer;
  let postgres: StartedPostgreSqlContainer;
  let previousAdminUrl: string | undefined;
  let identity: string;
  let archive: string;

  beforeAll(async () => {
    // Dedicated cluster: dumping shared catalogs must not block concurrent DROP DATABASE
    // in other integration suites.
    postgres = await new PostgreSqlContainer('postgres:18-alpine').withUsername('postgres')
      .withPassword('postgres').withDatabase('postgres').start();
    previousAdminUrl = process.env[ADMIN_URL_ENV];
    process.env[ADMIN_URL_ENV] = postgres.getConnectionUri();
    const admin = new Client({ connectionString: postgres.getConnectionUri() });
    await admin.connect();
    try {
      await admin.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS`);
      await admin.query(`CREATE ROLE ${MIGRATOR_ROLE} LOGIN PASSWORD '${MIGRATOR_PASSWORD}' NOSUPERUSER NOBYPASSRLS CREATEDB`);
    } finally { await admin.end(); }
    source = await createTestDatabase();
    destination = await createTestDatabase({ migrate: false });
    const image = await GenericContainer.fromDockerfile(resolve('deploy/backup'))
      .withBuildkit().withCache(true).build('picket-backup-test:' + randomBytes(4).toString('hex'));
    backup = await image.withNetworkMode('container:' + postgres.getId())
      .withEnvironment({
        PGHOST: '127.0.0.1', PGDATABASE: new URL(source.adminUrl.reveal()).pathname.slice(1),
        BACKUP_DIR: '/tmp/backups', BACKUP_RECIPIENTS_FILE: '/tmp/recipients', POSTGRES_PASSWORD_FILE: '/tmp/pg-password',
      })
      .withCopyContentToContainer([{ content: 'postgres', target: '/tmp/pg-password' }])
      .withEntrypoint(['/bin/sh']).withCommand(['-c', 'echo ready; sleep 300'])
      .withWaitStrategy(Wait.forLogMessage('ready')).start();
    // Generate an ephemeral test identity, then remove it before taking the backup.
    // Production init generates both keys; the operator moves the private identity
    // to a vault before normal operation. The backup service receives only public keys.
    const keys = await backup.exec(['sh', '-c', 'age-keygen -o /tmp/identity 2>/dev/null && age-keygen -y /tmp/identity > /tmp/recipients && cat /tmp/identity && rm /tmp/identity']);
    expect(keys.exitCode).toBe(0);
    identity = keys.stdout;
  }, 120_000);

  afterAll(async () => {
    await backup?.stop();
    await destination?.drop();
    await source?.drop();
    await postgres?.stop();
    if (previousAdminUrl !== undefined) process.env[ADMIN_URL_ENV] = previousAdminUrl;
    else delete process.env[ADMIN_URL_ENV];
  });

  it('restores a consistent snapshot under concurrent writes, including both servers and database protections', async () => {
    await queryAsAdmin(source, "INSERT INTO guild_settings (guild_id, locale) VALUES ('700000000000000001','fr'), ('700000000000000002','de')");
    await queryAsAdmin(source, 'CREATE TABLE aaa_snapshot (v int); CREATE TABLE zzz_snapshot (v int); INSERT INTO aaa_snapshot VALUES (0); INSERT INTO zzz_snapshot VALUES (0)');
    let writing = true;
    const writer = (async () => { while (writing) {
      await queryAsAdmin(source, 'BEGIN; UPDATE aaa_snapshot SET v = v + 1; UPDATE zzz_snapshot SET v = v + 1; COMMIT;');
    } })();
    try {
      const dump = await backup.exec(['./run.sh', 'pre-migration']);
      if (dump.exitCode !== 0) throw new Error(dump.output);
    } finally { writing = false; await writer; }
    const files = await backup.exec(['sh', '-c', 'ls /tmp/backups/picket-*/picket.dump.age']);
    expect(files.exitCode).toBe(0);
    archive = files.stdout.trim();
    expect((await backup.exec(['test', '!', '-f', '/tmp/identity'])).exitCode).toBe(0);
    expect((await backup.exec(['head', '-c', '22', archive])).stdout).toBe('age-encryption.org/v1\n');
    expect((await backup.exec(['sh', '-c', 'cd "$(dirname "$1")" && sha256sum --check picket.dump.age.sha256', 'sh', archive])).exitCode).toBe(0);
    // Only the restoring environment receives the private identity.
    await backup.copyContentToContainer([{ content: identity, target: '/tmp/restore-identity' }]);
    const restoredName = new URL(destination.adminUrl.reveal()).pathname.slice(1);
    const restore = await backup.exec(['bash', '-c', 'set -o pipefail; export PGPASSWORD="$(cat /tmp/pg-password)"; age --decrypt -i /tmp/restore-identity "$1" | pg_restore --exit-on-error --username=postgres --dbname="$2"', 'bash', archive, restoredName]);
    if (restore.exitCode !== 0) throw new Error(restore.output);
    await backup.exec(['rm', '/tmp/restore-identity']);
    expect(await queryAsAdmin(destination, 'SELECT v FROM aaa_snapshot')).toEqual(await queryAsAdmin(destination, 'SELECT v FROM zzz_snapshot'));
    expect(await queryAsAdmin(destination, 'SELECT guild_id, locale FROM guild_settings ORDER BY guild_id')).toEqual([
      { guild_id: '700000000000000001', locale: 'fr' }, { guild_id: '700000000000000002', locale: 'de' },
    ]);
    expect(await queryAsAdmin(destination, "SELECT relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname='guild_settings'")).toEqual(await queryAsAdmin(source, "SELECT relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname='guild_settings'"));
    expect(await queryAsAdmin(destination, "SELECT count(*)::int AS count FROM pg_policies WHERE schemaname='public'")).toEqual(await queryAsAdmin(source, "SELECT count(*)::int AS count FROM pg_policies WHERE schemaname='public'"));
    expect(await queryAsAdmin(destination, "SELECT count(*)::int AS count FROM pg_proc WHERE proname='purge_guild'")).toEqual([{ count: 1 }]);
    expect(await queryAsAdmin(destination, "SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name='guild_audit_log' ORDER BY grantee, privilege_type")).toEqual(await queryAsAdmin(source, "SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name='guild_audit_log' ORDER BY grantee, privilege_type"));
    expect(await destination.handle.db.selectFrom('guild_settings').selectAll().execute()).toEqual([]);
    const { GuildId } = await import('@picket/kernel');
    const { withTenant } = await import('@picket/persistence');
    expect(await withTenant(destination.handle.db, GuildId.assert('700000000000000001'), (trx) => trx.selectFrom('guild_settings').select('locale').execute())).toEqual([{ locale: 'fr' }]);
  });

  it('detects a corrupted encrypted archive without requiring the private identity', async () => {
    const check = await backup.exec(['sh', '-c', 'printf corruption >> "$1"; cd "$(dirname "$1")"; sha256sum --check picket.dump.age.sha256', 'sh', archive]);
    expect(check.exitCode).not.toBe(0);
  });

  it('rejects an application-role dump instead of silently omitting servers protected by RLS', async () => {
    const dump = await backup.exec(['env', 'PGPASSWORD=picket_app_test', 'pg_dump', '--username=picket_app', '--table=guild_settings']);
    expect(dump.exitCode).not.toBe(0);
    expect(dump.output).toContain('row-level security');
  });
});
