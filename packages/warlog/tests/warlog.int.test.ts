import { PostgresLeaseStore, PostgresDiscordBudget } from '@picket/coordination';
import { ChannelId, GuildId, UserId, noopLogger } from '@picket/kernel';
import { createI18n } from '@picket/i18n';
import { purgeGuildData, withTenant } from '@picket/persistence';
import { createTestDatabase, queryAsAdmin, type TestDatabase } from '@picket/testing';
import { PostgresTimerStore } from '@picket/timers';
import { PostgresWarStore, PublishWarLog, WAR_LOG_COLORS, objectEvent, type PollSnapshot, type WarObject } from '../src';
import type { Lease } from '@picket/coordination';

const A = GuildId.assert('700000000000000001'), B = GuildId.assert('700000000000000002');
const channel = ChannelId.assert('600000000000000001'), actor = UserId.assert('500000000000000001');
const now = new Date('2026-10-05T12:00:00Z');
const object = (state = '1C', region = 'WestgateHex'): WarObject => ({ key: `${region}:1B:0.10000:0.20000`, region, code: '1B', x: .1, y: .2, location: 'Jade Cove', state, stateAt: now.getTime() });
function snapshot(war = 100, objects: readonly WarObject[] = [object()]): PollSnapshot {
  return { war: { id: `war${war}`, number: war, startedAt: now.getTime() - 3_600_000, endedAt: null, winner: 'NONE' }, regions: { WestgateHex: { version: 1, updatedAt: now.getTime(), items: [] } }, objects: Object.fromEntries(objects.map(obj => [obj.key, obj])) };
}
describe('war-log persistence and diffusion', () => {
  let database: TestDatabase, store: PostgresWarStore, lease: Lease;
  beforeAll(async () => { database = await createTestDatabase(); store = new PostgresWarStore(database.handle.db); });
  afterAll(async () => { await database.drop(); });
  async function register(guildId: GuildId) {
    await database.handle.db.insertInto('guild_registry').values({ guild_id: guildId }).onConflict(c => c.doNothing()).execute();
    await withTenant(database.handle.db, guildId, trx => trx.insertInto('guild_settings').values({ guild_id: guildId }).onConflict(c => c.doNothing()).execute());
  }
  async function enable(guildId: GuildId, zones: ('center' | 'west_coast' | 'east_coast')[] = ['west_coast']) {
    await store.configure(guildId, actor, { kind: 'channel', channelId: channel, locale: 'en' }, now);
    await store.configure(guildId, actor, { kind: 'zones', zones }, now);
    expect(await store.configure(guildId, actor, { kind: 'enable', war: 100 }, now)).toBe('saved');
  }
  async function capture(region = 'WestgateHex', at = new Date(now.getTime() + 1_000)) {
    const before = object('1C', region), after = object('1W', region);
    const event = objectEvent(before, after, 100, at.getTime(), at.getTime())!;
    expect(await store.commit(lease, snapshot(100, [after]), [event], false, at)).toBe(true);
    return event;
  }
  beforeEach(async () => {
    await queryAsAdmin(database, 'TRUNCATE guild_registry, wars, leases, guild_audit_log CASCADE');
    await queryAsAdmin(database, 'UPDATE warlog_state SET generation = 0, available = false, highest_war = 0, payload = NULL');
    lease = (await new PostgresLeaseStore(database.handle.db).acquire('warlog-poller', 'a', 300_000))!;
    await register(A); await register(B);
    await store.commit(lease, snapshot(), [], true, now);
  });
  it('starts disabled and requires a channel, valid zones and the current active war', async () => {
    expect((await store.subscription(A)).paused).toBe(true);
    expect((await store.subscription(A)).perspective).toBe('NONE');
    expect(await store.configure(A, actor, { kind: 'enable', war: 100 }, now)).toBe('invalid');
    await store.configure(A, actor, { kind: 'channel', channelId: channel, locale: 'fr' }, now);
    expect(await store.configure(A, actor, { kind: 'zones', zones: ['center','west_coast','east_coast','west_islands'] }, now)).toBe('invalid');
    await store.configure(A, actor, { kind: 'zones', zones: ['west_coast'] }, now);
    expect(await store.configure(A, actor, { kind: 'enable', war: 99 }, now)).toBe('stale_war');
    expect(await store.configure(A, actor, { kind: 'enable', war: 100 }, now)).toBe('saved');
    const other = await withTenant(database.handle.db, B, trx => trx.selectFrom('warlog_subscriptions').selectAll().execute());
    expect(other).toEqual([]);
    expect(await database.handle.db.selectFrom('warlog_subscriptions').selectAll().execute()).toEqual([]);
  });
  it('fans out only to subscriptions for the event zone and records one delivery per event', async () => {
    await enable(A); await enable(B, ['center']); const event = await capture();
    await store.commit(lease, snapshot(100, [object('1W')]), [event], false, new Date(now.getTime() + 2_000));
    expect((await queryAsAdmin(database, 'SELECT guild_id FROM warlog_deliveries')).map(row => row.guild_id)).toEqual([A]);
    const delivery = await store.claim(A, new Date(now.getTime() + 2_000)); expect(delivery).not.toBeNull();
    expect(await store.claim(A, new Date(now.getTime() + 2_000))).toBeNull();
    await store.finish(delivery!, { kind: 'sent', messageId: '800000000000000001' }, new Date(now.getTime() + 3_000));
    expect(await store.claim(A, new Date(now.getTime() + 4_000))).toBeNull();
  });
  it('cancels already claimed work on a filter change and resumes without replay', async () => {
    await enable(A); await capture(); const delivery = (await store.claim(A, new Date(now.getTime() + 2_000)))!;
    await store.configure(A, actor, { kind: 'zones', zones: ['center'] }, new Date(now.getTime() + 3_000));
    expect(await store.valid(delivery)).toBe(false);
    expect(await queryAsAdmin(database, 'SELECT * FROM warlog_deliveries')).toEqual([]);
    await store.configure(A, actor, { kind: 'disable' }, now);
    await capture(); await store.configure(A, actor, { kind: 'enable', war: 100 }, new Date(now.getTime() + 7 * 86_400_000));
    expect(await queryAsAdmin(database, 'SELECT * FROM warlog_deliveries')).toEqual([]);
  });
  it('invalidates old deliveries on poller recovery while keeping subscription choices', async () => {
    await enable(A); await capture(); const delivery = (await store.claim(A, new Date(now.getTime() + 2_000)))!;
    await store.recover(lease); expect(await store.valid(delivery)).toBe(false);
    await store.commit(lease, snapshot(100, [object('1W')]), [], true, new Date(now.getTime() + 86_400_000));
    expect((await store.subscription(A)).paused).toBe(false);
    expect(await queryAsAdmin(database, 'SELECT * FROM warlog_deliveries')).toEqual([]);
  });
  it('requires renewal only on a new war and keeps a single invitation across retries', async () => {
    await enable(A); await store.configure(A, actor, { kind: 'perspective', perspective: 'COLONIALS' }, now); await store.recover(lease);
    await store.commit(lease, snapshot(101), [], true, new Date(now.getTime() + 86_400_000));
    await store.commit(lease, snapshot(101), [], true, new Date(now.getTime() + 86_400_001));
    expect(await store.subscription(A)).toMatchObject({ paused: true, perspective: 'COLONIALS', channelId: channel, zones: ['west_coast'] });
    expect((await queryAsAdmin(database, 'SELECT event_key, notice FROM warlog_deliveries'))).toEqual([{ event_key: 'renew:101', notice: true }]);
    expect(await store.configure(A, actor, { kind: 'enable', war: 100 }, now)).toBe('stale_war');
    expect(await store.configure(A, actor, { kind: 'enable', war: 101 }, now)).toBe('saved');
    await store.recover(lease); await store.commit(lease, snapshot(101), [], true, now);
    expect(await store.subscription(A)).toMatchObject({ paused: false, perspective: 'COLONIALS' });
  });
  it('isolates perspectives per guild and cancels obsolete rendering on a perspective change', async () => {
    await enable(A); await enable(B);
    await store.configure(A, actor, { kind: 'perspective', perspective: 'WARDENS' }, now);
    await store.configure(B, actor, { kind: 'perspective', perspective: 'COLONIALS' }, now);
    await capture();
    const first = (await store.claim(A, new Date(now.getTime() + 2_000)))!;
    expect(first.perspective).toBe('WARDENS');
    expect((await store.claim(B, new Date(now.getTime() + 2_000)))!.perspective).toBe('COLONIALS');
    await store.configure(A, actor, { kind: 'perspective', perspective: 'NONE' }, new Date(now.getTime() + 3_000));
    expect(await store.valid(first)).toBe(false);
    expect(await store.subscription(A)).toMatchObject({ perspective: 'NONE', paused: false });
    expect((await store.subscription(B)).perspective).toBe('COLONIALS');
    expect(await queryAsAdmin(database, "SELECT after->>'perspective' AS perspective FROM guild_audit_log WHERE guild_id = $1 AND action = 'settings.warlog.perspective' ORDER BY id", [A])).toEqual([{ perspective: 'WARDENS' }, { perspective: 'NONE' }]);
  });
  it('publishes the same nuclear alert with different colors for opposite guild perspectives', async () => {
    await enable(A); await enable(B);
    const otherChannel = ChannelId.assert('600000000000000002');
    await store.configure(B, actor, { kind: 'channel', channelId: otherChannel, locale: 'fr' }, now);
    await store.configure(A, actor, { kind: 'perspective', perspective: 'WARDENS' }, now);
    await store.configure(B, actor, { kind: 'perspective', perspective: 'COLONIALS' }, now);
    const site = { ...object('0W'), code: '4A' as const, key: 'WestgateHex:4A:0.10000:0.20000' };
    const sentAt = new Date(now.getTime() + 1_000);
    await store.commit(lease, snapshot(100, [site]), [{ type: 'launch_armed', war: 100, object: site, faction: 'WARDENS', occurredAt: sentAt.getTime(), detectedAt: sentAt.getTime() }], false, sentAt);
    const send = jest.fn().mockResolvedValue('800000000000000001');
    const publisher = new PublishWarLog(store, { send, fetch: jest.fn(), edit: jest.fn(), delete: jest.fn() }, createI18n(), { now: () => sentAt }, noopLogger, async () => 'fr', async () => {});
    await publisher.tick();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.find(([id]) => id === channel)![1].embeds[0].color).toBe(WAR_LOG_COLORS.favorable);
    expect(send.mock.calls.find(([id]) => id === otherChannel)![1].embeds[0].color).toBe(WAR_LOG_COLORS.unfavorable);
    expect((await queryAsAdmin(database, 'SELECT * FROM warlog_deliveries WHERE completed_at IS NULL'))).toEqual([]);
  });
  it('fences a stale poller and preserves the last valid state', async () => {
    const stale = { ...lease, token: lease.token + 1n };
    expect(await store.recover(stale)).toBe(false);
    expect(await store.commit(stale, snapshot(101), [], true, now)).toBe(false);
    expect((await store.state()).highestWar).toBe(100);
    expect(await store.commit(lease, snapshot(99), [], true, now)).toBe(false);
  });
  it('persists coordinate-specific concrete timers, cancels destruction and skips overdue recovery notices', async () => {
    const first = { ...object('0V'), key: 'WestgateHex:3A:0.10000:0.20000', code: '3A' as const };
    const second = { ...first, key: 'WestgateHex:3A:0.20000:0.20000', x: .2 };
    const events = [first, second].map(obj => objectEvent(undefined, obj, 100, now.getTime(), now.getTime())!);
    await store.commit(lease, snapshot(100, [first, second]), events, false, now);
    expect(await queryAsAdmin(database, 'SELECT object_key FROM concrete_timers')).toHaveLength(2);
    const destroyed = objectEvent(first, undefined, 100, now.getTime() + 1_000, now.getTime() + 1_000)!;
    await store.commit(lease, snapshot(100, [second]), [destroyed], false, now);
    expect(await queryAsAdmin(database, 'SELECT object_key FROM concrete_timers')).toHaveLength(1);
    await store.recover(lease); await store.commit(lease, snapshot(100, [second]), [], true, new Date(now.getTime() + 49 * 3_600_000));
    expect(await queryAsAdmin(database, "SELECT * FROM war_events WHERE payload->>'type' = 'sc_dried'")).toEqual([]);
  });
  it('retains only the current and preceding observed wars', async () => {
    await store.commit(lease, snapshot(101), [], true, now); await store.commit(lease, snapshot(102), [], true, now);
    expect(await queryAsAdmin(database, 'SELECT war_number FROM wars ORDER BY war_number')).toEqual([{ war_number: 101 }, { war_number: 102 }]);
  });
  it('suspends only the affected channel on a definitive send error', async () => {
    await enable(A); await enable(B); await capture(); const delivery = (await store.claim(A, new Date(now.getTime() + 2_000)))!;
    await store.finish(delivery, { kind: 'blocked', reason: 'missing_permissions' }, now);
    expect((await store.subscription(A)).paused).toBe(true); expect((await store.subscription(B)).paused).toBe(false);
  });
  it('purges all tenant data while retaining shared game observations', async () => {
    await enable(A); await enable(B); await capture(); await purgeGuildData(database.handle.db, A);
    expect(await queryAsAdmin(database, 'SELECT guild_id FROM warlog_subscriptions')).toEqual([{ guild_id: B }]);
    expect(await queryAsAdmin(database, 'SELECT * FROM war_events')).toHaveLength(1);
  });
  it('protects new timers and makes a new-war reset idempotent', async () => {
    const board = '00000000-0000-0000-0000-000000000001';
    await queryAsAdmin(database, `INSERT INTO timer_boards(id,guild_id,channel_id,created_by,settings) VALUES($1,$2,$3,$4,'{"resetOnNewWar":true}')`, [board,A,channel,actor]);
    const insert = async (id: string, created: Date) => queryAsAdmin(database, `INSERT INTO timer_assets(id,board_id,guild_id,type,name,region_key,location_key,owner_user_id,direction,duration_s,started_at,created_at) VALUES($1,$2,$3,'facility','test','westgate','jadecove',$4,'down',3600,$5,$5)`, [id,board,A,actor,created]);
    await insert('oldtimer', new Date(now.getTime() - 1_000)); await insert('newtimer', new Date(now.getTime() + 1_000));
    const timers = new PostgresTimerStore(database.handle.db);
    await timers.resetForNewWar(A, 101, now, new Date(now.getTime() + 2_000));
    await insert('laterone', new Date(now.getTime() + 3_000));
    await timers.resetForNewWar(A, 101, now, new Date(now.getTime() + 4_000));
    expect(await queryAsAdmin(database, 'SELECT id FROM timer_assets ORDER BY id')).toEqual([{ id: 'laterone' }, { id: 'newtimer' }]);
    expect(await queryAsAdmin(database, "SELECT * FROM timer_events WHERE action = 'reset_war'")).toHaveLength(1);
    await queryAsAdmin(database, `UPDATE guild_settings SET features = jsonb_set(features,'{timers}','false') WHERE guild_id = $1`, [A]);
    await timers.resetForNewWar(A, 102, new Date(now.getTime() + 10_000), new Date(now.getTime() + 11_000));
    expect(await queryAsAdmin(database, 'SELECT id FROM timer_assets ORDER BY id')).toEqual([{ id: 'laterone' }, { id: 'newtimer' }]);
  });
  it.each([100,300])('delivers one capture to %i guilds within the simulated 120-second target, without grouping', async count => {
    const guilds = Array.from({ length: count }, (_, i) => GuildId.assert(String(700000000000001000n + BigInt(i))));
    for (const guild of guilds) { await register(guild); await enable(guild); }
    await capture(); let businessNow = new Date(now.getTime() + 2_000);
    const send = jest.fn().mockResolvedValue('800000000000000001');
    const publisher = new PublishWarLog(store, { send, fetch: jest.fn(), edit: jest.fn(), delete: jest.fn() }, createI18n(), { now: () => businessNow }, noopLogger, async () => 'en', async () => {});
    const started = Date.now();
    for (let i = 0; i < Math.ceil(count / 10); i++) { await publisher.tick(); businessNow = new Date(businessNow.getTime() + 1_000); }
    expect(send).toHaveBeenCalledTimes(count);
    expect(send.mock.calls.every(call => !call[1].content.includes('\n') && call[1].embeds.length === 0)).toBe(true);
    expect(new Set(send.mock.calls.map(call => call[1].nonce)).size).toBe(count);
    expect(businessNow.getTime() - now.getTime() + Date.now() - started).toBeLessThan(120_000);
  }, 60_000);
  it('paces authenticated requests from independent replicas through one shared budget', async () => {
    await queryAsAdmin(database, 'TRUNCATE discord_request_budget');
    const one = new PostgresDiscordBudget(database.handle.db), two = new PostgresDiscordBudget(database.handle.db);
    const start = Date.now();
    await Promise.all(Array.from({ length: 16 }, (_, i) => (i % 2 ? one : two).acquire()));
    expect(Date.now() - start).toBeGreaterThanOrEqual(350);
  });
});
