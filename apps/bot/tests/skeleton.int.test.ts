import { buildCommandsPayload, createInteractionServer, toWireResponse } from '@picket/discord';
import { ChannelId, Secret, noopLogger, systemClock } from '@picket/kernel';
import { createDatabase } from '@picket/persistence';
import {
  InMemoryInteractionReplies,
  InMemoryMessaging,
  createTestDatabase,
  createTestKeys,
  queryAsAdmin,
  testI18n,
  type TestDatabase,
} from '@picket/testing';
import { buildAuditPublisher, buildCommandRegistry, buildPipeline, buildPurgeJob } from '../src/composition';

const GUILD = '700000000000000001';
const OFFICER_ROLE = '400000000000000011';
const ADMINISTRATOR = '8';
const DAY_MS = 24 * 60 * 60 * 1000;

// Horloge métier pilotable ; l'ingress garde l'horloge système (les signatures sont générées en temps réel).
let businessNow = new Date('2026-10-05T12:00:00Z');
const messaging = new InMemoryMessaging();
const replies = new InMemoryInteractionReplies();
const composition = {
  clock: { now: () => businessNow },
  guildRetentionDays: 30,
  i18n: testI18n,
  discord: { messaging, replies, guildChannels: { inspect: async () => ({ kind: 'ready' as const, locale: 'en' }) } },
};

