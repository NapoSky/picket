import {
  CommandRegistry,
  ComponentRegistry,
  InteractionPipeline,
  deliverDeferred,
  type AccessLevel,
  type InteractionReceipts,
  type Reply,
} from '@picket/discord';
import { ChannelId, InteractionId, MessageId, UserId, noopLogger } from '@picket/kernel';
import {
  CreateTodolist,
  TODOLIST_ROOT,
  TickTodolistItem,
  todolistCommands,
  todolistFamily,
} from '@picket/todolist';
import {
  InMemoryInteractionReplies,
  InMemoryKeyedLock,
  InMemoryMessaging,
  makeInteraction,
  recordingLogger,
  testI18n,
} from '@picket/testing';

const channel = ChannelId.assert('600000000000000001');
const VIEW = 1n << 10n;
const SEND = 1n << 11n;
const EMBED = 1n << 14n;
const ALL_PERMISSIONS = VIEW | SEND | EMBED;

class MemoryReceipts implements InteractionReceipts {
  readonly #seen = new Set<string>();
  async claim(id: InteractionId): Promise<boolean> {
    if (this.#seen.has(id)) return false;
    this.#seen.add(id);
    return true;
  }
}

function harness() {
  const messaging = new InMemoryMessaging();
  const replies = new InMemoryInteractionReplies();
  const logger = recordingLogger();
  const state: { level: AccessLevel | null; enabled: boolean; suspended: boolean } = { level: 'member', enabled: true, suspended: false };
  const pipeline = new InteractionPipeline({
    registry: new CommandRegistry([TODOLIST_ROOT], todolistCommands(), testI18n),
    components: new ComponentRegistry([
      todolistFamily({ create: new CreateTodolist(messaging), tick: new TickTodolistItem(messaging, new InMemoryKeyedLock()) }),
    ]),
    receipts: new MemoryReceipts(),
    access: { levelOf: async () => state.level },
    gate: { suspensionOf: async () => (state.suspended ? { purgeAt: new Date('2026-11-04T00:00:00Z') } : null) },
    language: { localeOf: async () => null },
    features: { isEnabled: async () => state.enabled },
    logger,
  });

  let counter = 0;
  const nextId = () => InteractionId.assert(`93000000000${String(10_000 + counter++)}`);
  type Overrides = Parameters<typeof makeInteraction>[0];

  /** Comme le serveur HTTP : la réponse immédiate, puis le travail différé livré par l'adaptateur. */
  async function handle(overrides: Overrides): Promise<Reply> {
    const interaction = makeInteraction({ id: nextId(), appPermissions: ALL_PERMISSIONS, ...overrides });
    const reply = await pipeline.handle(interaction);
    if (reply.kind === 'deferred') await deliverDeferred({ reply, interaction, replies, logger: noopLogger });
    return reply;
  }

  const create = (overrides: Overrides = {}) => handle({ commandPath: ['todolist', 'create'], ...overrides });
  const submit = (content: string, overrides: Overrides = {}) =>
    handle({ kind: 'modal', customId: 'td:1:create', fields: { content }, channelId: channel, ...overrides });
  const click = (message: MessageId, index: number, overrides: Overrides = {}) =>
    handle({ kind: 'component', customId: `td:1:i${index}`, message: { id: message, channelId: channel }, ...overrides });
  const text = (reply: Reply) => (reply.kind === 'message' ? reply.content : '');
  const posted = () => messaging.list(channel);

  return { messaging, replies, logger, state, create, submit, click, handle, text, posted };
}

const numbered = (count: number) => Array.from({ length: count }, (_value, index) => `A・item ${index}`).join('\n');

describe('/todolist create', () => {
  it('opens a modal with one paragraph input limited to 4000 characters', async () => {
    const reply = await harness().create();
    expect(reply).toMatchObject({
      kind: 'modal',
      customId: 'td:1:create',
      title: 'New todolist',
      inputs: [{ customId: 'content', style: 'paragraph', required: true, maxLength: 4000 }],
    });
  });

  it('XCT-EC-07: explains which permissions the bot lacks in this channel before opening the modal', async () => {
    const { create, text } = harness();
    const reply = await create({ appPermissions: VIEW });
    expect(text(reply)).toBe('I cannot post here. Missing permissions in this channel: Send Messages, Embed Links.');
  });

  it('opens the modal when Discord gives no permissions, or the bot is an administrator', async () => {
    const { create } = harness();
    expect((await create({ appPermissions: null })).kind).toBe('modal');
    expect((await create({ appPermissions: 1n << 3n })).kind).toBe('modal');
  });

  it('refuses when the todolists feature is disabled on the server (XCT-RQ-04), without opening anything', async () => {
    const { create, state, text } = harness();
    state.enabled = false;
    expect(text(await create())).toContain('disabled on this server');
  });

  it('refuses a user without any access level, and a suspended guild', async () => {
    const { create, state, text } = harness();
    state.level = null;
    expect(text(await create())).toContain('required level: member');
    state.level = 'member';
    state.suspended = true;
    expect(text(await create())).toContain('scheduled for deletion');
  });
});

describe('todolist modal submission', () => {
  it('acknowledges at once, posts every page publicly, then confirms privately', async () => {
    const { submit, posted, replies } = harness();
    const reply = await submit('__Prep__\nA・Crates (x3)\nB・Trucks\nnote');
    expect(reply).toMatchObject({ kind: 'deferred', ephemeral: true, update: false });
    expect(posted().map((message) => message.description)).toEqual(['__Prep__\n🇦・Crates (x3)\n🇧・Trucks\nnote']);
    expect(posted()[0]?.buttons.map((button) => button.customId)).toEqual(['td:1:i0', 'td:1:i1']);
    expect(replies.replies).toMatchObject([{ action: 'editOriginal', content: 'Todolist posted.' }]);
  });

  it('says how many messages a long list needs', async () => {
    const { submit, posted, replies } = harness();
    await submit(numbered(60));
    expect(posted()).toHaveLength(3);
    expect(replies.contents).toEqual(['Todolist posted in 3 messages.']);
  });

  it.each([
    ['', 'Nothing to post'],
    ['just words', 'No item found'],
    [numbered(101), 'Too many items (maximum 100)'],
    [`A・ok\nB・${'x'.repeat(301)}`, 'Line 2: the item is too long'],
    ['x'.repeat(4001), 'too long (maximum 4000'],
  ])('refuses %j at once, with a clear message and nothing posted', async (input, expected) => {
    const { submit, posted, text, replies } = harness();
    const reply = await submit(input);
    expect(reply.kind).toBe('message');
    expect(text(reply)).toContain(expected);
    expect(posted()).toEqual([]);
    expect(replies.replies).toEqual([]);
  });

  it('hands the refused text back so it can be copied, without letting it break out of the code block', async () => {
    const { submit, text } = harness();
    const content = `no item here\n\`\`\`injected\`\`\`\n${'y'.repeat(3000)}`;
    const reply = text(await submit(content));
    expect(reply.length).toBeLessThanOrEqual(2000);
    expect(reply).toContain('Your text, to copy back:');
    expect(reply).toContain('no item here');
    expect(reply.split('```').length - 1).toBe(2);
  });

  it('does not echo an empty text', async () => {
    const { submit, text } = harness();
    expect(text(await submit('   '))).toBe('Nothing to post: the text is empty.');
  });

  it('XCT-EC-07: re-checks the bot permissions on submission, they may have changed since the modal opened', async () => {
    const { submit, text, posted } = harness();
    expect(text(await submit('A・a', { appPermissions: SEND | EMBED }))).toContain('View Channel');
    expect(posted()).toEqual([]);
  });

  it('TDL-EC-23: explains an API refusal after the fact, and leaves no half list behind', async () => {
    const { submit, messaging, posted, replies } = harness();
    messaging.failNext('send', 'missing_permissions');
    await submit(numbered(30));
    expect(posted()).toEqual([]);
    expect(replies.contents).toEqual(['I could not post in this channel. Check my permissions there and try again.']);

    const original = messaging.send.bind(messaging);
    let sent = 0;
    messaging.send = async (target, message) => {
      sent += 1;
      if (sent === 2) throw new Error('boom');
      return original(target, message);
    };
    await submit(numbered(30));
    expect(posted()).toEqual([]);
    expect(replies.contents.at(-1)).toBe('Something went wrong. Please try again later.');
  });

  it('answers privately in the language of the user, and posts the list with the standard title', async () => {
    const { submit, posted, replies } = harness();
    await submit('A・a', { locale: 'fr' });
    expect(replies.contents).toEqual(['Todolist publiée.']);
    expect(posted()).toHaveLength(1);
  });

  it('refuses a submission of the wrong shape or an unknown modal', async () => {
    const { handle, text } = harness();
    expect(text(await handle({ kind: 'modal', customId: 'td:1:other', fields: { content: 'A・a' } }))).toContain('no longer available');
    expect(text(await handle({ kind: 'modal', customId: 'td:1:create', fields: { content: 'A・a' }, channelId: null }))).toContain('cannot hold');
  });

  it('is processed once when Discord delivers the same submission twice', async () => {
    const { handle, posted } = harness();
    const id = InteractionId.assert('930000000009999999');
    await handle({ id, kind: 'modal', customId: 'td:1:create', fields: { content: 'A・a' }, channelId: channel });
    const second = await handle({ id, kind: 'modal', customId: 'td:1:create', fields: { content: 'A・a' }, channelId: channel });
    expect(posted()).toHaveLength(1);
    expect(second.kind).toBe('message');
  });
});

describe('todolist buttons', () => {
  async function listed(content: string) {
    const h = harness();
    await h.submit(content);
    h.replies.replies.length = 0;
    return { ...h, id: h.posted()[0]?.id as MessageId };
  }

  it('TDL-RQ-10: a click updates the message with no private message at all', async () => {
    const { click, id, posted, replies } = await listed('A・a\nB・b');
    const reply = await click(id, 0);
    expect(reply).toMatchObject({ kind: 'deferred', update: true });
    expect(posted()[0]?.description).toBe('✅・~~a~~\n🇧・b');
    expect(replies.replies).toEqual([]);
  });

  it('TDL-EC-17: only the end of a list or page speaks, once, privately', async () => {
    const { click, id, posted, replies } = await listed('A・a\nB・b');
    await click(id, 0);
    await click(id, 1);
    expect(posted()).toEqual([]);
    expect(replies.replies).toMatchObject([{ action: 'followUp', content: 'Todolist complete: its message was removed.' }]);
  });

  it('TDL-EC-09: finishing one page of a long list names the page', async () => {
    const h = await listed(numbered(26));
    const second = h.posted()[1]?.id as MessageId;
    await h.click(second, 0);
    expect(h.replies.contents).toEqual(['Page 2/2 complete: its message was removed.']);
    expect(h.posted()).toHaveLength(1);
  });

  it('TDL-EC-10: a click on an item someone else just completed is explained, not applied twice', async () => {
    const { click, id, replies } = await listed('A・a\nB・b');
    await click(id, 0);
    await click(id, 0);
    expect(replies.contents).toEqual(['This item was already completed.']);
  });

  it('applies simultaneous clicks of several people without losing any', async () => {
    const h = await listed('A・a\nB・b\nC・c\nD・d');
    h.messaging.latencyMs = 10;
    await Promise.all([0, 1, 2].map((index) => h.click(h.posted()[0]?.id as MessageId, index)));
    expect(h.posted()[0]?.description).toBe('✅・~~a~~\n✅・~~b~~\n✅・~~c~~\n🇩・d');
  });

  it('XCT-EC-05: the level is evaluated at click time, not when the list was created', async () => {
    const { click, id, state, text, posted } = await listed('A・a\nB・b');
    state.level = null;
    expect(text(await click(id, 0))).toContain('required level: member');
    expect(posted()[0]?.description).toBe('🇦・a\n🇧・b');
    state.level = 'member';
    expect((await click(id, 0)).kind).toBe('deferred');
    expect(posted()[0]?.description).toBe('✅・~~a~~\n🇧・b');
  });

  it('XCT-RQ-04 / suspension: a disabled feature or a suspended guild stops the buttons too', async () => {
    const { click, id, state, text, posted } = await listed('A・a\nB・b');
    state.enabled = false;
    expect(text(await click(id, 0))).toContain('disabled on this server');
    state.enabled = true;
    state.suspended = true;
    expect(text(await click(id, 0))).toContain('scheduled for deletion');
    expect(posted()[0]?.description).toBe('🇦・a\n🇧・b');
  });

  it('DIS-EC-07: a button of an unknown version, namespace or shape always gets an answer, never silence', async () => {
    const { handle, id, text } = await listed('A・a');
    const message = { id, channelId: channel };
    for (const customId of ['td:2:i0', 'zz:1:i0', 'td:1:nope', 'td:1:i99', 'garbage', 'td:1:i0:extra', '']) {
      const reply = await handle({ kind: 'component', customId, message });
      expect(text(reply)).toContain('no longer available');
    }
    expect(text(await handle({ kind: 'component', customId: 'td:1:i0', message: null }))).toContain('no longer available');
  });

  it('TDL-EC-22: a click on a message deleted meanwhile is silent, as the original', async () => {
    const { click, id, messaging, replies } = await listed('A・a\nB・b');
    messaging.remove(channel, id);
    expect((await click(id, 0)).kind).toBe('deferred');
    expect(replies.replies).toEqual([]);
  });

  it('explains a failure to edit and an unreadable message', async () => {
    const { click, id, messaging, replies } = await listed('A・a\nB・b');
    messaging.failNext('edit', 'missing_permissions');
    await click(id, 0);
    messaging.failNext('fetch', 'unavailable');
    await click(id, 0);
    expect(replies.contents).toEqual([
      'I could not update this list. Check my permissions in this channel.',
      'Something went wrong. Please try again later.',
    ]);
    const blank = await messaging.send(channel, { embeds: [], buttons: [] });
    replies.replies.length = 0;
    await click(blank, 0);
    expect(replies.contents).toEqual(['This list can no longer be read. Delete it and create a new one.']);
  });

  it('logs who did what, since nothing else records it (TDL-EC-16)', async () => {
    const { click, id, logger } = await listed('A・a\nB・b');
    await click(id, 0, { userId: UserId.assert('500000000000000042') });
    expect(logger.records.find((record) => record.message === 'todolist tick')?.fields).toMatchObject({
      user_id: '500000000000000042',
      message_id: id,
      item: 0,
      outcome: 'updated',
    });
  });

  it('answers in the language of the person who clicks', async () => {
    const { click, id, replies } = await listed('A・a');
    await click(id, 0, { locale: 'fr' });
    expect(replies.contents).toEqual(['Todolist terminée : son message a été supprimé.']);
  });
});
