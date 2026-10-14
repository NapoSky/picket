import { REGIONS_DATA } from './regions-data';

export interface GameLocation {
  /** Short stable identifier (lowercase letters and digits), unique within the region. */
  readonly key: string;
  readonly name: string;
  readonly regionKey: string;
  /** Display rank within the region (alphabetical order, ignoring the article The). */
  readonly order: number;
}

export interface GameRegion {
  /** Short stable identifier (lowercase letters and digits), unique. */
  readonly key: string;
  readonly name: string;
  readonly order: number;
  readonly locations: readonly GameLocation[];
}

/** Dataset version: increment when a name or key changes. */
export const GAME_DATA_VERSION = '2026.03';

/** Lowercase, without accents, punctuation or spaces: used as a key and search input. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Ignore the article in alphabetical order (The Deadlands sorts under D).
const sortName = (name: string): string => normalizeText(name.replace(/^the\s+/iu, ''));
const byName = (a: string, b: string): number => sortName(a).localeCompare(sortName(b)) || a.localeCompare(b);

function build(): readonly GameRegion[] {
  const sorted = [...REGIONS_DATA].sort((a, b) => byName(a.name, b.name));
  const keys = new Set<string>();
  return sorted.map((region, order) => {
    const key = normalizeText(region.name);
    if (key === '' || keys.has(key)) throw new Error(`Duplicate or empty region key for "${region.name}"`);
    keys.add(key);
    const locationKeys = new Set<string>();
    const locations = [...region.locations]
      .sort(byName)
      .map((name, index): GameLocation => {
        const locationKey = normalizeText(name);
        if (locationKey === '' || locationKeys.has(locationKey)) {
          throw new Error(`Duplicate or empty location key for "${name}" in "${region.name}"`);
        }
        locationKeys.add(locationKey);
        return { key: locationKey, name, regionKey: key, order: index };
      });
    return { key, name: region.name, order, locations };
  });
}

const REGIONS: readonly GameRegion[] = build();
const BY_KEY = new Map(REGIONS.map((region) => [region.key, region]));

export function allRegions(): readonly GameRegion[] {
  return REGIONS;
}

export function findRegion(key: string): GameRegion | undefined {
  return BY_KEY.get(key);
}

export function findLocation(regionKey: string, key: string): GameLocation | undefined {
  return BY_KEY.get(regionKey)?.locations.find((location) => location.key === key);
}

/**
 * Accept the exact key or name (ignoring case, accents and punctuation), never fuzzy correction. A typo
 * produces an error and suggestions, not a different location.
 */
export function resolveRegion(input: string): GameRegion | undefined {
  return BY_KEY.get(normalizeText(input));
}

export function resolveLocation(regionKey: string, input: string): GameLocation | undefined {
  return findLocation(regionKey, normalizeText(input));
}