describe('settings panel: signed HTTP -> guards -> Postgres -> Discord replies', () => {
  let database: TestDatabase;
  const keys = createTestKeys();
  let counter = 0;
  const caller = '500000000000000001';
  beforeAll(async () => { database = await createTestDatabase(); });
  afterAll(async () => { await database.drop(); });
  beforeEach(() => { businessNow = new Date('2026-10-05T12:00:00Z'); });
  interface RequestOptions {
    permissions?: string; roles?: string[]; guildId?: string; locale?: string;
    path?: object[]; customId?: string; componentType?: number; values?: string[];
    resolved?: object; modal?: boolean; fields?: object[];
  }
  const server = () => createInteractionServer({ publicKey: keys.publicKeyHex, pipeline: buildPipeline(database.handle.db, noopLogger, composition), replies, logger: noopLogger, clock: systemClock });
  const payload = (options: RequestOptions, id?: string) => ({
    id: id ?? `91000000000${String(10_000 + counter++)}`, application_id: '800000000000000001', token: 'interaction-token', version: 1,
    type: options.customId ? options.modal ? 5 : 3 : 2,
    guild_id: options.guildId ?? GUILD, channel_id: '600000000000000001', locale: options.locale ?? 'en-US',
    member: { user: { id: caller }, roles: options.roles ?? [], permissions: options.permissions ?? '0' },
    ...(options.customId ? { message: { id: '900000000000000001', channel_id: '600000000000000001' } } : {}),
    data: options.customId ? options.modal ? { custom_id: options.customId, components: options.fields ?? [] } : { custom_id: options.customId, component_type: options.componentType ?? 2, ...(options.values ? { values: options.values } : {}), ...(options.resolved ? { resolved: options.resolved } : {}) } : { id: '1', name: 'picket', type: 1, options: options.path ?? [{ type: 1, name: 'settings' }] },
  });
  function signed(value: object) {
    const timestamp = String(Math.floor(Date.now() / 1000)); const body = JSON.stringify(value);
    return { method: 'POST' as const, url: '/interactions', headers: { 'content-type': 'application/json', 'x-signature-ed25519': keys.signRequest(timestamp, body), 'x-signature-timestamp': timestamp }, payload: body };
  }
  async function say(options: RequestOptions = {}) {
    const app = server(); const before = replies.replies.length;
    const response = await app.inject(signed(payload(options))); await app.close();
    expect(response.statusCode).toBe(200);
    const wire = response.json();
    if (wire.type === 5 || wire.type === 6) {
      const delivered = replies.replies.slice(before); expect(delivered).toHaveLength(1);
      const content = delivered[0]!.content!;
      expect(delivered[0]?.action).toBe(typeof content !== 'string' && 'file' in content ? 'followUp' : 'editOriginal');
      if (typeof content !== 'string' && 'components' in content) toWireResponse({ kind: 'panel', panel: content, update: wire.type === 6 });
      return content;
    }
    if (wire.type === 9) return wire.data as { custom_id: string };
    expect(wire.data.allowed_mentions).toEqual({ parse: [] }); return wire.data.content as string;
  }
  function control(panel: unknown, action: string, arg?: string) {
    const matches = JSON.stringify(panel).matchAll(/"customId":"([^"]+)"/g);
    for (const match of matches) { const id = match[1]!; if (id.split('.')[3] === action && (arg === undefined || id.split('.')[4] === arg)) return id; }
    throw new Error(`Missing control ${action}.${arg}`);
  }
  const admin = { permissions: ADMINISTRATOR };
  const status = [{ type: 1, name: 'status' }];
  const click = (panel: unknown, action: string, arg?: string, options: RequestOptions = {}) => say({ ...admin, customId: control(panel, action, arg), ...options });

  it('answers member status with permissions and lazily initialises the tenant', async () => {
    const result = await say({ path: status }); expect(result).toContain('PICKET is up'); expect(result).toContain('Member roles: @everyone');
    expect(await queryAsAdmin(database, 'SELECT guild_id FROM guild_settings')).toEqual([{ guild_id: GUILD }]);
    expect(await say({ path: status, locale: 'fr' })).toContain('PICKET est opérationnel');
    expect(await say()).toContain('required level: officer');
  });
  it('uses native role selections, applies access immediately and audits before/after', async () => {
    const home = await say(admin); const permissions = await click(home, 'view', 'permissions'); const officers = await click(permissions, 'view', 'officer');
    const selection = { componentType: 6, values: [OFFICER_ROLE], resolved: { roles: { [OFFICER_ROLE]: { id: OFFICER_ROLE, name: 'Officers' } } } };
    expect(await click(officers, 'add', 'officer', { ...selection, permissions: '0' })).toContain('required level: admin');
    await click(officers, 'add', 'officer', selection);
    expect(await queryAsAdmin(database, 'SELECT level, role_id FROM guild_permission_roles WHERE level = $1', ['officer'])).toEqual([{ level: 'officer', role_id: OFFICER_ROLE }]);
    expect(await queryAsAdmin(database, 'SELECT actor_id, action FROM guild_audit_log')).toEqual([{ actor_id: caller, action: 'permissions.add' }]);
    expect(JSON.stringify(await say({ roles: [OFFICER_ROLE] }))).toContain('Your access level: **officer**');
    const members = await click(permissions, 'view', 'member'); await click(members, 'restrict');
    expect(await say({ path: status })).toContain('required level: member');
    expect(await say({ path: status, roles: [OFFICER_ROLE] })).toContain('PICKET is up');
    const confirm = await click(await click(permissions, 'view', 'member'), 'view', 'everyone'); await click(confirm, 'everyone');
    expect(await say({ path: status })).toContain('PICKET is up');
  });
  it('saves settings from menus and modals, changes language immediately, and keeps war-log unavailable', async () => {
    const home = await say(admin); const language = await click(home, 'view', 'language');
    expect(JSON.stringify(await click(language, 'language', '0', { componentType: 3, values: ['fr'] }))).toContain('Modification enregistrée');
    expect(await say({ path: status })).toContain('PICKET est opérationnel');
    await click(language, 'language', '0', { componentType: 3, values: ['auto'] });
    const advanced = await click(home, 'view', 'advanced'); expect(JSON.stringify(advanced)).toContain('Coming soon');
    const modal = await click(advanced, 'timezone') as { custom_id: string };
    await say({ ...admin, customId: modal.custom_id, modal: true, fields: [{ type: 18, component: { type: 4, custom_id: 'timezone', value: 'europe/paris' } }] });
    const channel = '600000000000000009';
    await click(advanced, 'channel', '0', { componentType: 8, values: [channel], resolved: { channels: { [channel]: { id: channel, type: 0 } } } });
    await click(await click(home, 'disable', 'timers'), 'disable', 'timers');
    const rows = await queryAsAdmin(database, 'SELECT locale, timezone, audit_channel_id, features FROM guild_settings WHERE guild_id = $1', [GUILD]);
    expect(rows).toEqual([{ locale: null, timezone: 'Europe/Paris', audit_channel_id: channel, features: { timers: false, todolists: true, warlog: false } }]);
    const audit = await queryAsAdmin<{ action: string }>(database, "SELECT action FROM guild_audit_log WHERE action LIKE 'settings.%' ORDER BY id");
    expect(audit.map((row) => row.action)).toEqual(['settings.language', 'settings.language', 'settings.timezone', 'settings.audit_channel', 'settings.feature']);
  });
  it('keeps guilds separate and redirects old commands without mutation', async () => {
    const other = '700000000000000002';
    const old = [{ type: 2, name: 'settings', options: [{ type: 1, name: 'language', options: [{ type: 3, name: 'language', value: 'fr' }] }] }];
    expect(JSON.stringify(await say({ ...admin, guildId: other, path: old }))).toContain('No old command arguments');
    expect(await queryAsAdmin(database, 'SELECT locale FROM guild_settings WHERE guild_id = $1', [other])).toEqual([{ locale: null }]);
    expect(await queryAsAdmin(database, 'SELECT role_id FROM guild_permission_roles WHERE guild_id = $1', [other])).toEqual([{ role_id: other }]);
  });
  it('previews deletion, blocks writes during suspension, recovers after expiry and purges on time', async () => {
    const guildId = '700000000000000077'; const options = { ...admin, guildId };
    const home = await say(options); const data = await click(home, 'view', 'data', options); const confirm = await click(data, 'view', 'delete', options);
    expect(JSON.stringify(confirm)).toContain('not automatically deleted');
    await click(confirm, 'delete', '0', options);
    expect(await say({ guildId, path: status })).toContain('scheduled for deletion');
    expect(JSON.stringify(await click(home, 'disable', 'timers', options))).toContain('suspended');
    businessNow = new Date('2026-10-05T12:16:00Z');
    const recovery = await say(options); await click(recovery, 'cancel', '0', options);
    expect(await say({ guildId, path: status })).toContain('PICKET is up');
    businessNow = new Date('2026-10-05T12:00:00Z');
    const again = await say(options); await click(await click(await click(again, 'view', 'data', options), 'view', 'delete', options), 'delete', '0', options);
    const job = buildPurgeJob(database.handle.db, noopLogger, composition);
    businessNow = new Date(Date.parse('2026-10-05T12:00:00Z') + 29 * DAY_MS); expect((await job.execute()).purged).toEqual([]);
    businessNow = new Date(Date.parse('2026-10-05T12:00:00Z') + 30 * DAY_MS); expect((await job.execute()).purged).toEqual([guildId]);
    for (const table of ['guild_settings', 'guild_permission_roles', 'guild_audit_log', 'guild_registry', 'interaction_receipts']) expect(await queryAsAdmin(database, `SELECT 1 FROM ${table} WHERE guild_id = $1`, [guildId])).toHaveLength(0);
  });
  it('deduplicates signed status requests across replicas and denies DMs', async () => {
    const request = signed(payload({ path: status }, '910000000000099999')); const first = server(); const second = server();
    const results = await Promise.all([first.inject(request), second.inject(request)]); await Promise.all([first.close(), second.close()]);
    expect(results.filter((response) => response.json().data.content.includes('already been processed'))).toHaveLength(1);
    const dm = payload({ path: status }) as Record<string, unknown>; delete dm.guild_id; delete dm.member; dm.user = { id: caller };
    const app = server(); expect((await app.inject(signed(dm))).json().data.content).toContain('only be used in a server'); await app.close();
  });
  it('publishes only two picket commands alongside unchanged feature commands', () => {
    const commands = buildCommandsPayload(buildCommandRegistry(database.handle.db, composition));
    expect(commands.map((command) => command.name)).toEqual(['picket', 'timers', 'todolist']);
    expect(commands[0]?.options?.map((command) => [command.name, command.type])).toEqual([['settings', 1], ['status', 1]]);
    expect(commands[1]?.options?.map((command) => command.name)).toEqual(['add', 'cleanup', 'create', 'repair', 'settings', 'strike']);
  });
  it('downloads a complete tenant export privately during suspension and denies non-administrators', async () => {
    const guildId = '700000000000000088';
    const options = { ...admin, guildId };
    const home = await say(options);
    const data = await click(home, 'view', 'data', options);
    expect(JSON.stringify(await click(data, 'export', '0', { ...options, permissions: '0' }))).toContain('required level: admin');
    const confirmation = await click(data, 'view', 'delete', options);
    const recovery = await click(confirmation, 'delete', '0', options);
    const exported = await click(recovery, 'export', '0', options);
    if (typeof exported !== 'object' || !('file' in exported)) throw new Error('Expected a private download');
    const contents = JSON.parse(new TextDecoder().decode(exported.file.bytes));
    expect(contents.guildId).toBe(guildId);
    expect(contents.data.guild_registry).toEqual([expect.objectContaining({ guild_id: guildId, inactive_reason: 'requested' })]);
    expect(contents.data.guild_audit_log).toEqual([expect.objectContaining({ actor_id: caller, action: 'guild.deletion_requested' })]);
    for (const records of Object.values(contents.data) as { guild_id: string }[][]) expect(records.every((row) => row.guild_id === guildId)).toBe(true);
    expect(await say({ guildId, path: status })).toContain('scheduled for deletion');
    await click(recovery, 'cancel', '0', options);
  });
});

