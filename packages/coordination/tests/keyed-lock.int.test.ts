import { LockTimeoutError, PostgresKeyedLock } from '@picket/coordination';
import { createTestDatabase, type TestDatabase } from '@picket/testing';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('PostgresKeyedLock (integration)', () => {
  let database: TestDatabase;
  let lock: PostgresKeyedLock;

  beforeAll(async () => {
    database = await createTestDatabase();
    lock = new PostgresKeyedLock(database.handle.db, 400);
  });

  afterAll(async () => {
    await database.drop();
  });

  it('returns what the work returns', async () => {
    expect(await lock.withLock('k', async () => 42)).toBe(42);
  });

  it('never lets two works of the same key overlap, whatever the number of contenders', async () => {
    const events: string[] = [];
    let running = 0;
    let maxRunning = 0;
    await Promise.all(
      ['a', 'b', 'c'].map((name) =>
        lock.withLock('same', async () => {
          running += 1;
          maxRunning = Math.max(maxRunning, running);
          events.push(`start ${name}`);
          await sleep(30);
          events.push(`end ${name}`);
          running -= 1;
        }),
      ),
    );
    expect(maxRunning).toBe(1);
    // Chaque début est suivi de sa propre fin.
    for (let index = 0; index < events.length; index += 2) {
      expect(events[index]?.replace('start ', '')).toBe(events[index + 1]?.replace('end ', ''));
    }
  });

  it('lets different keys run at the same time', async () => {
    const started = Date.now();
    await Promise.all(['x', 'y', 'z'].map((key) => lock.withLock(key, () => sleep(80))));
    expect(Date.now() - started).toBeLessThan(80 * 3 - 40);
  });

  it('releases the lock when the work throws, and rethrows the error as is', async () => {
    await expect(
      lock.withLock('boom', async () => {
        throw new TypeError('bug');
      }),
    ).rejects.toThrow('bug');
    expect(await lock.withLock('boom', async () => 'free again')).toBe('free again');
  });

  it('gives up with a LockTimeoutError when the lock stays taken, then works again once it is free', async () => {
    let release: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = lock.withLock('busy', () => holding);
    await sleep(50);

    const started = Date.now();
    await expect(lock.withLock('busy', async () => 'never')).rejects.toBeInstanceOf(LockTimeoutError);
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);

    release();
    await holder;
    expect(await lock.withLock('busy', async () => 'now free')).toBe('now free');
  });

  it('does not leak connections: many more calls than the pool size all complete', async () => {
    for (let index = 0; index < 20; index += 1) await lock.withLock(`pool-${index % 3}`, async () => index);
    await Promise.all(Array.from({ length: 12 }, (_value, index) => lock.withLock(`pool-${index % 3}`, async () => sleep(5))));
  });

  it('keys that merely look alike do not share a lock', async () => {
    let release: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = lock.withLock('todolist:1', () => holding);
    await sleep(30);
    expect(await lock.withLock('todolist:10', async () => 'independent')).toBe('independent');
    release();
    await holder;
  });
});
