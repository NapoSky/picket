import { parseTodolist, splitFactor, type ParseError, type TodoLine, type Todolist } from '@picket/todolist';

function parse(text: string): Todolist {
  const result = parseTodolist(text);
  if (!result.ok) throw new Error(`unexpected parse error: ${JSON.stringify(result.error)}`);
  return result.value;
}

function failure(text: string): ParseError {
  const result = parseTodolist(text);
  if (result.ok) throw new Error('expected a parse error');
  return result.error;
}

const items = (list: Todolist) =>
  list.lines.flatMap((line) => (line.kind === 'item' ? [{ text: line.item.text, factor: line.item.factor, category: line.categoryRaw }] : []));
const kinds = (list: Todolist) => list.lines.map((line: TodoLine) => (line.kind === 'text' ? (line.raw === '' ? 'blank' : 'text') : line.kind));

describe('todolist grammar: item markers', () => {
  it('accepts a capital letter with ・ or ·, an emoji letter, and a regional-indicator shortcode', () => {
    const list = parse('A・Crates\nB·Trucks\n🇨 - Ammo\n🇩:Fuel\n:regional_indicator_e: - Water\n🇫・Rations');
    expect(items(list).map((item) => item.text)).toEqual(['Crates', 'Trucks', 'Ammo', 'Fuel', 'Water', 'Rations']);
  });

  it('accepts a capital letter with - or : followed by a space', () => {
    const list = parse('A - Crates\nB- Trucks\nC: Ammo\nD : Fuel\nE-  Water');
    expect(items(list).map((item) => item.text)).toEqual(['Crates', 'Trucks', 'Ammo', 'Fuel', 'Water']);
  });

  it.each(['R-12 Hauler', 'A-10 Warthog', 'N:note'])('keeps %j as free text: - and : need a space after a plain letter', (line) => {
    expect(kinds(parse(`${line}\nB・Real item`))).toEqual(['text', 'item']);
  });

  it('TDL-EC-01: ignores the typed letters, items keep their order of appearance', () => {
    const list = parse('C・x\nA・y\nZ・z');
    expect(items(list).map((item) => item.text)).toEqual(['x', 'y', 'z']);
  });

  it.each(['X.', 'A・', 'A - ', '🇦', '🇦-', 'A) texte', '1・texte'])(
    'TDL-EC-02: %j stays free text instead of becoming a phantom item',
    (line) => {
      const list = parse(`${line}\nB・Real item`);
      expect(kinds(list)).toEqual(['text', 'item']);
      expect(items(list)).toHaveLength(1);
    },
  );

  it('does not mistake a flag emoji for an item marker', () => {
    expect(kinds(parse('🇫🇷 - Europe\nA・x'))).toEqual(['text', 'item']);
  });

  it('only lets a lowercase letter or a digit through as free text', () => {
    expect(kinds(parse('a・x\nB・y'))).toEqual(['text', 'item']);
  });

  it('trims lines and accepts CRLF input', () => {
    const list = parse('  A・Crates  \r\n\tB・Trucks\r\n');
    expect(items(list).map((item) => item.text)).toEqual(['Crates', 'Trucks']);
  });
});

describe('todolist grammar: categories', () => {
  it('recognises __Name__, __**Name**__ and **__Name__** (TDL-EC-04), keeping the line as typed', () => {
    const list = parse('__Prep__\nA・a\n__**Combat**__\nB・b\n**__Logistics__**\nC・c');
    expect(list.lines.filter((line) => line.kind === 'category').map((line) => (line as { raw: string }).raw)).toEqual([
      '__Prep__',
      '__**Combat**__',
      '**__Logistics__**',
    ]);
    expect(items(list).map((item) => item.category)).toEqual(['__Prep__', '__**Combat**__', '**__Logistics__**']);
  });

  it('TDL-EC-03: a **bold** line is a category when it introduces items, whatever its words or punctuation', () => {
    const list = parse('**Phase 1 : préparation**\nA・a\n\n**Info**\n\nB・b');
    expect(kinds(list)).toEqual(['category', 'item', 'blank', 'category', 'blank', 'item']);
  });

  it('keeps a **bold** line as text when no item follows', () => {
    expect(kinds(parse('A・a\n**Important**\nsome note'))).toEqual(['item', 'text', 'text']);
  });

  it('keeps an underlined heading without items as a heading line', () => {
    expect(kinds(parse('__Notes__\nA・a'))).toEqual(['category', 'item']);
    expect(kinds(parse('A・a\n__Footer__'))).toEqual(['item', 'category']);
  });

  it('rejects names that are empty, too long or contain their own delimiters', () => {
    expect(kinds(parse(`__${'x'.repeat(101)}__\nA・a`))).toEqual(['text', 'item']);
    expect(kinds(parse('**a** and **b**\nA・a'))).toEqual(['text', 'item']);
    expect(kinds(parse('__a__ and __b__\nA・a'))).toEqual(['text', 'item']);
  });

  it('TDL-EC-11: a line starting with __ without a closing __ is preserved as free text', () => {
    const list = parse('__à vérifier\nA・a');
    expect(list.lines[0]).toEqual({ kind: 'text', raw: '__à vérifier' });
  });
});

