import { supportGuildMessage, type SupportGuildChange, PostgresGuildSettingsRepository, PostgresGuildLifecycleRepository, PostgresSupportGuildEventsRepository, PublishSupportGuildEvents } from '@picket/guild';
import { ChannelId, GuildId, UserId, noopLogger } from '@picket/kernel';
import { withTenant } from '@picket/persistence';
import { createTestDatabase, InMemoryInteractionReplies, InMemoryMessaging, queryAsAdmin, testI18n, type TestDatabase } from '@picket/testing';
import { buildGatewayHandler, buildSupportGuildPublisher } from '../src/composition';

const guildId = GuildId.assert('700000000000000061');
const otherId = GuildId.assert('700000000000000062');
const channelId = ChannelId.assert('600000000000000061');
const otherChannel = ChannelId.assert('600000000000000062');

describe('support server notifications (integration)', () => {
  let database: TestDatabase;
  let messaging: InMemoryMessaging;
  let now: Date;
  const clock = { now: () => now };
  const options = () => ({ clock, guildRetentionDays: 7, i18n: testI18n, supportGuildEventsChannelId: channelId });
  const gateway = (enabled = true) => buildGatewayHandler(database.handle.db, noopLogger,
    { ...options(), supportGuildEventsChannelId: enabled ? channelId : null });
  const publisher = (destination = channelId) => new PublishSupportGuildEvents(new PostgresSupportGuildEventsRepository(database.handle.db), destination, messaging, clock, noopLogger, testI18n, async () => 'fr');
  const queued = async () => (await queryAsAdmin<{ content: string | null; id: string; attempts: number; event: { change: Omit<SupportGuildChange, 'inactiveSince'> & { inactiveSince: string | null }; retentionDays: number } | null }>(database,
    'SELECT id, content, attempts, event FROM support_guild_deliveries ORDER BY id')).map(row => ({ ...row,
      content: row.event ? supportGuildMessage({ ...row.event.change, inactiveSince: row.event.change.inactiveSince ? new Date(row.event.change.inactiveSince) : null }, row.event.retentionDays, testI18n.translator('fr').t) : row.content! }));
  const arrive = (handler = gateway(), name = 'ABC') => handler.handle({ type: 'guild_available', guildId, name });

  beforeAll(async () => { database = await createTestDatabase(); });
  afterAll(async () => { await database.drop(); });
  beforeEach(async () => {
    await queryAsAdmin(database, 'TRUNCATE guild_registry, support_guild_deliveries CASCADE');
    messaging = new InMemoryMessaging();
    now = new Date(Date.now() + 60_000);
  });

  it.each([
    ['en', 'fr', '🟢 PICKET joined **ABC**.'],
    [null, 'en-GB', '🟢 PICKET joined **ABC**.'],
    [null, 'fr', '🟢 PICKET a rejoint **ABC**.'],
    [null, 'unsupported', '🟢 PICKET joined **ABC**.'],
  ])('uses support settings %s before Discord language %s, independent of the source server', async (forced, discordLocale, expected) => {
    const supportId = GuildId.assert('700000000000000063');
    const settings = new PostgresGuildSettingsRepository(database.handle.db);
    await settings.findOrCreate(supportId);
    await settings.modify(supportId, UserId.assert('500000000000000061'), 'settings.language', current => ({ kind: 'apply', next: { ...current, locale: forced } }));
    await arrive();
    await settings.modify(guildId, UserId.assert('500000000000000061'), 'settings.language', current => ({ kind: 'apply', next: { ...current, locale: 'fr' } }));
    const guild = jest.fn(async () => ({ name: 'Support', locale: discordLocale }));
    const scope = jest.fn(async () => ({ guildId: supportId, channelId, ownerId: UserId.assert('500000000000000061'), ownerName: 'Owner' }));
    await buildSupportGuildPublisher(database.handle.db, noopLogger, { ...options(), discord: { messaging, replies: new InMemoryInteractionReplies(), operations: { scope, guild, leave: async () => undefined } } })!.tick();
    expect(messaging.list(channelId)[0]?.view.content).toBe(expected);
    expect(scope).toHaveBeenCalledWith(channelId);
    if (forced) expect(guild).not.toHaveBeenCalled();
    else expect(guild).toHaveBeenCalledWith(supportId);
  });

  it('still delivers legacy text queued before the localization upgrade', async () => {
    await queryAsAdmin(database, 'INSERT INTO support_guild_deliveries(channel_id, content) VALUES ($1, $2)', [channelId, '🟢 PICKET a rejoint **Legacy**.']);
    await publisher().tick();
    expect(messaging.list(channelId)[0]?.view.content).toBe('🟢 PICKET a rejoint **Legacy**.');
  });

  it('publishes join, departure and return once, without Stats or source IDs', async () => {
    const handler = gateway();
    await arrive(handler);
    await arrive(handler);
    await handler.handle({ type: 'guild_removed', guildId });
    await handler.handle({ type: 'guild_removed', guildId });
    await arrive(handler);
    await publisher().tick();
    const messages = messaging.list(channelId).map(message => message.view.content);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toBe('🟢 PICKET a rejoint **ABC**.');
    expect(messages[1]).toContain(`à partir du <t:${Math.floor((now.getTime() + 7 * 86_400_000) / 1000)}:D>`);
    expect(messages[2]).toContain('Purge liée au retrait annulée.');
    expect(messages.join('\n')).not.toContain(guildId);
    expect(await queued()).toEqual([]);
  });

  it('silently initializes READY memberships and stays silent after process restart or temporary outage', async () => {
    await gateway().handle({ type: 'ready', shardId: 0, shardCount: 1, guildIds: [guildId] });
    await arrive();
    await gateway().handle({ type: 'guild_voice_unavailable', guildId });
    await gateway().handle({ type: 'ready', shardId: 0, shardCount: 1, guildIds: [guildId] });
    await arrive();
    expect(await queued()).toEqual([]);
    expect(await new PostgresGuildLifecycleRepository(database.handle.db).inactiveSince(guildId)).toBeNull();
  });

  it('uses the last renamed server name on departure', async () => {
    const handler = gateway();
    await arrive(handler);
    await handler.handle({ type: 'guild_voice_metadata', guildId, name: 'DEF', afkChannelId: null });
    await handler.handle({ type: 'guild_removed', guildId });
    const messages = await queued();
    expect(messages).toHaveLength(2);
    expect(messages[1]?.content).toContain('**DEF**');
  });

  it('catches an offline departure once and keeps temporarily unavailable guilds', async () => {
    await arrive();
    await gateway().handle({ type: 'guild_available', guildId: otherId, name: 'XYZ' });
    const ready = { type: 'ready' as const, shardId: 0, shardCount: 1, guildIds: [otherId] };
    await gateway().handle(ready);
    await gateway().handle(ready);
    expect((await queued()).map(row => row.content).filter(content => content.includes('détecté après reconnexion'))).toHaveLength(1);
    expect(await new PostgresGuildLifecycleRepository(database.handle.db).inactiveSince(otherId)).toBeNull();
  });

  it('does not announce removal or return as cancellation of an administrator-requested deletion', async () => {
    await arrive();
    const lifecycle = new PostgresGuildLifecycleRepository(database.handle.db);
    await lifecycle.markInactive(guildId, 'system', 'guild.deletion_requested', now, 'requested');
    await gateway().handle({ type: 'guild_removed', guildId });
    await arrive();
    const messages = (await queued()).map(row => row.content);
    expect(messages).toHaveLength(3);
    expect(messages[1]).not.toContain('sauf retour');
    expect(messages[2]).toContain('La suppression demandée reste prévue');
    expect(await lifecycle.inactiveSince(guildId)).toEqual(now);
  });

  it('also catches offline removal while data deletion is already requested', async () => {
    await arrive();
    await new PostgresGuildLifecycleRepository(database.handle.db).markInactive(guildId, 'system', 'guild.deletion_requested', now, 'requested');
    await gateway().handle({ type: 'ready', shardId: 0, shardCount: 1, guildIds: [] });
    expect((await queued())[1]?.content).toContain('détecté après reconnexion');
  });

  it('tracks disabled membership without replaying old arrivals when enabled', async () => {
    await arrive(gateway(false));
    await arrive();
    expect(await queued()).toEqual([]);
    await gateway().handle({ type: 'guild_removed', guildId });
    expect((await queued())[0]?.content).toContain('**ABC**');
  });

  it('deduplicates concurrent state observations', async () => {
    await Promise.all(Array.from({ length: 6 }, () => arrive()));
    expect(await queued()).toHaveLength(1);
    await Promise.all(Array.from({ length: 6 }, () => gateway().handle({ type: 'guild_removed', guildId })));
    expect(await queued()).toHaveLength(2);
  });

  it('retries failed sends after backoff, preserving the delivery nonce and message order', async () => {
    await arrive();
    await gateway().handle({ type: 'guild_removed', guildId });
    messaging.failNext('send', 'unavailable');
    const spy = jest.spyOn(messaging, 'send');
    await publisher().tick();
    expect((await queued())[0]?.attempts).toBe(1);
    await publisher().tick();
    expect(spy).toHaveBeenCalledTimes(1);
    now = new Date(now.getTime() + 30_000);
    await publisher().tick();
    expect(messaging.list(channelId)).toHaveLength(2);
    expect(spy.mock.calls[0]?.[1].nonce).toBe(spy.mock.calls[1]?.[1].nonce);
    expect(await queued()).toEqual([]);
  });

  it('serializes overlapping publishers', async () => {
    await arrive();
    await Promise.all([publisher().tick(), publisher().tick(), publisher().tick()]);
    expect(messaging.list(channelId)).toHaveLength(1);
  });

  it('drops pending notifications for a previous destination after configuration changes', async () => {
    await arrive();
    await publisher(otherChannel).tick();
    expect(messaging.list(channelId)).toEqual([]);
    expect(messaging.list(otherChannel)).toEqual([]);
    expect(await queued()).toEqual([]);
  });

  it('keeps names tenant-isolated and preserves sent messages when the guild is purged', async () => {
    await arrive();
    await gateway().handle({ type: 'guild_available', guildId: otherId, name: 'XYZ' });
    expect(await database.handle.db.selectFrom('guild_support_presence').selectAll().execute()).toEqual([]);
    expect(await withTenant(database.handle.db, guildId, trx => trx.selectFrom('guild_support_presence').select('name').execute()))
      .toEqual([{ name: 'ABC' }]);
    await publisher().tick();
    await new PostgresGuildLifecycleRepository(database.handle.db).purge(guildId);
    expect(await queryAsAdmin(database, 'SELECT 1 FROM guild_support_presence WHERE guild_id = $1', [guildId])).toEqual([]);
    expect(messaging.list(channelId)).toHaveLength(2);
  });
});
