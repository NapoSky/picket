import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GuildId, noopLogger } from '@picket/kernel';
import { ExportGuildData, PostgresGuildDataExportRepository, PostgresGuildSettingsRepository } from '@picket/guild';
import { createTestDatabase, queryAsAdmin, testI18n, type TestDatabase } from '@picket/testing';
import { DiskVoiceBuffer, PostgresStatsStore, type VoiceObservation } from '@picket/stats';
import { buildPurgeJob } from '../src/composition';

const A = GuildId.assert('700000000000000001'), B = GuildId.assert('700000000000000002');
const U = '300000000000000001', V = '300000000000000002', R = '400000000000000001';
describe('complete guild export and purge include retained SQL and pending voice data', () => {
  let database: TestDatabase, directory: string, buffer: DiskVoiceBuffer, store: PostgresStatsStore;
  const clock = { now: () => new Date() };
  const event = (guildId: string, key: string, userId = U): VoiceObservation => ({
    key, guildId, userId, channelId: '600000000000000001', channelName: 'Voice', name: 'Synthetic member',
    roles: [R], bot: false, shardId: 0, quality: 'observed', at: new Date(Date.now() - 3600_000).toISOString(),
  });
  beforeEach(async () => {
    database = await createTestDatabase(); directory = await mkdtemp(join(tmpdir(), 'picket-stats-data-'));
    buffer = new DiskVoiceBuffer(directory); store = new PostgresStatsStore(database.handle.db);
    for (const id of [A, B]) {
      await new PostgresGuildSettingsRepository(database.handle.db).findOrCreate(id);
      await store.configure(id, U, { enabled: true, memberRoles: [R] });
      await queryAsAdmin(database, "UPDATE stats_settings SET enabled_at=now()-interval '2 days' WHERE guild_id=$1", [id]);
      await store.observe(event(id, `${id}-join`));
      await store.observe({ ...event(id, `${id}-leave`), channelId: null, at: new Date(Date.now() - 1000).toISOString() });
    }
  });
  afterEach(async () => { await database.drop(); await rm(directory, { recursive: true, force: true }); });
  const repository = () => new PostgresGuildDataExportRepository(database.handle.db, undefined, {
    pendingVoice: (guildId, maxBytes) => buffer.exportGuild(guildId, maxBytes),
  });
  it('clips all SQL voice history to 60 days and includes pending facts without another guild or expired names', async () => {
    await queryAsAdmin(database, `INSERT INTO stats_voice_events(event_key,guild_id,user_id,at,kind,quality)
      VALUES('expired',$1,$2,now()-interval '61 days','join','observed')`, [A, V]);
    await queryAsAdmin(database, `INSERT INTO stats_voice_segments(id,guild_id,user_id,channel_id,shard_id,started_at,ended_at,confirmed_through,current_roles,quality)
      VALUES('boundary',$1,$2,'600000000000000001',0,now()-interval '61 days',now()-interval '59 days',now()-interval '59 days','{}','observed'),
      ('expired',$1,$2,'600000000000000001',0,now()-interval '62 days',now()-interval '61 days',now()-interval '61 days','{}','observed')`, [A, V]);
    await queryAsAdmin(database, "INSERT INTO stats_users VALUES($1,$2,'EXPIRED NAME',now()-interval '61 days')", [A, V]);
    await queryAsAdmin(database, "UPDATE stats_settings SET observed_through=now()-interval '61 days',interrupted_at=now()-interval '61 days' WHERE guild_id=$1", [A]);
    const queued = event(A, 'pending', V);
    await buffer.append(queued); await buffer.append(event(B, 'other-pending'));
    const result = await new ExportGuildData(repository(), clock).execute(A);
    if (result.kind !== 'exported') throw new Error('Expected a complete export');
    const body = new TextDecoder().decode(result.bytes), data = JSON.parse(body).data;
    expect(body).not.toContain(B); expect(body).not.toContain('EXPIRED NAME');
    for (const key of ['stats_voice_events', 'stats_voice_segments', 'stats_voice_presence', 'stats_users', 'stats_channels', 'stats_voice_pending'])
      expect(data).not.toHaveProperty(key);
    const member = data.stats_members.find((row: { userId: string }) => row.userId === V);
    expect(member.totalSeconds).toBeGreaterThan(86390); expect(member.totalSeconds).toBeLessThanOrEqual(86400);
    expect(member.pendingEvents).toBe(1);
    expect(Date.parse(member.lastPendingActivityDate)).toBe(Date.parse(queued.at));
    expect(data.stats_settings[0]).toMatchObject({ observed_through: null, interrupted_at: null });
    expect(data.stats_summary[0]).toMatchObject({ members: 2, pendingEvents: 1 });
    expect((await buffer.status()).count).toBe(2);
    expect(await repository().read(A, 1)).toBeNull();
  });
  it('does not duplicate an event replayed into PostgreSQL between disk capture and SQL snapshot', async () => {
    await buffer.append(event(A, 'pending', V));
    const concurrent = new PostgresGuildDataExportRepository(database.handle.db, undefined, { pendingVoice: async (guildId, maxBytes) => {
      const captured = await buffer.exportGuild(guildId, maxBytes);
      await buffer.replay((observation) => store.observe(observation));
      return captured;
    } });
    const data = await concurrent.read(A, 1_000_000);
    expect(data?.stats_members).toContainEqual(expect.objectContaining({ userId: V, pendingEvents: 0, totalSeconds: 0 }));
    expect(data?.stats_summary).toContainEqual(expect.objectContaining({ pendingEvents: 0 }));
  });
  it('purges SQL, queued facts and preferences, and retries an external erasure failure', async () => {
    await buffer.append(event(A, 'pending')); await buffer.append(event(B, 'other-pending'));
    await buffer.setExcluded(A, U, true); await store.setPrivacy(A, U, true, false);
    await queryAsAdmin(database, "UPDATE guild_registry SET inactive_since=now()-interval '31 days',inactive_reason='requested' WHERE guild_id=$1", [A]);
    const job = buildPurgeJob(database.handle.db, noopLogger, { clock, guildRetentionDays: 30, i18n: testI18n,
      stats: { store, buffer, dashboardUrl: null } });
    const erase = jest.spyOn(buffer, 'eraseGuild').mockRejectedValueOnce(new Error('Disk unavailable'));
    expect(await job.execute()).toEqual({ purged: [], failed: [A] });
    expect(await store.isRegistered(A)).toBe(true);
    erase.mockRestore();
    expect(await job.execute()).toEqual({ purged: [A], failed: [] });
    expect(await store.isRegistered(A)).toBe(false); expect(await store.isRegistered(B)).toBe(true);
    expect(await buffer.exportGuild(A, 10_000)).toEqual([]); expect(await buffer.isExcluded(A, U)).toBe(false);
    await new DiskVoiceBuffer(directory).append(event(A, 'pending'));
    expect((await buffer.status()).count).toBe(1);
    for (const table of ['stats_settings', 'stats_privacy', 'stats_users', 'stats_voice_events', 'stats_voice_segments', 'stats_voice_presence'])
      expect(await queryAsAdmin(database, `SELECT * FROM ${table} WHERE guild_id=$1`, [A])).toEqual([]);
  });
});
