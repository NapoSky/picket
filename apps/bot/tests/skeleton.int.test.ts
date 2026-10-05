import { buildCommandsPayload, createInteractionServer } from '@picket/discord';
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
import { buildCommandRegistry, buildPipeline, buildPurgeJob } from '../src/composition';

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
  discord: { messaging, replies },
};

describe('signed HTTP interaction -> pipeline -> access control -> Postgres -> reply (integration)', () => {
  let database: TestDatabase;
  const keys = createTestKeys();
  let counter = 0;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  function server(db = database.handle.db) {
    return createInteractionServer({
      publicKey: keys.publicKeyHex,
      pipeline: buildPipeline(db, noopLogger, composition),
      replies,
      logger: noopLogger,
      clock: systemClock,
    });
  }

  interface Caller {
    readonly permissions?: string;
    readonly roles?: string[];
    readonly guildId?: string;
    readonly locale?: string;
  }

  function payload(options: Caller & { path: object[]; id?: string }) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const id = options.id ?? `91000000000${String(10_000 + counter++)}`;
    const body = JSON.stringify({
      id,
      application_id: '800000000000000001',
      type: 2,
      token: 'interaction-token',
      version: 1,
      guild_id: options.guildId ?? GUILD,
      channel_id: '600000000000000001',
      locale: options.locale ?? 'en-US',
      member: { user: { id: '500000000000000001' }, roles: options.roles ?? [], permissions: options.permissions ?? '0' },
      data: { id: '1', name: 'picket', type: 1, options: options.path },
    });
    return {
      method: 'POST' as const,
      url: '/interactions',
      headers: {
        'content-type': 'application/json',
        'x-signature-ed25519': keys.signRequest(timestamp, body),
        'x-signature-timestamp': timestamp,
      },
      payload: body,
    };
  }

  const status = [{ type: 1, name: 'status' }];
  const show = [{ type: 2, name: 'permissions', options: [{ type: 1, name: 'show' }] }];
  const set = (level: string, role: string, action: string, confirm?: boolean) => [
    {
      type: 2,
      name: 'permissions',
      options: [
        {
          type: 1,
          name: 'set',
          options: [
            { type: 3, name: 'level', value: level },
            { type: 8, name: 'role', value: role },
            { type: 3, name: 'action', value: action },
            ...(confirm === undefined ? [] : [{ type: 5, name: 'confirm', value: confirm }]),
          ],
        },
      ],
    },
  ];

  const say = async (app: ReturnType<typeof server>, options: Caller & { path: object[]; id?: string }) => {
    const response = await app.inject(payload(options));
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.allowed_mentions).toEqual({ parse: [] });
    expect(body.data.flags).toBe(64);
    return body.data.content as string;
  };

  it('answers /picket status to a plain member and lazily initialises the guild', async () => {
    const content = await say(server(), { path: status });

    expect(content).toContain('PICKET is up and running.');
    expect(content).toContain('Enabled features: timers, todolists');
    expect(await queryAsAdmin(database, 'SELECT guild_id FROM guild_settings')).toEqual([{ guild_id: GUILD }]);
    expect(await queryAsAdmin(database, 'SELECT level, role_id FROM guild_permission_roles')).toEqual([
      { level: 'member', role_id: GUILD },
    ]);
  });

  it('answers in French to a French user, and in English otherwise', async () => {
    const french = await say(server(), { path: status, locale: 'fr' });
    expect(french).toContain('PICKET est opérationnel.');
    expect(french).toContain('Fonctionnalités activées : timers, todolists');

    expect(await say(server(), { path: status, locale: 'ja' })).toContain('PICKET is up and running.');
  });

  it('only lets administrators change permissions, and audits the change', async () => {
    const app = server();

    const denied = await say(app, { path: set('officer', OFFICER_ROLE, 'add') });
    expect(denied).toContain('required level: admin');
    expect(await queryAsAdmin(database, 'SELECT 1 FROM guild_audit_log')).toHaveLength(0);

    const applied = await say(app, { permissions: ADMINISTRATOR, path: set('officer', OFFICER_ROLE, 'add') });
    expect(applied).toBe(`<@&${OFFICER_ROLE}> now has the officer level.`);
    expect(await queryAsAdmin(database, 'SELECT actor_id, action FROM guild_audit_log')).toEqual([
      { actor_id: '500000000000000001', action: 'permissions.add' },
    ]);
  });

  it('applies a permission change to the very next interaction', async () => {
    const app = server();
    expect(await say(app, { path: status })).toContain('PICKET is up');

    await say(app, { permissions: ADMINISTRATOR, path: set('member', GUILD, 'remove') });

    expect(await say(app, { path: status })).toContain('required level: member');
    expect(await say(app, { path: status, roles: [OFFICER_ROLE] })).toContain('PICKET is up');
  });

  it('shows the effective configuration with the caller level', async () => {
    const content = await say(server(), { path: show, roles: [OFFICER_ROLE] });
    expect(content).toContain('Your access level: officer');
    expect(content).toContain(`Officer roles: <@&${OFFICER_ROLE}>`);
    expect(content).toContain('Member roles: none');
  });

  it('asks confirmation before opening member commands to everyone', async () => {
    const app = server();
    const asked = await say(app, { permissions: ADMINISTRATOR, path: set('member', GUILD, 'add') });
    expect(asked).toContain('confirm:True');

    const done = await say(app, { permissions: ADMINISTRATOR, path: set('member', GUILD, 'add', true) });
    expect(done).toBe('@everyone now has the member level.');
  });

  it('keeps guilds apart', async () => {
    const other = '700000000000000002';
    const content = await say(server(), { guildId: other, path: show });
    expect(content).toContain('Officer roles: none (server administrators only)');
    expect(content).toContain('Member roles: @everyone');
  });

  describe('/picket settings', () => {
    const SETTINGS_GUILD = '700000000000000003';
    const setting = (subcommand: string, options: object[]) => [
      { type: 2, name: 'settings', options: [{ type: 1, name: subcommand, options }] },
    ];
    const asOfficer = { guildId: SETTINGS_GUILD, roles: [OFFICER_ROLE] };

    it('keeps settings away from plain members', async () => {
      const content = await say(server(), {
        guildId: SETTINGS_GUILD,
        path: setting('timezone', [{ type: 3, name: 'timezone', value: 'Europe/Paris' }]),
      });
      expect(content).toContain('required level: officer');
    });

    it('lets an officer change the time zone, the audit channel and the features, with an audit trail', async () => {
      const app = server();
      await say(app, { guildId: SETTINGS_GUILD, permissions: ADMINISTRATOR, path: set('officer', OFFICER_ROLE, 'add') });

      expect(await say(app, { ...asOfficer, path: setting('timezone', [{ type: 3, name: 'timezone', value: 'europe/paris' }]) })).toBe(
        'Time zone set to Europe/Paris.',
      );
      expect(await say(app, { ...asOfficer, path: setting('audit-channel', [{ type: 7, name: 'channel', value: '600000000000000009' }]) })).toBe(
        'Audit channel set to: <#600000000000000009>.',
      );
      expect(
        await say(app, {
          ...asOfficer,
          path: setting('feature', [
            { type: 3, name: 'feature', value: 'warlog' },
            { type: 5, name: 'enabled', value: true },
          ]),
        }),
      ).toBe('War log enabled.');
      expect(await say(app, { ...asOfficer, path: setting('timezone', [{ type: 3, name: 'timezone', value: 'Mars/Olympus' }]) })).toContain('IANA');

      const status = await say(app, { ...asOfficer, path: [{ type: 1, name: 'status' }] });
      expect(status).toContain('Timezone: Europe/Paris');
      expect(status).toContain('timers, todolists, warlog');
      expect(status).toContain('Audit channel: configured');

      const audit = await queryAsAdmin<{ actor_id: string; action: string }>(
        database,
        "SELECT actor_id, action FROM guild_audit_log WHERE guild_id = $1 AND action LIKE 'settings.%' ORDER BY id",
        [SETTINGS_GUILD],
      );
      expect(audit.map((entry) => entry.action)).toEqual(['settings.timezone', 'settings.audit_channel', 'settings.feature']);
    });

    it('imposes the server language over the language of every user, until it is set back to automatic', async () => {
      const app = server();
      const frenchUser = { ...asOfficer, locale: 'fr', path: [{ type: 1, name: 'status' }] };
      expect(await say(app, frenchUser)).toContain('PICKET est opérationnel.');

      // Un officier francophone choisit l'anglais pour tout le serveur.
      await say(app, { ...asOfficer, locale: 'fr', path: setting('language', [{ type: 3, name: 'language', value: 'en' }]) });
      expect(await say(app, frenchUser)).toContain('PICKET is up and running.');

      await say(app, { ...asOfficer, path: setting('language', [{ type: 3, name: 'language', value: 'auto' }]) });
      expect(await say(app, frenchUser)).toContain('PICKET est opérationnel.');
    });
  });

  it('processes a re-delivered interaction only once, across replicas', async () => {
    const request = payload({ path: status, id: '910000000000099999' });
    const [first, second] = await Promise.all([server().inject(request), server().inject(request)]);
    const contents = [first, second].map((response) => response.json().data.content as string);

    expect(contents.filter((content) => content.includes('PICKET is up'))).toHaveLength(1);
    expect(contents.filter((content) => content.includes('already been processed'))).toHaveLength(1);
  });

  it('refuses the command outside a guild', async () => {
    const dm = JSON.parse(payload({ path: status }).payload);
    delete dm.guild_id;
    delete dm.member;
    dm.user = { id: '500000000000000001' };
    dm.id = '910000000000088888';
    const body = JSON.stringify(dm);
    const timestamp = String(Math.floor(Date.now() / 1000));

    const response = await server().inject({
      method: 'POST',
      url: '/interactions',
      headers: {
        'content-type': 'application/json',
        'x-signature-ed25519': keys.signRequest(timestamp, body),
        'x-signature-timestamp': timestamp,
      },
      payload: body,
    });

    expect(response.json().data.content).toContain('only be used in a server');
  });

  it('denies (fail-closed) with a generic message when the database is unavailable', async () => {
    const broken = createDatabase({ connectionString: new Secret('postgres://nobody:wrong@127.0.0.1:1/none') });
    const content = await say(server(broken.db), { permissions: ADMINISTRATOR, path: status });
    expect(content).toBe('Something went wrong. Please try again later.');
    await broken.close();
  });

  it('declares every command with its options in the generated global payload', () => {
    const [picket, timers, todolist, ...rest] = buildCommandsPayload(buildCommandRegistry(database.handle.db, composition));
    expect(rest).toEqual([]);
    expect(todolist).toMatchObject({ name: 'todolist', contexts: [0], options: [{ type: 1, name: 'create' }] });
    expect(timers).toMatchObject({
      name: 'timers',
      contexts: [0],
      options: [
        {
          type: 1,
          name: 'add',
          options: [
            { type: 3, name: 'type', required: true },
            { type: 3, name: 'region', required: true, autocomplete: true },
            { type: 3, name: 'location', required: true, autocomplete: true },
            { type: 6, name: 'owner', required: false },
          ],
        },
        { type: 1, name: 'cleanup' },
        { type: 1, name: 'repair' },
        {
          type: 1,
          name: 'settings',
          options: [
            { type: 5, name: 'alerts' },
            { type: 3, name: 'thresholds' },
            { type: 8, name: 'alert-role' },
            { type: 3, name: 'alert-role-action' },
            { type: 5, name: 'silent' },
            { type: 3, name: 'duplicates' },
            { type: 5, name: 'restrict-changes' },
            { type: 4, name: 'max-active', min_value: 1, max_value: 100 },
            { type: 4, name: 'purge-after', min_value: 0, max_value: 720 },
            { type: 5, name: 'reset-on-new-war' },
          ],
        },
        { type: 1, name: 'strike', options: [{ type: 3, name: 'timer', required: true, autocomplete: true }] },
        { type: 2, name: 'board', options: [{ type: 1, name: 'create' }] },
      ],
    });
    expect(picket).toMatchObject({
      name: 'picket',
      contexts: [0],
      options: [
        { type: 1, name: 'status' },
        { type: 2, name: 'data', options: [{ type: 1, name: 'cancel-deletion' }, { type: 1, name: 'delete', options: [{ name: 'confirm' }] }] },
        {
          type: 2,
          name: 'permissions',
          options: [
            { type: 1, name: 'set', options: [{ name: 'level' }, { name: 'role' }, { name: 'action' }, { name: 'confirm' }] },
            { type: 1, name: 'show' },
          ],
        },
        {
          type: 2,
          name: 'settings',
          options: [
            { type: 1, name: 'audit-channel', options: [{ type: 7, name: 'channel', required: false }] },
            { type: 1, name: 'feature', options: [{ name: 'feature' }, { name: 'enabled' }] },
            { type: 1, name: 'language', options: [{ name: 'language' }] },
            { type: 1, name: 'timezone', options: [{ name: 'timezone' }] },
          ],
        },
      ],
    });
  });
});

