import { DONE_MARKER, ITEM_SEPARATOR, MAX_FACTOR, REGIONAL_INDICATOR_A } from './constants';
import { splitFactor } from './parser';

/** Ligne d'item encore à faire : emoji lettre, séparateur, texte. Les lignes cochées commencent par ✅ et n'en font pas partie. */
const OPEN_ITEM = new RegExp(String.raw`^(\p{Regional_Indicator})${ITEM_SEPARATOR}(.+)$`, 'u');

function openItem(line: string): { index: number; text: string } | null {
  const match = OPEN_ITEM.exec(line);
  if (!match) return null;
  const index = (match[1] as string).codePointAt(0)! - REGIONAL_INDICATOR_A;
  return { index, text: match[2] as string };
}

/** Index (0 pour 🇦) des items à faire, dans l'ordre d'affichage. */
export function openItemIndexes(description: string): number[] {
  const indexes: number[] = [];
  for (const line of description.split('\n')) {
    const item = openItem(line);
    if (item) indexes.push(item.index);
  }
  return indexes;
}

export type TickOutcome =
  /** L'item n'existe plus à faire : déjà coché par quelqu'un d'autre, ou message modifié. */
  | { readonly kind: 'not_found' }
  | { readonly kind: 'updated'; readonly description: string; readonly openIndexes: readonly number[] }
  /** Plus aucun item à faire sur cette page. */
  | { readonly kind: 'completed' };

/**
 * Applique un clic en ne modifiant que la ligne de l'item : le reste du message (texte libre, catégories) n'est
 * jamais relu ni réécrit, donc jamais perdu. Facteur supérieur à 1 : décrémenté ; sinon l'item est barré.
 */
export function tickItem(description: string, index: number): TickOutcome {
  const lines = description.split('\n');
  const position = lines.findIndex((line) => openItem(line)?.index === index);
  if (position < 0) return { kind: 'not_found' };

  const { text } = openItem(lines[position] as string) as { index: number; text: string };
  const { text: base, factor } = splitFactor(text);
  if (factor > 1 && factor <= MAX_FACTOR) {
    const remaining = factor - 1;
    const letter = String.fromCodePoint(REGIONAL_INDICATOR_A + index);
    lines[position] = `${letter}${ITEM_SEPARATOR}${remaining > 1 ? `${base} (x${remaining})` : base}`;
  } else {
    lines[position] = `${DONE_MARKER}${ITEM_SEPARATOR}~~${base}~~`;
  }

  const next = lines.join('\n');
  const openIndexes = openItemIndexes(next);
  return openIndexes.length === 0 ? { kind: 'completed' } : { kind: 'updated', description: next, openIndexes };
}
