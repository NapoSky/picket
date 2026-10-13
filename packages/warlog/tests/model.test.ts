import { WAR_REGION_NAMES, WAR_ZONE_KEYS, WAR_ZONES, validWarZones } from '@picket/game-data';
import { closestLabel, mapObject, objectEvent, snapshotEvents, type EventType, type MapItem, type WarObject } from '../src';

const object = (state: string, code: WarObject['code'] = '1B'): WarObject => ({ key: `WestgateHex:${code}:0.10000:0.20000`, region: 'WestgateHex', code, x: .1, y: .2, location: 'Jade Cove', state, stateAt: 1_000 });
describe('war transitions', () => {
  it.each<[string | undefined, string | undefined, WarObject['code'], EventType | null]>([
    ['1W','1W','1B',null], ['?', '0N','3A',null], ['0N','?','3A',null],
    ['0N','1W','1B','claimed'], ['1C','1W','1B','claimed'], ['1W','0N','1B','lost'],
    ['1W','2V','1B','upgrading'], ['2V','2W','1B','upgraded'], ['3V','2W','1B','couldnt_upgrade'],
    ['1V','0N','1B','didnt_build'], ['1W','1S','1B','scorched'], ['1S','0N','1B','no_longer_scorched'],
    [undefined,'0C','5F','appeared'], ['0C',undefined,'5F','disappeared'], ['0N','0C','5F','claimed'],
    ['0N','1K','2A','building'], ['1K','1C','2A','built'],
    ['0N','0V','4A','launch_detected'], ['0V','0W','4A','launch_armed'], ['0W','0V','4A','launch_disarmed'], ['0W',undefined,'4A','launch_destroyed'],
    [undefined,'0K','4B','rocket_targeting'], ['0K','0C','4B','rocket_hit'], ['0K',undefined,'4B','rocket_no_target'], ['0C',undefined,'4B','rocket_forgotten'],
    [undefined,'0V','3A','sc_built'], ['0V','0W','3A',null], ['0W',undefined,'3A','sc_destroyed'],
    [undefined,'0C','3B','ic_built'], ['0C','0N','3C','ws_destroyed'], ['0W','0S','3A','sc_destroyed'],
  ])('%s -> %s for %s yields %s', (before, after, code, expected) => {
    expect(objectEvent(before === undefined ? undefined : object(before, code), after === undefined ? undefined : object(after, code), 100, 2_000, 3_000)?.type ?? null).toBe(expected);
  });
  it('uses the losing faction for neutralisation and scorched structures', () => {
    expect(objectEvent(object('1C'), object('1S'), 100, 2_000, 3_000)?.faction).toBe('COLONIALS');
    expect(objectEvent(object('3W'), object('0N'), 100, 2_000, 3_000)).toMatchObject({ type: 'lost', tier: 3 });
  });
  it('uses stable rounded coordinates, tier before icon consolidation and a VP flag', () => {
    const item: MapItem = { iconType: 58, flags: 1, teamId: 'WARDENS', x: .123456, y: .20000001 };
    expect(mapObject('WestgateHex', item, [], 10)).toMatchObject({ code: '1A', state: '3W', key: 'WestgateHex:1A:0.12346:0.20000' });
    expect(mapObject('WestgateHex', { ...item, flags: 0 }, [], 10)?.code).toBe('1B');
  });
  it('preserves upgrade progress while the API still reports the old tier', () => {
    const item: MapItem = { iconType: 56, flags: 4, teamId: 'WARDENS', x: .1, y: .2 };
    expect(mapObject('WestgateHex', item, [], 10, object('1W'))?.state).toBe('2V');
    expect(mapObject('WestgateHex', item, [], 10, object('2V'))?.state).toBe('2V');
  });
  it('uses the same nearest-label rule and excludes untracked icons', () => {
    const labels = [{ text: 'Major', x: .8, y: .8, major: true }, { text: 'Minor', x: .1, y: .2, major: false }];
    expect(closestLabel('1B', .1, .2, labels, '?')).toBe('Major');
    expect(closestLabel('5F', .1, .2, labels, '?')).toBe('Minor');
    expect(mapObject('WestgateHex', { iconType: 88, flags: 0, teamId: 'WARDENS', x: .1, y: .2 }, [], 1)).toBeNull();
  });
  it('rejects a backwards map version instead of generating false changes', () => {
    const war = { id: 'war', number: 100, startedAt: 1, endedAt: null, winner: 'NONE' as const };
    const before = { war, regions: { WestgateHex: { version: 3, updatedAt: 3, items: [] } }, objects: {} };
    expect(() => snapshotEvents(before, { ...before, regions: { WestgateHex: { version: 2, updatedAt: 2, items: [] } } }, 4)).toThrow('backwards');
  });
});
describe('geographic catalogue', () => {
  it('partitions all 53 known regions into exactly five zones', () => {
    const names = WAR_ZONE_KEYS.flatMap(zone => [...WAR_ZONES[zone]]);
    expect(WAR_ZONE_KEYS).toHaveLength(5); expect(names).toHaveLength(53);
    expect(new Set(names).size).toBe(53); expect(names.every(name => WAR_REGION_NAMES[name])).toBe(true);
  });
  it('enforces the quota and rejects duplicates and invented zones', () => {
    expect(validWarZones(['center','west_coast','east_coast'])).toBe(true);
    expect(validWarZones(WAR_ZONE_KEYS)).toBe(false); expect(validWarZones(['center','center'])).toBe(false);
    expect(validWarZones(['imaginary'])).toBe(false);
  });
});
