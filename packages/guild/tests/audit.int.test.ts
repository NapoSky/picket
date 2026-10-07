import { DiscordApiError, type AuditChannelAccess, type GuildChannels } from '@picket/discord';
import { PostgresGuildAuditRepository, PostgresGuildSettingsRepository, PublishGuildAudit, UpdateGuildSettings } from '@picket/guild';
import { ChannelId, GuildId, MessageId, UserId, noopLogger } from '@picket/kernel';
import { purgeExpiredJournals, purgeGuildData, withTenant } from '@picket/persistence';
import { InMemoryMessaging, createTestDatabase, queryAsAdmin, testI18n, type TestDatabase } from '@picket/testing';

const guild = GuildId.assert('700000000000000001');
const otherGuild = GuildId.assert('700000000000000002');
const channel = ChannelId.assert('600000000000000001');
const otherChannel = ChannelId.assert('600000000000000002');
const actor = UserId.assert('500000000000000001');
const board = '00000000-0000-4000-8000-000000000001';

describe('durable audit publication (PostgreSQL)', () => {
  let database: TestDatabase, repository: PostgresGuildAuditRepository, settings: UpdateGuildSettings, messaging: InMemoryMessaging;
  let now: Date, access: AuditChannelAccess, inspector: GuildChannels;
  beforeAll(async () => { database = await createTestDatabase(); });
  afterAll(async () => { await database.drop(); });
  beforeEach(async () => {
    await queryAsAdmin(database, 'TRUNCATE guild_audit_delivery, guild_audit_schedule, guild_audit_log, guild_application_logs, timer_events, guild_settings, guild_permission_roles, guild_registry CASCADE');
    const store = new PostgresGuildSettingsRepository(database.handle.db);
    await store.findOrCreate(guild); await store.findOrCreate(otherGuild);
    // Ancienne préférence déjà stockée : pas de reprise de l'historique antérieur à la migration.
    await queryAsAdmin(database, 'UPDATE guild_settings SET audit_channel_id = $2, locale = $3 WHERE guild_id = $1', [guild, channel, 'fr']);
    repository = new PostgresGuildAuditRepository(database.handle.db);
    settings = new UpdateGuildSettings(store, testI18n.locales);
    messaging = new InMemoryMessaging(); now = new Date(Date.now() + 1000);
    access = { kind: 'ready', locale: 'en' }; inspector = { inspect: async () => access };
  });
  const publisher = () => new PublishGuildAudit(repository, inspector, messaging, testI18n, { now: () => now }, noopLogger);
  const change = () => settings.execute({ guildId: guild, actorId: actor, change: { kind: 'language', locale: 'en' } });
  const deliveries = () => queryAsAdmin(database, 'SELECT * FROM guild_audit_delivery ORDER BY id');

  it('publishes committed changes in the server language and does not repeat unchanged settings', async () => {
    await change(); await change();
    expect(await deliveries()).toHaveLength(1);
    await publisher().tick(); await publisher().tick();
    expect(messaging.list(channel)).toHaveLength(1);
    expect(messaging.list(channel)[0]?.view.content).toContain('⚙️ **Language changed**');
    expect(await deliveries()).toEqual([expect.objectContaining({ attempts: 1, message_id: messaging.list(channel)[0]?.id, completed_at: now })]);
  });

  it('creates no delivery for a rolled-back mutation', async () => {
    await expect(withTenant(database.handle.db, guild, async (trx) => {
      await trx.insertInto('guild_audit_log').values({ guild_id: guild, actor_id: actor, action: 'settings.language' }).execute();
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await deliveries()).toEqual([]);
  });

  it('filters the scope: includes alert acknowledgements, excludes refreshes, board rendering and todolist ticks', async () => {
    const included = ['add', 'reactivate', 'strike', 'cleanup', 'auto_purge', 'reset_war', 'acknowledge'];
    for (const action of [...included, 'refresh', 'repair', 'settings', 'board_create', 'board_delete']) {
      await withTenant(database.handle.db, guild, (trx) => trx.insertInto('timer_events').values({ guild_id: guild, board_id: board, asset_id: 'asset123', actor_id: actor, action, detail: JSON.stringify({ name: 'Bunker', thresholdMin: 120 }) }).execute());
    }
    for (const [id, msg] of [['00000000-0000-4000-8000-000000000001', 'todolist created'], ['00000000-0000-4000-8000-000000000002', 'todolist tick']]) {
      await withTenant(database.handle.db, guild, (trx) => trx.insertInto('guild_application_logs').values({ id: id!, guild_id: guild, record: JSON.stringify({ msg, user_id: actor, channel_id: otherChannel, messages: 1, message_ids: ['900000000000000001'] }) }).execute());
    }
    await repository.recordTodolist({ guildId: guild, actor, channelId: otherChannel, messageIds: [MessageId.assert('900000000000000001')] });
    expect(await deliveries()).toHaveLength(included.length + 1);
    for (let i = 0; i < included.length + 1; i++) await publisher().tick();
    const messages = messaging.list(channel);
    expect(messages).toHaveLength(included.length + 1);
    expect(messages.at(-2)?.view.content).toContain('⏱️ **Alerte acquittée**');
    expect(JSON.stringify(messages.at(-1))).toContain('https://discord.com/channels/');
    expect(messages.at(-1)?.view.content).toContain('📋 **Todolist créée**');
  });

  it('pauses on lost permissions, keeps successful changes, and resumes with a test', async () => {
    await change(); access = { kind: 'blocked', reason: 'missing_permissions' };
    await publisher().tick(); await publisher().tick();
    expect(messaging.list(channel)).toHaveLength(0);
    expect(await deliveries()).toEqual([expect.objectContaining({ attempts: 1, completed_at: null })]);
    expect((await new PostgresGuildSettingsRepository(database.handle.db).findOrCreate(guild)).auditFailure).toBe('missing_permissions');
    expect(await publisher().test(guild, actor)).toBe('blocked');
    access = { kind: 'ready', locale: 'en' };
    expect(await publisher().test(guild, actor)).toBe('queued');
    await publisher().tick(); await publisher().tick();
    expect(messaging.list(channel)).toHaveLength(2);
    expect(messaging.list(channel)[1]?.view.content).toContain('⚙️ **Audit channel test**');
  });

  it('handles a permissions race between channel validation and sending', async () => {
    await change(); messaging.failNext('send', 'missing_access'); await publisher().tick();
    expect(await repository.due(now, 25)).toEqual([]);
    expect((await deliveries())[0]).toMatchObject({ last_error: 'missing_access', completed_at: null });
  });

  it('retries temporary failures after backoff and retains the same nonce across a new publisher', async () => {
    await change(); messaging.failNext('send', 'unavailable'); await publisher().tick();
    expect(await repository.due(now, 25)).toEqual([]);
    now = new Date(now.getTime() + 31_000);
    repository = new PostgresGuildAuditRepository(database.handle.db);
    await publisher().tick();
    expect(messaging.list(channel)[0]?.view.nonce).toBe(`pa${(await deliveries())[0]?.id}`);
    expect((await deliveries())[0]).toMatchObject({ attempts: 2, last_error: null });
  });

  it('serializes competing workers without duplicate messages', async () => {
    await change();
    const post = jest.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); return { kind: 'sent' as const, messageId: '900000000000000001' }; });
    await Promise.all([repository.deliver(guild, now, post), new PostgresGuildAuditRepository(database.handle.db).deliver(guild, now, post)]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('cancels queued posts to the old channel when the destination changes', async () => {
    await change();
    await settings.execute({ guildId: guild, actorId: actor, change: { kind: 'audit_channel', channelId: otherChannel } });
    await publisher().tick();
    expect(messaging.list(channel)).toHaveLength(0);
    expect(messaging.list(otherChannel)).toHaveLength(1);
    expect((await deliveries())[0]).toMatchObject({ last_error: 'channel_changed' });
  });

  it('publishes a final removal notice in the previous channel, then stops recording deliveries', async () => {
    await settings.execute({ guildId: guild, actorId: actor, change: { kind: 'audit_channel', channelId: null } });
    await change(); await publisher().tick();
    expect(messaging.list(channel)).toHaveLength(1);
    expect(messaging.list(channel)[0]?.view.content).toContain('⚙️ **Audit channel changed**');
    expect(await deliveries()).toHaveLength(1);
  });

  it('enforces tenant isolation and removes delivery history with its 30-day source journal', async () => {
    await change();
    expect(await withTenant(database.handle.db, otherGuild, (trx) => trx.selectFrom('guild_audit_delivery').selectAll().execute())).toEqual([]);
    await queryAsAdmin(database, "UPDATE guild_audit_log SET at = now() - interval '31 days' WHERE guild_id = $1", [guild]);
    await purgeExpiredJournals(database.handle.db);
    expect(await deliveries()).toEqual([]);
    await publisher().tick(); expect(messaging.list(channel)).toHaveLength(0);
    await purgeGuildData(database.handle.db, guild);
    expect(await queryAsAdmin(database, 'SELECT * FROM guild_audit_schedule WHERE guild_id = $1', [guild])).toEqual([]);
  });

  it('does not treat Discord unavailability as a permanent channel failure', async () => {
    await change(); inspector.inspect = async () => { throw new DiscordApiError('unavailable', 'network failure'); };
    await publisher().tick();
    expect((await deliveries())[0]).toMatchObject({ last_error: 'unavailable' });
    expect((await new PostgresGuildSettingsRepository(database.handle.db).findOrCreate(guild)).auditFailure).toBeUndefined();
  });
});
