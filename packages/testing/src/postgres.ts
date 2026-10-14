import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { Secret } from '@picket/kernel';
import { createDatabase, migrate, type DatabaseHandle } from '@picket/persistence';
import { ADMIN_URL_ENV, APP_PASSWORD, APP_ROLE, MIGRATOR_PASSWORD, MIGRATOR_ROLE } from './constants';

export { ADMIN_URL_ENV, APP_PASSWORD, APP_ROLE, MIGRATOR_PASSWORD, MIGRATOR_ROLE };

export interface TestDatabase {
  readonly handle: DatabaseHandle;
  /** Superuser connection: bypasses RLS, reserved for test verification. */
  readonly adminUrl: Secret;
  /** Non-superuser table owner, matching the production migration role. */
  readonly migratorUrl: Secret;
  readonly appUrl: Secret;
  drop(): Promise<void>;
}

function adminUrl(): string {
  const url = process.env[ADMIN_URL_ENV];
  if (!url) throw new Error(`${ADMIN_URL_ENV} is not set: run integration tests through the integration Jest project`);
  return url;
}

function withDatabase(url: string, database: string, credentials?: { user: string; password: string }): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  if (credentials) {
    parsed.username = credentials.user;
    parsed.password = credentials.password;
  }
  return parsed.toString();
}

/** Migrated disposable database, accessed by a non-owner role (therefore subject to RLS). */
export async function createTestDatabase(options: { readonly migrate?: boolean } = {}): Promise<TestDatabase> {
  const name = `picket_test_${randomBytes(6).toString('hex')}`;
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name} OWNER ${MIGRATOR_ROLE}`);
  } finally {
    await admin.end();
  }

  const superuserUrl = new Secret(withDatabase(adminUrl(), name));
  const migratorUrl = new Secret(
    withDatabase(adminUrl(), name, { user: MIGRATOR_ROLE, password: MIGRATOR_PASSWORD }),
  );
  if (options.migrate !== false) await migrate({ connectionString: migratorUrl, appRole: APP_ROLE });

  const appUrl = new Secret(withDatabase(adminUrl(), name, { user: APP_ROLE, password: APP_PASSWORD }));
  const handle = createDatabase({ connectionString: appUrl, maxConnections: 4 });

  return {
    handle,
    adminUrl: superuserUrl,
    migratorUrl,
    appUrl,
    async drop() {
      await handle.close();
      const cleanup = new Client({ connectionString: adminUrl() });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

/** Execute SQL as superuser (bypassing RLS) to prepare or verify test state. */
export async function queryAsAdmin<T extends Record<string, unknown>>(
  database: TestDatabase,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: database.adminUrl.reveal() });
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}
