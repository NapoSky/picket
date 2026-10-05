import { createInteractionServer } from '@picket/discord';
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

  const say = async (guildId: string, path: object[], permissions = '0') => {
    const app = createInteractionServer({
      publicKey: keys.publicKeyHex,
      pipeline: buildPipeline(database.handle.db, noopLogger, composition),
      replies: new InMemoryInteractionReplies(),
      logger: noopLogger,
      clock: systemClock,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({
      id: `94000000000${String(10_000 + counter++)}`,
      application_id: '800000000000000001',
      type: 2,
      token: 't',
      version: 1,
      guild_id: guildId,
      channel_id: '600000000000000001',
      member: { user: { id: '500000000000000001' }, roles: [], permissions },
      data: { id: '1', name: 'picket', type: 1, options: path },
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
    return response.json().data.content as string;
  };
  const status = [{ type: 1, name: 'status' }];
  const requestDeletion = [
    { type: 2, name: 'data', options: [{ type: 1, name: 'delete', options: [{ type: 5, name: 'confirm', value: true }] }] },
  ];

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
    await say(GUILD, requestDeletion, '8');

    await handler.handle({ type: 'guild_available', guildId: GUILD });
    await handler.handle({ type: 'ready', shardId: 0, shardCount: 1, guildIds: [GUILD] });

    expect(await registry(GUILD)).toEqual([{ inactive_reason: 'requested' }]);
    expect(await say(GUILD, status)).toContain('scheduled for deletion');
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
