import { noopLogger } from '@picket/kernel';
import { WarPoller, type WarApi, type WarStore, type MapData, type PollSnapshot } from '../src';

const war = { id: 'war100', number: 100, startedAt: 1_000, endedAt: null, winner: 'NONE' as const };
function harness() {
  let now = 10_000;
  const store = {
    state: jest.fn().mockResolvedValue({ generation: '1', available: true, highestWar: 100, snapshot: null }),
    objects: jest.fn().mockResolvedValue([]), recover: jest.fn().mockResolvedValue(true), commit: jest.fn().mockResolvedValue(true),
    subscription: jest.fn(), configure: jest.fn(), guilds: jest.fn().mockResolvedValue([]), hookGuilds: jest.fn().mockResolvedValue([]), claim: jest.fn(), valid: jest.fn(), finish: jest.fn(), channelChanged: jest.fn(), runHook: jest.fn(),
  } satisfies WarStore;
  const map: MapData = { version: 1, updatedAt: 1_000, items: [{ iconType: 56, teamId: 'COLONIALS', flags: 0, x: .1, y: .2 }] };
  const api = { war: jest.fn().mockResolvedValue(war), maps: jest.fn().mockResolvedValue(['WestgateHex']), labels: jest.fn().mockResolvedValue([{ text: 'Jade Cove', x: .1, y: .2, major: true }]), map: jest.fn().mockResolvedValue(map), reset: jest.fn(), stop: jest.fn() } satisfies WarApi;
  const logger = { ...noopLogger, warn: jest.fn() };
  const poller = new WarPoller(api, store, { name: 'warlog-poller', holder: 'a', token: 1n }, { now: () => new Date(now) }, logger);
  return { store, api, map, logger, tick: () => poller.tick(), advance: (ms: number) => { now += ms; } };
}

it('reports each unknown icon once across regions and polling cycles while retaining tracked objects', async () => {
  const h = harness();
  h.api.maps.mockResolvedValue(['WestgateHex', 'OriginHex']);
  h.api.map.mockResolvedValue({ ...h.map, items: [...h.map.items, { ...h.map.items[0]!, iconType: 97 }, { ...h.map.items[0]!, iconType: 88 }] });
  await h.tick(); h.advance(15_000); await h.tick();
  expect(h.logger.warn.mock.calls).toEqual([[{ icons: [97] }, 'unknown War API icons']]);
  const snapshot = h.store.commit.mock.calls[1]![1] as PollSnapshot;
  expect(Object.values(snapshot.objects)).toHaveLength(2);
  expect(Object.values(snapshot.objects).every(object => object.code === '1B')).toBe(true);
  expect(h.store.commit.mock.calls[1]?.[2]).toEqual([]);

  h.api.map.mockResolvedValue({ ...h.map, items: [...h.map.items, { ...h.map.items[0]!, iconType: 97 }, { ...h.map.items[0]!, iconType: 98 }] });
  h.advance(15_000); await h.tick(); h.advance(15_000); await h.tick();
  expect(h.logger.warn.mock.calls).toEqual([
    [{ icons: [97] }, 'unknown War API icons'],
    [{ icons: [98] }, 'unknown War API icons'],
  ]);
});
it('keeps unknown icon diagnostics deduplicated after recovery and a new war', async () => {
  const h = harness();
  h.api.map.mockResolvedValue({ ...h.map, items: [{ ...h.map.items[0]!, iconType: 97 }] });
  await h.tick();
  h.api.map.mockRejectedValueOnce(new Error('region unavailable'));
  h.advance(15_000); await h.tick(); h.advance(15_000); await h.tick();
  h.api.war.mockResolvedValue({ ...war, id: 'war101', number: 101 });
  h.advance(15_000); await h.tick();
  expect(h.logger.warn.mock.calls.filter(call => call[1] === 'unknown War API icons')).toEqual([
    [{ icons: [97] }, 'unknown War API icons'],
  ]);
  expect(h.store.commit).toHaveBeenCalledTimes(3);
});