describe('guild deletion lifecycle (integration)', () => {
  let database: TestDatabase;
  const keys = createTestKeys();
  let counter = 0;
  const guild = '700000000000000077';

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  const app = () =>
    createInteractionServer({
      publicKey: keys.publicKeyHex,
      pipeline: buildPipeline(database.handle.db, noopLogger, composition),
      replies,
      logger: noopLogger,
      clock: systemClock,
    });

  const say = async (path: object[], permissions = '0') => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({
      id: `92000000000${String(10_000 + counter++)}`,
      application_id: '800000000000000001',
      type: 2,
      token: 't',
      version: 1,
      guild_id: guild,
      channel_id: '600000000000000001',
      member: { user: { id: '500000000000000001' }, roles: [], permissions },
      data: { id: '1', name: 'picket', type: 1, options: path },
    });
    const response = await app().inject({
      method: 'POST',
      url: '/interactions',
      headers: {
        'content-type': 'application/json',
        'x-signature-ed25519': keys.signRequest(timestamp, body),
        'x-signature-timestamp': timestamp,
      },
      payload: body,
    });
    return response.json().data.content as string;
  };

  const data = (sub: string, confirm?: boolean) => [
    { type: 2, name: 'data', options: [{ type: 1, name: sub, options: confirm === undefined ? [] : [{ type: 5, name: 'confirm', value: confirm }] }] },
  ];
  const status = [{ type: 1, name: 'status' }];
  const rowsFor = async (table: string) =>
    queryAsAdmin(database, `SELECT 1 FROM ${table} WHERE guild_id = $1`, [guild]);

  beforeEach(() => {
    businessNow = new Date('2026-10-05T12:00:00Z');
  });

  it('explains the consequences and changes nothing without confirmation', async () => {
    expect(await say(status)).toContain('PICKET is up');
    const reply = await say(data('delete'), ADMINISTRATOR);
    expect(reply).toContain('2026-11-04');
    expect(reply).toContain('confirm:True');
    expect(await say(status)).toContain('PICKET is up');
  });

  it('only lets administrators schedule a deletion', async () => {
    expect(await say(data('delete', true))).toContain('required level: admin');
    expect(await say(status)).toContain('PICKET is up');
  });

  it('suspends the guild, keeps cancel-deletion available, and resumes after cancellation', async () => {
    expect(await say(data('delete', true), ADMINISTRATOR)).toBe(
      'Deletion scheduled for 2026-11-04. Cancel it with /picket data cancel-deletion.',
    );

    const blocked = await say(status);
    expect(blocked).toContain('scheduled for deletion on 2026-11-04');
    expect(await say(status, ADMINISTRATOR)).toContain('scheduled for deletion');
    expect(await say(data('delete', true), ADMINISTRATOR)).toContain('scheduled for deletion');

    expect(await say(data('cancel-deletion'), ADMINISTRATOR)).toContain('PICKET is active again');
    expect(await say(status)).toContain('PICKET is up');
    expect(await say(data('cancel-deletion'), ADMINISTRATOR)).toBe('No deletion is scheduled for this server.');
  });

  it('does not purge before the retention period, then erases everything after it', async () => {
    await say(data('delete', true), ADMINISTRATOR);
    const job = buildPurgeJob(database.handle.db, noopLogger, composition);

    businessNow = new Date(Date.parse('2026-10-05T12:00:00Z') + 29 * DAY_MS);
    expect((await job.execute()).purged).toEqual([]);
    expect(await rowsFor('guild_settings')).toHaveLength(1);

    businessNow = new Date(Date.parse('2026-10-05T12:00:00Z') + 30 * DAY_MS);
    expect((await job.execute()).purged).toEqual([guild]);

    for (const table of ['guild_settings', 'guild_permission_roles', 'guild_audit_log', 'guild_registry', 'interaction_receipts']) {
      expect(await rowsFor(table)).toHaveLength(0);
    }
    expect((await job.execute()).purged).toEqual([]);
  });

  it('starts again from scratch when the server uses PICKET after a purge', async () => {
    expect(await say(status)).toContain('PICKET is up');
    expect(await rowsFor('guild_settings')).toHaveLength(1);
    expect(await rowsFor('guild_audit_log')).toHaveLength(0);
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

  it('stores nothing about the list in the database: Discord is the only state', async () => {
    const tables = await queryAsAdmin<{ table_name: string }>(
      database,
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    expect(tables.map((row) => row.table_name).filter((name) => name.includes('todo'))).toEqual([]);
    expect(await queryAsAdmin(database, 'SELECT 1 FROM guild_audit_log WHERE action LIKE $1', ['todolist%'])).toEqual([]);
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
