import { GuildId, UserId, noopLogger, type Clock } from '@picket/kernel';
import {
  CancelGuildDeletion,
  GetSuspension,
  HandleGuildAvailable,
  HandleGuildRemoved,
  PurgeInactiveGuilds,
  ReconcileGuilds,
  RequestGuildDeletion,
  purgeCutoff,
  purgeDate,
  shardOf,
  type DeactivationReason,
  type DeactivationResult,
  type GuildLifecycleRepository,
} from '@picket/guild';

const DAY_MS = 24 * 60 * 60 * 1000;
const guild = GuildId.assert('700000000000000001');
const other = GuildId.assert('700000000000000002');
const actor = UserId.assert('500000000000000001');
const fixedClock = (iso: string): Clock => ({ now: () => new Date(iso) });

class FakeLifecycleRepository implements GuildLifecycleRepository {
  readonly known = new Set<string>();
  readonly inactive = new Map<string, { since: Date; reason: DeactivationReason }>();
  purgeable: GuildId[] = [];
  failingOn = new Set<string>();
  readonly purged: GuildId[] = [];
  readonly initialized: GuildId[] = [];
  lastCutoff: Date | null = null;

  async initialize(id: GuildId) {
    this.known.add(id);
    this.initialized.push(id);
  }
  async inactiveSince(id: GuildId) {
    return this.inactive.get(id)?.since ?? null;
  }
  async markInactive(
    id: GuildId,
    _actor: unknown,
    _action: string,
    now: Date,
    reason: DeactivationReason,
  ): Promise<DeactivationResult> {
    const existing = this.inactive.get(id);
    if (existing) return { changed: false, inactiveSince: existing.since };
    if (reason === 'left' && !this.known.has(id)) return { changed: false, inactiveSince: now };
    this.known.add(id);
    this.inactive.set(id, { since: now, reason });
    return { changed: true, inactiveSince: now };
  }
  async reactivate(id: GuildId, _actor: unknown, _action: string, onlyReason?: DeactivationReason) {
    const existing = this.inactive.get(id);
    if (!existing || (onlyReason && existing.reason !== onlyReason)) return false;
    return this.inactive.delete(id);
  }
  async listActive() {
    return [...this.known].filter((id) => !this.inactive.has(id)) as GuildId[];
  }
  async findPurgeable(cutoff: Date) {
    this.lastCutoff = cutoff;
    return this.purgeable;
  }
  async purge(id: GuildId) {
    if (this.failingOn.has(id)) throw new Error('boom');
    this.purged.push(id);
  }
}

describe('retention dates', () => {
  it('adds the retention period to the deactivation date', () => {
    expect(purgeDate(new Date('2026-10-05T12:00:00Z'), 30).toISOString()).toBe('2026-11-04T12:00:00.000Z');
  });

  it('computes the oldest deactivation date that is due, consistently with purgeDate', () => {
    const now = new Date('2026-11-04T12:00:00Z');
    const cutoff = purgeCutoff(now, 30);
    expect(cutoff.toISOString()).toBe('2026-10-05T12:00:00.000Z');
    expect(purgeDate(cutoff, 30).getTime()).toBe(now.getTime());
    expect(now.getTime() - cutoff.getTime()).toBe(30 * DAY_MS);
  });
});

