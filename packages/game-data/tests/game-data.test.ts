import {
  GAME_DATA_VERSION,
  allRegions,
  findLocation,
  findRegion,
  normalizeText,
  resolveLocation,
  resolveRegion,
  searchLocations,
  searchRegions,
} from '@picket/game-data';

describe('game data catalogue', () => {
  it('holds the regions and locations of the game, versioned', () => {
    expect(allRegions().length).toBeGreaterThanOrEqual(53);
    expect(allRegions().reduce((total, region) => total + region.locations.length, 0)).toBeGreaterThanOrEqual(900);
    expect(GAME_DATA_VERSION).toMatch(/^\d{4}\.\d{2}$/);
  });

  it('gives every region and location a unique, short, payload-safe key', () => {
    const regionKeys = new Set<string>();
    for (const region of allRegions()) {
      expect(region.key).toMatch(/^[a-z0-9]{1,24}$/);
      expect(regionKeys.has(region.key)).toBe(false);
      regionKeys.add(region.key);
      const locationKeys = new Set<string>();
      for (const location of region.locations) {
        expect(location.key).toMatch(/^[a-z0-9]{1,24}$/);
        expect(locationKeys.has(location.key)).toBe(false);
        locationKeys.add(location.key);
        expect(location.regionKey).toBe(region.key);
      }
    }
  });

  it('fits the longest add-timer custom id in the 100 characters Discord allows', () => {
    const longestRegion = Math.max(...allRegions().map((region) => region.key.length));
    const longestLocation = Math.max(...allRegions().flatMap((region) => region.locations.map((location) => location.key.length)));
    // `tm:1:a:<type>:<region>:<location>:<owner snowflake>`
    expect('tm:1:a:'.length + 2 + 1 + longestRegion + 1 + longestLocation + 1 + 20).toBeLessThanOrEqual(100);
  });

  it('orders alphabetically without the article', () => {
    const names = allRegions().map((region) => region.name);
    expect(names.indexOf('The Deadlands')).toBeLessThan(names.indexOf('Westgate'));
    expect(names.indexOf('Callum\'s Cape')).toBeLessThan(names.indexOf('The Deadlands'));
    expect(allRegions().map((region) => region.order)).toEqual(allRegions().map((_region, index) => index));
  });

  it('normalises accents, case and punctuation', () => {
    expect(normalizeText('Loch Mór')).toBe('lochmor');
    expect(normalizeText("Allod's Bight")).toBe('allodsbight');
  });

  it('finds by key and resolves an exact name, never an approximate one', () => {
    const region = resolveRegion('loch mor');
    expect(region?.name).toBe('Loch Mór');
    expect(findRegion('lochmor')).toBe(region);
    expect(resolveRegion('Deadland')).toBeUndefined();
    const location = resolveLocation('allodsbight', "mercy's wail");
    expect(location?.name).toBe("Mercy's Wail");
    expect(findLocation('allodsbight', 'mercyswail')).toBe(location);
    expect(findLocation('allodsbight', 'unknown')).toBeUndefined();
    expect(findLocation('unknown', 'mercyswail')).toBeUndefined();
  });
});

describe('game data search', () => {
  it('ranks an exact name, then a prefix, then a word prefix, then a substring', () => {
    const names = searchRegions('dead').map((region) => region.name);
    expect(names[0]).toBe('The Deadlands');
    expect(searchRegions('the deadlands')[0]?.name).toBe('The Deadlands');
    expect(searchRegions('Westgate')[0]?.name).toBe('Westgate');
  });

  it('suggests approximate typings without ever applying them', () => {
    expect(searchRegions('dlnds').map((region) => region.name)).toContain('The Deadlands');
    expect(resolveRegion('dlnds')).toBeUndefined();
  });

  it('returns the first regions in order for an empty query, and at most the limit', () => {
    expect(searchRegions('')).toHaveLength(25);
    expect(searchRegions('', 3).map((region) => region.order)).toEqual([0, 1, 2]);
  });

  it('searches the locations of one region only', () => {
    expect(searchLocations('allodsbight', 'mercy').map((location) => location.name)).toEqual(["Mercy's Wail"]);
    expect(searchLocations('allodsbight', 'zzzz')).toEqual([]);
    expect(searchLocations('unknown', 'mercy')).toEqual([]);
    expect(searchLocations('allodsbight', '').length).toBeLessThanOrEqual(25);
  });
});
