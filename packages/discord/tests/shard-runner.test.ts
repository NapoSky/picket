import { ShardRunner, shardLeaseName, type ShardConnection, type ShardConnectionParams } from '@picket/discord';
import type { Lease, LeaseStore } from '@picket/coordination';
import { noopLogger, systemClock } from '@picket/kernel';

class MemoryLeases implements LeaseStore {
  readonly holders = new Map<string, { holder: string; token: bigint }>();
  async acquire(name: string, holder: string): Promise<Lease | null> {
    const current = this.holders.get(name);
    if (current && current.holder !== holder) return null;
    const token = current ? current.token : 1n;
    this.holders.set(name, { holder, token });
    return { name, holder, token };
  }
  async renew(lease: Lease) {
    return this.holders.get(lease.name)?.holder === lease.holder;
  }
  async release(lease: Lease) {
    if (this.holders.get(lease.name)?.holder === lease.holder) this.holders.delete(lease.name);
  }
}

class RecordingConnections {
  readonly log: string[] = [];
  failStartOnce = false;
  connect = (params: ShardConnectionParams): ShardConnection => ({
    start: async () => {
      if (this.failStartOnce) {
        this.failStartOnce = false;
        throw new Error('identify refused');
      }
      this.log.push(`start:${params.shardId}/${params.shardCount}`);
    },
    stop: async () => void this.log.push(`stop:${params.shardId}`),
  });
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 40));

function runner(holder: string, leases: LeaseStore, connections: RecordingConnections, shardCount = 2) {
  return new ShardRunner({
    shardCount,
    holder,
    leases,
    connect: connections.connect,
    clock: systemClock,
    logger: noopLogger,
    ttlMs: 400,
    renewEveryMs: 10,
    retryEveryMs: 10,
  });
}

describe('ShardRunner', () => {
  it('names leases per shard', () => {
    expect(shardLeaseName(3)).toBe('gateway:shard:3');
  });

  it('holds one connection per shard and starts each only once', async () => {
    const leases = new MemoryLeases();
    const connections = new RecordingConnections();
    const shards = runner('a', leases, connections);

    shards.start();
    await tick();

    expect([...connections.log].sort()).toEqual(['start:0/2', 'start:1/2']);
    expect(shards.leaderShards).toBe(2);
    await shards.stop();
  });

  it('keeps a second replica in standby, then lets it take over once the first one stops (graceful handoff)', async () => {
    const leases = new MemoryLeases();
    const first = new RecordingConnections();
    const second = new RecordingConnections();
    const a = runner('a', leases, first, 1);
    const b = runner('b', leases, second, 1);

    a.start();
    b.start();
    await tick();
    expect(first.log).toEqual(['start:0/1']);
    expect(second.log).toEqual([]);
    expect(b.leaderShards).toBe(0);

    await a.stop();
    await tick();

    expect(first.log).toEqual(['start:0/1', 'stop:0']);
    expect(second.log).toEqual(['start:0/1']);
    expect(b.leaderShards).toBe(1);
    await b.stop();
  });

  it('releases the lease when the connection cannot start, so another replica can try', async () => {
    const leases = new MemoryLeases();
    const failing = new RecordingConnections();
    failing.failStartOnce = true;
    const healthy = new RecordingConnections();
    const a = runner('a', leases, failing, 1);
    const b = runner('b', leases, healthy, 1);

    a.start();
    await tick();
    expect(failing.log).toEqual([]);

    b.start();
    await tick();
    expect(healthy.log).toEqual(['start:0/1']);

    await Promise.all([a.stop(), b.stop()]);
  });
});
