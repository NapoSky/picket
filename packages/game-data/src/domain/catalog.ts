import { REGIONS_DATA } from './regions-data';

export interface GameLocation {
  /** Identifiant stable et court (lettres minuscules et chiffres), unique dans la région. */
  readonly key: string;
  readonly name: string;
  readonly regionKey: string;
  /** Rang d'affichage dans la région (ordre alphabétique, sans l'article « The »). */
  readonly order: number;
}

export interface GameRegion {
  /** Identifiant stable et court (lettres minuscules et chiffres), unique. */
  readonly key: string;
  readonly name: string;
  readonly order: number;
  readonly locations: readonly GameLocation[];
}

/** Version du jeu de données : à incrémenter quand un nom ou une clé change. */
export const GAME_DATA_VERSION = '2026.03';

/** Minuscules, sans accents ni ponctuation ni espaces : sert de clé et de base à la recherche. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// L'article ne compte pas dans l'ordre alphabétique (« The Deadlands » se range sous D).
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
 * Accepte la clé ou le nom exact (casse, accents et ponctuation ignorés) : jamais de correction approximative,
 * une faute de frappe se traduit par une erreur et des suggestions, pas par un autre lieu.
 */
export function resolveRegion(input: string): GameRegion | undefined {
  return BY_KEY.get(normalizeText(input));
}

export function resolveLocation(regionKey: string, input: string): GameLocation | undefined {
  return findLocation(regionKey, normalizeText(input));
}
