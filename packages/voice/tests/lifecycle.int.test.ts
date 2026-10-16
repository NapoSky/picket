import { GuildId, UserId, noopLogger } from '@picket/kernel';
import { sql, withTenant, purgeGuildData } from '@picket/persistence';
import {
  createTestDatabase,
  queryAsAdmin,
  type TestDatabase,
} from '@picket/testing';
import {
  ExportGuildData,
  PostgresGuildDataExportRepository,
} from '@picket/guild';
import {
  PostgresVoice,
  VoiceError,
  type TemplateInput,
  type VoiceDiscord,
  type VoiceIdentity,
  type VoiceSession,
} from '@picket/voice';
import type { GatewayDelivery } from '@picket/discord';
const guildId = GuildId.assert('700000000000000001');
const otherGuild = GuildId.assert('700000000000000002');
const identity: VoiceIdentity = {
  guildId,
  userId: UserId.assert('500000000000000001'),
  roleIds: [],
};
const input: TemplateInput = {
  name: 'Combat',
  categoryId: '600000000000000001',
  channelName: 'Combat',
  capacity: 99,
  idleMinutes: 15,
};
describe('durable ephemeral voice lifecycle', () => {
  let database: TestDatabase, service: PostgresVoice, now: Date, next: number;
  let discord: jest.Mocked<VoiceDiscord>;
  const clock = { now: () => now };
  const delivery = (): GatewayDelivery => ({
    key: 'session:0:1',
    shardId: 0,
    at: now,
    replayed: false,
    lease: { name: 'gateway:0', holder: 'test', token: 1n },
  });
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database?.drop();
  });
  beforeEach(async () => {
    await queryAsAdmin(
      database,
      'TRUNCATE voice_settings,voice_templates,voice_sessions,voice_channels,voice_presence,voice_runtime,guild_settings,guild_registry,leases CASCADE',
    );
    for (const g of [guildId, otherGuild]) {
      await queryAsAdmin(
        database,
        'INSERT INTO guild_registry(guild_id) VALUES($1)',
        [g],
      );
      await queryAsAdmin(
        database,
        'INSERT INTO guild_settings(guild_id) VALUES($1)',
        [g],
      );
    }
    await queryAsAdmin(
      database,
      "INSERT INTO leases(name,holder,token,expires_at) VALUES('gateway:0','test',1,now()+interval '1 day')",
    );
    now = new Date();
    next = 0;
    discord = {
      category: jest.fn().mockResolvedValue(undefined),
      create: jest
        .fn()
        .mockImplementation(async () =>
          String(610000000000000000n + BigInt(++next)),
        ),
      exists: jest.fn().mockResolvedValue(true),
      remove: jest.fn().mockResolvedValue(undefined),
      orderChannels: jest.fn().mockResolvedValue(undefined),
    };
    service = new PostgresVoice(database.handle.db, discord, clock, noopLogger);
    await service.handle(
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
      delivery(),
    );
  });
  async function draft(quantity = 1): Promise<VoiceSession> {
    const models = await service.templates(identity, true);
    const m = models[0]!;
    const s = await service.session(identity, 'member');
    return service.updateSession(identity, s.id, s.revision, {
      ...s.state,
      queue: { [m.id]: { quantity, revision: m.revision } },
    });
  }
  async function deploy(quantity = 1) {
    if (!(await service.templates(identity, true)).length)
      await service.saveTemplate(identity, input);
    const s = await draft(quantity);
    return service.deploy(identity, s);
  }
  async function createOne() {
    await deploy();
    await service.tick();
    return (await service.channels(guildId))[0]!;
  }
  async function move(channelId: string | null, userId = identity.userId) {
    await service.handle(
      {
        type: 'voice_state',
        guildId,
        person: {
          userId,
          channelId,
          roles: [],
          bot: false,
          name: 'not-stored',
        },
      },
      delivery(),
    );
  }
  it('defaults enabled, validates capacity/delay and limits template creation including races', async () => {
    const defaults = await queryAsAdmin(
      database,
      'SELECT features FROM guild_settings WHERE guild_id=$1',
      [guildId],
    );
    expect(defaults[0]!.features).toMatchObject({ voice: true });
    for (const capacity of [0, 100, -1, 1.5])
      await expect(
        service.saveTemplate(identity, { ...input, capacity }),
      ).rejects.toMatchObject({ reason: 'invalid' });
    for (const idleMinutes of [0, 31, 60])
      await expect(
        service.saveTemplate(identity, { ...input, idleMinutes }),
      ).rejects.toMatchObject({ reason: 'invalid' });
    for (let n = 0; n < 9; n++)
      await service.saveTemplate(identity, { ...input, name: `Template ${n}` });
    const results = await Promise.allSettled([
      service.saveTemplate(identity, { ...input, name: 'A' }),
      service.saveTemplate(identity, { ...input, name: 'B' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await service.templates(identity, true)).toHaveLength(10);
  });
  it('reserves quotas atomically and refuses stale duplicate deployments', async () => {
    await service.saveTemplate(identity, input);
    expect(await service.limit(guildId)).toBe(6);
    await expect(deploy(7)).rejects.toMatchObject({ reason: 'limit' });
    await service.limit(guildId, 10);
    await expect(service.limit(guildId, 11)).rejects.toMatchObject({
      reason: 'invalid',
    });
    const a = await draft(8),
      b = await draft(8);
    const result = await Promise.allSettled([
      service.deploy(identity, a),
      service.deploy(identity, b),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await service.channels(guildId)).toHaveLength(8);
    const success = result.find(
      (r) => r.status === 'fulfilled',
    ) as PromiseFulfilledResult<VoiceSession>;
    await expect(service.deploy(identity, success.value)).rejects.toMatchObject(
      { reason: 'expired' },
    );
  });
  it.each(['patch', 'lock'])(
    'retries a failed %s after restart without recreating saved channels',
    async (failure) => {
      await deploy(2);
      if (failure === 'patch')
        discord.orderChannels.mockRejectedValueOnce(
          new Error('Discord positioning unavailable'),
        );
      else
        service = new PostgresVoice(
          database.handle.db,
          discord,
          clock,
          noopLogger,
          {
            withLock: async (_key, work) => {
              await work();
              throw new Error('Lock connection lost after positioning');
            },
          },
        );
      await service.tick();
      const created = await service.channels(guildId);
      expect(created).toHaveLength(2);
      expect(
        created.every(
          (channel) => channel.status === 'active' && channel.channelId,
        ),
      ).toBe(true);
      expect(discord.create).toHaveBeenCalledTimes(2);
      expect(
        await queryAsAdmin(database, 'SELECT needs_check FROM voice_channels'),
      ).toEqual([{ needs_check: true }, { needs_check: true }]);
      expect(discord.orderChannels).toHaveBeenCalledWith(
        guildId,
        expect.arrayContaining(
          created.map((channel) =>
            expect.objectContaining({
              channelId: channel.channelId,
              categoryId: input.categoryId,
              templateName: 'Combat',
              name: channel.name,
            }),
          ),
        ),
      );
      service = new PostgresVoice(
        database.handle.db,
        discord,
        clock,
        noopLogger,
      );
      now = new Date(now.getTime() + 61_000);
      await service.tick();
      expect(discord.orderChannels).toHaveBeenCalledTimes(2);
      expect(discord.create).toHaveBeenCalledTimes(2);
      expect(
        (await service.channels(guildId)).map((channel) => channel.channelId),
      ).toEqual(created.map((channel) => channel.channelId));
      expect(
        await queryAsAdmin(database, 'SELECT needs_check FROM voice_channels'),
      ).toEqual([{ needs_check: false }, { needs_check: false }]);
      await service.tick();
      expect(discord.orderChannels).toHaveBeenCalledTimes(2);
    },
  );
  it('does not create after a template changes or a member loses destination access', async () => {
    await service.saveTemplate(identity, input);
    const s = await draft();
    const m = (await service.templates(identity, true))[0]!;
    await service.saveTemplate(
      identity,
      { ...input, capacity: 10 },
      m.id,
      m.revision,
    );
    await expect(service.deploy(identity, s)).rejects.toMatchObject({
      reason: 'changed',
    });
    expect(discord.create).not.toHaveBeenCalled();
  });
  it('persists drafts with ownership, revision, expiry and tenant isolation', async () => {
    const s = await service.session(identity, 'member');
    await expect(
      service.readSession({ ...identity, guildId: otherGuild }, s.id),
    ).rejects.toMatchObject({ reason: 'expired' });
    await expect(
      service.readSession(
        { ...identity, userId: UserId.assert('500000000000000002') },
        s.id,
      ),
    ).rejects.toMatchObject({ reason: 'expired' });
    const updated = await service.updateSession(identity, s.id, s.revision, {
      ...s.state,
      quantity: 3,
    });
    await expect(
      service.updateSession(identity, s.id, s.revision, s.state),
    ).rejects.toMatchObject({ reason: 'expired' });
    const restarted = new PostgresVoice(
      database.handle.db,
      discord,
      clock,
      noopLogger,
    );
    expect((await restarted.readSession(identity, s.id)).state.quantity).toBe(
      3,
    );
    now = new Date(now.getTime() + 16 * 60_000);
    await expect(
      service.readSession(identity, updated.id),
    ).rejects.toMatchObject({ reason: 'expired' });
    expect(
      (await sql`SELECT * FROM voice_sessions`.execute(database.handle.db))
        .rows,
    ).toHaveLength(0);
  });
  it('starts on creation, cancels on joins including bots, and restarts on last departure', async () => {
    const ch = await createOne();
    expect(ch.status).toBe('active');
    expect(ch.deleteAfter?.getTime()).toBe(now.getTime() + 15 * 60_000);
    await move(ch.channelId);
    expect((await service.channels(guildId))[0]!.deleteAfter).toBeNull();
    await expect(service.removeChannel(guildId, ch.id)).rejects.toMatchObject({
      reason: 'occupied',
    });
    await move(null);
    const first = (await service.channels(guildId))[0]!.deleteAfter!;
    now = new Date(now.getTime() + 14 * 60_000);
    await move(ch.channelId);
    await move(null);
    expect(
      (await service.channels(guildId))[0]!.deleteAfter!.getTime(),
    ).toBeGreaterThan(first.getTime());
    expect(discord.remove).not.toHaveBeenCalled();
  });
  it('resumes cleanup after restart and continues when the feature is disabled', async () => {
    const ch = await createOne();
    await queryAsAdmin(
      database,
      'UPDATE guild_settings SET features=features||\'{"voice":false}\' WHERE guild_id=$1',
      [guildId],
    );
    now = new Date(now.getTime() + 16 * 60_000);
    service = new PostgresVoice(database.handle.db, discord, clock, noopLogger);
    await service.tick();
    expect(discord.remove).toHaveBeenCalledWith(ch.channelId);
    expect(await service.channels(guildId)).toEqual([]);
  });
  it('pauses cleanup on disconnect and grants a full interval after continuity is lost', async () => {
    const ch = await createOne();
    await service.connectionChanged(0, false, delivery().lease);
    now = new Date(now.getTime() + 16 * 60_000);
    await service.tick();
    expect(discord.remove).not.toHaveBeenCalled();
    await service.handle(
      {
        type: 'guild_available',
        guildId,
        voiceSnapshot: {
          name: 'Server',
          afkChannelId: null,
          people: [],
          channels: { [ch.channelId!]: 'Combat' },
        },
      },
      delivery(),
    );
    await service.tick();
    expect(discord.remove).not.toHaveBeenCalled();
    expect((await service.channels(guildId))[0]!.deleteAfter!.getTime()).toBe(
      now.getTime() + 15 * 60_000,
    );
  });
  it('refuses deletion when the gateway lease expires', async () => {
    const ch = await createOne();
    await queryAsAdmin(
      database,
      "UPDATE leases SET expires_at=now()-interval '1 second'",
    );
    await expect(service.removeChannel(guildId, ch.id)).rejects.toMatchObject({
      reason: 'unavailable',
    });
    expect(discord.remove).not.toHaveBeenCalled();
  });
  it('reconciles a channel deleted during downtime and does not mistake an access error for deletion', async () => {
    await createOne();
    await service.connectionChanged(0, false, delivery().lease);
    discord.exists.mockRejectedValueOnce({ status: 403 });
    await service.tick();
    expect(await service.channels(guildId)).toHaveLength(1);
    discord.exists.mockResolvedValue(false);
    await queryAsAdmin(
      database,
      "UPDATE voice_channels SET retry_at=now()-interval '1 minute'",
    );
    await service.tick();
    expect(await service.channels(guildId)).toHaveLength(0);
  });
  it('does not retry an ambiguous POST or an interrupted dispatched creation', async () => {
    await deploy();
    discord.create.mockRejectedValueOnce(new Error('response lost'));
    await service.tick();
    await service.tick();
    expect(discord.create).toHaveBeenCalledTimes(1);
    expect((await service.channels(guildId))[0]!.status).toBe('uncertain');
    await queryAsAdmin(
      database,
      "UPDATE voice_channels SET status='creating',attempted_at=now()-interval '3 minutes'",
    );
    await service.tick();
    expect(discord.create).toHaveBeenCalledTimes(1);
    expect((await service.channels(guildId))[0]!.status).toBe('uncertain');
  });
  it('exports only template names, without options, drafts, channel state or presence', async () => {
    await createOne();
    const exported = await new ExportGuildData(
      new PostgresGuildDataExportRepository(database.handle.db),
      clock,
    ).execute(guildId);
    if (exported.kind !== 'exported') throw new Error('export failed');
    const data = JSON.parse(new TextDecoder().decode(exported.bytes)).data;
    expect(data.voice_templates).toEqual([{ name: 'Combat' }]);
    for (const t of [
      'voice_channels',
      'voice_presence',
      'voice_runtime',
      'voice_sessions',
      'voice_settings',
    ])
      expect(data).not.toHaveProperty(t);
    expect(JSON.stringify(data.voice_templates)).not.toContain(
      input.categoryId,
    );
  });
  it('purges tenant configuration and operational state', async () => {
    await createOne();
    await purgeGuildData(database.handle.db, guildId);
    expect(await service.channels(guildId)).toEqual([]);
    expect(await service.templates(identity, true)).toEqual([]);
  });
  it('keeps an occupied bot channel and ignores unchanged mute/deafen events', async () => {
    const ch = await createOne();
    const bot = {
      userId: '500000000000000003',
      channelId: ch.channelId,
      roles: [],
      bot: true,
      name: 'not-persisted',
    };
    await service.handle(
      { type: 'voice_state', guildId, person: bot },
      delivery(),
    );
    await move(ch.channelId);
    await move(null);
    expect((await service.channels(guildId))[0]!.occupants).toBe(1);
    expect((await service.channels(guildId))[0]!.deleteAfter).toBeNull();
    await expect(service.removeChannel(guildId, ch.id)).rejects.toMatchObject({
      reason: 'occupied',
    });
  });
  it('does not delete on an old deadline after a join and departure during verification', async () => {
    const ch = await createOne();
    now = new Date(now.getTime() + 16 * 60_000);
    discord.exists.mockImplementationOnce(async () => {
      await move(ch.channelId);
      await move(null);
      return true;
    });
    await service.tick();
    expect(discord.remove).not.toHaveBeenCalled();
    expect((await service.channels(guildId))[0]!.deleteAfter!.getTime()).toBe(
      now.getTime() + 15 * 60_000,
    );
  });
  it('requires explicit resolution for uncertain slots and never deletes an unidentified channel', async () => {
    await deploy();
    discord.create.mockRejectedValueOnce(new Error('unknown'));
    await service.tick();
    const ch = (await service.channels(guildId))[0]!;
    expect(ch.status).toBe('uncertain');
    await service.resolveChannel(guildId, ch.id);
    expect(await service.channels(guildId)).toEqual([]);
    expect(discord.remove).not.toHaveBeenCalled();
  });
  it('expires private drafts and completed records even without remaining channel work', async () => {
    const s = await service.session(identity, 'member');
    await deploy();
    discord.create.mockRejectedValueOnce(new Error('unknown'));
    await service.tick();
    await service.resolveChannel(
      guildId,
      (await service.channels(guildId))[0]!.id,
    );
    now = new Date(now.getTime() + 2 * 86400_000);
    await service.tick();
    expect(
      await queryAsAdmin(database, 'SELECT * FROM voice_sessions'),
    ).toHaveLength(0);
    expect(
      await queryAsAdmin(database, 'SELECT * FROM voice_channels'),
    ).toHaveLength(0);
    await expect(service.readSession(identity, s.id)).rejects.toMatchObject({
      reason: 'expired',
    });
  });
  it('does not rewrite channel state for unrelated voice activity or mute-only updates', async () => {
    const ch = await createOne();
    const before = (await service.channels(guildId))[0]!.lastVerifiedAt;
    now = new Date(now.getTime() + 60_000);
    await move('699999999999999999');
    expect((await service.channels(guildId))[0]!.lastVerifiedAt).toEqual(
      before,
    );
    await move(ch.channelId);
    const joined = (await service.channels(guildId))[0]!.lastVerifiedAt;
    now = new Date(now.getTime() + 60_000);
    await move(ch.channelId);
    expect((await service.channels(guildId))[0]!.lastVerifiedAt).toEqual(
      joined,
    );
  });
  it('bounds one reconciliation pass with 300 guilds and 4,500 tracked channels', async () => {
    await queryAsAdmin(
      database,
      `INSERT INTO guild_registry(guild_id) SELECT (900000000000000000::bigint+n)::text FROM generate_series(1,300) n`,
    );
    await queryAsAdmin(
      database,
      `INSERT INTO voice_channels(id,guild_id,batch_id,template_id,template_revision,category_id,name,capacity,idle_minutes,channel_id,status,retry_at)
      SELECT 'job-'||g||'-'||c,(900000000000000000::bigint+g)::text,'test',NULL,1,'600000000000000001','Test '||c,99,15,(920000000000000000::bigint+g*100+c)::text,'active',$1 FROM generate_series(1,300) g CROSS JOIN generate_series(1,15) c`,
      [new Date(now.getTime() - 60_000)],
    );
    discord.exists.mockResolvedValue(false);
    await service.tick();
    expect(discord.exists).toHaveBeenCalledTimes(100);
    expect(discord.create).not.toHaveBeenCalled();
    expect(
      await queryAsAdmin(
        database,
        "SELECT count(*)::int n FROM voice_channels WHERE status='deleted'",
      ),
    ).toEqual([{ n: 100 }]);
    expect(
      await queryAsAdmin(
        database,
        "SELECT count(*)::int n FROM voice_channels WHERE status='active'",
      ),
    ).toEqual([{ n: 4400 }]);
  });

  it('releases a pending reservation when the destination is definitively unavailable', async () => {
    await deploy();
    discord.category.mockRejectedValueOnce(new VoiceError('access'));
    await service.tick();
    expect(await service.channels(guildId)).toEqual([]);
    expect(discord.create).not.toHaveBeenCalled();
  });

  it('keeps every operational table isolated outside the owning tenant', async () => {
    const ch = await createOne();
    await move(ch.channelId);
    for (const table of [
      'voice_settings',
      'voice_templates',
      'voice_sessions',
      'voice_channels',
      'voice_presence',
      'voice_runtime',
    ])
      expect(
        (
          await sql`SELECT * FROM ${sql.table(table)}`.execute(
            database.handle.db,
          )
        ).rows,
      ).toEqual([]);
    expect(await service.channels(otherGuild)).toEqual([]);
  });
});
