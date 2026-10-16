import {
  createInteractionServer,
  decodeCustomId,
  toWireResponse,
  type PanelView,
} from '@picket/discord';
import { GuildId, UserId, noopLogger, systemClock } from '@picket/kernel';
import {
  InMemoryInteractionReplies,
  InMemoryMessaging,
  createTestDatabase,
  createTestKeys,
  queryAsAdmin,
  testI18n,
  type TestDatabase,
} from '@picket/testing';
import { PostgresVoice } from '@picket/voice';
import { buildPipeline } from '../src/composition';
const guildId = GuildId.assert('700000000000000001');
const keys = createTestKeys(),
  replies = new InMemoryInteractionReplies();
let sequence = 0;
function control(view: unknown, action: string, arg?: string): string {
  const ids: string[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if ((k === 'custom_id' || k === 'customId') && typeof x === 'string')
        ids.push(x);
      else if (Array.isArray(x)) x.forEach(walk);
      else if (typeof x === 'object') walk(x);
    }
  };
  walk(view);
  const id = ids.find((id) => {
    const decoded = decodeCustomId(id),
      p = decoded?.payload.split('.'),
      offset = decoded?.namespace.startsWith('ps') ? 3 : 2;
    return (
      p?.[offset] === action && (arg === undefined || p[offset + 1] === arg)
    );
  });
  if (!id) throw new Error(`Missing ${action}.${arg}`);
  return id;
}
describe('voice through signed HTTP, Discord modal wire format and PostgreSQL', () => {
  let database: TestDatabase, voice: PostgresVoice;
  beforeAll(async () => {
    database = await createTestDatabase();
    voice = new PostgresVoice(
      database.handle.db,
      {
        category: async () => undefined,
        create: async () => String(610000000000000000n + BigInt(++sequence)),
        exists: async () => true,
        remove: async () => undefined,
      },
      systemClock,
      noopLogger,
    );
  });
  afterAll(async () => {
    await database.drop();
  });
  async function request(
    data: object,
    options: {
      customId?: string;
      modal?: boolean;
      member?: boolean;
      user?: string;
    } = {},
  ) {
    const value = {
      id: String(910000000000000000n + BigInt(++sequence)),
      application_id: '800000000000000001',
      token: 'unused',
      version: 1,
      type: options.customId ? (options.modal ? 5 : 3) : 2,
      guild_id: guildId,
      channel_id: '600000000000000001',
      locale: 'en-US',
      member: {
        user: { id: options.user ?? '500000000000000001' },
        roles: [],
        permissions: options.member ? '0' : '8',
      },
      ...(options.customId
        ? {
            message: {
              id: '900000000000000001',
              channel_id: '600000000000000001',
            },
          }
        : {}),
      data: options.customId ? { custom_id: options.customId, ...data } : data,
    };
    const body = JSON.stringify(value),
      timestamp = String(Math.floor(Date.now() / 1000)),
      before = replies.replies.length;
    const app = createInteractionServer({
      publicKey: keys.publicKeyHex,
      pipeline: buildPipeline(database.handle.db, noopLogger, {
        clock: systemClock,
        i18n: testI18n,
        guildRetentionDays: 30,
        voice,
        discord: { messaging: new InMemoryMessaging(), replies },
      }),
      replies,
      logger: noopLogger,
      clock: systemClock,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/interactions',
      headers: {
        'content-type': 'application/json',
        'x-signature-timestamp': timestamp,
        'x-signature-ed25519': keys.signRequest(timestamp, body),
      },
      payload: body,
    });
    await app.close();
    expect(response.statusCode).toBe(200);
    const wire = response.json();
    if (wire.type !== 5 && wire.type !== 6) return wire;
    const delivery = replies.replies.slice(before).at(-1);
    if (delivery?.action === 'deleteOriginal') return wire;
    const content = delivery?.content;
    if (typeof content === 'string') return content;
    if (!content || !('components' in content))
      throw new Error(JSON.stringify(replies.replies.slice(before)));
    return toWireResponse({
      kind: 'panel',
      update: true,
      panel: content as PanelView,
    });
  }
  const command = (name: string, member = false, root = 'picket') =>
    request(
      { id: '1', name: root, type: 1, options: [{ type: 1, name }] },
      { member },
    );
  const click = (
    view: unknown,
    action: string,
    arg?: string,
    values?: string[],
    member = false,
  ) =>
    request(
      { component_type: values ? 3 : 2, ...(values ? { values } : {}) },
      { customId: control(view, action, arg), member },
    );
  it('configures a native four-field template with one shared name and deploys a merged member queue', async () => {
    const home = await command('settings');
    expect(() => control(home, 'configure', 'voice')).toThrow('Missing');
    const settings = await command('settings', false, 'voice');
    expect(JSON.stringify(await click(settings, 'view', 'home'))).toContain('Server settings');
    const modal = await click(settings, 'addModel');
    expect(modal.type).toBe(9);
    expect(modal.data.components).toHaveLength(4);
    expect(modal.data.components[0].component.type).toBe(8);
    expect(modal.data.components[1].component.custom_id).toBe('channelName');
    const modelId = modal.data.custom_id;
    const result = await request(
      {
        components: [
          {
            type: 18,
            component: {
              type: 8,
              custom_id: 'category',
              values: ['600000000000000004'],
            },
          },
          {
            type: 18,
            component: { type: 4, custom_id: 'channelName', value: 'Combat' },
          },
          {
            type: 18,
            component: { type: 4, custom_id: 'capacity', value: '99' },
          },
          {
            type: 18,
            component: { type: 3, custom_id: 'delay', values: ['15'] },
          },
        ],
      },
      { customId: modelId, modal: true },
    );
    expect(JSON.stringify(result)).toContain('Combat');
    const rows = await queryAsAdmin(
      database,
      'SELECT name,channel_name,capacity,idle_minutes,category_id FROM voice_templates',
    );
    expect(rows).toEqual([
      { name: 'Combat', channel_name: 'Combat', capacity: 99, idle_minutes: 15, category_id: '600000000000000004' },
    ]);
    await queryAsAdmin(
      database,
      "INSERT INTO leases(name,holder,token,expires_at) VALUES('gateway:shard:0','http-test',1,now()+interval '1 day')",
    );
    await voice.handle(
      {
        type: 'guild_available',
        guildId,
        voiceSnapshot: {
          name: 'Server',
          afkChannelId: null,
          people: [],
          channels: {},
        },
      },
      {
        key: 'snapshot',
        shardId: 0,
        at: new Date(),
        replayed: false,
        lease: { name: 'gateway:shard:0', holder: 'http-test', token: 1n },
      },
    );
    const template = (
      await queryAsAdmin<{ id: string }>(
        database,
        'SELECT id FROM voice_templates',
      )
    )[0]!.id;
    let member = await command('create', true, 'voice');
    member = await click(member, 'pick', undefined, [template], true);
    member = await click(member, 'quantity', undefined, ['2'], true);
    member = await click(member, 'addQueue', undefined, undefined, true);
    member = await click(member, 'pick', undefined, [template], true);
    member = await click(member, 'addQueue', undefined, undefined, true);
    expect(JSON.stringify(member)).toContain('Deploy 3 channels');
    expect(
      await queryAsAdmin(database, 'SELECT * FROM voice_channels'),
    ).toHaveLength(0);
    const staleDeploy = control(member, 'deploy');
    member = await click(member, 'deploy', undefined, undefined, true);
    expect(JSON.stringify(member)).toContain('Queued');
    expect(
      await queryAsAdmin(database, 'SELECT * FROM voice_channels'),
    ).toHaveLength(3);
    await request(
      { component_type: 2 },
      { customId: staleDeploy, member: true },
    );
    expect(
      await queryAsAdmin(database, 'SELECT * FROM voice_channels'),
    ).toHaveLength(3);
    await voice.tick();
    await voice.tick();
    expect(
      (await voice.channels(guildId)).filter((c) => c.status === 'active'),
    ).toHaveLength(3);
  });
  it('cancels a prepared member queue by deleting its private message and invalidating old controls', async () => {
    await command('create', true, 'voice');
    await voice.saveTemplate(
      { guildId, userId: UserId.assert('500000000000000001'), roleIds: [] },
      { name: 'Cancel example', channelName: 'Cancel example', categoryId: '600000000000000004', capacity: 99, idleMinutes: 15 },
    );
    const templates = await queryAsAdmin<{ id: string }>(
      database, "SELECT id FROM voice_templates WHERE name = 'Cancel example'",
    );
    const template = templates[0]!.id;
    let member = await command('create', true, 'voice');
    member = await click(member, 'pick', undefined, [template], true);
    member = await click(member, 'addQueue', undefined, undefined, true);
    const deploy = control(member, 'deploy');
    const sessionId = decodeCustomId(deploy)!.payload.split('.')[0]!;
    const channelsBefore = await voice.channels(guildId);
    const deliveriesBefore = replies.replies.length;

    expect(await click(member, 'cancel', undefined, undefined, true)).toEqual({ type: 6 });
    expect(replies.replies.slice(deliveriesBefore)).toMatchObject([
      { action: 'deleteOriginal', target: { applicationId: '800000000000000001' }, content: null },
    ]);
    expect(await queryAsAdmin(database, 'SELECT state->\'queue\' AS queue FROM voice_sessions WHERE id = $1', [sessionId]))
      .toEqual([{ queue: {} }]);
    expect(JSON.stringify(await request({ component_type: 2 }, { customId: deploy, member: true }))).toContain('expired');
    expect(await voice.channels(guildId)).toEqual(channelsBefore);
  });
  it('rejects member configuration and another member taking over a private draft', async () => {
    const settings = await command('settings');
    expect(JSON.stringify(settings)).toContain('Temporary voice channels');
    const denied = await command('settings', true, 'voice');
    expect(JSON.stringify(denied)).toContain('required level');
    const member = await command('create', true, 'voice');
    const foreign = await request(
      { component_type: 2 },
      {
        customId: control(member, 'clear'),
        member: true,
        user: '500000000000000002',
      },
    );
    expect(JSON.stringify(foreign)).toContain('expired');
  });
});
