import { LockTimeoutError, type KeyedLock } from '@picket/coordination';
import { DiscordApiError } from '@picket/discord';
import { ChannelId, MessageId } from '@picket/kernel';
import { CreateTodolist, TickTodolistItem, type PageTexts } from '@picket/todolist';
import { InMemoryKeyedLock, InMemoryMessaging } from '@picket/testing';

const channel = ChannelId.assert('600000000000000001');
const texts: PageTexts = { title: '📋 Todolist', footer: (page, total) => `📋 ${page}/${total}` };
const numbered = (count: number) => Array.from({ length: count }, (_value, index) => `A・item ${index}`).join('\n');

function prepare(create: CreateTodolist, text: string) {
  const prepared = create.prepare(text, texts);
  if (!prepared.ok) throw new Error(`prepare failed: ${JSON.stringify(prepared.error)}`);
  return prepared.value;
}

async function publish(messaging: InMemoryMessaging, text: string): Promise<readonly MessageId[]> {
  const create = new CreateTodolist(messaging);
  const result = await create.publish(channel, prepare(create, text));
  if (!result.ok) throw new Error('publish failed');
  return result.value;
}

describe('CreateTodolist', () => {
  it('builds one embed per page with a button for every open item, a single custom_id format, and no footer for a single page', () => {
    const create = new CreateTodolist(new InMemoryMessaging());
    const [only, ...none] = prepare(create, 'A・a\nB・b (x2)').pages;
    expect(none).toEqual([]);
    expect(only?.embeds).toEqual([{ title: '📋 Todolist', description: '🇦・a\n🇧・b (x2)', color: 0x5865f2 }]);
    expect(only?.buttons).toEqual([
      { customId: 'td:1:i0', emoji: '🇦' },
      { customId: 'td:1:i1', emoji: '🇧' },
    ]);
  });

  it('puts the page position in the footer of every page of a long list', () => {
    const create = new CreateTodolist(new InMemoryMessaging());
    const { pages } = prepare(create, numbered(30));
    expect(pages.map((page) => page.embeds[0]?.footer)).toEqual(['📋 1/2', '📋 2/2']);
    expect(pages.map((page) => page.buttons.length)).toEqual([25, 5]);
  });

  it('keeps every custom_id within the 100 character limit', () => {
    const create = new CreateTodolist(new InMemoryMessaging());
    for (const page of prepare(create, numbered(100)).pages) {
      for (const button of page.buttons) expect(button.customId.length).toBeLessThanOrEqual(100);
    }
  });

  it('hands back the parse and layout errors untouched', () => {
    const create = new CreateTodolist(new InMemoryMessaging());
    expect(create.prepare('', texts)).toEqual({ ok: false, error: { code: 'empty' } });
    expect(create.prepare('just text', texts)).toEqual({ ok: false, error: { code: 'no_items' } });
  });

  it('publishes the pages in order and returns their message ids', async () => {
    const messaging = new InMemoryMessaging();
    const ids = await publish(messaging, numbered(30));
    expect(ids).toHaveLength(2);
    expect(messaging.list(channel).map((message) => message.id)).toEqual(ids);
    expect(messaging.calls).toEqual(['send', 'send']);
  });

  it('removes the pages already posted when a later page fails: never a truncated list', async () => {
    const messaging = new InMemoryMessaging();
    const create = new CreateTodolist(messaging);
    messaging.failNext('send', 'missing_permissions');
    // La première page échoue.
    expect(await create.publish(channel, prepare(create, numbered(60)))).toEqual({ ok: false, error: { reason: 'missing_permissions', rolledBack: 0 } });

    const second = new InMemoryMessaging();
    const secondCreate = new CreateTodolist(second);
    const prepared = prepare(secondCreate, numbered(90));
    // La deuxième page échoue : la première est retirée.
    const original = second.send.bind(second);
    let sent = 0;
    second.send = async (target, message) => {
      sent += 1;
      if (sent === 3) throw new DiscordApiError('rate_limited', 'too many');
      return original(target, message);
    };
    const result = await secondCreate.publish(channel, prepared);
    expect(result).toEqual({ ok: false, error: { reason: 'rate_limited', rolledBack: 2 } });
    expect(second.list(channel)).toEqual([]);
  });

  it('still reports the failure when removing a posted page fails too', async () => {
    const messaging = new InMemoryMessaging();
    const create = new CreateTodolist(messaging);
    const original = messaging.send.bind(messaging);
    let sent = 0;
    messaging.send = async (target, message) => {
      sent += 1;
      if (sent === 2) throw new DiscordApiError('unavailable', 'down');
      return original(target, message);
    };
    messaging.failNext('delete', 'unavailable');
    expect(await create.publish(channel, prepare(create, numbered(30)))).toEqual({
      ok: false,
      error: { reason: 'unavailable', rolledBack: 0 },
    });
    expect(messaging.list(channel)).toHaveLength(1);
  });

  it('rethrows an unexpected error after cleaning up', async () => {
    const messaging = new InMemoryMessaging();
    const create = new CreateTodolist(messaging);
    const original = messaging.send.bind(messaging);
    let sent = 0;
    messaging.send = async (target, message) => {
      sent += 1;
      if (sent === 2) throw new TypeError('bug');
      return original(target, message);
    };
    await expect(create.publish(channel, prepare(create, numbered(30)))).rejects.toThrow('bug');
    expect(messaging.list(channel)).toEqual([]);
  });
});

