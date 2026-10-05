import {
  activeAssets,
  compareAssets,
  deadline,
  displayedMoment,
  isExpired,
  reactivateAsset,
  refreshAsset,
  sameResource,
  strikeAsset,
} from '@picket/timers';
import { HOUR_MS, NOW, OTHER, makeAsset } from './fixtures';

const later = (hours: number) => new Date(NOW.getTime() + hours * HOUR_MS);

describe('asset lifecycle', () => {
  it('a countdown ends at start plus duration; an age has no deadline', () => {
    expect(deadline(makeAsset())).toEqual(later(50));
    expect(displayedMoment(makeAsset())).toEqual(later(50));
    const field = makeAsset({ type: 'field', direction: 'up', durationS: 3_600 });
    expect(deadline(field)).toBeNull();
    expect(displayedMoment(field)).toEqual(NOW);
  });

  it('TIM-RQ-07: expiry is informative, computed from the clock, and never stored', () => {
    const asset = makeAsset();
    expect(isExpired(asset, later(49))).toBe(false);
    expect(isExpired(asset, later(50))).toBe(true);
    expect(isExpired(makeAsset({ type: 'field', direction: 'up' }), later(1_000))).toBe(false);
  });

  it('TIM-EC-08: striking freezes the displayed moment and keeps the original duration and direction', () => {
    const struck = strikeAsset(makeAsset(), later(10));
    expect(struck).toMatchObject({ status: 'struck', struckAt: later(10), frozenAt: later(50), durationS: 50 * 3_600, direction: 'down', rev: 1 });
    expect(deadline(struck)).toBeNull();
    expect(displayedMoment(struck)).toEqual(later(50));

    const field = strikeAsset(makeAsset({ type: 'field', direction: 'up' }), later(7));
    expect(field.frozenAt).toEqual(NOW);
  });

  it('a refresh restarts the countdown from its duration, and an age from zero', () => {
    const refreshed = refreshAsset(makeAsset(), later(20));
    expect(refreshed.startedAt).toEqual(later(20));
    expect(deadline(refreshed)).toEqual(later(70));
    expect(refreshed.rev).toBe(1);
    expect(displayedMoment(refreshAsset(makeAsset({ type: 'field', direction: 'up' }), later(20)))).toEqual(later(20));
  });

  it('adding a struck asset again reactivates it: same id, new start, duration and owner', () => {
    const struck = strikeAsset(makeAsset(), later(10));
    const back = reactivateAsset(struck, { ownerId: OTHER, durationS: 3_600, now: later(11) });
    expect(back).toMatchObject({ id: struck.id, status: 'active', struckAt: null, frozenAt: null, ownerId: OTHER, durationS: 3_600, startedAt: later(11) });
    expect(deadline(back)).toEqual(later(12));
  });

  it('recognises the same resource by type, name (any case), place and code', () => {
    const base = makeAsset({ name: 'Depot', code: '123456' });
    expect(sameResource(base, { ...base, name: 'DEPOT' })).toBe(true);
    expect(sameResource(base, { ...base, code: '654321' })).toBe(false);
    expect(sameResource(base, { ...base, locationKey: 'rumhold' })).toBe(false);
    expect(sameResource(base, { ...base, type: 'facility' })).toBe(false);
    expect(sameResource({ ...base, code: null }, { ...base, code: null })).toBe(true);
  });

  it('keeps only the active assets', () => {
    const active = makeAsset();
    expect(activeAssets([active, strikeAsset(makeAsset(), NOW)])).toEqual([active]);
  });
});

describe('compareAssets', () => {
  it('orders by region, location, type, then name, ignoring the article of a region', () => {
    const at = (regionKey: string, locationKey: string, extra: Parameters<typeof makeAsset>[0] = {}) => makeAsset({ regionKey, locationKey, ...extra });
    const deadlands = at('thedeadlands', 'abandonedward');
    const allods = at('allodsbight', 'rumhold');
    const allodsMercy = at('allodsbight', 'mercyswail', { type: 'tank', code: null, name: 'B' });
    const allodsMercyStock = at('allodsbight', 'mercyswail', { type: 'stockpile', name: 'Z' });
    const allodsMercyStockA = at('allodsbight', 'mercyswail', { type: 'stockpile', name: 'A' });
    const sorted = [deadlands, allods, allodsMercy, allodsMercyStock, allodsMercyStockA].sort(compareAssets);
    expect(sorted.map((asset) => asset.id)).toEqual([allodsMercyStockA, allodsMercyStock, allodsMercy, allods, deadlands].map((asset) => asset.id));
  });

  it('is total and stable: equal places and names fall back on the id', () => {
    const a = makeAsset({ name: 'Same' });
    const b = makeAsset({ name: 'Same' });
    expect([b, a].sort(compareAssets).map((asset) => asset.id)).toEqual([a.id, b.id].sort());
    expect(compareAssets(a, a)).toBe(0);
  });
});