describe('shardOf', () => {
  it('follows the Discord formula (guild_id >> 22) % shard_count', () => {
    expect(shardOf('175928847299117063', 1)).toBe(0);
    // 175928847299117063 >> 22 = 41944705796 ; 41944705796 % 5 = 1
    expect(shardOf('175928847299117063', 5)).toBe(1);
  });

  it('handles identifiers beyond 2^53 without precision loss', () => {
    const big = '1234567890123456789';
    expect(shardOf(big, 16)).toBe(Number((BigInt(big) >> 22n) % 16n));
  });

  it('spreads guilds over every shard', () => {
    const shards = new Set(Array.from({ length: 200 }, (_v, i) => shardOf(String(1_000_000_000_000_000_000n + BigInt(i) * 4_194_304n), 4)));
    expect([...shards].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe('RequestGuildDeletion / CancelGuildDeletion / GetSuspension', () => {
  it('schedules a deletion, keeps the original date on repeat, and exposes the suspension', async () => {
    const repository = new FakeLifecycleRepository();
    const request = new RequestGuildDeletion(repository, fixedClock('2026-10-05T12:00:00Z'), 30);

    expect(await request.execute(guild, actor)).toEqual({
      alreadyScheduled: false,
      purgeAt: new Date('2026-11-04T12:00:00Z'),
    });
    const later = new RequestGuildDeletion(repository, fixedClock('2026-10-20T12:00:00Z'), 30);
    expect(await later.execute(guild, 'system')).toEqual({
      alreadyScheduled: true,
      purgeAt: new Date('2026-11-04T12:00:00Z'),
    });
    expect(await new GetSuspension(repository, 30).execute(guild)).toEqual(new Date('2026-11-04T12:00:00Z'));
  });

  it('previews the purge date without scheduling anything', async () => {
    const repository = new FakeLifecycleRepository();
    const request = new RequestGuildDeletion(repository, fixedClock('2026-10-05T12:00:00Z'), 7);
    expect(request.previewPurgeAt()).toEqual(new Date('2026-10-12T12:00:00Z'));
    expect(repository.inactive.size).toBe(0);
  });

  it('cancels a pending deletion once, and reports when there is nothing to cancel', async () => {
    const repository = new FakeLifecycleRepository();
    await new RequestGuildDeletion(repository, fixedClock('2026-10-05T12:00:00Z'), 30).execute(guild, actor);
    const cancel = new CancelGuildDeletion(repository);

    expect(await cancel.execute(guild, actor)).toBe(true);
    expect(await cancel.execute(guild, actor)).toBe(false);
    expect(await new GetSuspension(repository, 30).execute(guild)).toBeNull();
  });
});

describe('Gateway-driven lifecycle', () => {
  const clock = fixedClock('2026-10-05T12:00:00Z');

  it('initialises a guild when the bot joins it or finds it again', async () => {
    const repository = new FakeLifecycleRepository();
    await new HandleGuildAvailable(repository).execute(guild);
    await new HandleGuildAvailable(repository).execute(guild);
    expect(repository.initialized).toEqual([guild, guild]);
    expect(await repository.listActive()).toEqual([guild]);
  });

  it('suspends a guild the bot was removed from, and brings it back when the bot rejoins', async () => {
    const repository = new FakeLifecycleRepository();
    await new HandleGuildAvailable(repository).execute(guild);

    expect(await new HandleGuildRemoved(repository, clock).execute(guild)).toBe(true);
    expect(repository.inactive.get(guild)?.reason).toBe('left');

    await new HandleGuildAvailable(repository).execute(guild);
    expect(repository.inactive.has(guild)).toBe(false);
  });

  it('never cancels a deletion requested by an administrator when the guild shows up again', async () => {
    const repository = new FakeLifecycleRepository();
    await new RequestGuildDeletion(repository, clock, 30).execute(guild, actor);

    // Discord renvoie un événement de création pour chaque serveur à chaque connexion.
    await new HandleGuildAvailable(repository).execute(guild);

    expect(repository.inactive.get(guild)?.reason).toBe('requested');
  });

  it('ignores the removal of a guild it never knew', async () => {
    const repository = new FakeLifecycleRepository();
    expect(await new HandleGuildRemoved(repository, clock).execute(guild)).toBe(false);
    expect(repository.inactive.size).toBe(0);
  });

  it('is idempotent when the removal event is delivered twice', async () => {
    const repository = new FakeLifecycleRepository();
    await new HandleGuildAvailable(repository).execute(guild);
    const removed = new HandleGuildRemoved(repository, clock);
    expect(await removed.execute(guild)).toBe(true);
    expect(await removed.execute(guild)).toBe(false);
  });
});

describe('ReconcileGuilds', () => {
  const clock = fixedClock('2026-10-05T12:00:00Z');

  function setup(repository: FakeLifecycleRepository) {
    return new ReconcileGuilds(repository, new HandleGuildRemoved(repository, clock));
  }

  it('marks as left the active guilds missing from the connection, and keeps the present ones', async () => {
    const repository = new FakeLifecycleRepository();
    await new HandleGuildAvailable(repository).execute(guild);
    await new HandleGuildAvailable(repository).execute(other);

    const departed = await setup(repository).execute({ shardId: 0, shardCount: 1, presentGuildIds: [guild] });

    expect(departed).toEqual([other]);
    expect(repository.inactive.get(other)?.reason).toBe('left');
    expect(repository.inactive.has(guild)).toBe(false);
  });

  it('treats a guild reported unavailable by Discord as present (no false departure)', async () => {
    const repository = new FakeLifecycleRepository();
    await new HandleGuildAvailable(repository).execute(guild);
    // `ready` liste aussi les serveurs indisponibles : ils figurent dans presentGuildIds.
    expect(await setup(repository).execute({ shardId: 0, shardCount: 1, presentGuildIds: [guild] })).toEqual([]);
  });

  it('only considers the guilds that belong to the shard being reconciled', async () => {
    const repository = new FakeLifecycleRepository();
    const onShard0 = GuildId.assert(String(1_000_000_000_000_000_000n + 4_194_304n));
    const onShard1 = GuildId.assert('1000000000000000000');
    expect([shardOf(onShard0, 2), shardOf(onShard1, 2)]).toEqual([0, 1]);
    await new HandleGuildAvailable(repository).execute(onShard0);
    await new HandleGuildAvailable(repository).execute(onShard1);

    const departed = await setup(repository).execute({ shardId: 0, shardCount: 2, presentGuildIds: [] });

    expect(departed).toEqual([onShard0]);
    expect(repository.inactive.has(onShard1)).toBe(false);
  });

  it('does not touch a guild already suspended', async () => {
    const repository = new FakeLifecycleRepository();
    await new RequestGuildDeletion(repository, clock, 30).execute(guild, actor);
    expect(await setup(repository).execute({ shardId: 0, shardCount: 1, presentGuildIds: [] })).toEqual([]);
    expect(repository.inactive.get(guild)?.reason).toBe('requested');
  });
});

describe('PurgeInactiveGuilds', () => {
  it('purges every due guild using the retention cutoff', async () => {
    const repository = new FakeLifecycleRepository();
    repository.purgeable = [guild, other];
    const job = new PurgeInactiveGuilds(repository, fixedClock('2026-11-04T12:00:00Z'), 30, noopLogger);

    expect(await job.execute()).toEqual({ purged: [guild, other], failed: [] });
    expect(repository.lastCutoff).toEqual(new Date('2026-10-05T12:00:00Z'));
  });

  it('isolates a failing guild: the others are still purged and the failure is reported', async () => {
    const repository = new FakeLifecycleRepository();
    repository.purgeable = [guild, other];
    repository.failingOn.add(guild);
    const job = new PurgeInactiveGuilds(repository, fixedClock('2026-11-04T12:00:00Z'), 30, noopLogger);

    expect(await job.execute()).toEqual({ purged: [other], failed: [guild] });
  });

  it('does nothing when no guild is due', async () => {
    const job = new PurgeInactiveGuilds(new FakeLifecycleRepository(), fixedClock('2026-11-04T12:00:00Z'), 30, noopLogger);
    expect(await job.execute()).toEqual({ purged: [], failed: [] });
  });
});