describe('TickTodolistItem', () => {
  function setup(latencyMs = 0, lock: KeyedLock = new InMemoryKeyedLock()) {
    const messaging = new InMemoryMessaging();
    messaging.latencyMs = latencyMs;
    return { messaging, tick: new TickTodolistItem(messaging, lock) };
  }
  const only = (messaging: InMemoryMessaging) => {
    const [message] = messaging.list(channel);
    if (!message) throw new Error('message gone');
    return message;
  };

  it('edits only the clicked line, drops its button and keeps title, footer and colour of the message as posted', async () => {
    const { messaging, tick } = setup();
    const [id] = await publish(messaging, 'A・a\nB・b\nnote');
    expect(await tick.execute(channel, id as MessageId, 0)).toEqual({ kind: 'updated' });
    const message = only(messaging);
    expect(message.description).toBe('✅・~~a~~\n🇧・b\nnote');
    expect(message.buttons).toEqual([{ customId: 'td:1:i1', emoji: '🇧' }]);
    expect(messaging.calls).toEqual(['send', `fetch:${id}`, `edit:${id}`]);
  });

  it('deletes the message when the last item is done (single page)', async () => {
    const { messaging, tick } = setup();
    const [id] = await publish(messaging, 'A・only');
    expect(await tick.execute(channel, id as MessageId, 0)).toEqual({ kind: 'completed', page: 1, total: 1 });
    expect(messaging.list(channel)).toEqual([]);
  });

  it('TDL-EC-09: finishing a page of a group says which page, and never claims the whole list is finished', async () => {
    const { messaging, tick } = setup();
    const ids = await publish(messaging, numbered(26));
    expect(await tick.execute(channel, ids[1] as MessageId, 0)).toEqual({ kind: 'completed', page: 2, total: 2 });
    expect(messaging.list(channel).map((message) => message.id)).toEqual([ids[0]]);
  });

  it('TDL-EC-10: two simultaneous clicks on different items are both kept, thanks to the lock and a fresh read', async () => {
    const { messaging, tick } = setup(15);
    const [id] = await publish(messaging, 'A・a\nB・b\nC・c');
    const results = await Promise.all([tick.execute(channel, id as MessageId, 0), tick.execute(channel, id as MessageId, 1)]);
    expect(results).toEqual([{ kind: 'updated' }, { kind: 'updated' }]);
    expect(only(messaging).description).toBe('✅・~~a~~\n✅・~~b~~\n🇨・c');
  });

  it('shows the harness would catch the original race: without a lock, a click is lost', async () => {
    const unlocked: KeyedLock = { withLock: (_key, work) => work() };
    const { messaging, tick } = setup(15, unlocked);
    const [id] = await publish(messaging, 'A・a\nB・b\nC・c');
    await Promise.all([tick.execute(channel, id as MessageId, 0), tick.execute(channel, id as MessageId, 1)]);
    expect(only(messaging).description.split('\n').filter((line) => line.startsWith('✅')).length).toBe(1);
  });

  it('two people clicking the same simple item: one wins, the other is told it was already done', async () => {
    const { messaging, tick } = setup(10);
    const [id] = await publish(messaging, 'A・a\nB・b');
    const results = await Promise.all([tick.execute(channel, id as MessageId, 0), tick.execute(channel, id as MessageId, 0)]);
    expect(results.map((result) => result.kind).sort()).toEqual(['already_done', 'updated']);
  });

  it('three simultaneous clicks on an (x3) item need exactly three decrements, none lost', async () => {
    const { messaging, tick } = setup(10);
    const [id] = await publish(messaging, 'A・Crates (x3)\nB・b');
    const results = await Promise.all([0, 1, 2].map(() => tick.execute(channel, id as MessageId, 0)));
    expect(results.every((result) => result.kind === 'updated')).toBe(true);
    expect(only(messaging).description).toBe('✅・~~Crates~~\n🇧・b');
    expect(await tick.execute(channel, id as MessageId, 0)).toEqual({ kind: 'already_done' });
  });

  it('serialises clicks per message only: different messages do not wait for each other', async () => {
    const { messaging, tick } = setup(30);
    const [first, second] = await publish(messaging, numbered(26));
    const started = Date.now();
    await Promise.all([tick.execute(channel, first as MessageId, 0), tick.execute(channel, second as MessageId, 0)]);
    expect(Date.now() - started).toBeLessThan(30 * 4 - 10);
  });

  it('TDL-EC-22: a message deleted before the click, or during it, is reported as gone', async () => {
    const { messaging, tick } = setup();
    const [id] = await publish(messaging, 'A・a\nB・b');
    messaging.failNext('edit', 'unknown_message');
    expect(await tick.execute(channel, id as MessageId, 0)).toEqual({ kind: 'gone' });
    messaging.remove(channel, id as MessageId);
    expect(await tick.execute(channel, id as MessageId, 0)).toEqual({ kind: 'gone' });
  });

  it('reports a channel that no longer exists as gone too', async () => {
    const { messaging, tick } = setup();
    const [id] = await publish(messaging, 'A・a');
    messaging.failNext('fetch', 'unknown_channel');
    expect(await tick.execute(channel, id as MessageId, 0)).toEqual({ kind: 'gone' });
  });

  it('TDL-EC-19: a message without a readable embed is reported instead of crashing', async () => {
    const { messaging, tick } = setup();
    const id = await messaging.send(channel, { embeds: [], buttons: [] });
    expect(await tick.execute(channel, id, 0)).toEqual({ kind: 'unreadable' });
    const empty = await messaging.send(channel, { embeds: [{ description: '' }], buttons: [] });
    expect(await tick.execute(channel, empty, 0)).toEqual({ kind: 'unreadable' });
  });

  it('reports a stale button (item already done earlier) without touching the message', async () => {
    const { messaging, tick } = setup();
    const [id] = await publish(messaging, 'A・a\nB・b');
    await tick.execute(channel, id as MessageId, 0);
    messaging.calls.length = 0;
    expect(await tick.execute(channel, id as MessageId, 0)).toEqual({ kind: 'already_done' });
    expect(messaging.calls).toEqual([`fetch:${id}`]);
  });

  it('TDL-EC-23: surfaces missing permissions on edit, delete and read', async () => {
    const { messaging, tick } = setup();
    const [id] = await publish(messaging, 'A・a\nB・b');
    messaging.failNext('edit', 'missing_permissions');
    expect(await tick.execute(channel, id as MessageId, 0)).toEqual({ kind: 'discord_error', reason: 'missing_permissions' });
    messaging.failNext('fetch', 'missing_access');
    expect(await tick.execute(channel, id as MessageId, 0)).toEqual({ kind: 'discord_error', reason: 'missing_access' });
    messaging.failNext('delete', 'unavailable');
    const [single] = await publish(messaging, 'A・x');
    expect(await tick.execute(channel, single as MessageId, 0)).toEqual({ kind: 'discord_error', reason: 'unavailable' });
  });

  it('answers busy when the lock cannot be obtained in time', async () => {
    const busy: KeyedLock = {
      withLock: async () => {
        throw new LockTimeoutError('timeout');
      },
    };
    const { messaging, tick } = setup(0, busy);
    const [id] = await publish(messaging, 'A・a');
    expect(await tick.execute(channel, id as MessageId, 0)).toEqual({ kind: 'busy' });
  });

  it('does not swallow a programming error', async () => {
    const { messaging, tick } = setup();
    const [id] = await publish(messaging, 'A・a\nB・b');
    messaging.fetch = async () => {
      throw new TypeError('bug');
    };
    await expect(tick.execute(channel, id as MessageId, 0)).rejects.toThrow('bug');
  });
});
