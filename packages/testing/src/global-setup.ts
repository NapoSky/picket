import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { ADMIN_URL_ENV, APP_PASSWORD, APP_ROLE, MIGRATOR_PASSWORD, MIGRATOR_ROLE } from './constants';

declare global {
  var __PICKET_PG__: StartedPostgreSqlContainer | undefined;
}

/** Jest globalSetup : un seul Postgres pour toute la suite d'intégration. */
export default async function globalSetup(): Promise<void> {
  const container = await new PostgreSqlContainer('postgres:18-alpine')
    .withUsername('postgres')
    .withPassword('postgres')
    .withDatabase('postgres')
    .start();
  globalThis.__PICKET_PG__ = container;

  const admin = new Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  try {
    await admin.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS`);
    // Propriétaire des tables, non superutilisateur : la RLS (FORCE) s'applique à lui comme en production.
    await admin.query(`CREATE ROLE ${MIGRATOR_ROLE} LOGIN PASSWORD '${MIGRATOR_PASSWORD}' NOSUPERUSER NOBYPASSRLS CREATEDB`);
  } finally {
    await admin.end();
  }
  process.env[ADMIN_URL_ENV] = container.getConnectionUri();
}