describe('todolist grammar: merging and quantities', () => {
  it('TDL-EC-05: merges duplicates of a category, adds the factors, keeps the first position and the first spelling', () => {
    const list = parse('__Prep__\nA・Crates (x2)\nB・Trucks\nC・crates\nD・CRATES (x4)');
    expect(items(list)).toEqual([
      { text: 'Crates', factor: 7, category: '__Prep__' },
      { text: 'Trucks', factor: 1, category: '__Prep__' },
    ]);
    expect(kinds(list)).toEqual(['category', 'item', 'item']);
  });

  it('TDL-EC-06: does not merge the same text across categories, or with an uncategorised one', () => {
    const list = parse('A・Crates\n__Combat__\nB・Crates\n__Prep__\nC・Crates');
    expect(items(list)).toHaveLength(3);
  });

  it('treats **Name** and __Name__ headings as the same category for merging', () => {
    const list = parse('__Prep__\nA・Crates\n**Prep**\nB・Crates');
    expect(items(list)).toEqual([{ text: 'Crates', factor: 2, category: '__Prep__' }]);
  });

  it('keeps every other line in place when a duplicate is removed', () => {
    const list = parse('A・a\nnote 1\nB・b\nnote 2\nC・A');
    expect(kinds(list)).toEqual(['item', 'text', 'item', 'text']);
  });

  it('TDL-EC-08: (x1) is redundant, (x0) and huge factors stay literal text, never a counter', () => {
    expect(items(parse('A・Crates (x1)'))).toEqual([{ text: 'Crates', factor: 1, category: null }]);
    expect(items(parse('A・Crates (x0)'))).toEqual([{ text: 'Crates (x0)', factor: 1, category: null }]);
    expect(items(parse('A・Crates (x1000)'))).toEqual([{ text: 'Crates (x1000)', factor: 1, category: null }]);
    expect(items(parse(`A・Crates (x${'9'.repeat(250)})`))[0]?.factor).toBe(1);
    expect(items(parse('A・Crates (X3)'))).toEqual([{ text: 'Crates', factor: 3, category: null }]);
  });

  it('does not merge when the sum would pass 999', () => {
    const list = parse('A・Crates (x600)\nB・Crates (x600)');
    expect(items(list).map((item) => item.factor)).toEqual([600, 600]);
  });

  it('splitFactor only reads a trailing factor on a non-empty text', () => {
    expect(splitFactor('(x3)')).toEqual({ text: '(x3)', factor: 1 });
    expect(splitFactor('a (x3) b')).toEqual({ text: 'a (x3) b', factor: 1 });
    expect(splitFactor('a   (x12)  ')).toEqual({ text: 'a', factor: 12 });
  });
});

describe('todolist grammar: free text and layout lines', () => {
  it('TDL-EC-07: keeps free text exactly where it was typed, before, between and after the items', () => {
    const list = parse('Intro\nA・a\nbetween\nB・b\noutro');
    expect(kinds(list)).toEqual(['text', 'item', 'text', 'item', 'text']);
  });

  it('collapses runs of blank lines and trims the ends, without touching anything else', () => {
    const list = parse('\n\nIntro\n\n\n\nA・a\n\n\n');
    expect(kinds(list)).toEqual(['text', 'blank', 'item']);
  });

  it('keeps mentions and markdown untouched (embeds never notify)', () => {
    const list = parse('@everyone <@&123> ~~x~~ **y**\nA・~~done~~');
    expect(list.lines[0]).toEqual({ kind: 'text', raw: '@everyone <@&123> ~~x~~ **y**' });
    expect(items(list)[0]?.text).toBe('~~done~~');
  });

  it('is deterministic', () => {
    const text = '__X__\nA・a (x2)\nnote\nB・b\nC・a';
    expect(parse(text)).toEqual(parse(text));
  });
});

describe('todolist grammar: limits', () => {
  it('refuses an empty text, and a text without any item', () => {
    expect(failure('')).toEqual({ code: 'empty' });
    expect(failure(' \n \r\n ')).toEqual({ code: 'empty' });
    expect(failure('just some words\n__Heading__')).toEqual({ code: 'no_items' });
  });

  it('refuses a text over 4000 characters', () => {
    expect(failure(`A・${'x'.repeat(4000)}`)).toEqual({ code: 'input_too_long', max: 4000 });
    expect(parseTodolist(`${'x'.repeat(3990)}\nA・a`).ok).toBe(true);
  });

  it('accepts exactly 100 items and refuses 101, merged duplicates not counting twice', () => {
    const lines = (count: number) => Array.from({ length: count }, (_value, index) => `A・item ${index}`).join('\n');
    expect(parse(lines(100)).itemCount).toBe(100);
    expect(failure(lines(101))).toEqual({ code: 'too_many_items', max: 100 });
    expect(parse(`${lines(100)}\nA・item 3`).itemCount).toBe(100);
  });

  it('refuses an item over 300 characters and says on which line', () => {
    expect(failure(`A・ok\nB・${'x'.repeat(301)}`)).toEqual({ code: 'item_too_long', line: 2, max: 300 });
    expect(parseTodolist(`A・${'x'.repeat(300)}`).ok).toBe(true);
  });

  it('counts the length of the item without its factor', () => {
    expect(parseTodolist(`A・${'x'.repeat(300)} (x3)`).ok).toBe(true);
  });
});
