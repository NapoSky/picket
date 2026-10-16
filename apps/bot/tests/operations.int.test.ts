import type { GuildOperationsDiscord, IncomingInteraction, OperatorScope, PanelButton, Reply } from '@picket/discord';
import { AccessCheckError, buildCommandsPayload, toWireResponse } from '@picket/discord';
import { ChannelId, GuildId, InteractionId, UserId, noopLogger } from '@picket/kernel';
import { HandleGuildAvailable, PostgresGuildLifecycleRepository, PostgresGuildOperationsRepository, PostgresGuildDataExportRepository, PostgresSupportGuildEventsRepository, OpsError } from '@picket/guild';
import { withTenant, sql } from '@picket/persistence';
import { MAX_CHANNELS } from '@picket/voice';
import { createTestDatabase, InMemoryInteractionReplies, InMemoryMessaging, makeInteraction, queryAsAdmin, recordingLogger, testI18n, type TestDatabase } from '@picket/testing';
import { buildCommandRegistry, buildGatewayHandler, buildOperatorService, buildPipeline } from '../src/composition';

const support = GuildId.assert('700000000000000001');
const target = GuildId.assert('700000000000000081');
const other = GuildId.assert('700000000000000082');
const channel = ChannelId.assert('600000000000000001');
const otherChannel = ChannelId.assert('600000000000000002');
const owner = UserId.assert('500000000000000001');
const outsider = UserId.assert('500000000000000002');
const reason = 'Test server verified by the service operator.';

