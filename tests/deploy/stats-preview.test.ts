import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>((done) => child.once('close', () => done()));
  try { process.kill(-child.pid!, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  await closed;
}

describe('real stats preview command', () => {
  it.each([
    { args: ['admin', '--host'], role: 'admin', administrator: true, level: 'instance_admin' },
    { args: ['officer', '--host'], role: 'officer', administrator: false, level: 'officer' },
    { args: ['member', '--host', '127.0.0.1'], role: 'member', administrator: false, level: 'member' },
    { args: ['--mode', 'officer'], role: 'officer', administrator: false, level: 'officer' },
    { args: ['--host'], role: 'admin', administrator: true, level: 'instance_admin' },
  ])('serves the dashboard root and correct session for $args', async ({ args, role, administrator, level }) => {
    const port = await freePort();
    const child = spawn('pnpm', ['stats:dev', ...args, '--port', String(port)], {
      cwd: resolve('.'), detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout!.on('data', (data: Buffer) => { output += data.toString(); });
    child.stderr!.on('data', (data: Buffer) => { output += data.toString(); });
    try {
      const deadline = Date.now() + 20_000;
      while (!output.includes('ready in')) {
        if (child.exitCode !== null) throw new Error(`Preview exited (${child.exitCode}): ${output}`);
        if (Date.now() > deadline) throw new Error(`Preview startup timed out: ${output}`);
        await sleep(50);
      }
      const origin = `http://127.0.0.1:${port}`;
      const page = await fetch(origin);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain(`Fictitious data · ${role} access`);
      expect(html).toContain('PICKET · Activity');
      expect((await fetch(`${origin}/app.js`)).status).toBe(200);
      expect((await fetch(`${origin}/style.css`)).status).toBe(200);
      expect(await (await fetch(`${origin}/api/session`)).json()).toMatchObject({ administrator });
      const guilds = await (await fetch(`${origin}/api/guilds`)).json() as { guilds: { level: string }[] };
      expect(guilds.guilds[0]!.level).toBe(level);
      expect(guilds.guilds).toHaveLength(5);
      expect(await (await fetch(`${origin}/api/instance`)).json()).toMatchObject({ activeGuilds: 5,
        features: expect.arrayContaining([{ feature: 'timers', enabledGuilds: 5 }, { feature: 'stats', enabledGuilds: 4 }]) });
      expect((await fetch(`${origin}/api/activity?guild=all`)).status).toBe(administrator ? 200 : 403);
    } finally { await stop(child); }
  }, 30_000);

  it('terminates on an unknown positional role instead of starting a server returning 404', async () => {
    const child = spawn('pnpm', ['stats:dev', 'unknown-role', '--host'], {
      cwd: resolve('.'), detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout!.on('data', (data: Buffer) => { output += data.toString(); });
    child.stderr!.on('data', (data: Buffer) => { output += data.toString(); });
    try {
      const code = await new Promise<number | null>((done) => child.once('close', done));
      expect(code).toBe(1);
      expect(output).toContain('Stats preview role must be member, officer or admin');
      expect(output).not.toContain('ready in');
    } finally { await stop(child); }
  }, 30_000);
});
