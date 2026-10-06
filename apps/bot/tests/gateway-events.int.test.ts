import { createInteractionServer, type PanelView } from '@picket/discord';
import { GuildId, RoleId, noopLogger, systemClock } from '@picket/kernel';
import { InMemoryInteractionReplies, createTestDatabase, createTestKeys, queryAsAdmin, testI18n, type TestDatabase } from '@picket/testing';
import { buildGatewayHandler, buildPipeline } from '../src/composition';

const GUILD = GuildId.assert('700000000000000051');
const OTHER = GuildId.assert('700000000000000052');
const ROLE = RoleId.assert('400000000000000051');
const composition = { clock: systemClock, guildRetentionDays: 30, i18n: testI18n };

describe('Gateway events -> guild lifecycle and permissions (integration)', () => {
  let database: TestDatabase;
  const keys = createTestKeys();
  let counter = 0;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  beforeEach(async () => {
    await queryAsAdmin(database, 'TRUNCATE guild_registry, guild_settings, guild_permission_roles, guild_audit_log, interaction_receipts');
  });

  const gateway = () => buildGatewayHandler(database.handle.db, noopLogger, composition);

  const interact = async (guildId: string, path: object[], permissions = '0', customId?: string) => {
    const replies = new InMemoryInteractionReplies();
    const app = createInteractionServer({
      publicKey: keys.publicKeyHex,
      pipeline: buildPipeline(database.handle.db, noopLogger, composition),
      replies,
      logger: noopLogger,
      clock: systemClock,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({
      id: `94000000000${String(10_000 + counter++)}`,
      application_id: '800000000000000001',
      type: customId === undefined ? 2 : 3,
      token: 't',
      version: 1,
      guild_id: guildId,
      channel_id: '600000000000000001',
      member: { user: { id: '500000000000000001' }, roles: [], permissions },
      ...(customId === undefined ? {} : { message: { id: '900000000000000001', channel_id: '600000000000000001' } }),
      data: customId === undefined
        ? { id: '1', name: 'picket', type: 1, options: path }
        : { custom_id: customId, component_type: 2 },
    });
    try {
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
      // Attend aussi la livraison différée du panneau avant de vérifier l'état PostgreSQL.
      await app.close();
      expect(response.statusCode).toBe(200);
      return { wire: response.json(), delivered: replies.replies };
    } finally {
      await app.close();
    }
  };
  const say = async (guildId: string, path: object[], permissions = '0') =>
    (await interact(guildId, path, permissions)).wire.data.content as string;
  const status = [{ type: 1, name: 'status' }];
  const legacyDeletion = [
    { type: 2, name: 'data', options: [{ type: 1, name: 'delete', options: [{ type: 5, name: 'confirm', value: true }] }] },
  ];

  async function panel(guildId: string, customId?: string): Promise<PanelView> {
    const result = await interact(guildId, [{ type: 1, name: 'settings' }], '8', customId);
    expect(result.wire.type).toBe(customId === undefined ? 5 : 6);
    expect(result.delivered).toHaveLength(1);
    expect(result.delivered[0]?.action).toBe('editOriginal');
    const content = result.delivered[0]?.content;
    if (content === undefined || content === null || typeof content === 'string') throw new Error('Expected settings panel');
    return content;
  }

  function button(view: PanelView, action: string, argument = '0'): string {
    const buttons = view.components.flatMap((component) => component.kind === 'buttons'
      ? component.buttons
      : component.kind === 'section' ? [component.button] : []);
    const target = buttons.find((candidate) => candidate.customId.split('.')[3] === action && candidate.customId.split('.')[4] === argument);
    if (target === undefined) throw new Error(`Missing panel button ${action}.${argument}`);
    return target.customId;
  }

  async function requestDeletion(guildId: string): Promise<void> {
    const home = await panel(guildId);
    const data = await panel(guildId, button(home, 'view', 'data'));
    const confirmation = await panel(guildId, button(data, 'view', 'delete'));
    await panel(guildId, button(confirmation, 'delete'));
  }

  const registry = (guildId: string) =>
    queryAsAdmin<{ inactive_reason: string | null }>(database, 'SELECT inactive_reason FROM guild_registry WHERE guild_id = $1', [guildId]);

  it('prepares a guild as soon as the bot sees it, before anyone uses a command', async () => {
    await gateway().handle({ type: 'guild_available', guildId: GUILD });
    expect(await registry(GUILD)).toEqual([{ inactive_reason: null }]);
    expect(await queryAsAdmin(database, 'SELECT level, role_id FROM guild_permission_roles')).toEqual([
      { level: 'member', role_id: GUILD },
    ]);
  });

  it('is unaffected by the flood of repeated GUILD_CREATE events at every connection', async () => {
    const handler = gateway();
    await Promise.all(Array.from({ length: 8 }, () => handler.handle({ type: 'guild_available', guildId: GUILD })));
    expect(await queryAsAdmin(database, 'SELECT 1 FROM guild_settings')).toHaveLength(1);
    expect(await queryAsAdmin(database, 'SELECT 1 FROM guild_permission_roles')).toHaveLength(1);
  });

  it('suspends a guild when the bot is removed, and resumes it when the bot comes back', async () => {
    const handler = gateway();
    await handler.handle({ type: 'guild_available', guildId: GUILD });
    expect(await say(GUILD, status)).toContain('PICKET is up');

    await handler.handle({ type: 'guild_removed', guildId: GUILD });
    expect(await registry(GUILD)).toEqual([{ inactive_reason: 'left' }]);
    expect(await say(GUILD, status)).toContain('scheduled for deletion');

    await handler.handle({ type: 'guild_available', guildId: GUILD });
    expect(await registry(GUILD)).toEqual([{ inactive_reason: null }]);
    expect(await say(GUILD, status)).toContain('PICKET is up');
  });

  it('never cancels a deletion requested by an administrator, however many times the guild reappears', async () => {
    const handler = gateway();
    await handler.handle({ type: 'guild_available', guildId: GUILD });
    await requestDeletion(GUILD);

    await handler.handle({ type: 'guild_available', guildId: GUILD });
    await handler.handle({ type: 'ready', shardId: 0, shardCount: 1, guildIds: [GUILD] });

    expect(await registry(GUILD)).toEqual([{ inactive_reason: 'requested' }]);
    expect(await say(GUILD, status)).toContain('scheduled for deletion');
  });

  it('opens the panel without scheduling deletion when an old delete command is used', async () => {
    await gateway().handle({ type: 'guild_available', guildId: GUILD });
    const result = await interact(GUILD, legacyDeletion, '8');

    expect(result.wire.type).toBe(5);
    expect(result.delivered).toHaveLength(1);
    expect(result.delivered[0]?.action).toBe('editOriginal');
    expect(JSON.stringify(result.delivered[0]?.content)).toContain('No old command arguments were applied');
    expect(await registry(GUILD)).toEqual([{ inactive_reason: null }]);
    expect(await queryAsAdmin(database, 'SELECT 1 FROM guild_audit_log')).toEqual([]);
  });

  it('ignores the removal of a guild it never saw', async () => {
    await gateway().handle({ type: 'guild_removed', guildId: OTHER });
    expect(await registry(OTHER)).toEqual([]);
  });

  it('removes a deleted Discord role from the access levels and audits it', async () => {
    const handler = gateway();
    await handler.handle({ type: 'guild_available', guildId: GUILD });
    await queryAsAdmin(database, "INSERT INTO guild_permission_roles (guild_id, level, role_id) VALUES ($1, 'officer', $2)", [GUILD, ROLE]);

    await handler.handle({ type: 'role_deleted', guildId: GUILD, roleId: ROLE });

    expect(await queryAsAdmin(database, 'SELECT role_id FROM guild_permission_roles WHERE level = $1', ['officer'])).toEqual([]);
    expect(await queryAsAdmin(database, 'SELECT actor_id, action FROM guild_audit_log')).toEqual([
      { actor_id: 'system', action: 'permissions.role_deleted' },
    ]);
  });

  it('catches up on removals that happened while offline, without touching guilds still present', async () => {
    const handler = gateway();
    await handler.handle({ type: 'guild_available', guildId: GUILD });
    await handler.handle({ type: 'guild_available', guildId: OTHER });

    await handler.handle({ type: 'ready', shardId: 0, shardCount: 1, guildIds: [GUILD] });

    expect(await registry(GUILD)).toEqual([{ inactive_reason: null }]);
    expect(await registry(OTHER)).toEqual([{ inactive_reason: 'left' }]);
    expect(await queryAsAdmin(database, "SELECT action FROM guild_audit_log WHERE guild_id = $1", [OTHER])).toEqual([
      { action: 'guild.left_while_offline' },
    ]);
  });
});
