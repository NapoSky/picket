import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';
import { DomainError, type Secret } from '@picket/kernel';

export class MigrationError extends DomainError {
  readonly code = 'migration_failed';
}

// Verrou consultatif : deux `migrate` simultanés (deux déploiements) s'exécutent l'un après l'autre.
const MIGRATION_LOCK_KEY = 727_001;
const FILE_PATTERN = /^(\d{3}_[a-z0-9_]+)\.sql$/;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

export const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

export interface MigrateOptions {
  readonly connectionString: Secret;
  readonly migrationsDir?: string;
  /** Rôle de l'application, destinataire des `GRANT` (`{{app_role}}` dans les fichiers SQL). */
  readonly appRole: string;
}

export interface MigrateResult {
  readonly applied: readonly string[];
  readonly alreadyApplied: number;
}

export async function migrate(options: MigrateOptions): Promise<MigrateResult> {
  if (!ROLE_PATTERN.test(options.appRole)) throw new MigrationError('Invalid application role name');
  const directory = options.migrationsDir ?? MIGRATIONS_DIR;

  const files = (await readdir(directory)).filter((name) => FILE_PATTERN.test(name)).sort();
  const client = new Client({ connectionString: options.connectionString.reveal() });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const known = new Map<string, string>(
      (await client.query<{ version: string; checksum: string }>('SELECT version, checksum FROM schema_migrations')).rows.map(
        (row) => [row.version, row.checksum],
      ),
    );

    const applied: string[] = [];
    for (const file of files) {
      const version = (FILE_PATTERN.exec(file) as RegExpExecArray)[1] as string;
      const raw = await readFile(join(directory, file), 'utf8');
      const checksum = createHash('sha256').update(raw).digest('hex');

      const previous = known.get(version);
      if (previous !== undefined) {
        if (previous !== checksum) throw new MigrationError(`Migration ${version} was modified after being applied`);
        continue;
      }

      try {
        await client.query('BEGIN');
        await client.query(raw.replaceAll('{{app_role}}', `"${options.appRole}"`));
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [version, checksum]);
        await client.query('COMMIT');
      } catch (cause) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new MigrationError(`Migration ${version} failed`, { cause });
      }
      applied.push(version);
    }
    return { applied, alreadyApplied: files.length - applied.length };
  } finally {
    await client.end();
  }
}
