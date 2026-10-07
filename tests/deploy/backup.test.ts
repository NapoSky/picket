import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile, cp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const source = resolve('deploy');

describe('deployment backups', () => {
  let directory: string;
  let deploy: string;
  let backups: string;
  let bin: string;
  let env: NodeJS.ProcessEnv;

  const calls = async () => (await readFile(join(directory, 'calls'), 'utf8')).trim().split('\n');
  const run = (script: string, arg: string) => execute(join(deploy, script), [arg], { env });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'picket-backup-test-'));
    deploy = join(directory, 'deploy');
    backups = join(directory, 'backups');
    bin = join(directory, 'bin');
    await Promise.all([mkdir(deploy), mkdir(backups), mkdir(bin)]);
    for (const name of ['rollout.sh', 'backup.sh']) await cp(join(source, name), join(deploy, name));
    await cp(join(source, 'backup'), join(deploy, 'backup'), { recursive: true });
    await writeFile(join(deploy, 'password'), 'unused-test-password');
    await writeFile(join(deploy, 'recipients'), 'age1publicrecipient\n');
    await writeFile(join(directory, 'calls'), '');
    // Fault injection at the process boundary. This fake encoder is NOT a cryptography test.
    await writeFile(join(bin, 'age'), '#!/bin/sh\n[ "${FAIL_ENCRYPT:-0}" = 0 ] || exit 1\nbase64\n', { mode: 0o755 });
    await writeFile(join(bin, 'pg_dump'), [
      '#!/bin/sh', 'printf "%s\\n" "pg_dump $*" >> "$TEST_CALLS"',
      'printf "complete database archive"', '[ "${FAIL_DUMP:-0}" = 0 ]', '',
    ].join('\n'), { mode: 0o755 });
    await writeFile(join(bin, 'docker'), [
      '#!/bin/bash', 'printf "%s\\n" "$*" >> "$TEST_CALLS"',
      'printf "%s:%s\\n" "$PICKET_BACKUP_UID" "$PICKET_BACKUP_GID" >> "$TEST_IDENTITIES"', 'case "$*" in',
      '  "compose run --rm -T backup "*) exec "$TEST_RUNNER" "${@: -1}" ;;',
      '  *) exit 0 ;;', 'esac', '',
    ].join('\n'), { mode: 0o755 });
    env = { ...process.env, PATH: bin + ':' + process.env.PATH, TEST_CALLS: join(directory, 'calls'), TEST_IDENTITIES: join(directory, 'identities'), TEST_RUNNER: join(deploy, 'backup', 'run.sh'), BACKUP_DIR: backups, BACKUP_RECIPIENTS_FILE: join(deploy, 'recipients'), POSTGRES_PASSWORD_FILE: join(deploy, 'password'), PGDATABASE: 'picket', PICKET_BACKUP_UID: '9999', PICKET_BACKUP_GID: '9999' };
  });

  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('verifies and atomically publishes the backup before migration and rollout', async () => {
    await run('rollout.sh', 'ghcr.io/example/picket@sha256:' + 'a'.repeat(64));
    const recorded = await calls();
    const dump = recorded.findIndex((call) => call.includes('pg_dump'));
    const migration = recorded.findIndex((call) => call.endsWith('run --rm migrate'));
    const rollout = recorded.findIndex((call) => call.startsWith('rollout '));
    expect(dump).toBeGreaterThanOrEqual(0);
    expect(dump).toBeLessThan(migration);
    expect(migration).toBeLessThan(rollout);
    expect(recorded[dump]).toContain('--username=postgres --dbname=picket --format=custom');
    const names = (await readdir(backups)).filter((name) => name.startsWith('picket-'));
    expect(names).toHaveLength(1);
    const snapshot = join(backups, names[0]!);
    expect(names[0]).not.toContain('.partial');
    await execute('sha256sum', ['--check', 'picket.dump.age.sha256'], { cwd: snapshot });
    expect(await readFile(join(snapshot, 'manifest.txt'), 'utf8')).toContain('reason=pre-migration');
  });

  it.each([
    ['backup.sh', 'daily'], ['backup.sh', 'start'], ['rollout.sh', 'image'],
  ])('passes the deployment user identity dynamically from %s (%s), leaving .env untouched', async (script, arg) => {
    const dotenv = 'PICKET_IMAGE=existing-image\nPICKET_BACKUP_UID=9999\nPICKET_BACKUP_GID=9999\n';
    await writeFile(join(deploy, '.env'), dotenv);
    await run(script, arg);
    const identities = (await readFile(env.TEST_IDENTITIES!, 'utf8')).trim().split('\n');
    expect(identities.length).toBeGreaterThan(0);
    expect(new Set(identities)).toEqual(new Set([`${process.getuid!()}:${process.getgid!()}`]));
    expect(await readFile(join(deploy, '.env'), 'utf8')).toBe(dotenv);
    if (arg === 'start') expect(await calls()).toEqual(['compose up -d backup']);
  });

  it.each(['FAIL_DUMP', 'FAIL_ENCRYPT'])('aborts before migration when %s fails, and removes partial archives', async (failure) => {
    env[failure] = '1';
    await expect(run('rollout.sh', 'image')).rejects.toThrow();
    expect((await calls()).some((call) => call.includes('run --rm migrate') || call.startsWith('rollout '))).toBe(false);
    expect((await readdir(backups)).filter((name) => name.startsWith('picket-'))).toEqual([]);
  });

  it('refuses missing public recipients or a private encryption identity before migration', async () => {
    await rm(join(deploy, 'recipients'));
    await expect(run('rollout.sh', 'image')).rejects.toThrow();
    await writeFile(join(deploy, 'recipients'), 'AGE-SECRET-KEY-PRIVATE\n');
    await expect(run('rollout.sh', 'image')).rejects.toThrow();
    expect((await calls()).some((call) => call.includes('run --rm migrate'))).toBe(false);
  });

  it('detects a corrupt write using the hash of the ciphertext stream', async () => {
    await writeFile(join(bin, 'tee'), '#!/bin/sh\ncat\nprintf corrupt > "$1"\n', { mode: 0o755 });
    await expect(run('rollout.sh', 'image')).rejects.toThrow(/read-back verification/);
    expect((await readdir(backups)).filter((name) => name.startsWith('picket-'))).toEqual([]);
    expect((await calls()).some((call) => call.includes('run --rm migrate'))).toBe(false);
  });

  it('expires old snapshots even if the daily dump fails, and preserves unrelated paths and symlinks', async () => {
    const old = 'picket-20200101T000000Z-12345678';
    const recent = 'picket-20990101T000000Z-12345678';
    await Promise.all([mkdir(join(backups, old)), mkdir(join(backups, recent)), mkdir(join(backups, 'personal-files'))]);
    await symlink(join(backups, 'personal-files'), join(backups, 'picket-20200101T000000Z-abcdefgh'));
    env.FAIL_DUMP = '1';
    await expect(run('backup.sh', 'daily')).rejects.toThrow();
    expect((await readdir(backups)).filter((name) => !name.startsWith('.')).sort()).toEqual(['personal-files', 'picket-20200101T000000Z-abcdefgh', recent]);
  });

  const seedSnapshots = async (count: number) => {
    const names = Array.from({ length: count }, (_, index) => {
      const stamp = new Date(Date.now() - (index + 1) * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
      return `picket-${stamp}-${String(index).padStart(8, '0')}`;
    });
    await Promise.all(names.map((name) => mkdir(join(backups, name))));
    return names;
  };

  it('prunes to the five newest complete snapshots without counting partial archives', async () => {
    const names = await seedSnapshots(8);
    const partial = `${names[0]}.partial`;
    await mkdir(join(backups, partial));
    await run('backup.sh', 'prune');
    expect((await readdir(backups)).filter((name) => name.startsWith('picket-')).sort()).toEqual([...names.slice(0, 5), partial].sort());
  });

  it.each(['daily', 'pre-migration'])('rotates the oldest backup after a successful %s backup', async (reason) => {
    const names = await seedSnapshots(5);
    await run('backup.sh', reason);
    const retained = (await readdir(backups)).filter((name) => name.startsWith('picket-'));
    expect(retained).toHaveLength(5);
    expect(retained).toEqual(expect.arrayContaining(names.slice(0, 4)));
    expect(retained).not.toContain(names[4]);
    const published = retained.find((name) => !names.includes(name))!;
    await execute('sha256sum', ['--check', 'picket.dump.age.sha256'], { cwd: join(backups, published) });
  });

  it.each(['FAIL_DUMP', 'FAIL_ENCRYPT'])('preserves five existing backups when %s fails', async (failure) => {
    const names = await seedSnapshots(5);
    env[failure] = '1';
    await expect(run('backup.sh', 'daily')).rejects.toThrow();
    expect((await readdir(backups)).filter((name) => name.startsWith('picket-')).sort()).toEqual(names.sort());
  });

  it('serialises manual deployments before any Docker or database work', async () => {
    // Hold the production lock in a separate process until the second invocation exits.
    const blocker = execFile('flock', [join(deploy, '.rollout.lock'), 'sh', '-c', 'echo locked; read release']);
    await new Promise<void>((resolveReady) => blocker.stdout!.once('data', () => resolveReady()));
    try {
      await expect(run('rollout.sh', 'image')).rejects.toThrow(/already running/);
      expect(await calls()).toEqual(['']);
    } finally { blocker.stdin!.end('release\n'); }
  });

  it('keeps 03:30 Europe/Paris across spring and autumn clock changes', async () => {
    const code = [
      'import sys,datetime', 'sys.path.insert(0,sys.argv[1])', 'from schedule import next_run,ZONE',
      'for raw in ["2026-03-28T04:00:00+01:00", "2026-10-24T04:00:00+02:00"]:',
      '  now=datetime.datetime.fromisoformat(raw).astimezone(ZONE)',
      '  print(next_run(now).isoformat())',
    ].join('\n');
    const result = await execute('python3', ['-c', code, join(source, 'backup')]);
    expect(result.stdout.trim().split('\n')).toEqual(['2026-03-29T03:30:00+02:00', '2026-10-25T03:30:00+01:00']);
  });
});
