import { DONE_MARKER, ITEM_SEPARATOR, MAX_FACTOR, REGIONAL_INDICATOR_A } from './constants';
import { splitFactor } from './parser';

/** Open item line: emoji letter, separator, text. Completed lines start with ✅ and are excluded. */
const OPEN_ITEM = new RegExp(String.raw`^(\p{Regional_Indicator})${ITEM_SEPARATOR}(.+)$`, 'u');

function openItem(line: string): { index: number; text: string } | null {
  const match = OPEN_ITEM.exec(line);
  if (!match) return null;
  const index = (match[1] as string).codePointAt(0)! - REGIONAL_INDICATOR_A;
  return { index, text: match[2] as string };
}

/** Indices of open items (0 for 🇦), in display order. */
export function openItemIndexes(description: string): number[] {
  const indexes: number[] = [];
  for (const line of description.split('\n')) {
    const item = openItem(line);
    if (item) indexes.push(item.index);
  }
  return indexes;
}

export type TickOutcome =
  /** Item no longer open: already ticked by someone else, or message modified. */
  | { readonly kind: 'not_found' }
  | { readonly kind: 'updated'; readonly description: string; readonly openIndexes: readonly number[] }
  /** No open items remain on this page. */
  | { readonly kind: 'completed' };

/**
 * Apply a click by changing only the item's line. Never reread or rewrite other message content (free text,
 * categories), so it cannot be lost. Decrement factors above 1; otherwise strike the item.
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
