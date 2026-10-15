import type { GuildOperationsDiscord, Reply } from '@picket/discord';
import { ChannelId, GuildId, InteractionId, MessageId, UserId, noopLogger } from '@picket/kernel';
import { CancelGuildDeletion, ExecuteRequestedDepartures, PostgresGuildLifecycleRepository, PostgresRequestedDepartures, PostgresSupportGuildEventsRepository, RequestGuildDeletion } from '@picket/guild';
import { PostgresKeyedLock } from '@picket/coordination';
import { sql, withTenant } from '@picket/persistence';
import { createTestDatabase, InMemoryInteractionReplies, InMemoryMessaging, makeInteraction, queryAsAdmin, testI18n, type TestDatabase } from '@picket/testing';
import { buildGatewayHandler, buildPipeline, buildRequestedDepartures } from '../src/composition';

const guildId = GuildId.assert('700000000000000091');
const actor = UserId.assert('500000000000000091');
const channelId = ChannelId.assert('600000000000000091');

describe('administrator removal and data deletion (PostgreSQL)', () => {
  let database: TestDatabase;
  let now: Date;
  let present: boolean;
  let discord: GuildOperationsDiscord;
  let leave: jest.Mock;
  let replies: InMemoryInteractionReplies;
  let sequence = 100;
  const clock = { now: () => now };
  const options = () => ({ clock, i18n: testI18n, guildRetentionDays: 30, supportGuildEventsChannelId: channelId,
    discord: { operations: discord, replies, messaging: new InMemoryMessaging() } });
  const lifecycle = () => new PostgresGuildLifecycleRepository(database.handle.db);
  const executor = () => buildRequestedDepartures(database.handle.db, options());
  const request = () => new RequestGuildDeletion(lifecycle(), clock, 30, executor());
  const gateway = () => buildGatewayHandler(database.handle.db, noopLogger, options());
  const state = () => new PostgresRequestedDepartures(database.handle.db, channelId, 30).find(guildId);
  const acknowledge = () => new PostgresRequestedDepartures(database.handle.db, channelId, 30).acknowledge(guildId);
  const step = async (reply: Reply): Promise<Reply | null> => reply.kind === 'deferred' ? reply.run() : reply;
  const control = (reply: Reply | null, label: string) => {
    if (reply?.kind !== 'panel') throw new Error('Expected settings panel');
    const found = reply.panel.components.flatMap(component => component.kind === 'buttons' ? [...component.buttons] : [])
      .find(button => button.label === label);
    if (!found) throw new Error(`Missing button ${label}`);
    return found.customId;
  };
  beforeAll(async () => { database = await createTestDatabase(); });
  afterAll(async () => { await database.drop(); });
  beforeEach(async () => {
    await queryAsAdmin(database, 'TRUNCATE guild_registry, support_guild_deliveries CASCADE');
    now = new Date('2026-10-15T16:00:00Z'); present = true; replies = new InMemoryInteractionReplies();
    leave = jest.fn(async () => { present = false; });
    discord = { scope: jest.fn(async () => { throw new Error('No operator identity needed'); }),
      guild: async () => present ? { name: 'Amicale test' } : null, leave };
    await gateway().handle({ type: 'guild_available', guildId, name: 'Amicale test' });
    await queryAsAdmin(database, 'TRUNCATE support_guild_deliveries');
  });

  it('confirms privately before leaving, schedules erasure and tracks departure without operator intervention', async () => {
    const pipeline = buildPipeline(database.handle.db, noopLogger, options());
    const interaction = () => makeInteraction({ guildId, userId: actor, channelId, memberPermissions: 8n,
      locale: 'en', id: InteractionId.assert(String(950000000000000000n + BigInt(sequence++))) });
    const click = async (customId: string, permissions = 8n) => step(await pipeline.handle({ ...interaction(), kind: 'component',
      commandPath: [], customId, componentKind: 'button', memberPermissions: permissions,
      message: { id: MessageId.assert('910000000000000091'), channelId } }));
    const home = await step(await pipeline.handle({ ...interaction(), commandPath: ['picket', 'settings'] }));
    const data = await click(control(home, 'Data'));
    const confirmation = await click(control(data, 'Remove PICKET and delete data'));
    expect(leave).not.toHaveBeenCalled();
    expect(await state()).toBeNull();
    const confirm = control(confirmation, 'Confirm removal');
    const denied = await click(confirm, 0n);
    expect(JSON.stringify(denied)).toContain('required level: admin');
    expect(await state()).toBeNull();
    const failedReply = jest.spyOn(replies, 'editOriginal').mockRejectedValueOnce(new Error('Discord reply failed'));
    const failed = await click(confirm);
    expect(JSON.stringify(failed)).toContain(testI18n.translator('en').t('errors.failure'));
    expect(await state()).toMatchObject({ acknowledged: false });
    await executor().recover();
    expect(leave).not.toHaveBeenCalled();
    failedReply.mockRestore();
    leave.mockImplementation(async () => {
      expect(replies.replies).toHaveLength(1);
      expect(JSON.stringify(replies.replies[0]!.content)).toContain('PICKET will leave');
      present = false;
    });
    expect(await click(confirm)).toBeNull();
    expect(leave).toHaveBeenCalledTimes(1);
    expect(await state()).toMatchObject({ status: 'left' });
    expect(await lifecycle().inactiveSince(guildId)).toEqual(now);
    expect(await withTenant(database.handle.db, guildId, trx => trx.selectFrom('guild_support_presence').select('present').executeTakeFirst())).toEqual({ present: false });
    expect(discord.scope).not.toHaveBeenCalled();
    const queued = await queryAsAdmin<{ content: string }>(database, 'SELECT content FROM support_guild_deliveries');
    expect(queued).toHaveLength(1);
    expect(queued[0]!.content).not.toContain('sauf retour');
    await gateway().handle({ type: 'guild_removed', guildId });
    expect(await queryAsAdmin(database, 'SELECT id FROM support_guild_deliveries')).toHaveLength(1);
  });

  it('works without a configured support channel and dispatches only once across replicas', async () => {
    const run = buildRequestedDepartures(database.handle.db, { ...options(), supportGuildEventsChannelId: null });
    await lifecycle().markInactive(guildId, actor, 'guild.deletion_requested', now, 'requested');
    await acknowledge();
    await Promise.all([run.execute(guildId), executor().execute(guildId), run.recover()]);
    expect(leave).toHaveBeenCalledTimes(1);
    expect((await state())!.status).toBe('left');
    expect(await queryAsAdmin(database, 'SELECT id FROM support_guild_deliveries')).toEqual([]);
  });

  it('keeps the recovery worker behind the private acknowledgement', async () => {
    let release!: () => void; let ready!: () => void; let entered!: () => void;
    const announcement = new Promise<void>(resolve => { release = resolve; });
    const preparing = new Promise<void>(resolve => { ready = resolve; });
    const competing = new Promise<void>(resolve => { entered = resolve; });
    const lock = new PostgresKeyedLock(database.handle.db);
    let calls = 0;
    const run = new ExecuteRequestedDepartures(new PostgresRequestedDepartures(database.handle.db, channelId, 30), discord,
      { withLock: async (key, work) => { if (++calls === 2) entered(); return lock.withLock(key, work); } }, clock, noopLogger);
    const confirmation = new RequestGuildDeletion(lifecycle(), clock, 30, run).execute(guildId, actor, 'guild.deletion_requested', async () => {
      ready(); await announcement;
    });
    await preparing;
    const recovery = run.execute(guildId);
    await competing;
    expect(leave).not.toHaveBeenCalled();
    release(); await Promise.all([confirmation, recovery]);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('recovers a committed request after restart and preserves its original deletion deadline', async () => {
    const original = new Date(now.getTime() - 86_400_000);
    await lifecycle().markInactive(guildId, actor, 'guild.deletion_requested', original, 'requested');
    await acknowledge();
    await executor().recover();
    await request().execute(guildId, actor);
    expect(leave).toHaveBeenCalledTimes(1);
    expect(await lifecycle().inactiveSince(guildId)).toEqual(original);
  });

  it('never sends a lost-response departure again, even after a new installation', async () => {
    leave.mockImplementation(async () => { present = false; throw new Error('response lost'); });
    await request().execute(guildId, actor);
    expect((await state())!.status).toBe('uncertain');
    await gateway().handle({ type: 'guild_removed', guildId });
    present = true; await gateway().handle({ type: 'guild_available', guildId, name: 'Amicale test' });
    now = new Date(now.getTime() + 31_000); await executor().recover(); await executor().recover();
    expect(leave).toHaveBeenCalledTimes(1);
    expect((await state())!.status).toBe('returned');
    expect(await withTenant(database.handle.db, guildId, trx => trx.selectFrom('guild_support_presence').select('present').executeTakeFirst())).toEqual({ present: true });
  });

  it('reconciles an absent bot after a lost response without another DELETE', async () => {
    leave.mockImplementation(async () => { present = false; throw new Error('response lost'); });
    await request().execute(guildId, actor);
    now = new Date(now.getTime() + 31_000); await executor().recover();
    expect((await state())!.status).toBe('left');
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('recovers SQL finalization failure after departure without dispatching again', async () => {
    const fail = jest.spyOn(PostgresSupportGuildEventsRepository.prototype, 'observeInTransaction')
      .mockRejectedValueOnce(new Error('SQL unavailable'));
    try {
      await request().execute(guildId, actor);
      expect((await state())!.status).toBe('executing');
      now = new Date(now.getTime() + 31_000); await executor().recover();
      expect((await state())!.status).toBe('left'); expect(leave).toHaveBeenCalledTimes(1);
    } finally { fail.mockRestore(); }
  });

  it('rolls back the deletion schedule if its durable departure cannot be recorded', async () => {
    await queryAsAdmin(database, `CREATE FUNCTION reject_departure_request() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'queue failure'; END $$;
      CREATE TRIGGER reject_departure BEFORE INSERT ON guild_departure_requests FOR EACH ROW EXECUTE FUNCTION reject_departure_request()`);
    try {
      await expect(request().execute(guildId, actor)).rejects.toThrow('queue failure');
      expect(await lifecycle().inactiveSince(guildId)).toBeNull(); expect(await state()).toBeNull();
      expect(leave).not.toHaveBeenCalled();
    } finally { await queryAsAdmin(database, 'DROP TRIGGER reject_departure ON guild_departure_requests; DROP FUNCTION reject_departure_request()'); }
  });

  it('keeps an undispatched request pending during an API outage and resumes later', async () => {
    const get = discord.guild;
    discord.guild = async () => { throw new Error('403 or outage'); };
    await request().execute(guildId, actor);
    expect(leave).not.toHaveBeenCalled(); expect((await state())!.status).toBe('pending');
    discord.guild = get; await executor().recover();
    expect(leave).toHaveBeenCalledTimes(1); expect((await state())!.status).toBe('left');
  });

  it('does not pretend an unsuccessful departure completed or automatically retry DELETE', async () => {
    leave.mockRejectedValue(new Error('Discord failure'));
    await request().execute(guildId, actor);
    now = new Date(now.getTime() + 31_000); await executor().recover(); await executor().recover();
    expect((await state())!.status).toBe('failed'); expect(leave).toHaveBeenCalledTimes(1);
  });

  it('does not remove a membership that changed before an undispatched request was recovered', async () => {
    await lifecycle().markInactive(guildId, actor, 'guild.deletion_requested', now, 'requested');
    await acknowledge();
    await gateway().handle({ type: 'guild_removed', guildId });
    await gateway().handle({ type: 'guild_available', guildId, name: 'Amicale test' });
    await executor().recover();
    expect((await state())!.status).toBe('returned'); expect(leave).not.toHaveBeenCalled();
  });

  it('does not leave or recover a departure whose final Discord reply failed, and allows a confirmed retry', async () => {
    await expect(request().execute(guildId, actor, 'guild.deletion_requested', async () => {
      throw new Error('Final reply not delivered');
    })).rejects.toThrow('Final reply not delivered');
    expect(await state()).toMatchObject({ status: 'pending', acknowledged: false });
    await executor().execute(guildId); await executor().recover();
    expect(leave).not.toHaveBeenCalled();
    const delivered = jest.fn(async () => undefined);
    await request().execute(guildId, actor, 'guild.deletion_requested', delivered);
    expect(delivered).toHaveBeenCalledTimes(1);
    expect(leave).toHaveBeenCalledTimes(1);
    expect(await state()).toMatchObject({ status: 'left', acknowledged: true });
  });

  it('respects cancellation and erases its durable request with tenant data', async () => {
    await lifecycle().markInactive(guildId, actor, 'guild.deletion_requested', now, 'requested');
    await new CancelGuildDeletion(lifecycle()).execute(guildId, actor); await executor().recover();
    expect(await state()).toBeNull(); expect(leave).not.toHaveBeenCalled();
    await lifecycle().markInactive(guildId, actor, 'guild.deletion_requested', now, 'requested');
    expect((await withTenant(database.handle.db, GuildId.assert('700000000000000092'), trx => sql`SELECT guild_id FROM guild_departure_requests`.execute(trx))).rows).toEqual([]);
    expect(await queryAsAdmin(database, 'SELECT guild_id FROM guild_departure_requests')).toHaveLength(1);
    await lifecycle().purge(guildId); expect(await state()).toBeNull();
  });
});
