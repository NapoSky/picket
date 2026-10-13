import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

describe('connected stats development startup', () => {
  it('starts the existing dev database, migrates it and loads dev overrides instead of deployment .env', async () => {
    const root = await mkdtemp(join(tmpdir(), 'picket-stats-live-'));
    const bin = join(root, 'bin');
    try {
      await Promise.all([mkdir(bin), mkdir(join(root, 'apps/bot/dist'), { recursive: true }), mkdir(join(root, 'apps/stats/dist'), { recursive: true })]);
      const calls = join(root, 'calls');
      await writeFile(calls, '');
      await writeFile(join(bin, 'docker'), '#!/bin/sh\nprintf "docker %s\\n" "$*" >> "$TEST_CALLS"\n', { mode: 0o755 });
      await writeFile(join(bin, 'pnpm'), '#!/bin/sh\nprintf "pnpm %s\\n" "$*" >> "$TEST_CALLS"\nif [ "$1" = "stats:dev:prepare" ]; then exec sh -c "$TEST_PREPARE"; fi\n', { mode: 0o755 });
      await writeFile(join(root, '.env'), 'DISCORD_APPLICATION_ID=deployment-id\nDATABASE_URL=deployment-database\n');
      await writeFile(join(root, '.env.example'), 'NODE_ENV=development\nDASHBOARD_URL=http://localhost:8082\nDATABASE_URL=default-development-database\n');
      await writeFile(join(root, '.env.dev'), 'DISCORD_APPLICATION_ID=development-id\nDISCORD_BOT_TOKEN=synthetic-development-token\nDATABASE_URL=development-database\nDATABASE_MIGRATOR_URL=development-migrator\n');
      const marker = (kind: string) => `require('node:fs').appendFileSync(process.env.TEST_CALLS, JSON.stringify({kind:${JSON.stringify(kind)},application:process.env.DISCORD_APPLICATION_ID,tokenPresent:!!process.env.DISCORD_BOT_TOKEN,database:process.env.DATABASE_URL,migrator:process.env.DATABASE_MIGRATOR_URL,origin:process.env.DASHBOARD_URL,args:process.argv.slice(2)})+'\\n');`;
      await writeFile(join(root, 'apps/bot/dist/cli.js'), marker('migrate'));
      await writeFile(join(root, 'apps/stats/dist/cli.js'), marker('http'));
      const manifest = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as { scripts: Record<string, string> };
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_CALLS: calls, TEST_PREPARE: manifest.scripts['stats:dev:prepare']! };
      // Use real Node --env-file handling with synthetic files; never read developer credentials.
      for (const key of ['DISCORD_APPLICATION_ID', 'DISCORD_BOT_TOKEN', 'DATABASE_URL', 'DATABASE_MIGRATOR_URL', 'DASHBOARD_URL']) delete env[key as keyof typeof env];
      await execute('sh', ['-c', manifest.scripts['stats:dev:live']! + ' admin --host'], { cwd: root, env });
      const recorded = (await readFile(calls, 'utf8')).trim().split('\n');
      expect(recorded.slice(0, 3)).toEqual(['pnpm stats:dev:prepare', 'docker compose -f compose.dev.yml up -d --wait', 'pnpm build']);
      expect(recorded.slice(3).map((line) => JSON.parse(line))).toEqual(['migrate', 'http'].map((kind) => ({
        kind, application: 'development-id', tokenPresent: true, database: 'development-database',
        migrator: 'development-migrator', origin: 'http://localhost:8082', args: kind === 'http' ? ['admin', '--host'] : ['migrate'],
      })));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