it('initialises silently then emits a capture with separate API and detection timestamps', async () => {
  const h = harness(); await h.tick();
  expect(h.store.commit.mock.calls[0]?.[2]).toEqual([]); expect(h.store.commit.mock.calls[0]?.[3]).toBe(true);
  h.api.map.mockResolvedValue({ ...h.map, version: 2, updatedAt: 2_000, items: [{ ...h.map.items[0]!, teamId: 'WARDENS' }] });
  h.advance(15_000); await h.tick();
  expect(h.store.commit.mock.calls[1]?.[2]).toEqual([expect.objectContaining({ type: 'claimed', faction: 'WARDENS', occurredAt: 2_000, detectedAt: 25_000 })]);
});
it('recovers after API failure at boot rather than remaining dead', async () => {
  const h = harness(); h.api.war.mockRejectedValueOnce(new Error('offline')); await h.tick();
  expect(h.store.commit).not.toHaveBeenCalled(); await h.tick(); expect(h.api.war).toHaveBeenCalledTimes(1);
  h.advance(15_000); await h.tick(); expect(h.store.commit.mock.calls[0]?.[3]).toBe(true);
});
it('drops comparison after a partial failure and silently rebuilds every region', async () => {
  const h = harness(); await h.tick(); h.api.map.mockRejectedValueOnce(new Error('region unavailable'));
  h.advance(15_000); await h.tick(); expect(h.store.commit).toHaveBeenCalledTimes(1);
  h.api.map.mockResolvedValue({ ...h.map, version: 3, updatedAt: 3_000, items: [] });
  h.advance(15_000); await h.tick(); expect(h.store.commit.mock.calls[1]?.[2]).toEqual([]);
  expect(h.api.maps).toHaveBeenCalledTimes(2); expect(h.api.labels).toHaveBeenCalledTimes(2);
});
it('does not activate a baseline assembled across different wars', async () => {
  const h = harness(); h.api.war.mockResolvedValueOnce(war).mockResolvedValueOnce({ ...war, id: 'war101', number: 101 });
  await h.tick(); expect(h.store.commit).not.toHaveBeenCalled(); expect(h.store.recover).toHaveBeenCalled();
});
it('uses fencing failures without adopting the rejected state', async () => {
  const h = harness(); h.store.commit.mockResolvedValueOnce(false); await h.tick(); await h.tick();
  expect(h.store.commit.mock.calls.every((call: unknown[]) => call[3] === true)).toBe(true);
});
it('protects the monotone war number against a replay', async () => {
  const h = harness(); h.api.war.mockResolvedValue({ ...war, number: 99 }); await h.tick(); expect(h.store.commit).not.toHaveBeenCalled();
});
it('an unchanged successful map does not trigger reconstruction', async () => {
  const h = harness(); await h.tick(); await h.tick();
  expect(h.api.maps).toHaveBeenCalledTimes(1); expect(h.store.commit.mock.calls[1]?.[2]).toEqual([]);
});
it('rebuilds silently after a process suspension even when the API returns success', async () => {
  const h = harness(); await h.tick(); h.advance(300_000);
  h.api.map.mockResolvedValue({ ...h.map, version: 2, updatedAt: 2_000, items: [{ ...h.map.items[0]!, teamId: 'WARDENS' }] });
  await h.tick(); expect(h.api.maps).toHaveBeenCalledTimes(2);
  expect(h.store.commit.mock.calls[1]?.[2]).toEqual([]); expect(h.store.commit.mock.calls[1]?.[3]).toBe(true);
});
it('announces the winner once when it arrives after the end timestamp during live polling', async () => {
  const h = harness(); await h.tick(); h.advance(15_000);
  h.api.war.mockResolvedValue({ ...war, endedAt: 20_000 }); await h.tick();
  expect(h.store.commit.mock.calls[1]?.[2]).toEqual([]);
  h.api.war.mockResolvedValue({ ...war, endedAt: 20_000, winner: 'WARDENS' });
  h.advance(15_000); await h.tick();
  expect(h.store.commit.mock.calls[2]?.[2]).toEqual([expect.objectContaining({ type: 'war_ended', faction: 'WARDENS' })]);
  h.advance(15_000); await h.tick(); expect(h.store.commit.mock.calls[3]?.[2]).toEqual([]);
});
