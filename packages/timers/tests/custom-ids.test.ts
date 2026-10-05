import { decodeCustomId } from '@picket/discord';
import { UserId } from '@picket/kernel';
import { allRegions } from '@picket/game-data';
import { ASSET_TYPE_IDS, ackCustomId, addModalCustomId, parseTimersPayload, refreshCustomId } from '@picket/timers';

const owner = UserId.assert('500000000000000001');

function decodeCustomIdForTest(customId: string) {
  const decoded = decodeCustomId(customId);
  expect(decoded).toMatchObject({ namespace: 'tm', version: 1 });
  return decoded === null ? null : parseTimersPayload(decoded.payload);
}

describe('custom ids', () => {
  it('round-trips a refresh button and an alert acknowledgement', () => {
    expect(decodeCustomIdForTest(refreshCustomId('abc12345xy'))).toEqual({ kind: 'refresh', assetId: 'abc12345xy' });
    expect(decodeCustomIdForTest(ackCustomId('abc12345xy', 120))).toEqual({ kind: 'ack', assetId: 'abc12345xy', thresholdMin: 120 });
  });

  it('carries the type, the place and the owner of a timer to be added through the modal', () => {
    const id = addModalCustomId('naval_ship', 'allodsbight', 'mercyswail', owner);
    expect(id).toBe('tm:1:a:ns:allodsbight:mercyswail:500000000000000001');
    expect(decodeCustomIdForTest(id)).toEqual({ kind: 'add', type: 'naval_ship', regionKey: 'allodsbight', locationKey: 'mercyswail', ownerId: owner });
  });

  it('stays under the 100 characters Discord allows, for every type, region and location', () => {
    for (const type of ASSET_TYPE_IDS) {
      for (const region of allRegions()) {
        for (const location of region.locations) {
          expect(addModalCustomId(type, region.key, location.key, UserId.assert('500000000000000001000')).length).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it.each([
    '',
    'x',
    'r',
    'r:',
    'r:ABC12345',
    'r:short',
    'r:abc12345xy:extra',
    'k:abc12345xy',
    'k:abc12345xy:abc',
    'k:abc12345xy:123456',
    'a:zz:allodsbight:mercyswail:500000000000000001',
    'a:st:Allods:mercyswail:500000000000000001',
    'a:st:allodsbight:mercyswail:12',
    'a:st:allodsbight:mercyswail',
    'a:st:allodsbight:mercyswail:500000000000000001:more',
    'z:abc12345xy',
  ])('refuses the forged or malformed payload %j', (payload) => {
    expect(parseTimersPayload(payload)).toBeNull();
  });
});