describe('todolists end to end: signed HTTP -> pipeline -> Postgres lock -> Discord messages (integration)', () => {
  let database: TestDatabase;
  const keys = createTestKeys();
  let counter = 0;
  const GUILD_ID = '700000000000000066';
  const CHANNEL_ID = '600000000000000066';
  const channel = ChannelId.assert(CHANNEL_ID);
  const PERMISSIONS_OK = String((1 << 10) | (1 << 11) | (1 << 14));

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  beforeEach(() => {
    replies.replies.length = 0;
    messaging.latencyMs = 0;
  });

  const replica = () =>
    createInteractionServer({
      publicKey: keys.publicKeyHex,
      pipeline: buildPipeline(database.handle.db, noopLogger, composition),
      replies,
      logger: noopLogger,
      clock: systemClock,
    });

  async function post(app: ReturnType<typeof replica>, interaction: Record<string, unknown>) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({
      id: `95000000000${String(10_000 + counter++)}`,
      application_id: '800000000000000001',
      token: 'interaction-token',
      version: 1,
      guild_id: GUILD_ID,
      channel_id: CHANNEL_ID,
      locale: 'en-US',
      app_permissions: PERMISSIONS_OK,
      member: { user: { id: '500000000000000001' }, roles: [], permissions: '0' },
      ...interaction,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/interactions',
      headers: {
        'content-type': 'application/json',
        'x-signature-ed25519': keys.signRequest(timestamp, body),
        'x-signature-timestamp': timestamp,
      },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    return response.json() as { type: number; data?: { content?: string; custom_id?: string; flags?: number } };
  }

  const create = (app: ReturnType<typeof replica>) =>
    post(app, { type: 2, data: { id: '1', name: 'todolist', type: 1, options: [{ type: 1, name: 'create' }] } });
  const submit = (app: ReturnType<typeof replica>, content: string, extra: Record<string, unknown> = {}) =>
    post(app, {
      type: 5,
      data: { custom_id: 'td:1:create', components: [{ type: 1, components: [{ type: 4, custom_id: 'content', value: content }] }] },
      ...extra,
    });
  const click = (app: ReturnType<typeof replica>, message: string, index: number, extra: Record<string, unknown> = {}) =>
    post(app, {
      type: 3,
      message: { id: message, channel_id: CHANNEL_ID },
      data: { custom_id: `td:1:i${index}`, component_type: 2 },
      ...extra,
    });

  /** Comme à l'arrêt d'une réplique : attend le travail différé avant d'inspecter. */
  const drain = (app: ReturnType<typeof replica>) => app.close();
  const posted = () => messaging.list(channel);

  it('opens the creation modal for a plain member', async () => {
    const app = replica();
    expect(await create(app)).toMatchObject({ type: 9, data: { custom_id: 'td:1:create' } });
    await drain(app);
  });

  it('creates a list: acknowledged at once, posted publicly, confirmed privately', async () => {
    const app = replica();
    const response = await submit(app, '__Prep__\nA・Crates (x2)\nB・Trucks');
    expect(response).toEqual({ type: 5, data: { flags: 64 } });
    await drain(app);

    const [message] = posted();
    expect(message?.description).toBe('__Prep__\n🇦・Crates (x2)\n🇧・Trucks');
    expect(message?.buttons.map((button) => button.customId)).toEqual(['td:1:i0', 'td:1:i1']);
    expect(replies.replies).toMatchObject([{ action: 'editOriginal', content: 'Todolist posted.' }]);
  });

  it('stores creation metadata only: list contents and ticking state stay in Discord', async () => {
    const tables = await queryAsAdmin<{ table_name: string }>(
      database,
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    expect(tables.map((row) => row.table_name).filter((name) => name.includes('todo'))).toEqual([]);
    const records = await queryAsAdmin<{ after: Record<string, unknown> }>(database, "SELECT after FROM guild_audit_log WHERE action = 'todolist.created'");
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) expect(Object.keys(record.after).sort()).toEqual(['channel_id', 'message_ids', 'messages']);
    expect(JSON.stringify(records)).not.toContain('Crates');
  });

  it('publishes todolist creation audit even with a noop logger, without duplicating log entries', async () => {
    const auditChannel = ChannelId.assert('600000000000000099');
    await queryAsAdmin(database, 'UPDATE guild_settings SET audit_channel_id = $1 WHERE guild_id = $2', [auditChannel, GUILD_ID]);
    const app = replica();
    await submit(app, 'A・Secret list text'); await drain(app);
    const audit = buildAuditPublisher(database.handle.db, noopLogger, { ...composition, clock: { now: () => new Date(Date.now() + 1000) } });
    await audit.tick(); await audit.tick();
    expect(messaging.list(auditChannel)).toHaveLength(1);
    expect(messaging.list(auditChannel)[0]?.view.content).toContain('📋 **Todolist created**');
    expect(JSON.stringify(messaging.list(auditChannel))).not.toContain('Secret list text');
    await queryAsAdmin(database, 'UPDATE guild_settings SET audit_channel_id = NULL WHERE guild_id = $1', [GUILD_ID]);
  });

  it('plays a whole list: quantities need several clicks, the last click removes the message and says so once', async () => {
    const app = replica();
    await submit(app, 'A・Crates (x2)\nB・Trucks');
    await drain(app);
    const id = posted().at(-1)?.id as string;
    replies.replies.length = 0;

    const clicks = replica();
    expect(await click(clicks, id, 0)).toEqual({ type: 6 });
    expect(await click(clicks, id, 0)).toEqual({ type: 6 });
    expect(await click(clicks, id, 1)).toEqual({ type: 6 });
    await drain(clicks);

    expect(posted().find((message) => message.id === id)).toBeUndefined();
    expect(replies.contents).toEqual(['Todolist complete: its message was removed.']);
  });

  it('TDL-EC-10: simultaneous clicks received by different replicas are all kept (Postgres lock, fresh read)', async () => {
    const author = replica();
    await submit(author, 'A・a\nB・b\nC・c\nD・d');
    await drain(author);
    const id = posted().at(-1)?.id as string;
    messaging.latencyMs = 25;

    const replicas = [replica(), replica(), replica()];
    await Promise.all(replicas.map((app, index) => click(app, id, index)));
    await Promise.all(replicas.map(drain));

    expect(posted().find((message) => message.id === id)?.description).toBe('✅・~~a~~\n✅・~~b~~\n✅・~~c~~\n🇩・d');
  });

  it('XCT-RQ-04: a server that disabled the feature gets neither the modal nor working buttons', async () => {
    const app = replica();
    await submit(app, 'A・a\nB・b');
    await drain(app);
    const id = posted().at(-1)?.id as string;

    await queryAsAdmin(database, `UPDATE guild_settings SET features = '{"timers": true, "todolists": false, "warlog": false}' WHERE guild_id = $1`, [
      GUILD_ID,
    ]);
    const off = replica();
    expect((await create(off)).data?.content).toContain('disabled on this server');
    expect((await click(off, id, 0)).data?.content).toContain('disabled on this server');
    expect(posted().find((message) => message.id === id)?.description).toBe('🇦・a\n🇧・b');

    await queryAsAdmin(database, `UPDATE guild_settings SET features = '{"timers": true, "todolists": true, "warlog": false}' WHERE guild_id = $1`, [
      GUILD_ID,
    ]);
    expect(await click(off, id, 0)).toEqual({ type: 6 });
    await drain(off);
  });

  it('XCT-EC-07: explains missing bot permissions before anything is posted', async () => {
    const before = posted().length;
    const app = replica();
    const response = await post(app, {
      type: 2,
      app_permissions: String(1 << 10),
      data: { id: '1', name: 'todolist', type: 1, options: [{ type: 1, name: 'create' }] },
    });
    expect(response.data?.content).toContain('Missing permissions in this channel: Send Messages, Embed Links');
    expect((await submit(app, 'A・a', { app_permissions: String(1 << 10) })).data?.content).toContain('Missing permissions');
    expect(posted()).toHaveLength(before);
    await drain(app);
  });

  it('DIS-EC-07: a button from another version or an unknown family is answered, not ignored', async () => {
    const app = replica();
    for (const customId of ['td:2:i0', 'old_todolist_a', 'zz:1:i0']) {
      const response = await post(app, {
        type: 3,
        message: { id: '910000000000000999', channel_id: CHANNEL_ID },
        data: { custom_id: customId, component_type: 2 },
      });
      expect(response.data?.content).toBe('This interaction is no longer available.');
      expect(response.data?.flags).toBe(64);
    }
    await drain(app);
  });

  it('answers in French to a French user without changing the posted list', async () => {
    const app = replica();
    await submit(app, 'A・a', { locale: 'fr' });
    await drain(app);
    expect(replies.contents).toEqual(['Todolist publiée.']);
    expect(posted().at(-1)?.description).toBe('🇦・a');
  });
});
