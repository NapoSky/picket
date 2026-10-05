import { err, ok, type Result } from '@picket/kernel';
import {
  ITEMS_PER_PAGE,
  ITEM_SEPARATOR,
  PAGE_HARD_BUDGET,
  PAGE_SOFT_BUDGET,
  letterEmoji,
} from './constants';
import type { TodoItem, Todolist } from './parser';

export interface Page {
  /** Description de l'embed : les lignes d'items portent leur lettre, les autres lignes sont celles de la saisie. */
  readonly description: string;
  readonly itemCount: number;
}

export type LayoutError = { readonly code: 'too_long_to_render' };

export const renderItem = (item: TodoItem): string => (item.factor > 1 ? `${item.text} (x${item.factor})` : item.text);

interface Block {
  /** Lignes (texte libre, catégories, vides) situées avant l'item depuis l'item précédent. */
  readonly gap: readonly string[];
  readonly gapHasCategory: boolean;
  readonly categoryRaw: string | null;
  readonly text: string;
}

interface WorkingPage {
  lines: string[];
  items: number;
  length: number;
}

const isBlank = (line: string): boolean => line === '';
const joined = (lines: readonly string[]): number => lines.reduce((total, line) => total + line.length + 1, 0);

function trimBlank(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && isBlank(lines[start] as string)) start += 1;
  while (end > start && isBlank(lines[end - 1] as string)) end -= 1;
  return lines.slice(start, end);
}

function trimLeadingBlank(lines: readonly string[]): string[] {
  const start = lines.findIndex((line) => !isBlank(line));
  return start < 0 ? [] : lines.slice(start);
}

/**
 * Découpe en pages d'au plus 25 items et de longueur bornée. Un item et le texte qui le précède restent ensemble ;
 * une catégorie à cheval sur deux pages est répétée en tête de la suivante ; le texte final reste sur la dernière page.
 */
export function layoutPages(list: Todolist): Result<readonly Page[], LayoutError> {
  const blocks: Block[] = [];
  let gap: string[] = [];
  let gapHasCategory = false;
  for (const line of list.lines) {
    if (line.kind === 'item') {
      blocks.push({ gap, gapHasCategory, categoryRaw: line.categoryRaw, text: renderItem(line.item) });
      gap = [];
      gapHasCategory = false;
    } else {
      gap.push(line.raw);
      if (line.kind === 'category') gapHasCategory = true;
    }
  }
  const tail = gap;

  const pages: WorkingPage[] = [];
  const itemLine = (page: WorkingPage, text: string): string => `${letterEmoji(page.items)}${ITEM_SEPARATOR}${text}`;

  for (const block of blocks) {
    let page = pages[pages.length - 1];
    const candidate = (target: WorkingPage): string[] => [...block.gap, itemLine(target, block.text)];
    const overflows = page !== undefined && page.items > 0 && page.length + joined(candidate(page)) > PAGE_SOFT_BUDGET;
    if (page === undefined || page.items >= ITEMS_PER_PAGE || overflows) {
      page = { lines: [], items: 0, length: 0 };
      pages.push(page);
      // Page entamée au milieu d'une catégorie : on répète son titre.
      if (!block.gapHasCategory && block.categoryRaw !== null) {
        page.lines.push(block.categoryRaw);
        page.length += block.categoryRaw.length + 1;
      }
      const lead = trimLeadingBlank(block.gap);
      page.lines.push(...lead);
      page.length += joined(lead);
    } else {
      page.lines.push(...block.gap);
      page.length += joined(block.gap);
    }
    const line = itemLine(page, block.text);
    page.lines.push(line);
    page.length += line.length + 1;
    page.items += 1;
  }

  const last = pages[pages.length - 1];
  if (last) {
    last.lines.push(...tail);
  }

  const result: Page[] = [];
  for (const page of pages) {
    const description = trimBlank(page.lines).join('\n');
    if (description.length > PAGE_HARD_BUDGET) return err({ code: 'too_long_to_render' });
    result.push({ description, itemCount: page.items });
  }
  return ok(result);
}
