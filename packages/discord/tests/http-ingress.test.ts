import {
  CommandRegistry,
  InteractionPipeline,
  DiscordApiError,
  createInteractionServer,
  ephemeral,
  type CommandEntry,
  type InteractionReceipts,
  type InteractionReplies,
  type Reply,
} from '@picket/discord';
import { noopLogger, type Clock } from '@picket/kernel';
import { InMemoryInteractionReplies, allFeaturesEnabled, createTestKeys, noComponents, testI18n } from '@picket/testing';

const NOW_MS = 1_760_000_000_000;
const clock: Clock = { now: () => new Date(NOW_MS) };
const timestamp = String(NOW_MS / 1000);

const receipts: InteractionReceipts = { claim: async () => true };

function setup(options: { extra?: CommandEntry[]; replies?: InteractionReplies } = {}) {
  const keys = createTestKeys();
  const registry = new CommandRegistry(
    [{ name: 'picket', description: 'commands.picket.description' }],
    [
      { path: ['picket', 'status'], description: 'commands.picket.status.description', level: 'member', handler: async () => ephemeral('all good') },
      ...(options.extra ?? []),
    ],
    testI18n,
  );
  const pipeline = new InteractionPipeline({
    registry,
    receipts,
    access: { levelOf: async () => 'member' },
    gate: { suspensionOf: async () => null },
    language: { localeOf: async () => null },
    components: noComponents,
    features: allFeaturesEnabled,
    logger: noopLogger,
  });
  const app = createInteractionServer({
    publicKey: keys.publicKeyHex,
    pipeline,
    replies: options.replies ?? new InMemoryInteractionReplies(),
    logger: noopLogger,
    clock,
  });

  const post = (body: string, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: '/interactions',
      headers: { 'content-type': 'application/json', ...headers },
      payload: body,
    });

  const signedPost = (body: string, ts = timestamp) =>
    post(body, { 'x-signature-ed25519': keys.signRequest(ts, body), 'x-signature-timestamp': ts });

  return { app, keys, post, signedPost };
}

const commandPayload = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: '900000000000000001',
    application_id: '800000000000000001',
    type: 2,
    token: 'interaction-token',
    version: 1,
    guild_id: '700000000000000001',
    channel_id: '600000000000000001',
    locale: 'fr',
    member: { user: { id: '500000000000000001' }, roles: ['400000000000000001'], permissions: '8' },
    data: { id: '1', name: 'picket', type: 1, options: [{ type: 1, name: 'status' }] },
    ...overrides,
  });

describe('POST /interactions', () => {
  it('rejects requests without signature headers', async () => {
    const { post } = setup();
    expect((await post('{"type":1}')).statusCode).toBe(401);
  });

  it('rejects an invalid signature', async () => {
    const { post } = setup();
    const response = await post('{"type":1}', {
      'x-signature-ed25519': 'a'.repeat(128),
      'x-signature-timestamp': timestamp,
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a genuine signature whose timestamp is stale (replay)', async () => {
    const { signedPost } = setup();
    expect((await signedPost('{"type":1}', String(NOW_MS / 1000 - 3600))).statusCode).toBe(401);
  });

  it('rejects a body modified after signing', async () => {
    const { post, keys } = setup();
    const response = await post('{"type":2}', {
      'x-signature-ed25519': keys.signRequest(timestamp, '{"type":1}'),
      'x-signature-timestamp': timestamp,
    });
    expect(response.statusCode).toBe(401);
  });

  it('answers PING with PONG', async () => {
    const { signedPost } = setup();
    const response = await signedPost('{"type":1}');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ type: 1 });
  });

  it('routes a slash command and answers ephemerally without mentions', async () => {
    const { signedPost } = setup();
    const response = await signedPost(commandPayload());
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      type: 4,
      data: { content: 'all good', allowed_mentions: { parse: [] }, flags: 64 },
    });
  });

  it('returns 400 for signed but malformed JSON', async () => {
    const { signedPost } = setup();
    expect((await signedPost('{not json')).statusCode).toBe(400);
  });

  it('returns 400 for a signed interaction with invalid identifiers', async () => {
    const { signedPost } = setup();
    expect((await signedPost(commandPayload({ id: 'nope' }))).statusCode).toBe(400);
  });

  it('returns 400 for unsupported interaction types', async () => {
    const { signedPost } = setup();
    expect((await signedPost(commandPayload({ type: 99 }))).statusCode).toBe(400);
  });

  it('refuses oversized bodies before verifying anything', async () => {
    const { post } = setup();
    const response = await post('x'.repeat(300 * 1024), {
      'x-signature-ed25519': 'a'.repeat(128),
      'x-signature-timestamp': timestamp,
    });
    expect(response.statusCode).toBe(413);
  });

  it('exposes nothing else', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'GET', url: '/interactions' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(404);
  });
});