describe('private service operations (PostgreSQL)', () => {
  let database: TestDatabase;
  let now: Date;
  let scope: OperatorScope;
  let names: Map<GuildId, string>;
  let discord: GuildOperationsDiscord;
  let leave: jest.Mock;
  let messaging: InMemoryMessaging;
  let replies: InMemoryInteractionReplies;
  let sequence = 100;
  const clock = { now: () => now };
  const options = () => ({ clock, guildRetentionDays: 30, i18n: testI18n, supportGuildEventsChannelId: channel,
    discord: { operations: discord, messaging, replies } });
  const service = () => buildOperatorService(database.handle.db, options());
  const repo = () => new PostgresGuildOperationsRepository(database.handle.db);
  const gateway = () => buildGatewayHandler(database.handle.db, noopLogger, options());
  const interaction = (changes: Partial<IncomingInteraction> = {}) => makeInteraction({ guildId: support, channelId: channel, userId: owner,
    id: InteractionId.assert(String(900000000000000000n + BigInt(sequence++))), commandPath: ['picket-ops', 'servers'], locale: 'fr', ...changes });
  const prepared = async () => { const ops = service(); const session = await ops.start(interaction()); return { ops, session, operation: await ops.prepare(session, target) }; };
  const queued = () => queryAsAdmin<{ content: string }>(database, 'SELECT content FROM support_guild_deliveries ORDER BY id');
  const finish = async (reply: Reply): Promise<Reply> => {
    if (reply.kind !== 'deferred') return reply;
    const result = await reply.run();
    if (!result) throw new Error('Expected a deferred result');
    return result;
  };
  const buttons = (reply: Reply): PanelButton[] => reply.kind === 'panel' ? reply.panel.components.flatMap(item =>
    item.kind === 'section' ? [item.button] : item.kind === 'buttons' ? [...item.buttons] : []) : [];

  beforeAll(async () => { database = await createTestDatabase(); });
  afterAll(async () => { await database.drop(); });
  beforeEach(async () => {
    await queryAsAdmin(database, 'TRUNCATE guild_registry, guild_settings, guild_permission_roles, guild_audit_log, support_guild_deliveries, operator_sessions, operator_departures CASCADE');
    now = new Date('2026-10-15T16:00:00Z');
    scope = { guildId: support, channelId: channel, ownerId: owner, ownerName: 'NapoSky' };
    names = new Map([[support, 'PICKET Support'], [target, 'Serveur de test'], [other, 'Régiment']]);
    leave = jest.fn(async (id: GuildId) => { names.delete(id); });
    discord = { scope: async () => scope, guild: async id => names.has(id) ? { name: names.get(id)! } : null, leave };
    messaging = new InMemoryMessaging(); replies = new InMemoryInteractionReplies();
    for (const [guildId, name] of names) await gateway().handle({ type: 'guild_available', guildId, name });
    await queryAsAdmin(database, 'DELETE FROM support_guild_deliveries');
  });

  it('never includes the operator command in global deployment', () => {
    expect(buildCommandsPayload(buildCommandRegistry(database.handle.db, options())).map(root => root.name)).not.toContain('picket-ops');
  });

  it('shows current temporary voice usage and its server limit, including reservations and excluding other servers', async () => {
    expect(await repo().detail(target)).toMatchObject({ voiceChannels: 0, reservedVoiceChannels: 0 });
    for (const guildId of [target, other]) await withTenant(database.handle.db, guildId, async trx => {
      const statuses = guildId === target ? ['active', 'active', 'pending', 'creating', 'uncertain', 'deleted', 'failed'] : ['active'];
      for (const [index, status] of statuses.entries()) await sql`INSERT INTO voice_channels
        (id,guild_id,batch_id,template_revision,category_id,name,capacity,idle_minutes,status)
        VALUES (${`${guildId}-${index}`},${guildId},'batch',1,${channel},${`Voice ${index}`},10,15,${status})`.execute(trx);
    });
    expect(await repo().detail(target)).toMatchObject({ voiceChannels: 2, reservedVoiceChannels: 3 });
    const pipeline = buildPipeline(database.handle.db, noopLogger, options());
    const session = await service().start(interaction());
    const inspect = async (locale: string) => finish(await pipeline.handle(interaction({ kind: 'component', commandPath: [], locale,
      customId: `ops:1:${session.id}.detail.${target}` })));
    const modules = (reply: Reply, locale: string) => reply.kind === 'panel' ? reply.panel.components.find(item =>
      item.kind === 'text' && item.text.startsWith(`**${testI18n.translator(locale).t('ops.modules')}**`)) : undefined;
    for (const locale of ['en', 'fr', 'de', 'es-ES', 'pt-BR', 'pl']) {
      const detail = await inspect(locale);
      const { t } = testI18n.translator(locale);
      expect(detail).toMatchObject({ kind: 'panel', panel: { components: expect.arrayContaining([
        { kind: 'text', text: t('ops.voiceChannels', { active: 2, reserved: 3, limit: MAX_CHANNELS }) },
      ]) } });
      expect(modules(detail, locale)).toMatchObject({ text: expect.stringContaining(t('features.voice')) });
    }
    // Disabling creation does not release existing channels or hide their usage.
    await withTenant(database.handle.db, target, trx => sql`UPDATE guild_settings SET features=features || '{"voice":false}'::jsonb WHERE guild_id=${target}`.execute(trx));
    const disabled = await inspect('fr');
    expect(JSON.stringify(disabled)).toContain(testI18n.translator('fr').t('ops.voiceChannels', { active: 2, reserved: 3, limit: MAX_CHANNELS }));
    expect(modules(disabled, 'fr')).toMatchObject({ text: expect.not.stringContaining(testI18n.translator('fr').t('features.voice')) });
    await withTenant(database.handle.db, target, trx => sql`UPDATE voice_channels SET status='deleted' WHERE guild_id=${target}`.execute(trx));
    const refreshed = await finish(await pipeline.handle(interaction({ kind: 'component', commandPath: [],
      customId: `ops:1:${session.id}.refresh.0` })));
    expect(JSON.stringify(refreshed)).toContain(testI18n.translator('fr').t('ops.voiceChannels', { active: 0, reserved: 0, limit: MAX_CHANNELS }));
  });

  it('denies server administrators who are not the application owner, including forged components', async () => {
    const pipeline = buildPipeline(database.handle.db, noopLogger, options());
    expect((await pipeline.handle(interaction({ channelId: otherChannel, userId: outsider, memberPermissions: 8n }))).kind).toBe('message');
    const { session } = await prepared();
    const result = await pipeline.handle(interaction({ kind: 'component', commandPath: [], customId: `ops:1:${session.id}.refresh.0`, channelId: otherChannel, userId: outsider, memberPermissions: 8n }));
    expect(result.kind).toBe('message');
    expect(leave).not.toHaveBeenCalled();
  });

  it('allows any channel in the resolved support guild and fails closed outside it or without configuration', async () => {
    expect(await service().authorize(interaction({ guildId: target }))).toBeNull();
    expect(await service().authorize(interaction({ channelId: otherChannel }))).toEqual(scope);
    expect(await service().authorize(interaction({ guildId: target, channelId: otherChannel }))).toBeNull();
    const disabled = buildOperatorService(database.handle.db, { ...options(), supportGuildEventsChannelId: null });
    expect(await disabled.authorize(interaction())).toBeNull();
    discord.scope = async () => { throw new Error('Discord unavailable'); };
    await expect(service().authorize(interaction())).rejects.toBeInstanceOf(AccessCheckError);
  });

  it('distinguishes verification failures from denied permissions without opening a session', async () => {
    const logger = recordingLogger();
    discord.scope = async () => { throw new Error('Discord unavailable'); };
    const reply = await buildPipeline(database.handle.db, logger, options()).handle(interaction());
    expect(reply).toEqual({ kind: 'message', content: testI18n.translator('fr').t('ops.authorizationUnavailable'), ephemeral: true });
    expect(logger.records.some(record => record.message === 'operator access verification unavailable')).toBe(true);
    expect(await queryAsAdmin(database, 'SELECT id FROM operator_sessions')).toHaveLength(0);
    expect(leave).not.toHaveBeenCalled();
  });

  it('rejects copied buttons and confirmation modals outside the support guild', async () => {
    const { session, operation } = await prepared();
    const pipeline = buildPipeline(database.handle.db, noopLogger, options());
    for (const request of [
      interaction({ kind: 'component', commandPath: [], guildId: other, channelId: otherChannel, customId: `ops:1:${session.id}.refresh.0` }),
      interaction({ kind: 'modal', commandPath: [], guildId: other, channelId: otherChannel, customId: `ops:1:${session.id}.submit.${operation.id}`, fields: { reason, confirmation: 'QUITTER' } }),
    ]) {
      expect(await pipeline.handle(request)).toEqual({ kind: 'message', content: testI18n.translator('fr').t('ops.denied'), ephemeral: true });
    }
    expect((await repo().operation(operation.id))!.status).toBe('prepared');
    expect(leave).not.toHaveBeenCalled();
  });

  it.each([
    ['support channel not configured', 'disabled'],
    ['support guild mismatch', 'guild'],
    ['application owner mismatch', 'owner'],
  ])('logs a safe actionable reason for denied operator access: %s', async (reason, mismatch) => {
    const logger = recordingLogger();
    const ops = buildOperatorService(database.handle.db, { ...options(), ...(mismatch === 'disabled' ? { supportGuildEventsChannelId: null } : {}) }, logger);
    const request = interaction({
      ...(mismatch === 'guild' ? { guildId: target } : {}),
      ...(mismatch === 'owner' ? { userId: outsider } : {}),
    });
    expect(await ops.authorize(request)).toBeNull();
    expect(logger.records.some(record => record.message === `operator access denied: ${reason}`)).toBe(true);
    expect(leave).not.toHaveBeenCalled();
  });

  it('runs search, details, the modal and departure from another channel in the support guild', async () => {
    const pipeline = buildPipeline(database.handle.db, noopLogger, options());
    const click = async (customId: string, changes: Partial<IncomingInteraction> = {}) => pipeline.handle(interaction({ kind: 'component', commandPath: [], customId, channelId: otherChannel, ...changes }));
    const home = await finish(await pipeline.handle(interaction({ channelId: otherChannel })));
    expect(home.kind).toBe('panel');
    const searchButton = buttons(home).find(button => button.label === 'Rechercher')!;
    const search = await click(searchButton.customId);
    expect(search.kind).toBe('modal');
    if (search.kind !== 'modal') return;
    const result = await finish(await click(search.customId, { kind: 'modal', fields: { query: 'serveur de TEST' } }));
    const inspect = buttons(result).find(button => button.label === 'Examiner')!;
    const detail = await finish(await click(inspect.customId));
    expect(JSON.stringify(detail)).not.toContain('user_id');
    const confirm = buttons(detail).find(button => button.style === 'danger')!;
    expect(confirm.disabled).toBe(false);
    const modal = await click(confirm.customId);
    expect(modal.kind).toBe('modal');
    if (modal.kind !== 'modal') return;
    expect(modal.description).toContain('Serveur de test');
    expect(toWireResponse(modal)).toMatchObject({ type: 9, data: { components: [{ type: 10 }, { type: 18 }, { type: 18 }] } });
    const outcome = await finish(await click(modal.customId, { kind: 'modal', fields: { reason, confirmation: 'QUITTER' } }));
    expect(JSON.stringify(outcome)).toContain('PICKET a quitté ce serveur');
    expect(leave).toHaveBeenCalledTimes(1);
    expect(replies.replies).toHaveLength(1);
    expect(await new PostgresGuildLifecycleRepository(database.handle.db).inactiveSince(target)).toEqual(now);
    const messages = await queued();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toContain('NapoSky');
    expect(messages[0]!.content).toContain(reason);
    const notifications = await queryAsAdmin<{ channel_id: string }>(database, 'SELECT channel_id FROM support_guild_deliveries');
    expect(notifications.map(notification => notification.channel_id)).toEqual([channel]);
    await gateway().handle({ type: 'guild_removed', guildId: target });
    expect(await queued()).toHaveLength(1);
  });

  it('protects the support server and refuses indistinguishable servers', async () => {
    const ops = service(); const session = await ops.start(interaction());
    await expect(ops.prepare(session, support)).rejects.toMatchObject({ reason: 'protected' });
    await gateway().handle({ type: 'guild_voice_metadata', guildId: other, name: 'Serveur de test', afkChannelId: null });
    await expect(ops.prepare(session, target)).rejects.toMatchObject({ reason: 'ambiguous' });
    expect(leave).not.toHaveBeenCalled();
  });

  it.each([{ reason: 'short', confirmation: 'QUITTER' }, { reason, confirmation: 'quitter' }, { reason: ' '.repeat(20), confirmation: 'QUITTER' }])('validates the submitted fields %j', async fields => {
    const { ops, session, operation } = await prepared();
    await expect(ops.submit(session, operation.id, fields.reason, fields.confirmation)).rejects.toMatchObject({ reason: 'invalid' });
    expect(leave).not.toHaveBeenCalled();
  });

  it('expires confirmations after two minutes and sessions after ten minutes', async () => {
    const { ops, session, operation } = await prepared();
    now = new Date(now.getTime() + 120_001);
    await expect(ops.submit(session, operation.id, reason, 'QUITTER')).rejects.toMatchObject({ reason: 'expired' });
    now = new Date(now.getTime() + 600_000);
    await expect(ops.session(session.id, interaction())).rejects.toBeInstanceOf(OpsError);
    expect(leave).not.toHaveBeenCalled();
  });

  it('consumes a confirmation once across two replicas', async () => {
    const { session, operation } = await prepared();
    const results = await Promise.allSettled([service().submit(session, operation.id, reason, 'QUITTER'), service().submit(session, operation.id, reason, 'QUITTER')]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('serializes different confirmations targeting the same server', async () => {
    const first = await prepared(); const second = await prepared();
    await Promise.allSettled([first.ops.submit(first.session, first.operation.id, reason, 'QUITTER'), second.ops.submit(second.session, second.operation.id, reason, 'QUITTER')]);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it.each(['rename', 'owner', 'support guild', 'membership', 'deadline', 'modules'] as const)('rechecks %s before dispatch', async change => {
    const { ops, session, operation } = await prepared();
    if (change === 'rename') names.set(target, 'New name');
    if (change === 'owner') scope = { ...scope, ownerId: outsider };
    if (change === 'support guild') scope = { ...scope, guildId: other };
    if (change === 'membership') {
      await gateway().handle({ type: 'guild_removed', guildId: target });
      await gateway().handle({ type: 'guild_available', guildId: target, name: names.get(target)! });
    }
    if (change === 'deadline') await new PostgresGuildLifecycleRepository(database.handle.db).markInactive(target, owner, 'guild.deletion_requested', now, 'requested');
    if (change === 'modules') await withTenant(database.handle.db, target, trx => sql`UPDATE guild_settings SET features=features || '{"timers":false}'::jsonb WHERE guild_id=${target}`.execute(trx));
    expect((await ops.submit(session, operation.id, reason, 'QUITTER')).status).toBe('failed');
    expect(leave).not.toHaveBeenCalled();
  });

  it('does not dispatch when the confirmation expires during Discord verification', async () => {
    const { ops, session, operation } = await prepared();
    const original = discord.guild;
    discord.guild = async id => { now = new Date(now.getTime() + 120_001); return original(id); };
    const result = await ops.submit(session, operation.id, reason, 'QUITTER');
    expect(result.failure).toBe('expired');
    expect(leave).not.toHaveBeenCalled();
  });

  it('preserves an earlier administrator-requested deletion and does not claim reactivation is automatic', async () => {
    const original = new Date(now.getTime() - 5 * 86_400_000);
    await new PostgresGuildLifecycleRepository(database.handle.db).markInactive(target, owner, 'guild.deletion_requested', original, 'requested');
    const { ops, session, operation } = await prepared();
    await ops.submit(session, operation.id, reason, 'QUITTER');
    expect(await new PostgresGuildLifecycleRepository(database.handle.db).inactiveSince(target)).toEqual(original);
    expect((await queued())[0]!.content).not.toContain('sauf retour');
  });

  it('records already absent targets without sending DELETE', async () => {
    const { ops, session, operation } = await prepared(); names.delete(target);
    expect((await ops.submit(session, operation.id, reason, 'QUITTER')).status).toBe('absent');
    expect(leave).not.toHaveBeenCalled();
  });

  it('recovers a lost response after restart without dispatching the departure twice', async () => {
    const { ops, session, operation } = await prepared();
    leave.mockImplementation(async (id: GuildId) => { names.delete(id); throw new Error('response lost'); });
    expect((await ops.submit(session, operation.id, reason, 'QUITTER')).status).toBe('uncertain');
    now = new Date(now.getTime() + 31_000);
    await service().recover();
    expect((await repo().operation(operation.id))!.status).toBe('left');
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('does not repeat an uncertain request when the bot is still present', async () => {
    const { ops, session, operation } = await prepared(); leave.mockRejectedValue(new Error('network'));
    await ops.submit(session, operation.id, reason, 'QUITTER');
    now = new Date(now.getTime() + 31_000); await service().recover(); await service().recover();
    expect((await repo().operation(operation.id))!.status).toBe('failed');
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('does not deactivate a later membership while recovering an uncertain request', async () => {
    const { ops, session, operation } = await prepared();
    leave.mockRejectedValue(new Error('response lost'));
    await ops.submit(session, operation.id, reason, 'QUITTER');
    await gateway().handle({ type: 'guild_removed', guildId: target });
    await gateway().handle({ type: 'guild_available', guildId: target, name: names.get(target)! });
    now = new Date(now.getTime() + 31_000); await service().recover();
    expect((await repo().operation(operation.id))!.status).toBe('returned');
    expect(await new PostgresGuildLifecycleRepository(database.handle.db).inactiveSince(target)).toBeNull();
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('protects a reinstallation that Discord sees before Gateway membership updates', async () => {
    const { ops, session, operation } = await prepared();
    leave.mockResolvedValue(undefined);
    const result = await ops.submit(session, operation.id, reason, 'QUITTER');
    expect(result.status).toBe('returned');
    expect(await new PostgresGuildLifecycleRepository(database.handle.db).inactiveSince(target)).toBeNull();
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('does not deactivate a recreated registry after a purge, even if its generation restarted at zero', async () => {
    const { session, operation } = await prepared();
    await repo().claim(operation.id, session.id, reason, now);
    await repo().update(operation.id, 'executing', now);
    await repo().update(operation.id, 'left', now);
    await new PostgresGuildLifecycleRepository(database.handle.db).purge(target);
    await gateway().handle({ type: 'guild_available', guildId: target, name: names.get(target)! });
    await queryAsAdmin(database, 'UPDATE guild_registry SET registered_at=$1 WHERE guild_id=$2', [new Date(operation.registeredAt.getTime() + 86_400_000), target]);
    await service().recover();
    expect((await repo().operation(operation.id))!.status).toBe('returned');
    expect(await new PostgresGuildLifecycleRepository(database.handle.db).inactiveSince(target)).toBeNull();
    expect(leave).not.toHaveBeenCalled();
  });

  it('returns the confirmed departure while SQL synchronization is retried independently', async () => {
    const { ops, session, operation } = await prepared();
    jest.spyOn(PostgresGuildOperationsRepository.prototype, 'finalizeDeparture').mockRejectedValueOnce(new Error('database unavailable'));
    const result = await ops.submit(session, operation.id, reason, 'QUITTER');
    expect(result.status).toBe('left');
    expect(result.syncedAt).toBeNull();
    await service().recover();
    expect((await repo().operation(operation.id))!.syncedAt).toEqual(now);
    expect(await queued()).toHaveLength(1);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it.each(['completed', 'lifecycle-only'] as const)('atomically protects a %s reinstallation racing the final database write', async stage => {
    const { ops, session, operation } = await prepared();
    const finalize = PostgresGuildOperationsRepository.prototype.finalizeDeparture;
    jest.spyOn(PostgresGuildOperationsRepository.prototype, 'finalizeDeparture').mockImplementationOnce(async function (this: PostgresGuildOperationsRepository, op, at) {
      names.set(target, 'Serveur de test');
      await gateway().handle({ type: 'guild_removed', guildId: target });
      if (stage === 'completed') await gateway().handle({ type: 'guild_available', guildId: target, name: names.get(target)! });
      else await new HandleGuildAvailable(new PostgresGuildLifecycleRepository(database.handle.db)).execute(target);
      await finalize.call(this, op, at);
    });
    expect((await ops.submit(session, operation.id, reason, 'QUITTER')).status).toBe('returned');
    expect(await new PostgresGuildLifecycleRepository(database.handle.db).inactiveSince(target)).toBeNull();
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('rolls back lifecycle and presence together if the notification transition fails', async () => {
    const { ops, session, operation } = await prepared();
    jest.spyOn(PostgresSupportGuildEventsRepository.prototype, 'observeInTransaction').mockRejectedValueOnce(new Error('notification storage failed'));
    const result = await ops.submit(session, operation.id, reason, 'QUITTER');
    expect(result.status).toBe('left');
    expect(result.syncedAt).toBeNull();
    expect(await new PostgresGuildLifecycleRepository(database.handle.db).inactiveSince(target)).toBeNull();
    expect((await repo().detail(target))!.present).toBe(true);
    expect(await queued()).toEqual([]);
    await service().recover();
    expect(await new PostgresGuildLifecycleRepository(database.handle.db).inactiveSince(target)).toEqual(now);
    expect((await repo().detail(target))!.present).toBe(false);
    expect(await queued()).toHaveLength(1);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('recovers an undispatched durable request after a replica stops', async () => {
    const { session, operation } = await prepared();
    expect(await repo().claim(operation.id, session.id, reason, now)).toBe(true);
    await service().recover();
    expect(leave).toHaveBeenCalledTimes(1);
    expect((await repo().operation(operation.id))!.syncedAt).toEqual(now);
  });

  it('retries local synchronization after a successful departure without sending another DELETE', async () => {
    const { session, operation } = await prepared();
    await repo().claim(operation.id, session.id, reason, now);
    await repo().update(operation.id, 'executing', now);
    names.delete(target);
    await repo().update(operation.id, 'left', now);
    await service().recover();
    expect((await repo().operation(operation.id))!.purgeSince).toEqual(now);
    expect(await new PostgresGuildLifecycleRepository(database.handle.db).inactiveSince(target)).toEqual(now);
    expect(await queued()).toHaveLength(1);
    expect(leave).not.toHaveBeenCalled();
  });

  it('keeps names and reasons private and neutralizes mentions and formatting in the notification', async () => {
    scope = { ...scope, ownerName: '@everyone **Owner**' };
    names.set(target, '@everyone **Test**');
    await gateway().handle({ type: 'guild_voice_metadata', guildId: target, name: names.get(target)!, afkChannelId: null });
    const { ops, session, operation } = await prepared();
    await ops.submit(session, operation.id, 'Test @everyone **internal** reason.', 'QUITTER');
    const content = (await queued())[0]!.content;
    expect(content).not.toContain('@everyone');
    expect(content).toContain('@\u200beveryone');
    expect(content).toContain('\\*\\*internal\\*\\*');
    const tenant = await withTenant(database.handle.db, target, trx => trx.selectFrom('guild_audit_log').select(['actor_id', 'action']).where('action', '=', 'guild.left').execute());
    expect(tenant).toEqual([{ actor_id: 'system', action: 'guild.left' }]);
    const exported = await new PostgresGuildDataExportRepository(database.handle.db).read(target, 10 * 1024 * 1024);
    expect(JSON.stringify(exported)).not.toContain('internal');
    expect(exported).not.toHaveProperty('operator_departures');
    expect(exported).not.toHaveProperty('operator_sessions');
  });

  it('paginates long escaped history within Discord limits and offers the full reason on examination', async () => {
    const { ops, session, operation } = await prepared();
    const longReason = '*'.repeat(500);
    await ops.submit(session, operation.id, longReason, 'QUITTER');
    await queryAsAdmin(database, `UPDATE operator_departures SET target_name=$1, actor_name=$1`, ['*'.repeat(100)]);
    for (let i = 1; i < 5; i++) await queryAsAdmin(database, `INSERT INTO operator_departures
      SELECT md5($1), session_id, target_id, target_name, actor_name, expected_revision, snapshot, status, reason,
        failure, created_at, expires_at, requested_at, attempted_at, completed_at, purge_since, synced_at
      FROM operator_departures WHERE id=$2`, [String(i), operation.id]);
    const pipeline = buildPipeline(database.handle.db, noopLogger, options());
    const home = await finish(await pipeline.handle(interaction()));
    const historyButton = buttons(home).find(button => button.label === 'Historique')!;
    const history = await finish(await pipeline.handle(interaction({ kind: 'component', commandPath: [], customId: historyButton.customId })));
    expect(() => toWireResponse(history)).not.toThrow();
    const inspect = buttons(history).find(button => button.label === 'Examiner')!;
    const record = await finish(await pipeline.handle(interaction({ kind: 'component', commandPath: [], customId: inspect.customId })));
    expect(JSON.stringify(record)).toContain('\\\\*'.repeat(500));
    expect(() => toWireResponse(record)).not.toThrow();
  });

  it('keeps operator history after tenant purge while preserving ordinary RLS', async () => {
    const { ops, session, operation } = await prepared(); await ops.submit(session, operation.id, reason, 'QUITTER');
    expect(await database.handle.db.selectFrom('guild_support_presence').selectAll().execute()).toEqual([]);
    const isolated = await withTenant(database.handle.db, other, trx => trx.selectFrom('guild_support_presence').select('guild_id').execute());
    expect(isolated).toEqual([{ guild_id: other }]);
    await new PostgresGuildLifecycleRepository(database.handle.db).purge(target);
    expect((await repo().history(null, 0)).operations.map(op => op.id)).toEqual([operation.id]);
    expect((await repo().servers()).some(server => server.id === target)).toBe(false);
  });

  it('expires abandoned forms and keeps submitted history for 30 days', async () => {
    const first = await prepared(); const second = await prepared();
    await first.ops.submit(first.session, first.operation.id, reason, 'QUITTER');
    now = new Date(now.getTime() + 11 * 60_000); await repo().cleanup(now);
    expect(await repo().operation(second.operation.id)).toBeNull();
    expect((await repo().history(null, 0)).total).toBe(1);
    now = new Date(now.getTime() + 31 * 86_400_000); await repo().cleanup(now);
    expect((await repo().history(null, 0)).total).toBe(0);
    expect((await sql`SELECT * FROM operator_sessions`.execute(database.handle.db)).rows).toEqual([]);
  });
});
