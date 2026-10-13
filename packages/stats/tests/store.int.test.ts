import { GuildId, noopLogger } from '@picket/kernel';
import { PostgresGuildSettingsRepository } from '@picket/guild';
import { PostgresLeaseStore } from '@picket/coordination';
import { createDiscordBotRest, normalizeDispatch } from '@picket/discord';
import { Secret } from '@picket/kernel';
import { createTestDatabase, queryAsAdmin, type TestDatabase } from '@picket/testing';
import { sql } from '@picket/persistence';
import {
  PostgresStatsStore,
  withStatsScope,
  VoiceCollector,
  type DurableVoiceBuffer,
  type VoiceObservation,
} from '../src';
const A = '700000000000000001',
  B = '700000000000000002',
  U = '300000000000000001',
  V = '300000000000000002',
  R = '400000000000000001',
  C = '600000000000000001',
  D = '600000000000000002';
describe('voice facts, RLS, erasure and recovery (PostgreSQL)', () => {
  let database: TestDatabase, store: PostgresStatsStore;
  const now = () => new Date();
  const observation = (patch: Partial<VoiceObservation> = {}): VoiceObservation => ({
    key: 'join',
    guildId: A,
    userId: U,
    channelId: C,
    channelName: 'Voice',
    name: 'Alice',
    roles: [R],
    bot: false,
    shardId: 0,
    quality: 'observed',
    at: new Date(Date.now() - 3600_000).toISOString(),
    ...patch,
  });
  beforeAll(async () => {
    database = await createTestDatabase();
    store = new PostgresStatsStore(database.handle.db, now);
  });
  afterAll(async () => database.drop());
  beforeEach(async () => {
    await queryAsAdmin(
      database,
      'TRUNCATE stats_settings,stats_privacy,stats_users,stats_channels,stats_voice_events,stats_voice_segments,stats_voice_presence,guild_permission_roles,guild_settings,guild_registry,leases CASCADE',
    );
    const guilds = new PostgresGuildSettingsRepository(database.handle.db);
    for (const id of [A, B]) {
      await guilds.findOrCreate(GuildId.assert(id));
      await store.configure(id, U, { memberRoles: [R], enabled: true });
      await queryAsAdmin(
        database,
        "UPDATE stats_settings SET enabled_at=now()-interval '3 days' WHERE guild_id=$1",
        [id],
      );
    }
  });
  it('enforces no everyone in the database and disables an active collection on permission changes', async () => {
    await store.observe(observation());
    await queryAsAdmin(
      database,
      "INSERT INTO guild_permission_roles(guild_id,level,role_id) VALUES($1,'member',$1)",
      [A],
    );
    expect((await store.config(A)).enabled).toBe(false);
    expect(
      (await queryAsAdmin(database, 'SELECT ended_at FROM stats_voice_segments WHERE guild_id=$1', [A]))[0]
        ?.ended_at,
    ).not.toBeNull();
    await expect(store.configure(A, U, { enabled: true })).resolves.toBe('invalid_roles');
    await expect(
      queryAsAdmin(
        database,
        "UPDATE guild_settings SET features=jsonb_set(features,'{stats}','true') WHERE guild_id=$1",
        [A],
      ),
    ).rejects.toThrow(/explicit member roles/);
  });
  it('replays join/move/leave without duplicates and sums precise clipped durations', async () => {
    const base = Date.now() - 3600_000;
    const join = observation({ at: new Date(base).toISOString() });
    const move = observation({ key: 'move', channelId: D, at: new Date(base + 1800_000).toISOString() });
    const leave = observation({ key: 'leave', channelId: null, at: new Date(base + 3000_000).toISOString() });
    for (const event of [join, move, leave, join, move, leave]) await store.observe(event);
    expect(await queryAsAdmin(database, 'SELECT event_key FROM stats_voice_events')).toHaveLength(3);
    const report = await store.report(
      { kind: 'guild', guildId: A, userId: U },
      { from: new Date(base - 1000), to: now() },
    );
    expect(report.seconds).toBeCloseTo(3000);
    expect(report.activeUsers).toBe(1);
    expect(report.channels).toHaveLength(2);
    expect(report.daily.reduce((n, d) => n + d.seconds, 0)).toBeCloseTo(report.seconds);
  });
  it('filters bots, AFK, excluded channels and non-targets before historical insertion', async () => {
    await store.metadata(A, 'Test guild', D);
    await store.configure(A, U, { excludedChannels: [C] });
    await store.observe(observation({ bot: true }));
    await store.observe(observation({ key: 'afk', channelId: D }));
    await store.observe(observation({ key: 'excluded' }));
    await store.observe(observation({ key: 'non-target', roles: [] }));
    expect(await queryAsAdmin(database, 'SELECT * FROM stats_voice_events')).toHaveLength(0);
    expect(await queryAsAdmin(database, 'SELECT * FROM stats_users')).toHaveLength(0);
  });
  it('reconciles per-server time series while deduplicating people across servers and sessions', async () => {
    const base = new Date();
    base.setUTCHours(23, 0, 0, 0);
    base.setUTCDate(base.getUTCDate() - 2);
    const at = (hours: number) => new Date(base.getTime() + hours * 3600_000);
    for (const [guildId, userId, channelId, start, end] of [
      [A, U, C, 0, 2], [A, U, D, 2, 3], [A, V, C, 0, 1], [B, U, C, 0, 2],
    ] as const) {
      await store.observe(observation({ key: `${guildId}-${userId}-${channelId}-join`, guildId, userId, channelId, at: at(start).toISOString() }));
      await store.observe(observation({ key: `${guildId}-${userId}-${channelId}-leave`, guildId, userId, channelId: null, at: at(end).toISOString() }));
    }
    const scope = { kind: 'global', guildId: null, userId: U } as const;
    const period = { from: at(0), to: at(4) };
    const report = await store.report(scope, period);
    expect(report.activeUsers).toBe(2);
    expect(report.seconds).toBe(21600);
    expect(report.serverActivity).toEqual([
      { guildId: A, seconds: 14400, activeUsers: 2, sessions: 3, inVoice: 0,
        daily: [{ day: at(0).toISOString().slice(0, 10), seconds: 7200, users: 2 },
          { day: at(2).toISOString().slice(0, 10), seconds: 7200, users: 1 }] },
      { guildId: B, seconds: 7200, activeUsers: 1, sessions: 1, inVoice: 0,
        daily: [{ day: at(0).toISOString().slice(0, 10), seconds: 3600, users: 1 },
          { day: at(2).toISOString().slice(0, 10), seconds: 3600, users: 1 }] },
    ]);
    for (const day of report.daily) {
      expect(report.serverActivity.reduce((sum, guild) => sum + (guild.daily.find((d) => d.day === day.day)?.seconds ?? 0), 0)).toBe(day.seconds);
    }
    expect(report.daily.map((day) => day.users)).toEqual([2, 1]);
    const clipped = await store.report(scope, { from: at(0.5), to: at(2.5), channelId: C });
    expect(clipped.seconds).toBe(12600);
    expect(clipped.serverActivity.map((g) => [g.guildId, g.seconds, g.activeUsers])).toEqual([[A, 7200, 2], [B, 5400, 1]]);
    const own = await store.report({ kind: 'self', guildId: A, userId: U }, period);
    expect(own.serverActivity.map((g) => [g.guildId, g.activeUsers, g.seconds])).toEqual([[A, 1, 10800]]);
    await store.setPrivacy(A, U, true, true);
    const erased = await store.report(scope, period);
    expect(erased.serverActivity.find((g) => g.guildId === A)).toMatchObject({ activeUsers: 1, seconds: 3600 });
    const expired = new PostgresStatsStore(database.handle.db, () => at(63 * 24));
    expect((await expired.report(scope, period)).serverActivity).toEqual([]);
  });
  it('keeps user and guild isolation even if a reader forgets SQL WHERE clauses', async () => {
    await store.observe(observation());
    await store.observe(observation({ key: 'other-person', userId: V }));
    await store.observe(observation({ key: 'other-guild', guildId: B }));
    expect((await sql`SELECT * FROM stats_voice_segments`.execute(database.handle.db)).rows).toEqual([]);
    const own = await withStatsScope(database.handle.db, { kind: 'self', guildId: A, userId: U }, (trx) =>
      sql`SELECT * FROM stats_voice_segments`.execute(trx),
    );
    expect(own.rows).toHaveLength(1);
    const guild = await withStatsScope(database.handle.db, { kind: 'guild', guildId: A, userId: U }, (trx) =>
      sql`SELECT * FROM stats_voice_segments`.execute(trx),
    );
    expect(guild.rows).toHaveLength(2);
    const global = await withStatsScope(
      database.handle.db,
      { kind: 'global', guildId: null, userId: U },
      (trx) => sql`SELECT * FROM stats_voice_segments`.execute(trx),
    );
    expect(global.rows).toHaveLength(3);
  });
  it('does not invent voice time during recovery and can reopen an observed presence', async () => {
    await store.observe(observation());
    await store.interrupt(A);
    const report = await store.report(
      { kind: 'guild', guildId: A, userId: U },
      { from: new Date(Date.now() - 7200_000), to: now() },
    );
    expect(report.seconds).toBe(0);
    expect(report.interruptedSegments).toBe(1);
    await store.observe(
      observation({ key: 'snapshot', at: new Date(Date.now() - 1000).toISOString(), quality: 'snapshot' }),
    );
    expect(await store.openUserIds(A)).toEqual(new Set([U]));
  });
  it('user erasure cannot be undone by a delayed disk replay', async () => {
    const event = observation();
    await store.observe(event);
    await store.setPrivacy(A, U, false, true);
    await store.observe(event);
    expect(await queryAsAdmin(database, 'SELECT * FROM stats_voice_segments')).toHaveLength(0);
    expect(await queryAsAdmin(database, 'SELECT * FROM stats_voice_events')).toHaveLength(0);
    await store.setPrivacy(A, U, true, false);
    await store.observe(observation({ key: 'after-optout', at: new Date(Date.now() - 1).toISOString() }));
    expect(await queryAsAdmin(database, 'SELECT * FROM stats_users')).toHaveLength(0);
  });
  it('rejects a writer after its shard lease was replaced', async () => {
    const leases = new PostgresLeaseStore(database.handle.db);
    const old = (await leases.acquire('gateway:shard:0', 'old', 1000))!;
    await leases.release(old);
    await leases.acquire('gateway:shard:0', 'new', 1000);
    await expect(store.observe(observation(), old)).rejects.toThrow(/lease lost/);
    expect(await queryAsAdmin(database, 'SELECT * FROM stats_voice_events')).toHaveLength(0);
  });
  it('updates only current state on a mute event instead of creating another session', async () => {
    await store.observe(observation());
    await store.observe(observation({ key: 'mute', at: new Date(Date.now() - 1000).toISOString() }));
    expect(await queryAsAdmin(database, 'SELECT * FROM stats_voice_events')).toHaveLength(1);
    expect(await queryAsAdmin(database, 'SELECT * FROM stats_voice_segments')).toHaveLength(1);
  });
  it('purges all expired history while keeping opt-out configuration', async () => {
    await store.observe(observation());
    await store.observe(
      observation({ key: 'leave', channelId: null, at: new Date(Date.now() - 1000).toISOString() }),
    );
    await store.setPrivacy(A, V, true, false);
    const future = new Date(Date.now() + 63 * 86_400_000);
    const expired = new PostgresStatsStore(database.handle.db, () => future);
    await expired.maintenance(A);
    for (const table of [
      'stats_users',
      'stats_channels',
      'stats_voice_events',
      'stats_voice_segments',
      'stats_voice_presence',
    ])
      expect(await queryAsAdmin(database, `SELECT * FROM ${table} WHERE guild_id=$1`, [A])).toEqual([]);
    expect(await expired.privacy(A, V)).toBe(true);
    await expired.observe(observation());
    expect(await queryAsAdmin(database, 'SELECT * FROM stats_voice_events')).toEqual([]);
  });
  it('splits daylight-saving and quarter-hour timezone boundaries exactly', async () => {
    const reportAt = new Date('2026-11-01T00:00:00Z');
    const clocked = new PostgresStatsStore(database.handle.db, () => reportAt);
    await queryAsAdmin(database, "UPDATE guild_settings SET timezone='Europe/Paris' WHERE guild_id=$1", [A]);
    await clocked.observe(observation({ key: 'dst-join', at: '2026-10-24T22:00:00Z' }));
    await clocked.observe(observation({ key: 'dst-leave', channelId: null, at: '2026-10-25T23:00:00Z' }));
    const dst = await clocked.report(
      { kind: 'guild', guildId: A, userId: U },
      { from: new Date('2026-10-24T22:00:00Z'), to: new Date('2026-10-25T23:00:00Z') },
    );
    expect(dst.seconds).toBe(25 * 3600);
    expect(dst.daily.find((d) => d.day === '2026-10-25')?.seconds).toBe(25 * 3600);
    expect(dst.serverActivity[0]?.daily).toEqual([{ day: '2026-10-25', seconds: 25 * 3600, users: 1 }]);
    expect(dst.hourly.find((h) => h.hour === 2)?.seconds).toBe(7200);
    await queryAsAdmin(database, "UPDATE guild_settings SET timezone='Asia/Kathmandu' WHERE guild_id=$1", [
      B,
    ]);
    await clocked.observe(observation({ guildId: B, key: 'quarter-join', at: '2026-10-26T18:05:00Z' }));
    await clocked.observe(
      observation({ guildId: B, key: 'quarter-leave', channelId: null, at: '2026-10-26T18:25:00Z' }),
    );
    const quarter = await clocked.report(
      { kind: 'guild', guildId: B, userId: U },
      { from: new Date('2026-10-26T18:00:00Z'), to: new Date('2026-10-26T19:00:00Z') },
    );
    expect(quarter.seconds).toBe(1200);
    expect(quarter.hourly).toEqual([
      { hour: 0, seconds: 600 },
      { hour: 23, seconds: 600 },
    ]);
  });
  it('tracks role gains/losses in an already connected person without a member roster', async () => {
    const leases = new PostgresLeaseStore(database.handle.db);
    const lease = (await leases.acquire('stats-collector-test', 'holder', 15_000))!;
    const buffer: DurableVoiceBuffer = {
      append: async () => undefined,
      replay: async () => 0,
      erase: async () => undefined,
      status: async () => ({ bytes: 0, count: 0, oldest: null }),
    };
    const collector = new VoiceCollector(store, buffer, noopLogger);
    await collector.connectionChanged(0, false, lease);
    await collector.connectionChanged(0, true, lease);
    const delivery = (key: string) => ({
      key,
      shardId: 0,
      at: new Date(Date.now() - 1),
      replayed: false,
      lease,
    });
    await collector.handle(
      {
        type: 'voice_state',
        guildId: GuildId.assert(A),
        person: { userId: U, channelId: C, roles: [], name: 'Alice', bot: false },
      },
      delivery('untracked'),
    );
    expect(await queryAsAdmin(database, 'SELECT * FROM stats_users')).toHaveLength(0);
    await collector.handle(
      { type: 'voice_member', guildId: GuildId.assert(A), userId: U, roles: [R], name: 'Alice', bot: false },
      delivery('role-gain'),
    );
    expect(await store.openUserIds(A)).toEqual(new Set([U]));
    await collector.handle(
      { type: 'voice_member', guildId: GuildId.assert(A), userId: U, roles: [], name: 'Alice', bot: false },
      delivery('role-loss'),
    );
    expect(await store.openUserIds(A)).toEqual(new Set());
    expect(await queryAsAdmin(database, 'SELECT * FROM stats_users')).toHaveLength(1);
    await leases.release(lease);
  });
  it('fences metadata and interruption callbacks from an old shard holder', async () => {
    const leases = new PostgresLeaseStore(database.handle.db);
    const old = (await leases.acquire('stats-fence-test', 'old', 15_000))!;
    await leases.release(old);
    await leases.acquire('stats-fence-test', 'new', 15_000);
    await store.observe(observation());
    await expect(store.interrupt(A, old)).rejects.toThrow(/lease lost/);
    await expect(store.metadata(A, 'Stale', null, old)).rejects.toThrow(/lease lost/);
    expect(await store.openUserIds(A)).toEqual(new Set([U]));
  });
  it('does not restore an old buffered event after explicit reactivation', async () => {
    const old = observation();
    await store.configure(A, U, { enabled: false });
    await store.configure(A, U, { enabled: true });
    await store.observe(old);
    expect(await queryAsAdmin(database, 'SELECT * FROM stats_voice_events')).toEqual([]);
    await store.observe(observation({ key: 'new-observation', at: new Date().toISOString() }));
    expect(await store.openUserIds(A)).toEqual(new Set([U]));
  });
  it('observes a new connection immediately after activation even with cached OFF settings', async () => {
    await store.configure(A, U, { enabled: false });
    const lease = (await new PostgresLeaseStore(database.handle.db).acquire(
      'stats-activation-test',
      'holder',
      15_000,
    ))!;
    const buffer: DurableVoiceBuffer = {
      append: async () => undefined,
      replay: async () => 0,
      erase: async () => undefined,
      status: async () => ({ bytes: 0, count: 0, oldest: null }),
    };
    const collector = new VoiceCollector(store, buffer, noopLogger);
    await collector.handle(
      {
        type: 'voice_state',
        guildId: GuildId.assert(A),
        person: { userId: U, channelId: C, roles: [R], name: 'Alice', bot: false },
      },
      { key: 'while-off', shardId: 0, at: new Date(), replayed: false, lease },
    );
    await store.configure(A, U, { enabled: true });
    await collector.handle(
      {
        type: 'voice_state',
        guildId: GuildId.assert(A),
        person: { userId: V, channelId: C, roles: [R], name: 'Bob', bot: false },
      },
      { key: 'after-enable', shardId: 0, at: new Date(), replayed: false, lease },
    );
    expect(await store.openUserIds(A)).toEqual(new Set([V]));
  });
  it('records a five-minute Gateway voice session with either targeted role and makes it available to reports', async () => {
    const secondRole = '400000000000000002';
    await store.configure(A, U, { memberRoles: [R, secondRole] });
    const end = new Date(Date.now() - 1000), start = new Date(end.getTime() - 300_000);
    const lease = (await new PostgresLeaseStore(database.handle.db).acquire('stats-five-minute-test', 'holder', 15_000))!;
    const buffer: DurableVoiceBuffer = {
      append: async () => undefined, replay: async () => 0, erase: async () => undefined,
      status: async () => ({ bytes: 0, count: 0, oldest: null }),
    };
    const collector = new VoiceCollector(store, buffer, noopLogger);
    const dispatch = (channel: string | null): Parameters<typeof normalizeDispatch>[0] => ({
      t: 'VOICE_STATE_UPDATE', s: 1, op: 0,
      d: { guild_id: A, user_id: U, channel_id: channel,
        member: { roles: [secondRole], user: { id: U, username: 'Alice', bot: false } } },
    } as Parameters<typeof normalizeDispatch>[0]);
    for (const [channel, at, key] of [[C, start, 'gateway-join'], [null, end, 'gateway-leave']] as const) {
      const event = normalizeDispatch(dispatch(channel), 0, 1);
      expect(event).not.toBeNull();
      await collector.handle(event!, { key, shardId: 0, at, replayed: false, lease });
    }
    const report = await store.report({ kind: 'guild', guildId: A, userId: U },
      { from: new Date(start.getTime() - 1000), to: now() });
    expect(report.seconds).toBe(300);
    expect(report.sessions).toBe(1);
    expect(report.users).toEqual([expect.objectContaining({ userId: U, seconds: 300 })]);
  });
  const metadataBuffer: DurableVoiceBuffer = {
    append: async () => undefined, replay: async () => 0, erase: async () => undefined,
    status: async () => ({ bytes: 0, count: 0, oldest: null }),
  };
  async function closedChannel(name: string) {
    const start = new Date(Date.now() - 61_000), end = new Date(start.getTime() + 60_000);
    await store.observe(observation({ channelName: name, at: start.toISOString() }));
    await store.observe(observation({ key: 'closed', channelId: null, at: end.toISOString() }));
  }
  async function metadataCollector(clock = now) {
    const lease = (await new PostgresLeaseStore(database.handle.db).acquire('stats-channel-metadata', 'holder', 15_000))!;
    const rest = createDiscordBotRest(new Secret('unused'));
    const collector = new VoiceCollector(store, metadataBuffer, noopLogger, clock, rest);
    await collector.connectionChanged(0, false, lease);
    await collector.connectionChanged(0, true, lease);
    return { collector, rest, lease };
  }
  it('preserves a known channel name when a later observation contains only its ID', async () => {
    await closedChannel('Chill - 🎵');
    await store.observe(observation({ key: 'new-session', userId: V, channelName: C, at: new Date().toISOString() }));
    expect((await store.channelNames(A))[C]).toBe('Chill - 🎵');
  });
  it('hydrates saved channel names after a Gateway resume without fetching or exposing other guild metadata', async () => {
    await closedChannel('Chill - 🎵');
    await store.observe(observation({ key: 'other-guild-name', guildId: B, channelName: 'Other server' }));
    const { collector, rest, lease } = await metadataCollector();
    const get = jest.spyOn(rest, 'get');
    await collector.handle({ type: 'voice_state', guildId: GuildId.assert(A),
      person: { userId: V, channelId: C, roles: [R], name: 'Bob', bot: false } },
      { key: 'resumed-join', shardId: 0, at: new Date(), replayed: false, lease });
    await collector.tick();
    await collector.refreshMetadata();
    expect(get).not.toHaveBeenCalled();
    expect((await store.channelNames(A))[C]).toBe('Chill - 🎵');
  });
  it('repairs an ID-only name for closed history without a new connection or extending retention', async () => {
    await closedChannel(C);
    const before = (await queryAsAdmin(database, 'SELECT last_seen_at FROM stats_channels WHERE guild_id=$1', [A]))[0]!.last_seen_at;
    const { collector, rest } = await metadataCollector();
    const get = jest.spyOn(rest, 'get').mockResolvedValue({ id: C, guild_id: A, type: 2, name: 'Chill - 🎵' });
    await collector.tick();
    await collector.refreshMetadata();
    await collector.tick();
    await collector.refreshMetadata();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(`/channels/${C}`);
    const report = await store.report({ kind: 'guild', guildId: A, userId: U },
      { from: new Date(Date.now() - 120_000), to: now() });
    expect(report.channels).toEqual([{ id: C, name: 'Chill - 🎵', seconds: 60 }]);
    expect(report.recent[0]?.channel).toBe('Chill - 🎵');
    expect((await queryAsAdmin(database, 'SELECT last_seen_at FROM stats_channels WHERE guild_id=$1', [A]))[0]!.last_seen_at).toEqual(before);
  });
  it('applies fresh snapshot names to retained channels without storing unrelated channels', async () => {
    await closedChannel(C);
    const { collector, rest, lease } = await metadataCollector();
    const get = jest.spyOn(rest, 'get');
    await collector.handle({ type: 'guild_available', guildId: GuildId.assert(A), voiceSnapshot: {
      name: 'Regiment', afkChannelId: null, people: [], channels: { [C]: 'Operations', [D]: 'Untracked' },
    } }, { key: 'fresh-snapshot', shardId: 0, at: new Date(), replayed: false, lease });
    expect(await store.channelNames(A)).toEqual({ [C]: 'Operations' });
    expect(get).not.toHaveBeenCalled();
  });
  it('rejects a channel name returned for a different server', async () => {
    await closedChannel(C);
    const { collector, rest } = await metadataCollector();
    jest.spyOn(rest, 'get').mockResolvedValue({ id: C, guild_id: B, type: 2, name: 'Private channel in another server' });
    await collector.tick();
    await collector.refreshMetadata();
    expect(await store.channelNames(A)).toEqual({ [C]: C });
    expect(await store.channelNames(B)).toEqual({});
  });
  it('keeps collecting voice activity when a name lookup fails and retries metadata later', async () => {
    let instant = new Date();
    const { collector, rest, lease } = await metadataCollector(() => instant);
    const get = jest.spyOn(rest, 'get').mockRejectedValueOnce(Object.assign(new Error('Missing access'), { status: 403 }))
      .mockResolvedValue({ id: C, guild_id: A, type: 2, name: 'Operations' });
    const start = new Date(instant.getTime() - 61_000), end = new Date(start.getTime() + 60_000);
    for (const [channelId, at, key] of [[C, start, 'name-failure-join'], [null, end, 'name-failure-leave']] as const)
      await collector.handle({ type: 'voice_state', guildId: GuildId.assert(A),
        person: { userId: U, channelId, roles: [R], name: 'Alice', bot: false } },
        { key, shardId: 0, at, replayed: false, lease });
    await collector.tick();
    await collector.refreshMetadata();
    instant = new Date(instant.getTime() + 31_000);
    await collector.tick();
    await collector.refreshMetadata();
    expect(get).toHaveBeenCalledTimes(1);
    expect((await queryAsAdmin(database, 'SELECT * FROM stats_voice_segments'))).toHaveLength(1);
    instant = new Date(instant.getTime() + 300_000);
    await collector.tick();
    await collector.refreshMetadata();
    expect(get).toHaveBeenCalledTimes(2);
    expect((await store.channelNames(A))[C]).toBe('Operations');
  });
  it('renames disconnected participants by ID without creating facts, touching retention or other guild nicknames', async () => {
    await closedChannel('Voice');
    await store.observe(observation({ key: 'other-nickname', guildId: B, name: 'Other nickname' }));
    const before = await queryAsAdmin(database, 'SELECT user_id,last_seen_at FROM stats_users WHERE guild_id=$1', [A]);
    const facts = await queryAsAdmin(database, 'SELECT * FROM stats_voice_segments WHERE guild_id=$1', [A]);
    const { collector, lease } = await metadataCollector();
    for (const [userId, nick] of [[U, 'New nickname'], [V, 'Untracked person']] as const) {
      const event = normalizeDispatch({ op: 0, s: 1, t: 'GUILD_MEMBER_UPDATE', d: {
        guild_id: A, roles: [R], nick, user: { id: userId, username: 'account', global_name: 'Profile name' },
      } } as Parameters<typeof normalizeDispatch>[0], 0, 1)!;
      await collector.handle(event, { key: `rename-${userId}`, shardId: 0, at: now(), replayed: false, lease });
    }
    const rows = await queryAsAdmin(database, 'SELECT user_id,name,last_seen_at FROM stats_users WHERE guild_id=$1', [A]);
    expect(rows).toEqual([expect.objectContaining({ user_id: U, name: 'New nickname', last_seen_at: before[0]!.last_seen_at })]);
    expect(await queryAsAdmin(database, 'SELECT * FROM stats_voice_segments WHERE guild_id=$1', [A])).toEqual(facts);
    expect((await queryAsAdmin(database, 'SELECT name FROM stats_users WHERE guild_id=$1', [B]))[0]!.name).toBe('Other nickname');
  });
  it('protects retained member names against ID-only observations', async () => {
    await closedChannel('Voice');
    await store.observe(observation({ key: 'fallback-name', name: U, at: now().toISOString() }));
    expect((await queryAsAdmin(database, 'SELECT name FROM stats_users WHERE guild_id=$1', [A]))[0]!.name).toBe('Alice');
  });
  it('periodically reconciles known guild, channel and member names even with collection disabled', async () => {
    await closedChannel('Old channel');
    await store.metadata(A, 'Old guild', D);
    await store.configure(A, U, { enabled: false, excludedChannels: [D] });
    const before = await queryAsAdmin(database, 'SELECT last_seen_at FROM stats_users WHERE guild_id=$1', [A]);
    let instant = now();
    const { collector, rest } = await metadataCollector(() => instant);
    const get = jest.spyOn(rest, 'get').mockImplementation(async path => {
      if (path === `/guilds/${A}`) return { id: A, name: 'Renamed guild' };
      if (path === `/channels/${C}`) return { id: C, guild_id: A, type: 2, name: 'Renamed channel' };
      if (path === `/guilds/${A}/members/${U}`)
        return { nick: 'Server nickname', user: { id: U, global_name: 'Display name', username: 'account' } };
      throw new Error(`Unexpected metadata request: ${path}`);
    });
    await collector.tick();
    await collector.refreshMetadata();
    expect(get).not.toHaveBeenCalled();
    instant = new Date(instant.getTime() + 30 * 60_000);
    await collector.tick();
    await collector.refreshMetadata();
    expect(get).toHaveBeenCalledTimes(3);
    expect(await store.settings(A)).toMatchObject({ name: 'Renamed guild', enabled: false, afkChannelId: D, excludedChannels: [D] });
    const report = await store.report({ kind: 'guild', guildId: A, userId: U },
      { from: new Date(Date.now() - 120_000), to: now() });
    expect(report.channels).toEqual([{ id: C, name: 'Renamed channel', seconds: 60 }]);
    expect(report.users).toEqual([expect.objectContaining({ userId: U, name: 'Server nickname', seconds: 60 })]);
    expect(report.sessions).toBe(1);
    expect(await queryAsAdmin(database, 'SELECT last_seen_at FROM stats_users WHERE guild_id=$1', [A])).toEqual(before);
    await collector.tick();
    await collector.refreshMetadata();
    expect(get).toHaveBeenCalledTimes(3);
  });
  it('bounds metadata pages, rotates servers and skips erased, expired and unrelated people', async () => {
    for (const guildId of [A, B])
      for (let i = 0; i < 8; i++) {
        await store.observe(observation({ guildId, userId: `${300000000000000010n + BigInt(i)}`, key: `retained-${guildId}-${i}` }));
        await store.observe(observation({ guildId, userId: `${300000000000000010n + BigInt(i)}`, channelId: null,
          key: `closed-${guildId}-${i}`, at: new Date(Date.now() - 3500_000).toISOString() }));
      }
    await queryAsAdmin(database, "UPDATE stats_users SET last_seen_at=now()-interval '61 days' WHERE user_id=$1", ['300000000000000010']);
    await store.setPrivacy(A, '300000000000000011', false, true);
    let instant = now();
    const { collector, rest } = await metadataCollector(() => instant);
    const paths: string[] = [];
    jest.spyOn(rest, 'get').mockImplementation(async path => {
      paths.push(path);
      const parts = path.split('/');
      if (parts[1] === 'channels') return { id: C, guild_id: paths.some(p => p === `/guilds/${B}`) ? B : A, type: 2, name: 'Voice' };
      if (parts.length === 3) return { id: parts[2], name: `Guild ${parts[2]}` };
      return { nick: null, user: { id: parts[4], global_name: 'Profile renamed', username: 'account' } };
    });
    instant = new Date(instant.getTime() + 30 * 60_000);
    for (let i = 0; i < 6; i++) {
      const count = paths.length;
      await collector.tick();
      await collector.refreshMetadata();
      expect(paths.length - count).toBeLessThanOrEqual(5);
      instant = new Date(instant.getTime() + 10_000);
    }
    expect(paths).toContain(`/guilds/${A}/members/300000000000000012`);
    expect(paths).toContain(`/guilds/${B}/members/300000000000000011`);
    expect(paths).not.toContain(`/guilds/${A}/members/300000000000000011`);
    expect(paths.some(path => path.endsWith('/300000000000000010'))).toBe(false);
    expect(paths.some(path => path.endsWith('/members'))).toBe(false);
    expect(await queryAsAdmin(database, 'SELECT name FROM stats_users WHERE guild_id=$1 AND user_id=$2', [B, '300000000000000011']))
      .toEqual([expect.objectContaining({ name: 'Profile renamed' })]);
  });
  it('retains member labels on inaccessible or mismatched identities and fences metadata writes', async () => {
    await closedChannel('Voice');
    let instant = now();
    const { collector, rest, lease } = await metadataCollector(() => instant);
    jest.spyOn(rest, 'get').mockResolvedValue({ user: { id: V, username: 'Wrong member' } });
    instant = new Date(instant.getTime() + 30 * 60_000);
    await collector.tick();
    await collector.refreshMetadata();
    expect((await queryAsAdmin(database, 'SELECT name FROM stats_users WHERE guild_id=$1', [A]))[0]!.name).toBe('Alice');
    await queryAsAdmin(database, 'DELETE FROM leases WHERE name=$1', [lease.name]);
    await expect(store.rememberMemberName(A, U, 'Stale holder', lease)).rejects.toThrow('Stats shard lease lost');
    await store.setPrivacy(A, U, false, true);
    await store.rememberMemberName(A, U, 'Erased person');
    expect(await queryAsAdmin(database, 'SELECT * FROM stats_users WHERE guild_id=$1', [A])).toEqual([]);
  });
  it('keeps voice events flowing during a slow periodic lookup and preserves a newer Gateway rename', async () => {
    await closedChannel('Voice');
    let instant = now();
    const { collector, rest, lease } = await metadataCollector(() => instant);
    let finish!: (value: unknown) => void, started!: () => void;
    const response = new Promise<unknown>(resolve => { finish = resolve; });
    const requested = new Promise<void>(resolve => { started = resolve; });
    jest.spyOn(rest, 'get').mockImplementation(async path => {
      if (path === `/guilds/${A}`) return { id: A, name: 'Guild' };
      if (path === `/channels/${C}`) return { id: C, guild_id: A, type: 2, name: 'Voice' };
      if (path === `/guilds/${A}/members/${U}`) { started(); return response; }
      throw new Error('Unexpected lookup');
    });
    instant = new Date(instant.getTime() + 30 * 60_000);
    const refreshing = collector.refreshMetadata();
    await requested;
    try {
      await collector.handle({ type: 'voice_member', guildId: GuildId.assert(A), userId: U,
        roles: [R], name: 'New Gateway nickname', bot: false },
        { key: 'newer-name', shardId: 0, at: now(), replayed: false, lease });
      await collector.handle({ type: 'voice_state', guildId: GuildId.assert(A),
        person: { userId: U, channelId: C, roles: [R], name: 'New Gateway nickname', bot: false } },
        { key: 'voice-during-lookup', shardId: 0, at: now(), replayed: false, lease });
      expect(await store.openUserIds(A)).toEqual(new Set([U]));
      const checkpoint = jest.spyOn(store, 'checkpoint');
      instant = now();
      await collector.tick();
      expect(checkpoint).toHaveBeenCalledWith(A, lease, instant);
    } finally {
      finish({ nick: 'Older REST nickname', user: { id: U, username: 'account' } });
      await refreshing;
    }
    expect((await queryAsAdmin(database, 'SELECT name FROM stats_users WHERE guild_id=$1', [A]))[0]!.name).toBe('New Gateway nickname');
  });
});