describe('POST /interactions: modals and deferred work', () => {
  const deferredCommand = (run: () => Promise<Reply | null>, update = false): CommandEntry => ({
    path: ['picket', 'slow'],
    description: 'commands.picket.status.description',
    level: 'member',
    handler: async () => ({ kind: 'deferred', ephemeral: true, update, run }),
  });
  const slowPayload = () => commandPayload({ data: { id: '1', name: 'picket', type: 1, options: [{ type: 1, name: 'slow' }] } });

  it('answers a command that opens a modal with the modal itself', async () => {
    const { signedPost } = setup({
      extra: [
        {
          path: ['picket', 'form'],
          description: 'commands.picket.status.description',
          level: 'member',
          handler: async () => ({ kind: 'modal', customId: 'td:1:create', title: 'T', inputs: [{ customId: 'c', label: 'L', style: 'paragraph' }] }),
        },
      ],
    });
    const response = await signedPost(commandPayload({ data: { id: '1', name: 'picket', type: 1, options: [{ type: 1, name: 'form' }] } }));
    expect(response.json()).toMatchObject({ type: 9, data: { custom_id: 'td:1:create', title: 'T' } });
  });

  it('acknowledges with type 5 first, and only then runs the work and edits the original response', async () => {
    const replies = new InMemoryInteractionReplies();
    const events: string[] = [];
    const run = async () => {
      events.push('run');
      return ephemeral('finished');
    };
    const { signedPost, app } = setup({ extra: [deferredCommand(run)], replies });
    app.addHook('onResponse', async () => {
      events.push('response sent');
    });

    const response = await signedPost(slowPayload());
    await app.close();

    expect(response.json()).toEqual({ type: 5, data: { flags: 64 } });
    expect(events).toEqual(['response sent', 'run']);
    expect(replies.replies).toMatchObject([
      { action: 'editOriginal', content: 'finished', target: { applicationId: '800000000000000001' } },
    ]);
    expect(replies.replies[0]?.target.token.reveal()).toBe('interaction-token');
  });

  it('deletes the waiting response when the work has nothing to say', async () => {
    const replies = new InMemoryInteractionReplies();
    const { signedPost, app } = setup({ extra: [deferredCommand(async () => null)], replies });
    await signedPost(slowPayload());
    await app.close();
    expect(replies.replies).toMatchObject([{ action: 'deleteOriginal' }]);
  });

  it('follows up privately for a deferred button click, and stays silent when there is nothing to say', async () => {
    const replies = new InMemoryInteractionReplies();
    const first = setup({ extra: [deferredCommand(async () => ephemeral('note'), true)], replies });
    const response = await first.signedPost(slowPayload());
    await first.app.close();
    expect(response.json()).toEqual({ type: 6 });
    expect(replies.replies).toMatchObject([{ action: 'followUp', content: 'note' }]);

    const quiet = new InMemoryInteractionReplies();
    const second = setup({ extra: [deferredCommand(async () => null, true)], replies: quiet });
    await second.signedPost(slowPayload());
    await second.app.close();
    expect(quiet.replies).toEqual([]);
  });

  it('waits for the work in flight before closing, so that a rolling update loses nothing', async () => {
    const replies = new InMemoryInteractionReplies();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { signedPost, app } = setup({
      extra: [
        deferredCommand(async () => {
          await gate;
          return ephemeral('done after the signal');
        }),
      ],
      replies,
    });
    await signedPost(slowPayload());

    let closed = false;
    const closing = app.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closed).toBe(false);

    release();
    await closing;
    expect(replies.contents).toEqual(['done after the signal']);
  });

  it('survives a failed delivery: the HTTP answer is already sent and nothing else can be done', async () => {
    const replies = new InMemoryInteractionReplies();
    replies.failWith = new DiscordApiError('unknown_message', 'expired');
    const { signedPost, app } = setup({ extra: [deferredCommand(async () => ephemeral('x'))], replies });
    expect((await signedPost(slowPayload())).statusCode).toBe(200);
    await expect(app.close()).resolves.toBeUndefined();
  });

  it('turns a crash of the work into an error message for the user', async () => {
    const replies = new InMemoryInteractionReplies();
    const { signedPost, app } = setup({
      extra: [
        deferredCommand(async () => {
          throw new Error('boom');
        }),
      ],
      replies,
    });
    await signedPost(slowPayload());
    await app.close();
    expect(replies.contents).toEqual(['Une erreur est survenue. Veuillez réessayer plus tard.']);
  });
});
