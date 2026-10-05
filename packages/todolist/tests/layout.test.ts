import { err } from '@picket/kernel';
import {
  PAGE_HARD_BUDGET,
  layoutPages,
  letterEmoji,
  openItemIndexes,
  parseTodolist,
  tickItem,
  type Page,
  type Todolist,
} from '@picket/todolist';

function parse(text: string): Todolist {
  const result = parseTodolist(text);
  if (!result.ok) throw new Error(`unexpected parse error: ${JSON.stringify(result.error)}`);
  return result.value;
}

function layout(text: string): readonly Page[] {
  const result = layoutPages(parse(text));
  if (!result.ok) throw new Error('unexpected layout error');
  return result.value;
}

const numbered = (count: number, prefix = 'item') => Array.from({ length: count }, (_value, index) => `A・${prefix} ${index}`);

describe('todolist layout: a single page', () => {
  it('numbers items with their emoji letter in display order and keeps every other line as typed', () => {
    const [page, ...others] = layout('__Prep__\nA・Crates (x3)\nB・Trucks\n__Combat__\nRappel : briefing à 21h\nC・Ammo');
    expect(others).toEqual([]);
    expect(page?.description).toBe(
      ['__Prep__', '🇦・Crates (x3)', '🇧・Trucks', '__Combat__', 'Rappel : briefing à 21h', '🇨・Ammo'].join('\n'),
    );
    expect(page?.itemCount).toBe(3);
  });

  it('TDL-EC-07: without any category, free text before, between and after the items stays in order', () => {
    const [page] = layout('Intro\nA・a\nbetween\nB・b\noutro');
    expect(page?.description).toBe('Intro\n🇦・a\nbetween\n🇧・b\noutro');
  });

  it('drops a duplicate line and renumbers the letters of the remaining items', () => {
    const [page] = layout('A・a\nB・b\nC・a');
    expect(page?.description).toBe('🇦・a (x2)\n🇧・b');
  });

  it('is deterministic and trims blank lines at both ends of a page', () => {
    const text = '\nIntro\n\nA・a\n\n';
    expect(layout(text)).toEqual(layout(text));
    expect(layout(text)[0]?.description).toBe('Intro\n\n🇦・a');
  });
});

describe('todolist layout: pagination', () => {
  it('fills a page with up to 25 items, letters 🇦 to 🇾', () => {
    const [page, ...others] = layout(numbered(25).join('\n'));
    expect(others).toEqual([]);
    expect(page?.itemCount).toBe(25);
    expect(openItemIndexes(page?.description ?? '')).toEqual(Array.from({ length: 25 }, (_value, index) => index));
    expect(page?.description.endsWith(`${letterEmoji(24)}・item 24`)).toBe(true);
  });

  it('TDL-EC-21: 26 items make two pages and the second only holds one item, lettered 🇦 again', () => {
    const pages = layout(numbered(26).join('\n'));
    expect(pages.map((page) => page.itemCount)).toEqual([25, 1]);
    expect(pages[1]?.description).toBe('🇦・item 25');
  });

  it('keeps 100 items over 4 pages and never loses or duplicates an item', () => {
    const pages = layout(numbered(100).join('\n'));
    expect(pages.map((page) => page.itemCount)).toEqual([25, 25, 25, 25]);
    const texts = pages.flatMap((page) => page.description.split('\n').map((line) => line.split('・')[1]));
    expect(texts).toEqual(numbered(100).map((line) => line.slice(2)));
  });

  it('repeats the category title at the top of a page started in the middle of a category', () => {
    const pages = layout(`__Big__\n${numbered(30).join('\n')}`);
    expect(pages[0]?.description.startsWith('__Big__\n🇦・item 0')).toBe(true);
    expect(pages[1]?.description.startsWith('__Big__\n🇦・item 25')).toBe(true);
  });

  it('does not repeat a title that already opens the page, and starts a new page at a category boundary cleanly', () => {
    const pages = layout(`__One__\n${numbered(25).join('\n')}\n__Two__\nSee below\nA・next`);
    expect(pages[1]?.description).toBe('__Two__\nSee below\n🇦・next');
  });

  it('keeps the free text that precedes an item on the page of that item', () => {
    const pages = layout(`${numbered(25).join('\n')}\nnote for the next one\nA・last`);
    expect(pages[0]?.description.includes('note for the next one')).toBe(false);
    expect(pages[1]?.description).toBe('note for the next one\n🇦・last');
  });

  it('keeps the closing text on the last page', () => {
    const pages = layout(`${numbered(26).join('\n')}\nthe end`);
    expect(pages[1]?.description).toBe('🇦・item 25\nthe end');
  });

  it('does not repeat uncategorised content, and does not put a title before an item without category', () => {
    const pages = layout(numbered(26).join('\n'));
    expect(pages[1]?.description.includes('__')).toBe(false);
  });
});

describe('todolist layout: length (TDL-EC-20)', () => {
  const long = (index: number) => `A・${String(index).padStart(2, '0')}${'x'.repeat(280)}`;

  it('starts a new page before a page gets too long, even with fewer than 25 items', () => {
    const pages = layout(Array.from({ length: 14 }, (_value, index) => long(index)).join('\n'));
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(page.description.length).toBeLessThanOrEqual(PAGE_HARD_BUDGET);
    expect(pages.reduce((total, page) => total + page.itemCount, 0)).toBe(14);
  });

  it('leaves room for every tick of a full page: 25 ticks never push a description over 4096', () => {
    const pages = layout(Array.from({ length: 25 }, (_value, index) => `A・${String(index).padStart(2, '0')}${'y'.repeat(140)}`).join('\n'));
    for (const page of pages) {
      let description = page.description;
      for (const index of openItemIndexes(page.description)) {
        const outcome = tickItem(description, index);
        if (outcome.kind === 'updated') {
          description = outcome.description;
          expect(description.length).toBeLessThanOrEqual(4096);
        }
      }
    }
  });

  it('reports a list that cannot be displayed rather than cutting content', () => {
    const list: Todolist = {
      lines: [
        { kind: 'text', raw: 'x'.repeat(PAGE_HARD_BUDGET + 10) },
        { kind: 'item', item: { text: 'a', factor: 1 }, categoryRaw: null },
      ],
      itemCount: 1,
    };
    expect(layoutPages(list)).toEqual(err({ code: 'too_long_to_render' }));
  });
});
