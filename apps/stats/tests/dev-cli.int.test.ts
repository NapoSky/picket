import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createTestDatabase, queryAsAdmin } from '@picket/testing';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>((done) => child.once('close', () => done()));
  // The complete pnpm/shell/node process group belongs to this test.
  try { process.kill(-child.pid!, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  await closed;
}

describe('exact connected development command', () => {
  it('runs pnpm stats:dev:live admin --host, migrates real PostgreSQL and opens an admin session', async () => {
    const database = await createTestDatabase({ migrate: false });
    const directory = await mkdtemp(join(tmpdir(), 'picket-live-cli-'));
    const bin = join(directory, 'bin');
    await mkdir(bin);
    // Testcontainers supplies the real isolated database. Only avoid starting a second
    // fixed-port Compose database; build, migrations and the server entry point are real.
    const calls = join(directory, 'docker-calls');
    await writeFile(join(bin, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_DOCKER_CALLS"\n', { mode: 0o755 });
    const port = await freePort();
    let healthPort = await freePort();
    while (healthPort === port) healthPort = await freePort();
    const root = resolve('.');
    // Run the unchanged package scripts from a private fixture. CI has no .env.dev,
    // and this test must never read or overwrite the developer's environment files.
    const development = {
      NODE_ENV: 'development', DATABASE_URL: database.appUrl.reveal(), DATABASE_MIGRATOR_URL: database.migratorUrl.reveal(),
      DATABASE_APP_ROLE: 'picket_app', DASHBOARD_PORT: String(port), HEALTH_PORT: String(healthPort),
      STATS_BUFFER_PATH: join(directory, 'buffer'), LOG_LEVEL: 'info',
    };
    await Promise.all([
      ...['apps', 'packages', 'node_modules'].map(name => symlink(join(root, name), join(directory, name), 'dir')),
      ...['tsconfig.json', 'tsconfig.base.json', 'pnpm-workspace.yaml'].map(name => symlink(join(root, name), join(directory, name), 'file')),
      readFile(join(root, 'package.json')).then(contents => writeFile(join(directory, 'package.json'), contents)),
      readFile(join(root, '.env.example')).then(contents => writeFile(join(directory, '.env.example'), contents)),
      writeFile(join(directory, '.env.dev'), Object.entries(development).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 }),
    ]);
    const env: Record<string, string | undefined> = {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_DOCKER_CALLS: calls,
    };
    for (const key of [...Object.keys(development), 'DATABASE_URL_FILE', 'DATABASE_MIGRATOR_URL_FILE',
      'DISCORD_APPLICATION_ID', 'DISCORD_BOT_TOKEN', 'DISCORD_BOT_TOKEN_FILE', 'DISCORD_CLIENT_SECRET', 'DISCORD_CLIENT_SECRET_FILE']) delete env[key];
    const child = spawn('pnpm', ['stats:dev:live', 'admin', '--host'], {
      cwd: directory, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env,
    });
    let output = '';
    child.stdout!.on('data', (data: Buffer) => { output += data.toString(); });
    child.stderr!.on('data', (data: Buffer) => { output += data.toString(); });
    try {
      const deadline = Date.now() + 40_000;
      while (!output.includes('live PostgreSQL dashboard ready')) {
        if (child.exitCode !== null) throw new Error(`Live CLI exited (${child.exitCode}): ${output}`);
        if (Date.now() > deadline) throw new Error(`Live CLI did not start: ${output}`);
        await sleep(100);
      }
      expect(await readFile(calls, 'utf8')).toBe('compose -f compose.dev.yml up -d --wait\n');
      expect((await fetch(`http://localhost:${healthPort}/readyz`)).status).toBe(200);
      const origin = `http://localhost:${port}`;
      const page = await fetch(origin);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('Live PostgreSQL');
      const login = await fetch(`${origin}/auth/discord`, { redirect: 'manual' });
      expect(login.status).toBe(302);
      const location = login.headers.get('location')!;
      expect(location.startsWith('/auth/callback?')).toBe(true);
      const stateCookie = login.headers.getSetCookie()[0]!.split(';')[0]!;
      const callback = await fetch(new URL(location, origin), { redirect: 'manual', headers: { cookie: stateCookie } });
      expect(callback.status).toBe(302);
      const sessionCookie = callback.headers.getSetCookie().find((value) => value.startsWith('picket_session='))!.split(';')[0]!;
      const session = await fetch(`${origin}/api/session`, { headers: { cookie: sessionCookie } });
      expect(await session.json()).toMatchObject({ administrator: true, user: { name: 'Development admin' } });
      expect((await fetch(`${origin}/api/activity?guild=all`, { headers: { cookie: sessionCookie } })).status).toBe(200);
      const downloaded = await fetch(`${origin}/api/export?guild=all&format=json`, { headers: { cookie: sessionCookie } });
      expect(downloaded.status).toBe(200);
      expect(await downloaded.json()).toEqual([]);
      expect(await queryAsAdmin(database, "SELECT version FROM schema_migrations WHERE version='012_stats'")).toHaveLength(1);
      expect(await queryAsAdmin(database, "SELECT version FROM schema_migrations WHERE version='013_instance_overview'")).toHaveLength(1);
    } finally {
      await stop(child); await database.drop(); await rm(directory, { recursive: true, force: true });
    }
  });
});
