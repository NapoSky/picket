import { createHash } from 'node:crypto';
import { GuildId, noopLogger } from '@picket/kernel';
import { PostgresGuildSettingsRepository } from '@picket/guild';
import { sql } from '@picket/persistence';
import { createTestDatabase, queryAsAdmin, type TestDatabase } from '@picket/testing';
import {
  createDashboardServer,
  PostgresStatsStore,
  DashboardDiscordError,
  type DashboardIdentityProvider,
  type OAuthGuild,
  type DurableVoiceBuffer,
} from '../src';
const A = '700000000000000001',
  B = '700000000000000002',
  OTHER = '700000000000000003',
  U = '300000000000000001',
  V = '300000000000000002',
  R = '400000000000000001',
  O = '400000000000000002',
  C = '600000000000000001';
const guild = (id: string): OAuthGuild => ({ id, name: id, permissions: '0', owner: false });
describe('dashboard OAuth, scopes, revocations and erasure', () => {
  let database: TestDatabase,
    store: PostgresStatsStore,
    app: ReturnType<typeof createDashboardServer>,
    cookie: string,
    csrf: string;
  let team = false,
    roles: readonly string[] = [R],
    botGuildNames: readonly Pick<OAuthGuild, 'id' | 'name'>[] = [],
    memberships: readonly OAuthGuild[] = [guild(A), guild(B), guild(OTHER)];
  const identity: DashboardIdentityProvider = {
    exchange: jest.fn(async () => ({ token: 'sensitive-oauth-token', expiresIn: 3600 })),
    user: async () => ({ id: U, name: 'Alice' }),
    guilds: jest.fn(async () => memberships),
    guildNames: jest.fn(async () => botGuildNames),
    memberRoles: async () => roles,
    teamMember: async () => team,
  };
  const buffer: DurableVoiceBuffer = {
    append: async () => undefined,
    replay: async () => 0,
    erase: jest.fn(async () => undefined),
    setExcluded: jest.fn(async () => undefined),
    status: async () => ({ bytes: 0, count: 0, oldest: null }),
  };
  beforeAll(async () => {
    database = await createTestDatabase();
    store = new PostgresStatsStore(database.handle.db);
  });
  afterAll(async () => database.drop());
  beforeEach(async () => {
    team = false;
    roles = [R];
    memberships = [guild(A), guild(B), guild(OTHER)];
    botGuildNames = [];
    await queryAsAdmin(
      database,
      'TRUNCATE stats_web_sessions,stats_oauth_states,stats_settings,stats_privacy,stats_users,stats_channels,stats_voice_events,stats_voice_segments,stats_voice_presence,guild_permission_roles,guild_settings,guild_registry CASCADE',
    );
    const guilds = new PostgresGuildSettingsRepository(database.handle.db);
    for (const id of [A, B]) {
      await guilds.findOrCreate(GuildId.assert(id));
      await store.configure(id, U, { memberRoles: [R], enabled: true });
      await queryAsAdmin(
        database,
        "UPDATE stats_settings SET enabled_at=now()-interval '2 days' WHERE guild_id=$1",
        [id],
      );
    }
    await queryAsAdmin(database, "INSERT INTO guild_permission_roles VALUES($1,'officer',$2)", [A, O]);
    for (const [guildId, userId, key] of [
      [A, U, 'own-a'],
      [A, V, 'other-a'],
      [B, V, 'other-b'],
    ] as const) {
      await store.observe({
        key,
        guildId,
        userId,
        channelId: C,
        channelName: 'Voice',
        name: userId === U ? '=SUM(A1:A2)' : 'Other',
        roles: [R],
        bot: false,
        shardId: 0,
        quality: 'observed',
        at: new Date(Date.now() - 3600_000).toISOString(),
      });
      await store.observe({
        key: `${key}:leave`,
        guildId,
        userId,
        channelId: null,
        channelName: '',
        name: '',
        roles: [R],
        bot: false,
        shardId: 0,
        quality: 'observed',
        at: new Date(Date.now() - 1000).toISOString(),
      });
    }
    await store.refreshAdminSnapshot();
    app = createDashboardServer({
      db: database.handle.db,
      store,
      identity,
      applicationId: '900000000000000001',
      origin: 'https://stats.example.org',
      encryptionSecret: 'test-client-secret',
      buffer,
      logger: noopLogger,
    });
    const start = await app.inject('/auth/discord');
    const url = new URL(start.headers.location!);
    const state = url.searchParams.get('state')!;
    const callback = await app.inject({
      url: `/auth/callback?state=${state}&code=auth-code`,
      headers: { cookie: `__Host-picket_oauth=${state}` },
    });
    expect(callback.statusCode).toBe(302);
    cookie = callback.cookies.find((c) => c.name === '__Host-picket_session')!.value;
    const session = await get('/api/session');
    csrf = session.json<{ csrf: string }>().csrf;
  });
  afterEach(async () => app.close());
  const get = (url: string) => app.inject({ url, headers: { cookie: `__Host-picket_session=${cookie}` } });
  const post = (url: string, payload: Record<string, unknown>, extra: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url,
      payload,
      headers: {
        cookie: `__Host-picket_session=${cookie}`,
        origin: 'https://stats.example.org',
        'x-picket-csrf': csrf,
        ...extra,
      },
    });
  it('uses opaque Secure cookies, encrypted tokens and one-use OAuth state', async () => {
    const row = (
      await queryAsAdmin(database, 'SELECT encrypted_token,token_hash FROM stats_web_sessions')
    )[0]!;
    expect(row.encrypted_token).not.toContain('sensitive-oauth-token');
    expect(row.token_hash).toBe(createHash('sha256').update(cookie).digest('hex'));
    const start = await app.inject('/auth/discord');
    const state = new URL(start.headers.location!).searchParams.get('state')!;
    const headers = { cookie: `__Host-picket_oauth=${state}` };
    expect((await app.inject({ url: `/auth/callback?state=wrong&code=auth-code`, headers })).statusCode).toBe(
      400,
    );
    expect(
      (await app.inject({ url: `/auth/callback?state=${state}&code=auth-code`, headers })).statusCode,
    ).toBe(302);
    expect(
      (await app.inject({ url: `/auth/callback?state=${state}&code=auth-code`, headers })).statusCode,
    ).toBe(400);
    expect(start.headers['set-cookie']).toContain('HttpOnly');
    expect(start.headers['set-cookie']).toContain('Secure');
  });
  it('exposes aggregates to members while keeping other individual histories private', async () => {
    const own = (await get(`/api/activity?guild=${A}&mode=guild`)).json<{
      scope: string;
      users: { userId: string }[];
    }>();
    expect(own.scope).toBe('self');
    expect(own.users.map((u) => u.userId)).toEqual([U]);
    const overview = (await get(`/api/activity?guild=${A}&mode=overview`)).json<{
      activeUsers: number;
      users: unknown[];
    }>();
    expect(overview.activeUsers).toBe(2);
    expect(overview.users).toEqual([]);
    expect((await get(`/api/activity?guild=${OTHER}`)).statusCode).toBe(403);
    expect(
      await queryAsAdmin(database, 'SELECT guild_id FROM guild_settings WHERE guild_id=$1', [OTHER]),
    ).toEqual([]);
  });
  it('refreshes a newly enabled server before any voice activity has been recorded', async () => {
    await queryAsAdmin(database, 'TRUNCATE stats_users,stats_channels,stats_voice_events,stats_voice_segments,stats_voice_presence CASCADE');
    await queryAsAdmin(database, "UPDATE guild_settings SET timezone='Europe/Paris' WHERE guild_id=$1", [A]);
    await store.configure(A, U, { enabled: false });
    await store.configure(A, U, { enabled: true });
    for (const days of [1, 7, 60]) {
      const response = await get(`/api/activity?guild=${A}&mode=overview&days=${days}`);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ seconds: 0, activeUsers: 0, sessions: 0, inVoice: 0, users: [] });
    }
    expect((await get(`/api/privacy?guild=${A}`)).statusCode).toBe(200);
  });
  it('logs safe dependency diagnostics without exposing SQL, OAuth tokens or request parameters', async () => {
    const log = jest.spyOn(noopLogger, 'error');
    const message = 'SELECT private_member_name FROM secret_table; sensitive-oauth-token';
    jest.spyOn(store, 'report').mockRejectedValueOnce(Object.assign(new Error(message), { code: '42702' }));
    const response = await get(`/api/activity?guild=${A}&mode=overview`);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'unavailable' });
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
    expect(log).toHaveBeenLastCalledWith(expect.objectContaining({
      method: 'GET', route: '/api/activity', code: '42702', requestId: response.headers['x-request-id'],
    }), 'dashboard dependency unavailable');
    expect(JSON.stringify(log.mock.calls)).not.toContain(message);
    expect(JSON.stringify(log.mock.calls)).not.toContain(A);
    jest.spyOn(identity, 'memberRoles').mockRejectedValueOnce(new DashboardDiscordError('membership', 429));
    expect((await get(`/api/privacy?guild=${A}`)).statusCode).toBe(503);
    expect(log).toHaveBeenLastCalledWith(expect.objectContaining({
      route: '/api/privacy', dependency: 'discord', operation: 'membership', upstreamStatus: 429,
    }), 'dashboard dependency unavailable');
  });
  it.each([[401, 401], [403, 403], [404, 403], [429, 503], [500, 503]])(
    'returns the appropriate status when Discord membership responds with %i', async (upstream, expected) => {
      team = true;
      // Team access to aggregates never grants membership or bypasses privacy checks.
      expect((await get(`/api/activity?guild=${A}&mode=overview`)).statusCode).toBe(200);
      jest.spyOn(identity, 'memberRoles').mockRejectedValueOnce(new DashboardDiscordError('membership', upstream));
      expect((await get(`/api/privacy?guild=${A}`)).statusCode).toBe(expected);
    },
  );
  it('returns the Discord cooldown for privacy retries without changing stored preferences', async () => {
    await store.setPrivacy(A, U, true, false);
    jest.spyOn(identity, 'memberRoles').mockRejectedValueOnce(new DashboardDiscordError('membership', 429, undefined, 61));
    const response = await get(`/api/privacy?guild=${A}`);
    expect(response.statusCode).toBe(503);
    expect(response.headers['retry-after']).toBe('61');
    expect(response.json()).toEqual({ error: 'discord_rate_limited' });
    expect(await store.privacy(A, U)).toBe(true);
  });
  it('shares only current instance counts with members while preserving tenant settings isolation', async () => {
    expect((await app.inject('/api/instance')).statusCode).toBe(401);
    const overview = (await get('/api/instance')).json();
    expect(overview).toEqual({ activeGuilds: 2, updatedAt: expect.any(String), features: [
      { feature: 'timers', enabledGuilds: 2 }, { feature: 'todolists', enabledGuilds: 2 },
      { feature: 'warlog', enabledGuilds: 0 }, { feature: 'stats', enabledGuilds: 2 },
    ] });
    expect((await sql`SELECT * FROM guild_settings`.execute(database.handle.db)).rows).toEqual([]);
    expect((await get('/api/activity?guild=all')).statusCode).toBe(403);
    await queryAsAdmin(database, "UPDATE guild_registry SET inactive_since=now(),inactive_reason='left' WHERE guild_id=$1", [B]);
    await new PostgresGuildSettingsRepository(database.handle.db).findOrCreate(GuildId.assert(OTHER));
    await queryAsAdmin(database, "UPDATE guild_settings SET features='{\"timers\":false,\"todolists\":false,\"warlog\":true}' WHERE guild_id=$1", [OTHER]);
    memberships = []; roles = [];
    expect((await get('/api/instance')).json()).toMatchObject({ activeGuilds: 2, features: [
      { feature: 'timers', enabledGuilds: 1 }, { feature: 'todolists', enabledGuilds: 1 },
      { feature: 'warlog', enabledGuilds: 1 }, { feature: 'stats', enabledGuilds: 1 },
    ] });
    await queryAsAdmin(database, "UPDATE guild_registry SET inactive_since=now(),inactive_reason='requested' WHERE guild_id=$1", [OTHER]);
    expect((await get('/api/instance')).json().activeGuilds).toBe(1);
    await queryAsAdmin(database, "UPDATE guild_registry SET inactive_since=now(),inactive_reason='left' WHERE guild_id=$1", [A]);
    expect((await get('/api/instance')).json()).toMatchObject({ activeGuilds: 0, features: [
      { feature: 'timers', enabledGuilds: 0 }, { feature: 'todolists', enabledGuilds: 0 },
      { feature: 'warlog', enabledGuilds: 0 }, { feature: 'stats', enabledGuilds: 0 },
    ] });
  });
  it('only grants officer access in the guild with the configured role and rechecks exports', async () => {
    roles = [R, O];
    expect(
      (await get(`/api/activity?guild=${A}&mode=guild`)).json<{ users: unknown[] }>().users,
    ).toHaveLength(2);
    expect((await get(`/api/activity?guild=${B}&mode=guild`)).json<{ scope: string }>().scope).toBe('self');
    roles = [R];
    const exported = await get(`/api/export?guild=${A}&mode=guild&format=json`);
    expect(exported.json<unknown[]>()).toHaveLength(1);
    expect(exported.json<unknown[]>()[0]).toEqual({
      userId: U, username: '=SUM(A1:A2)', totalSeconds: expect.any(Number),
      lastActivityDate: expect.stringMatching(/\+00:00$/),
    });
    expect(identity.guilds).toHaveBeenLastCalledWith('sensitive-oauth-token', true);
    memberships = [guild(B)];
    expect((await get(`/api/export?guild=${A}&format=csv`)).statusCode).toBe(403);
  });
  it('grants global access solely through current Team membership', async () => {
    expect((await get('/api/activity?guild=all')).statusCode).toBe(403);
    team = true;
    expect((await get('/api/activity?guild=all')).json<{ users: unknown[] }>().users).toHaveLength(3);
    const rows = (await get('/api/export?guild=all&format=json')).json<{ guildId: string }[]>();
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.guildId))).toEqual(new Set([A, B]));
    expect((await get('/api/export?guild=all&format=csv')).body.split('\r\n')[0]).toBe(
      'guild_id,user_id,username,total_seconds,last_activity_date',
    );
    team = false;
    expect((await get('/api/export?guild=all&format=json')).statusCode).toBe(403);
    expect((await get('/api/admin/status')).statusCode).toBe(403);
  });
  it('scopes server series to officer permissions and deduplicates the instance people total', async () => {
    roles = [R, O];
    const officer = (await get(`/api/activity?guild=${A}&mode=guild`)).json();
    expect(officer.serverActivity).toEqual([expect.objectContaining({ guildId: A, activeUsers: 2 })]);
    expect((await get(`/api/activity?guild=${B}&mode=guild`)).json().serverActivity).toEqual([]);
    expect((await get('/api/activity?guild=all')).statusCode).toBe(403);
    team = true;
    const global = (await get('/api/activity?guild=all')).json();
    expect(global.activeUsers).toBe(2);
    expect(new Map(global.serverActivity.map((g: { guildId: string; activeUsers: number }) => [g.guildId, g.activeUsers]))).toEqual(new Map([[A, 2], [B, 1]]));
    expect(global.serverActivity.reduce((sum: number, g: { seconds: number }) => sum + g.seconds, 0)).toBeCloseTo(global.seconds);
    const overview = (await get(`/api/activity?guild=${A}&mode=overview`)).json();
    expect(overview.serverActivity).toEqual([expect.objectContaining({ guildId: A, activeUsers: 2 })]);
    expect(overview.users).toEqual([]);
  });
  it('rejects cross-origin mutations and malformed CSRF without server errors', async () => {
    const payload = { guild: A, optedOut: true, erase: false };
    expect((await post('/api/privacy', payload, { origin: 'https://attacker.example' })).statusCode).toBe(
      403,
    );
    expect((await post('/api/privacy', payload, { 'x-picket-csrf': 'é'.repeat(64) })).statusCode).toBe(403);
    expect((await post('/api/privacy', payload)).statusCode).toBe(200);
    expect(await store.privacy(A, U)).toBe(true);
  });
  it('supports own erasure after leaving a guild and removes contribution from aggregates', async () => {
    memberships = [];
    expect((await get(`/api/activity?guild=${A}`)).statusCode).toBe(403);
    expect((await post('/api/privacy/erase-all', { confirm: 'DELETE' })).statusCode).toBe(200);
    expect(buffer.erase).toHaveBeenCalledWith(A, U);
    const report = await store.report(
      { kind: 'guild', guildId: A, userId: V },
      { from: new Date(Date.now() - 7200_000), to: new Date() },
    );
    expect(report.activeUsers).toBe(1);
  });
  it('neutralises CSV formulas and exports the selected channel only', async () => {
    const response = await get(`/api/export?guild=${A}&format=csv&channel=${C}`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("'=SUM(A1:A2)");
    expect(response.body.split('\r\n')[0]).toBe('user_id,username,total_seconds,last_activity_date');
    expect((await get(`/api/export?guild=${A}&format=json&channel=invalid`)).statusCode).toBe(400);
  });
  it('fails closed on an altered encrypted session token', async () => {
    await queryAsAdmin(database, "UPDATE stats_web_sessions SET encrypted_token='invalid'");
    expect((await get('/api/activity?guild=all')).statusCode).toBe(401);
    expect((await app.inject('/api/session')).statusCode).toBe(401);
  });
  it('ignores forged privileges and follows database role revocations even while Discord still returns the role', async () => {
    roles = [R, O];
    expect((await get(`/api/activity?guild=${A}&mode=guild`)).json().users).toHaveLength(2);
    await queryAsAdmin(database, "DELETE FROM guild_permission_roles WHERE guild_id=$1 AND level='officer'", [A]);
    const forged = `guild=${A}&mode=guild&scope=global&administrator=true&userId=${V}&roles=${O}`;
    const report = (await get(`/api/activity?${forged}`)).json();
    expect(report.scope).toBe('self'); expect(report.users.map((row: { userId: string }) => row.userId)).toEqual([U]);
    expect((await get(`/api/export?${forged}&format=json`)).json().map((row: { userId: string }) => row.userId)).toEqual([U]);
    expect((await get('/api/activity?guild=all&administrator=true')).statusCode).toBe(403);
    memberships = [guild(B)];
    expect((await get(`/api/activity?${forged}`)).statusCode).toBe(403);
    expect((await get(`/api/export?${forged}&format=csv`)).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/session', headers: { cookie: `__Host-picket_session=${'f'.repeat(64)}` } })).statusCode).toBe(401);
  });
  it('keeps retained inactive guild history available exclusively to instance administrators', async () => {
    await store.rememberGuildName(B, 'Reserve Depot');
    memberships = [guild(A)];
    await queryAsAdmin(
      database,
      "UPDATE guild_registry SET inactive_since=now(),inactive_reason='left' WHERE guild_id=$1",
      [B],
    );
    expect((await get(`/api/activity?guild=${B}`)).statusCode).toBe(403);
    team = true;
    expect((await get(`/api/activity?guild=${B}`)).statusCode).toBe(200);
    const guilds = (await get('/api/guilds')).json<{ guilds: { id: string; name: string; nameKnown: boolean; inactive: boolean }[] }>().guilds;
    expect(guilds.find((g) => g.id === B)).toMatchObject({ name: 'Reserve Depot', nameKnown: true, inactive: true });
    expect(identity.guildNames).not.toHaveBeenCalled();
  });
  it('recovers names outside the administrator membership and preserves them after a departure', async () => {
    team = true;
    memberships = [guild(A)];
    botGuildNames = [{ id: B, name: 'Allied Watchpost' }];
    const first = (await get('/api/guilds')).json().guilds;
    expect(first.find((g: { id: string }) => g.id === B)).toMatchObject({ name: 'Allied Watchpost', nameKnown: true, inactive: false });
    expect(await store.settings(B)).toMatchObject({ name: 'Allied Watchpost', nameKnown: true });
    await queryAsAdmin(database, "UPDATE guild_registry SET inactive_since=now(),inactive_reason='left' WHERE guild_id=$1", [B]);
    botGuildNames = [];
    const retained = (await get('/api/guilds')).json().guilds;
    expect(retained.find((g: { id: string }) => g.id === B)).toMatchObject({ name: 'Allied Watchpost', nameKnown: true, inactive: true });
    expect(identity.guildNames).toHaveBeenCalledTimes(1);
  });
  it('saves OAuth names without enabling collection or changing AFK and exclusion settings', async () => {
    await store.metadata(A, 'Old name', C);
    await store.configure(A, U, { enabled: false, excludedChannels: [C] });
    memberships = [{ ...guild(A), name: 'Renamed Regiment' }];
    expect((await get('/api/guilds')).statusCode).toBe(200);
    expect(await store.settings(A)).toMatchObject({ name: 'Renamed Regiment', nameKnown: true, enabled: false, afkChannelId: C, excludedChannels: [C] });
    expect(identity.guildNames).not.toHaveBeenCalled();
    await store.rememberGuildName(A, '');
    expect((await store.settings(A)).name).toBe('Renamed Regiment');
  });
  it('distinguishes unavailable old names from inactivity and does not expose other servers to members', async () => {
    memberships = [guild(A)];
    const memberGuilds = (await get('/api/guilds')).json().guilds;
    expect(memberGuilds.map((g: { id: string }) => g.id)).toEqual([A]);
    expect(identity.guildNames).not.toHaveBeenCalled();
    team = true;
    const unknown = (await get('/api/guilds')).json().guilds.find((g: { id: string }) => g.id === B);
    expect(unknown).toMatchObject({ name: B, nameKnown: false, inactive: false });
  });
  it('keeps the guild list usable when Discord name recovery fails', async () => {
    team = true;
    memberships = [guild(A)];
    jest.mocked(identity.guildNames).mockRejectedValueOnce(new Error('Discord unavailable'));
    const response = await get('/api/guilds');
    expect(response.statusCode).toBe(200);
    expect(response.json().guilds.find((g: { id: string }) => g.id === B)).toMatchObject({ name: B, nameKnown: false });
  });
});
