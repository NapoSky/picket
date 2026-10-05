import { err, ok, type Result } from '@picket/kernel';
import { MAX_CATEGORY_NAME, MAX_FACTOR, MAX_INPUT_LENGTH, MAX_ITEMS, MAX_ITEM_TEXT } from './constants';

export interface TodoItem {
  readonly text: string;
  /** Nombre de clics nécessaires ; 1 par défaut. */
  readonly factor: number;
}

/** Ligne de la liste, dans l'ordre de saisie : rien n'est jamais déplacé ni supprimé (sauf un doublon fusionné). */
export type TodoLine =
  | { readonly kind: 'text'; readonly raw: string }
  | { readonly kind: 'category'; readonly raw: string }
  | { readonly kind: 'item'; readonly item: TodoItem; readonly categoryRaw: string | null };

export interface Todolist {
  readonly lines: readonly TodoLine[];
  readonly itemCount: number;
}

export type ParseError =
  | { readonly code: 'empty' }
  | { readonly code: 'input_too_long'; readonly max: number }
  | { readonly code: 'no_items' }
  | { readonly code: 'too_many_items'; readonly max: number }
  | { readonly code: 'item_too_long'; readonly line: number; readonly max: number };

// Un marqueur n'est reconnu que s'il est sans ambiguïté : emoji lettre (tous séparateurs) ou lettre majuscule
// avec `・` / `·` seulement. `A - titre` ou `N: note` restent du texte libre.
const MARKER = String.raw`(?:\p{Regional_Indicator}|:regional_indicator_[a-z]:)`;
const EMOJI_ITEM = new RegExp(String.raw`^${MARKER}\s*[・·:-]\s*(.+)$`, 'u');
const LETTER_ITEM = /^[A-Z]\s*[・·]\s*(.+)$/u;

const UNDERLINE_BOLD = /^__\*\*(.+?)\*\*__$/u;
const BOLD_UNDERLINE = /^\*\*__(.+?)__\*\*$/u;
const UNDERLINE = /^__(.+?)__$/u;
const BOLD = /^\*\*(.+?)\*\*$/u;
const FACTOR = /^(.+?)\s*\(x(\d+)\)\s*$/iu;

/**
 * Sépare le texte et le facteur `(xN)`. Seuls 2 à 999 sont des facteurs ; `(x1)` est redondant et disparaît ;
 * `(x0)` ou plus de 999 restent du texte, et ne seront donc jamais décrémentés.
 */
export function splitFactor(text: string): TodoItem {
  const match = FACTOR.exec(text);
  if (!match) return { text, factor: 1 };
  const base = (match[1] as string).trim();
  const count = Number(match[2]);
  if (count === 1) return { text: base, factor: 1 };
  if (count >= 2 && count <= MAX_FACTOR) return { text: base, factor: count };
  return { text, factor: 1 };
}

type Draft =
  | { readonly kind: 'blank' }
  | { readonly kind: 'text'; readonly raw: string }
  | { readonly kind: 'item'; readonly content: string; readonly source: number }
  | { readonly kind: 'category'; readonly raw: string }
  | { readonly kind: 'bold'; readonly raw: string };

const validName = (name: string, forbidden: string): boolean => {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_CATEGORY_NAME && !trimmed.includes(forbidden);
};

function classify(line: string, source: number): Draft {
  if (line === '') return { kind: 'blank' };
  const item = EMOJI_ITEM.exec(line) ?? LETTER_ITEM.exec(line);
  if (item) return { kind: 'item', content: (item[1] as string).trim(), source };

  const underlineBold = UNDERLINE_BOLD.exec(line) ?? BOLD_UNDERLINE.exec(line);
  if (underlineBold && validName(underlineBold[1] as string, '**') && !(underlineBold[1] as string).includes('__')) {
    return { kind: 'category', raw: line };
  }
  const underline = UNDERLINE.exec(line);
  if (underline && validName(underline[1] as string, '__') && !(underline[1] as string).includes('**')) {
    return { kind: 'category', raw: line };
  }
  const bold = BOLD.exec(line);
  if (bold && validName(bold[1] as string, '**')) return { kind: 'bold', raw: line };
  return { kind: 'text', raw: line };
}

