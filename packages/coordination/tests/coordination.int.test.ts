import { Secret, noopLogger, systemClock } from '@picket/kernel';
import {
  LeaderElector,
  PostgresGatewaySessionStore,
  PostgresLeaseStore,
  type GatewaySession,
} from '@picket/coordination';
import { createDatabase } from '@picket/persistence';
import { createTestDatabase, queryAsAdmin, type TestDatabase } from '@picket/testing';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('coordination on Postgres (integration)', () => {
  let database: TestDatabase;
  let leases: PostgresLeaseStore;
  let sessions: PostgresGatewaySessionStore;

  beforeAll(async () => {
    database = await createTestDatabase();
    leases = new PostgresLeaseStore(database.handle.db);
    sessions = new PostgresGatewaySessionStore(database.handle.db);
  });

  afterAll(async () => {
    await database.drop();
  });

  beforeEach(async () => {
    await queryAsAdmin(database, 'TRUNCATE leases, gateway_sessions');
  });

  describe('PostgresLeaseStore', () => {
    it('grants a free lease with token 1 and refuses a second holder', async () => {
      const a = await leases.acquire('job', 'a', 5_000);
      expect(a).toEqual({ name: 'job', holder: 'a', token: 1n });
      expect(await leases.acquire('job', 'b', 5_000)).toBeNull();
    });

    it('lets exactly one of many concurrent contenders win', async () => {
      const results = await Promise.all(Array.from({ length: 12 }, (_v, i) => leases.acquire('job', `h${i}`, 5_000)));
      expect(results.filter((lease) => lease !== null)).toHaveLength(1);
    });

    it('renews for the holder and refuses a stale token', async () => {
      const a = (await leases.acquire('job', 'a', 5_000))!;
      expect(await leases.renew(a, 5_000)).toBe(true);
      expect(await leases.renew({ ...a, token: 99n }, 5_000)).toBe(false);
      expect(await leases.renew({ ...a, holder: 'b' }, 5_000)).toBe(false);
    });

    it('hands over after expiry with a strictly greater fencing token, and the old holder can no longer renew', async () => {
      const a = (await leases.acquire('job', 'a', 150))!;
      await sleep(250);
      const b = (await leases.acquire('job', 'b', 5_000))!;

      expect(b.token).toBeGreaterThan(a.token);
      expect(await leases.renew(a, 5_000)).toBe(false);
      expect(await leases.renew(b, 5_000)).toBe(true);
    });

    it('releases immediately so another holder can take over without waiting for the ttl', async () => {
      const a = (await leases.acquire('job', 'a', 60_000))!;
      await leases.release(a);
      const b = await leases.acquire('job', 'b', 5_000);
      expect(b?.token).toBe(2n);
    });

    it('ignores a release by a non-holder', async () => {
      const a = (await leases.acquire('job', 'a', 60_000))!;
      await leases.release({ ...a, holder: 'intruder' });
      expect(await leases.acquire('job', 'b', 5_000)).toBeNull();
    });

    it('keeps leases independent by name', async () => {
      expect(await leases.acquire('one', 'a', 5_000)).not.toBeNull();
      expect(await leases.acquire('two', 'b', 5_000)).not.toBeNull();
    });
  });

  describe('PostgresGatewaySessionStore (fenced writes)', () => {
    const session = (sequence: number): GatewaySession => ({
      resumeURL: 'wss://gateway.example',
      sequence,
      sessionId: 'abc',
      shardCount: 1,
      shardId: 0,
    });

    it('saves and loads a session for the lease holder', async () => {
      const lease = (await leases.acquire('gateway:shard:0', 'a', 5_000))!;
      expect(await sessions.load(0)).toBeNull();
      expect(await sessions.save(lease, session(10))).toBe(true);
      expect(await sessions.save(lease, session(11))).toBe(true);
      expect(await sessions.load(0)).toEqual(session(11));
    });

    it('refuses writes from a process that does not hold the lease', async () => {
      await leases.acquire('gateway:shard:0', 'a', 5_000);
      const impostor = { name: 'gateway:shard:0', holder: 'b', token: 1n };
      expect(await sessions.save(impostor, session(5))).toBe(false);
      expect(await sessions.load(0)).toBeNull();
    });

    it('fences out a former holder that was paused past its lease', async () => {
      const old = (await leases.acquire('gateway:shard:0', 'a', 100))!;
      await sessions.save(old, session(1));
      await sleep(200);
      const current = (await leases.acquire('gateway:shard:0', 'b', 5_000))!;
      await sessions.save(current, session(50));

      expect(await sessions.save(old, session(2))).toBe(false);
      expect(await sessions.load(0)).toEqual(session(50));
    });

    it('clears only for the current holder', async () => {
      const lease = (await leases.acquire('gateway:shard:0', 'a', 5_000))!;
      await sessions.save(lease, session(1));
      await sessions.clear({ ...lease, holder: 'b' }, 0);
      expect(await sessions.load(0)).not.toBeNull();
      await sessions.clear(lease, 0);
      expect(await sessions.load(0)).toBeNull();
    });

    it('treats a corrupted stored session as absent', async () => {
      await queryAsAdmin(database, `INSERT INTO gateway_sessions (shard_id, session, lease_token) VALUES (0, '{"x":1}', 1)`);
      expect(await sessions.load(0)).toBeNull();
    });
  });

  describe('LeaderElector across two database connections', () => {
    function replica(name: string, work: string[]) {
      const own = createDatabase({ connectionString: database.appUrl, maxConnections: 2 });
      const elector = new LeaderElector({
        store: new PostgresLeaseStore(own.db),
        name: 'election',
        holder: name,
        ttlMs: 400,
        renewEveryMs: 100,
        retryEveryMs: 50,
        clock: systemClock,
        logger: noopLogger,
        onAcquired: async () => {
          work.push(`${name}:start`);
          return async () => {
            work.push(`${name}:stop`);
          };
        },
      });
      return { elector, close: () => own.close() };
    }

    it('elects a single leader, then fails over to the other replica when the leader shuts down', async () => {
      const work: string[] = [];
      const a = replica('a', work);
      const b = replica('b', work);

      a.elector.start();
      b.elector.start();
      await sleep(400);
      expect(work.filter((entry) => entry.endsWith(':start'))).toHaveLength(1);

      const leader = a.elector.isLeader ? a : b;
      const follower = leader === a ? b : a;
      await leader.elector.stop();
      await sleep(400);

      expect(follower.elector.isLeader).toBe(true);
      expect(work.filter((entry) => entry.endsWith(':start'))).toHaveLength(2);

      await follower.elector.stop();
      await Promise.all([a.close(), b.close()]);
      expect(new Secret('x').reveal()).toBe('x');
    });
  });
});
