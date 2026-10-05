import { layoutPages, openItemIndexes, parseTodolist, tickItem } from '@picket/todolist';

function page(text: string): string {
  const parsed = parseTodolist(text);
  if (!parsed.ok) throw new Error('parse failed');
  const laidOut = layoutPages(parsed.value);
  if (!laidOut.ok) throw new Error('layout failed');
  return laidOut.value[0]?.description ?? '';
}

function updated(description: string, index: number): string {
  const outcome = tickItem(description, index);
  if (outcome.kind !== 'updated') throw new Error(`expected an update, got ${outcome.kind}`);
  return outcome.description;
}

describe('ticking an item', () => {
  it('strikes a simple item through and marks it done, leaving the other lines alone', () => {
    const description = page('__Prep__\nA・Crates\nB・Trucks\nnote');
    const outcome = tickItem(description, 0);
    expect(outcome).toEqual({
      kind: 'updated',
      description: '__Prep__\n✅・~~Crates~~\n🇧・Trucks\nnote',
      openIndexes: [1],
    });
  });

  it('TDL-EC-18: letters are stable, a ticked item never renumbers the others', () => {
    let description = page('A・a\nB・b\nC・c\nD・d');
    description = updated(description, 1);
    description = updated(description, 0);
    expect(openItemIndexes(description)).toEqual([2, 3]);
    expect(description).toBe('✅・~~a~~\n✅・~~b~~\n🇨・c\n🇩・d');
  });

  it('needs one click per unit of a factor, and drops the suffix when one unit remains', () => {
    let description = page('A・Crates (x3)\nB・Trucks');
    description = updated(description, 0);
    expect(description).toBe('🇦・Crates (x2)\n🇧・Trucks');
    description = updated(description, 0);
    expect(description).toBe('🇦・Crates\n🇧・Trucks');
    description = updated(description, 0);
    expect(description).toBe('✅・~~Crates~~\n🇧・Trucks');
  });

  it('ticks a literal (x0) or (x1000) once instead of reading it as a counter', () => {
    expect(updated(page('A・Crates (x0)\nB・b'), 0)).toBe('✅・~~Crates (x0)~~\n🇧・b');
    expect(updated(page('A・Crates (x1000)\nB・b'), 0)).toBe('✅・~~Crates (x1000)~~\n🇧・b');
  });

  it('reports the last open item as completing the page', () => {
    const description = updated(page('A・a\nB・b'), 0);
    expect(tickItem(description, 1)).toEqual({ kind: 'completed' });
  });

  it('completes a single-item page on the first click', () => {
    expect(tickItem(page('A・only'), 0)).toEqual({ kind: 'completed' });
  });

  it('TDL-EC-10: an item that is already done, or unknown, is reported instead of being ticked again', () => {
    const description = updated(page('A・a\nB・b'), 0);
    expect(tickItem(description, 0)).toEqual({ kind: 'not_found' });
    expect(tickItem(description, 7)).toEqual({ kind: 'not_found' });
    expect(tickItem('', 0)).toEqual({ kind: 'not_found' });
  });

  it('TDL-EC-11 / TDL-RQ-05: never touches or loses any other line, whatever it looks like', () => {
    const others = ['__oops sans fin', '~~barré~~', '**gras**', '✅・~~déjà~~ (écrit à la main)', '', 'z・pas un item', '`code`', '@everyone'];
    const description = page(`${others.slice(0, 4).join('\n')}\nA・target\n${others.slice(4).join('\n')}\nB・other`);
    const outcome = tickItem(description, 0);
    if (outcome.kind !== 'updated') throw new Error('expected update');
    const before = description.split('\n').filter((line) => !line.includes('target'));
    const after = outcome.description.split('\n').filter((line) => !line.includes('target'));
    expect(after).toEqual(before);
  });

  it('is not fooled by an item whose text looks like a done marker or contains ~~', () => {
    const description = page('A・~~x~~\nB・y');
    expect(openItemIndexes(description)).toEqual([0, 1]);
    expect(updated(description, 0)).toBe('✅・~~~~x~~~~\n🇧・y');
  });

  it('keeps a message with every item done as completed, whatever the order of the clicks', () => {
    const items = ['a', 'b', 'c', 'd'];
    const order = [2, 0, 3, 1];
    let description = page(items.map((text) => `A・${text}`).join('\n'));
    order.forEach((index, step) => {
      const outcome = tickItem(description, index);
      if (step < order.length - 1) {
        expect(outcome.kind).toBe('updated');
        description = (outcome as { description: string }).description;
      } else {
        expect(outcome).toEqual({ kind: 'completed' });
      }
    });
  });
});

describe('reading open items', () => {
  it('lists open items in display order and ignores done lines and free text', () => {
    expect(openItemIndexes('intro\n🇦・a\n✅・~~b~~\n🇨・c\n🇦 sans séparateur\nZ・no')).toEqual([0, 2]);
  });

  it('reads 🇦 as 0 and 🇾 as 24', () => {
    expect(openItemIndexes('🇦・a\n🇾・y')).toEqual([0, 24]);
  });
});