const categoryKey = (raw: string): string => raw.replace(/[_*]/gu, '').trim().toLowerCase();

/**
 * Grammaire stricte, pure et déterministe : le même texte donne toujours la même liste.
 * - item : marqueur (🇦, `:regional_indicator_a:`, ou `A` suivi de `・`/`·`) puis séparateur puis texte ; le marqueur saisi est
 *   ignoré (les lettres sont attribuées au rendu) ;
 * - catégorie : `__Nom__`, `__**Nom**__`, `**__Nom__**`, ou `**Nom**` quand un item suit ;
 * - tout le reste est du texte libre, conservé à sa place.
 */
export function parseTodolist(input: string): Result<Todolist, ParseError> {
  if (input.length > MAX_INPUT_LENGTH) return err({ code: 'input_too_long', max: MAX_INPUT_LENGTH });
  const sourceLines = input.replace(/\r\n?/gu, '\n').split('\n').map((line) => line.trim());
  if (sourceLines.every((line) => line === '')) return err({ code: 'empty' });

  const drafts = sourceLines.map((line, index) => classify(line, index + 1));

  // `**Titre**` n'est une catégorie que s'il introduit des items : sans liste de mots interdits dépendante d'une langue.
  const resolved = drafts.map((draft, index): Draft => {
    if (draft.kind !== 'bold') return draft;
    const next = drafts.slice(index + 1).find((candidate) => candidate.kind !== 'blank');
    return next?.kind === 'item' ? { kind: 'category', raw: draft.raw } : { kind: 'text', raw: draft.raw };
  });

  const lines: TodoLine[] = [];
  const merged = new Map<string, number>();
  let currentCategory: string | null = null;

  for (const draft of resolved) {
    switch (draft.kind) {
      case 'blank':
        lines.push({ kind: 'text', raw: '' });
        break;
      case 'text':
        lines.push({ kind: 'text', raw: draft.raw });
        break;
      case 'category':
        currentCategory = draft.raw;
        lines.push({ kind: 'category', raw: draft.raw });
        break;
      case 'bold':
        break;
      case 'item': {
        const item = splitFactor(draft.content);
        if (item.text.length > MAX_ITEM_TEXT) return err({ code: 'item_too_long', line: draft.source, max: MAX_ITEM_TEXT });
        // Doublon dans la même catégorie : fusionné (facteurs additionnés) à la première position.
        const key = `${currentCategory === null ? '' : categoryKey(currentCategory)}\u0000${item.text.toLowerCase()}`;
        const existingIndex = merged.get(key);
        const existing = existingIndex === undefined ? undefined : lines[existingIndex];
        if (existingIndex !== undefined && existing?.kind === 'item' && existing.item.factor + item.factor <= MAX_FACTOR) {
          lines[existingIndex] = { ...existing, item: { text: existing.item.text, factor: existing.item.factor + item.factor } };
          break;
        }
        if (!merged.has(key)) merged.set(key, lines.length);
        lines.push({ kind: 'item', item, categoryRaw: currentCategory });
        break;
      }
    }
  }

  // Lignes vides : jamais deux d'affilée, jamais en tête ni en queue (mise en forme seulement).
  const cleaned: TodoLine[] = [];
  for (const line of lines) {
    const blank = line.kind === 'text' && line.raw === '';
    const previous = cleaned[cleaned.length - 1];
    if (blank && (previous === undefined || (previous.kind === 'text' && previous.raw === ''))) continue;
    cleaned.push(line);
  }
  while (cleaned.length > 0 && cleaned[cleaned.length - 1]?.kind === 'text' && (cleaned[cleaned.length - 1] as { raw: string }).raw === '') {
    cleaned.pop();
  }

  const itemCount = cleaned.filter((line) => line.kind === 'item').length;
  if (itemCount === 0) return err({ code: 'no_items' });
  if (itemCount > MAX_ITEMS) return err({ code: 'too_many_items', max: MAX_ITEMS });
  return ok({ lines: cleaned, itemCount });
}
