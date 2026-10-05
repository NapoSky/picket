import { LeaderElector, type Lease, type LeaseStore } from '@picket/coordination';
import { noopLogger, type Clock } from '@picket/kernel';

class FakeStore implements LeaseStore {
  holder: string | null = null;
  token = 0n;
  failNext: Error | null = null;
  releases = 0;

  async acquire(name: string, holder: string): Promise<Lease | null> {
    if (this.failNext) throw this.failNext;
    if (this.holder !== null && this.holder !== holder) return null;
    if (this.holder === null) this.token += 1n;
    this.holder = holder;
    return { name, holder, token: this.token };
  }
  async renew(lease: Lease): Promise<boolean> {
    if (this.failNext) throw this.failNext;
    return this.holder === lease.holder && this.token === lease.token;
  }
  async release(lease: Lease): Promise<void> {
    this.releases += 1;
    if (this.holder === lease.holder) this.holder = null;
  }
  /** Un autre processus prend le verrou après expiration. */
  stealBy(other: string): void {
    this.holder = other;
    this.token += 1n;
  }
}

function setup(overrides: Partial<ConstructorParameters<typeof LeaderElector>[0]> = {}) {
  const store = new FakeStore();
  let nowMs = 1_000_000;
  const clock: Clock = { now: () => new Date(nowMs) };
  const events: string[] = [];
  const elector = new LeaderElector({
    store,
    name: 'gateway:shard:0',
    holder: 'replica-a',
    ttlMs: 15_000,
    renewEveryMs: 5_000,
    retryEveryMs: 2_000,
    clock,
    logger: noopLogger,
    onAcquired: async (lease) => {
      events.push(`start:${lease.token}`);
      return async () => {
        events.push('stop');
      };
    },
    ...overrides,
  });
  return { store, elector, events, advance: (ms: number) => void (nowMs += ms) };
}

describe('LeaderElector', () => {
  it('starts the work when it acquires a free lease, and only once while it holds it', async () => {
    const { elector, events } = setup();
    await elector.step();
    await elector.step();
    await elector.step();
    expect(events).toEqual(['start:1']);
    expect(elector.isLeader).toBe(true);
  });

  it('stays passive while another holder has the lease', async () => {
    const { elector, events, store } = setup();
    store.holder = 'replica-b';
    store.token = 7n;
    await elector.step();
    expect(events).toEqual([]);
    expect(elector.isLeader).toBe(false);
  });

  it('stops the work immediately when the lease is lost to another holder, then can win it back', async () => {
    const { elector, events, store } = setup();
    await elector.step();
    store.stealBy('replica-b');

    await elector.step();
    expect(events).toEqual(['start:1', 'stop']);
    expect(elector.isLeader).toBe(false);

    store.holder = null;
    await elector.step();
    expect(events).toEqual(['start:1', 'stop', 'start:3']);
  });

  it('tolerates a brief database outage but stops one renewal interval before its lease can expire elsewhere', async () => {
    const { elector, events, store, advance } = setup();
    await elector.step();

    store.failNext = new Error('db down');
    advance(5_000);
    await elector.step();
    expect(elector.isLeader).toBe(true);

    // 10 s sans renouvellement sur un bail de 15 s : on cède avant toute prise par un autre.
    advance(5_000);
    await elector.step();
    expect(elector.isLeader).toBe(false);
    expect(events).toEqual(['start:1', 'stop']);
  });

  it('keeps leading when renewal succeeds again after a blip', async () => {
    const { elector, store, advance, events } = setup();
    await elector.step();
    store.failNext = new Error('blip');
    advance(5_000);
    await elector.step();
    store.failNext = null;
    advance(5_000);
    await elector.step();
    advance(9_000);
    await elector.step();
    expect(events).toEqual(['start:1']);
    expect(elector.isLeader).toBe(true);
  });

  it('releases the lease and backs off when the work fails to start (no crash loop)', async () => {
    let attempts = 0;
    const { elector, store, advance } = setup({
      onAcquired: async () => {
        attempts += 1;
        throw new Error('gateway refused');
      },
    });

    await elector.step();
    expect(attempts).toBe(1);
    expect(store.releases).toBe(1);
    expect(store.holder).toBeNull();

    await elector.step();
    expect(attempts).toBe(1);

    advance(2_500);
    await elector.step();
    expect(attempts).toBe(2);

    advance(3_000);
    await elector.step();
    expect(attempts).toBe(2);
    advance(2_000);
    await elector.step();
    expect(attempts).toBe(3);
  });

  it('survives an acquisition error', async () => {
    const { elector, store } = setup();
    store.failNext = new Error('db down');
    await expect(elector.step()).resolves.toBeUndefined();
    expect(elector.isLeader).toBe(false);
  });

  it('stops the work and releases the lease on shutdown, so another replica can take over at once', async () => {
    const sleeps: number[] = [];
    const { elector, events, store } = setup({
      sleep: async (ms, signal) => {
        sleeps.push(ms);
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      },
    });

    elector.start();
    await new Promise((resolve) => setImmediate(resolve));
    expect(elector.isLeader).toBe(true);

    await elector.stop();

    expect(events).toEqual(['start:1', 'stop']);
    expect(store.releases).toBe(1);
    expect(store.holder).toBeNull();
    expect(sleeps[0]).toBe(5_000);
  });

  it('a stopped follower never starts anything', async () => {
    const { elector, events, store } = setup({
      sleep: async (_ms, signal) => {
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      },
    });
    store.holder = 'replica-b';
    elector.start();
    await new Promise((resolve) => setImmediate(resolve));
    await elector.stop();
    expect(events).toEqual([]);
    expect(store.releases).toBe(0);
  });
});
