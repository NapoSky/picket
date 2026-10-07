import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

describe('secrets initialization', () => {
  let directory: string;
  let deploy: string;
  let bin: string;
  let env: NodeJS.ProcessEnv;
  const run = () => execute(join(deploy, 'init-secrets.sh'), [], { env });
  const secret = (name: string) => join(deploy, 'secrets', name);

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'picket-init-secrets-'));
    deploy = join(directory, 'deploy');
    bin = join(directory, 'bin');
    await Promise.all([mkdir(deploy), mkdir(bin)]);
    await cp(resolve('deploy/init-secrets.sh'), join(deploy, 'init-secrets.sh'));
    // Fault injection only; actual age encryption is covered by backup-image.int.test.ts.
    await writeFile(join(bin, 'age-keygen'), [
      '#!/bin/sh',
      'printf "%s\\n" "$*" >> "$TEST_KEYGEN_CALLS"',
      'case "$1" in',
      '  -o) printf "synthetic-private-identity" > "$2"; chmod 644 "$2" ;;',
      '  -y) [ "${FAIL_DERIVE:-0}" = 0 ] || exit 1; test -s "$2"; printf "age1syntheticpublicrecipient\\n" ;;',
      '  *) exit 1 ;;',
      'esac', '',
    ].join('\n'), { mode: 0o755 });
    env = { ...process.env, PATH: bin + ':' + process.env.PATH, TEST_KEYGEN_CALLS: join(directory, 'keygen-calls') };
  });

  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('initializes database secrets and both backup keys, protects the private key and prints only guidance', async () => {
    const result = await run();
    expect(await readFile(secret('backup_identity'), 'utf8')).toBe('synthetic-private-identity');
    expect(await readFile(secret('backup_recipients'), 'utf8')).toBe('age1syntheticpublicrecipient\n');
    expect((await stat(secret('backup_identity'))).mode & 0o777).toBe(0o600);
    expect((await stat(secret('backup_recipients'))).mode & 0o777).toBe(0o644);
    expect((await stat(join(deploy, 'secrets'))).mode & 0o777).toBe(0o700);
    expect(await readFile(secret('database_url'), 'utf8')).toContain(await readFile(secret('picket_app_password'), 'utf8'));
    expect(result.stdout).toContain('PRIVATE KEY');
    expect(result.stdout).toContain('vault');
    expect(result.stdout).not.toContain('synthetic-private-identity');
    expect((await readdir(join(deploy, 'secrets'))).filter((name) => name.startsWith('.backup-keys.'))).toEqual([]);
  });

  it('preserves all credentials and keys on repeated initialization, including after the private key is moved away', async () => {
    await run();
    const names = (await readdir(join(deploy, 'secrets'))).filter((name) => !name.startsWith('.'));
    const original = await Promise.all(names.map((name) => readFile(secret(name), 'utf8')));
    const calls = await readFile(env.TEST_KEYGEN_CALLS!, 'utf8');
    await run();
    expect(await Promise.all(names.map((name) => readFile(secret(name), 'utf8')))).toEqual(original);
    await rm(secret('backup_identity'));
    await run();
    expect(await readFile(env.TEST_KEYGEN_CALLS!, 'utf8')).toBe(calls);
    await expect(stat(secret('backup_identity'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(secret('backup_recipients'), 'utf8')).toBe(original[names.indexOf('backup_recipients')]);
  });

  it('recreates a missing public recipient from the existing private identity without rotating it', async () => {
    await run();
    await rm(secret('backup_recipients'));
    await writeFile(env.TEST_KEYGEN_CALLS!, '');
    await run();
    expect(await readFile(env.TEST_KEYGEN_CALLS!, 'utf8')).toBe('-y backup_identity\n');
    expect(await readFile(secret('backup_identity'), 'utf8')).toBe('synthetic-private-identity');
  });

  it('leaves an existing .env entirely untouched, including its permissions and inode', async () => {
    const contents = 'PICKET_IMAGE=custom-image\nDISCORD_APPLICATION_ID=1234\nBACKUP_DIR=../backups\n# operator settings\n';
    await writeFile(join(deploy, '.env'), contents, { mode: 0o640 });
    const before = await stat(join(deploy, '.env'));
    await run();
    await run();
    expect(await readFile(join(deploy, '.env'), 'utf8')).toBe(contents);
    const after = await stat(join(deploy, '.env'));
    expect(after.ino).toBe(before.ino);
    expect(after.mode).toBe(before.mode);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('does not create .env when missing', async () => {
    await run();
    await run();
    await expect(stat(join(deploy, '.env'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps a generated identity after a public-key derivation failure so a retry reuses it', async () => {
    env.FAIL_DERIVE = '1';
    await expect(run()).rejects.toThrow();
    await expect(stat(secret('backup_recipients'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await stat(secret('backup_identity'))).mode & 0o777).toBe(0o600);
    env.FAIL_DERIVE = '0';
    await run();
    expect((await readFile(env.TEST_KEYGEN_CALLS!, 'utf8')).split('\n').filter((call) => call.startsWith('-o'))).toHaveLength(1);
    expect(await readFile(secret('backup_recipients'), 'utf8')).toBe('age1syntheticpublicrecipient\n');
  });

  it('builds and uses the Docker image when age-keygen is not installed on the host', async () => {
    await cp(join(bin, 'age-keygen'), join(bin, 'test-keygen'));
    await rm(join(bin, 'age-keygen'));
    // Restrict command lookup so this test also covers hosts with age already installed.
    for (const name of ['dirname', 'mkdir', 'chmod', 'flock', 'mktemp', 'id', 'mv', 'rm', 'openssl', 'cat']) {
      const found = await execute('sh', ['-c', 'command -v "$1"', 'test', name]);
      await symlink(found.stdout.trim(), join(bin, name));
    }
    await writeFile(join(bin, 'docker'), [
      '#!/bin/sh', 'printf "%s\\n" "$*" >> "$TEST_DOCKER_CALLS"',
      'case "$1" in',
      '  image) exit 1 ;;',
      '  build) exit 0 ;;',
      '  run)',
      '    while [ "$1" != picket-postgres-backup:18 ]; do shift; done',
      '    shift; cd "$TEST_SECRETS"; exec "$TEST_KEYGEN" "$@" ;;',
      '  *) exit 1 ;;', 'esac', '',
    ].join('\n'), { mode: 0o755 });
    env.PATH = bin;
    env.TEST_DOCKER_CALLS = join(directory, 'docker-calls');
    env.TEST_SECRETS = join(deploy, 'secrets');
    env.TEST_KEYGEN = join(bin, 'test-keygen');
    await run();
    const calls = await readFile(env.TEST_DOCKER_CALLS, 'utf8');
    expect(calls).toContain('build -t picket-postgres-backup:18 ./backup');
    expect(calls).toContain(`--mount type=bind,source=${deploy}/secrets,target=/keys --workdir /keys`);
    expect(calls).toContain('--entrypoint age-keygen picket-postgres-backup:18 -y backup_identity');
    expect((await stat(secret('backup_identity'))).mode & 0o777).toBe(0o600);
  });
});
