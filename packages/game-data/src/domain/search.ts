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
