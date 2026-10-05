import { allRegions, findRegion, normalizeText, type GameLocation, type GameRegion } from './catalog';

export const DEFAULT_SEARCH_LIMIT = 25;

function isSubsequence(query: string, target: string): boolean {
  let position = 0;
  for (const character of target) {
    if (character === query[position]) position += 1;
    if (position === query.length) return true;
  }
  return query.length === 0;
}

/** 0 : ne correspond pas. Plus c'est grand, plus la correspondance est directe. */
function score(query: string, name: string): number {
  if (query === '') return 1;
  const target = normalizeText(name);
  if (target === query) return 100;
  if (target.startsWith(query)) return 80;
  const words = name.split(/[^\p{L}\p{N}]+/u).map(normalizeText).filter((word) => word !== '');
  if (words.some((word) => word.startsWith(query))) return 60;
  if (target.includes(query)) return 40;
  // Une saisie un peu approximative (lettres dans l'ordre) reste proposée, jamais appliquée d'office.
  return query.length >= 3 && isSubsequence(query, target) ? 20 : 0;
}

function rank<T extends { readonly name: string; readonly order: number }>(items: readonly T[], query: string, limit: number): T[] {
  const normalized = normalizeText(query);
  return items
    .map((item) => ({ item, points: score(normalized, item.name) }))
    .filter((entry) => entry.points > 0)
    .sort((a, b) => b.points - a.points || a.item.order - b.item.order)
    .slice(0, limit)
    .map((entry) => entry.item);
}

/** Suggestions pour l'autocomplete : les mieux classées d'abord, `limit` au plus (25 chez Discord). */
export function searchRegions(query: string, limit: number = DEFAULT_SEARCH_LIMIT): GameRegion[] {
  return rank(allRegions(), query, limit);
}

export function searchLocations(regionKey: string, query: string, limit: number = DEFAULT_SEARCH_LIMIT): GameLocation[] {
  const region = findRegion(regionKey);
  return region === undefined ? [] : rank(region.locations, query, limit);
}

export interface GamePlace {
  readonly region: GameRegion;
  readonly location: GameLocation;
}

/** Un nom de lieu existe parfois dans plusieurs régions : le libellé les distingue. */
export const placeLabel = (place: GamePlace): string => `${place.location.name} (${place.region.name})`;

/** Identifiant d'un lieu dans une option de commande : `<région>.<lieu>`. */
export const placeValue = (place: GamePlace): string => `${place.region.key}.${place.location.key}`;

/**
 * Recherche d'un lieu sans connaître sa région : le nom du lieu compte d'abord, puis celui de la région (qui propose
 * alors tous ses lieux), puis les deux ensemble (« mercy allods »).
 */
export function searchPlaces(query: string, limit: number = DEFAULT_SEARCH_LIMIT): GamePlace[] {
  const normalized = normalizeText(query);
  const scored: { place: GamePlace; points: number }[] = [];
  for (const region of allRegions()) {
    for (const location of region.locations) {
      const points = Math.max(
        score(normalized, location.name),
        score(normalized, `${location.name} ${region.name}`) * 0.9,
        score(normalized, region.name) * 0.5,
      );
      if (points > 0) scored.push({ place: { region, location }, points });
    }
  }
  return scored
    .sort((a, b) => b.points - a.points || a.place.region.order - b.place.region.order || a.place.location.order - b.place.location.order)
    .slice(0, limit)
    .map((entry) => entry.place);
}

/**
 * Accepte l'identifiant `<région>.<lieu>` d'une suggestion, ou un nom de lieu exact s'il n'existe que dans une région.
 * Jamais de correction approximative, jamais de choix au hasard entre deux régions.
 */
export function resolvePlace(input: string): GamePlace | undefined {
  const trimmed = input.trim();
  const dot = trimmed.indexOf('.');
  if (dot > 0) {
    const region = findRegion(trimmed.slice(0, dot));
    const location = region?.locations.find((candidate) => candidate.key === trimmed.slice(dot + 1));
    return region !== undefined && location !== undefined ? { region, location } : undefined;
  }
  const key = normalizeText(trimmed);
  if (key === '') return undefined;
  const matches = allRegions().flatMap((region) => region.locations.filter((location) => location.key === key).map((location) => ({ region, location })));
  return matches.length === 1 ? matches[0] : undefined;
}
