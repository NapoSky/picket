import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify, { type FastifyRequest } from 'fastify';
import { GuildId, RoleId, type Logger, type OperationalMetrics } from '@picket/kernel';
import { PostgresPermissionRepository, resolveAccessLevel } from '@picket/guild';
import { sql, type Db } from '@picket/persistence';
import { exportActivity } from '../application/activity-export';
import { parsePeriod, type StatsScope } from '../domain/model';
import type { DurableVoiceBuffer } from '../application/store';
import { DashboardDiscordError, type DashboardIdentityProvider } from './dashboard-discord';
import { PostgresStatsStore } from './postgres-stats-store';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('hex');
const validId = (value: unknown): value is string => typeof value === 'string' && /^\d{15,25}$/.test(value);
const SESSION_MS = 8 * 60 * 60 * 1000;
interface Session {
  token_hash: string;
  user_id: string;
  display_name: string;
  encrypted_token: string;
  csrf_token: string;
  expires_at: Date;
  token: string;
}
export interface DashboardOptions {
  readonly db: Db;
  readonly store: PostgresStatsStore;
  readonly identity: DashboardIdentityProvider;
  readonly applicationId: string;
  readonly origin: string;
  readonly encryptionSecret: string;
  readonly buffer: DurableVoiceBuffer;
  readonly logger: Logger;
  readonly metrics?: OperationalMetrics;
  readonly now?: () => Date;
  readonly staticDirectory?: string;
  /** Supplied only by the development entry point; production uses Discord. */
  readonly development?: { readonly role: string; readonly authorizationUrl: (state: string) => string };
}

export function createDashboardServer(options: DashboardOptions) {
  const app = Fastify({
    trustProxy: ['loopback', 'uniquelocal'],
    logger: false,
    bodyLimit: 16 * 1024,
    requestTimeout: 10_000,
    keepAliveTimeout: 120_000,
  });
  const now = options.now ?? (() => new Date());
  app.addHook('onResponse', async (_request, reply) => {
    options.metrics?.record('http', reply.elapsedTime / 1000,
      reply.statusCode >= 500 ? 'error' : reply.statusCode >= 400 ? 'rejected' : 'success', 'dashboard');
  });
  const origin = new URL(options.origin).origin;
  const secure = origin.startsWith('https:');
  const cookieName = secure ? '__Host-picket_session' : 'picket_session';
  const stateCookie = secure ? '__Host-picket_oauth' : 'picket_oauth';
  const key = createHash('sha256').update(`picket-dashboard:${options.encryptionSecret}`).digest();
  const permissions = new PostgresPermissionRepository(options.db);
  const staticDirectory = options.staticDirectory ?? join(__dirname, '..', '..', 'static');
  const attempts = new Map<string, { count: number; expires: number }>();
  function cookie(name: string, value: string, maxAge: number) {
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  }
  function readCookie(request: FastifyRequest, name: string): string | null {
    const matches = (request.headers.cookie ?? '')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.startsWith(`${name}=`));
    return matches.length === 1 ? matches[0]!.slice(name.length + 1) : null;
  }
  function encrypt(value: string, aad: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(aad));
    const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }
  function decrypt(value: string, aad: string): string {
    const bytes = Buffer.from(value, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  }
  async function session(request: FastifyRequest): Promise<Session> {
    const token = readCookie(request, cookieName);
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      throw Object.assign(new Error('unauthenticated'), { statusCode: 401 });
    const row = (
      await sql<
        Omit<Session, 'token'>
      >`SELECT * FROM stats_web_sessions WHERE token_hash=${hash(token)} AND expires_at>${now()}`.execute(
        options.db,
      )
    ).rows[0];
    if (!row) throw Object.assign(new Error('unauthenticated'), { statusCode: 401 });
    try {
      return { ...row, token: decrypt(row.encrypted_token, row.token_hash) };
    } catch {
      await sql`DELETE FROM stats_web_sessions WHERE token_hash=${row.token_hash}`.execute(options.db);
      throw Object.assign(new Error('unauthenticated'), { statusCode: 401 });
    }
  }
  function csrf(request: FastifyRequest, current: Session): void {
    const token = request.headers['x-picket-csrf'];
    if (
      request.headers.origin !== origin ||
      typeof token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(token) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(current.csrf_token))
    )
      throw Object.assign(new Error('invalid_csrf'), { statusCode: 403 });
  }
  async function access(
    current: Session,
    guildId: string,
    fresh = false,
    knownGuild?: Awaited<ReturnType<DashboardIdentityProvider['guilds']>>[number],
  ) {
    if (!(await options.store.isActive(guildId)))
      throw Object.assign(new Error('forbidden'), { statusCode: 403 });
    const guild =
      knownGuild ?? (await options.identity.guilds(current.token, fresh)).find((g) => g.id === guildId);
    if (!guild) throw Object.assign(new Error('forbidden'), { statusCode: 403 });
    const roles = await options.identity.memberRoles(current.token, guildId, fresh);
    const config = await permissions.loadExisting(GuildId.assert(guildId));
    if (!config) throw Object.assign(new Error('forbidden'), { statusCode: 403 });
    const level =
      resolveAccessLevel({
        guildId: GuildId.assert(guildId),
        roleIds: roles.map(RoleId.assert),
        permissions: guild.owner ? 8n : BigInt(guild.permissions),
        config,
      }) ?? 'member';
    return { guild, level };
  }
  async function scope(current: Session, query: Record<string, unknown>, fresh = false): Promise<StatsScope & {
    accessLevel: 'member' | 'officer' | 'admin' | 'instance_admin';
  }> {
    if (query.guild === 'all') {
      if (!(await options.identity.teamMember(current.user_id, fresh)))
        throw Object.assign(new Error('forbidden'), { statusCode: 403 });
      return { kind: 'global', guildId: null, userId: current.user_id, accessLevel: 'instance_admin' };
    }
    if (!validId(query.guild)) throw Object.assign(new Error('invalid_guild'), { statusCode: 400 });
    // Team members may inspect a guild even when they are not members of it.
    const global = await options.identity.teamMember(current.user_id, fresh);
    const member = global ? null : await access(current, query.guild, fresh);
    if (!(global ? await options.store.isRegistered(query.guild) : await options.store.isActive(query.guild)))
      throw Object.assign(new Error('forbidden'), { statusCode: 403 });
    return {
      kind:
        query.mode === 'personal'
          ? 'self'
          : global || member?.level === 'officer' || member?.level === 'admin'
            ? 'guild'
            : 'self',
      guildId: query.guild,
      userId: current.user_id,
      accessLevel: global ? 'instance_admin' : member!.level,
    };
  }
  function periodFor(query: Record<string, unknown>, snapshotAt?: Date | null) {
    const instant = now();
    if (snapshotAt && snapshotAt.getTime()<=instant.getTime()-60*86_400_000)
      throw Object.assign(new Error('stats_snapshot_pending'), { statusCode:503 });
    const end = snapshotAt ?? instant;
    const days = typeof query.days === 'string' && /^\d+$/.test(query.days) ? Number(query.days) : 7;
    if (days < 1 || days > 60) return null;
    return parsePeriod(
      query.from ?? new Date(Math.max(instant.getTime()-60*86_400_000,end.getTime() - days * 86_400_000)).toISOString(),
      query.to ?? (snapshotAt ? end.toISOString() : undefined),
      instant,
    );
  }

  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'same-origin')
      .header('X-Frame-Options', 'DENY')
      .header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
    if (request.url.startsWith('/api/') || request.url.startsWith('/auth/'))
      reply.header('Cache-Control', 'no-store');
    if (!request.url.startsWith('/api/') && !request.url.startsWith('/auth/')) return;
    const identity = hash(readCookie(request, cookieName) ?? readCookie(request, stateCookie) ?? request.ip);
    const old = attempts.get(identity);
    const window =
      old && old.expires > now().getTime() ? old : { count: 0, expires: now().getTime() + 60_000 };
    window.count++;
    attempts.set(identity, window);
    if (attempts.size > 10_000)
      for (const [id, row] of attempts) if (row.expires <= now().getTime()) attempts.delete(id);
    if (attempts.size > 20_000 || window.count > 90)
      return reply.code(429).header('Retry-After', '60').send({ error: 'rate_limited' });
  });
  app.setErrorHandler((error, request, reply) => {
    const failure = error as { statusCode?: number; message?: string };
    if (failure.message === 'stats_snapshot_pending')
      return reply.code(503).header('Retry-After','60').send({ error:'stats_snapshot_pending' });
    const status =
      failure.statusCode && failure.statusCode >= 400 && failure.statusCode < 500 ? failure.statusCode : 503;
    if (status === 503 || error instanceof DashboardDiscordError) {
      // Never serialize the error: SQL, Discord request objects and query strings
      // can contain personal data or credentials. These codes are enough to diagnose.
      const code = (error as { code?: unknown }).code;
      const fields = {
        requestId: request.id,
        method: request.method,
        route: request.routeOptions.url,
        errorType: error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name) ? error.name : 'Error',
        ...(typeof code === 'string' && /^(?:[0-9A-Z]{5}|E[A-Z_]{1,40})$/.test(code) ? { code } : {}),
        ...(error instanceof DashboardDiscordError ? {
          dependency: 'discord', operation: error.operation,
          upstreamStatus: error.upstreamStatus, upstreamFailure: error.upstreamFailure,
          retryAfterSeconds: error.retryAfterSeconds,
        } : {}),
        ...(typeof (error as { status?: unknown }).status === 'number'
          ? { upstreamStatus: (error as { status: number }).status } : {}),
      };
      if (status === 503) options.logger.error(fields, 'dashboard dependency unavailable');
      else options.logger.warn(fields, 'dashboard Discord authorization denied');
      reply.header('X-Request-Id', request.id);
    }
    if (error instanceof DashboardDiscordError && error.upstreamStatus === 429 && error.retryAfterSeconds)
      return reply.code(503).header('Retry-After', String(error.retryAfterSeconds))
        .send({ error: 'discord_rate_limited' });
    return reply.code(status).send({ error: status === 503
      ? error instanceof DashboardDiscordError ? 'discord_unavailable' : 'unavailable'
      : failure.message });
  });

  // Cloudflare may cache JS/CSS even when HTML is revalidated. A content version
  // prevents a new page from using scripts and styles from the previous release.
  let assetVersion: Promise<string> | undefined;
  for (const [path, file, type] of [
    ['/', 'index.html', 'text/html'],
    ['/app.js', 'app.js', 'text/javascript'],
    ['/style.css', 'style.css', 'text/css'],
    ['/logo.png', 'logo.png', 'image/png'],
    ['/banner.jpg', 'banner.jpg', 'image/jpeg'],
  ] as const)
    app.get(path, async (_request, reply) => {
      const data = await readFile(join(staticDirectory, file));
      let body: Buffer | string = data;
      if (file === 'index.html') {
        assetVersion ??= Promise.all(['app.js', 'style.css'].map(asset => readFile(join(staticDirectory, asset))))
          .then(assets => createHash('sha256').update(assets[0]!).update(assets[1]!).digest('hex').slice(0, 16));
        const version = await assetVersion;
        body = data.toString().replace('src="/app.js"', `src="/app.js?v=${version}"`)
          .replace('href="/style.css"', `href="/style.css?v=${version}"`);
      }
      if (file === 'index.html' && options.development)
        body = body.toString().replace('<html ', '<html data-development="true" ').replace('<body>',
          `<body><p role="status" class="notice">Development · Live PostgreSQL · Simulated Discord identity: ${options.development.role}</p>`);
      return reply
        .type(type)
        .header('Cache-Control', 'no-cache')
        .send(body);
    });

  app.get('/auth/discord', async (_request, reply) => {
    const state = secret();
    await sql`INSERT INTO stats_oauth_states(state_hash,expires_at) VALUES(${hash(state)},${new Date(now().getTime() + 600_000)})`.execute(
      options.db,
    );
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: options.applicationId,
      response_type: 'code',
      redirect_uri: `${origin}/auth/callback`,
      scope: 'identify guilds guilds.members.read',
      state,
    }).toString();
    return reply.header('Set-Cookie', cookie(stateCookie, state, 600))
      .redirect(options.development?.authorizationUrl(state) ?? url.toString());
  });
  app.get('/auth/callback', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const state = readCookie(request, stateCookie);
    if (!state || query.state !== state || typeof query.code !== 'string' || query.code.length > 2048)
      return reply.code(400).send({ error: 'invalid_oauth_state' });
    const consumed = (
      await sql`DELETE FROM stats_oauth_states WHERE state_hash=${hash(state)} AND expires_at>${now()} RETURNING state_hash`.execute(
        options.db,
      )
    ).rows.length;
    if (!consumed) return reply.code(400).send({ error: 'invalid_oauth_state' });
    const token = await options.identity.exchange(query.code);
    const user = await options.identity.user(token.token);
    const sessionToken = secret();
    const tokenHash = hash(sessionToken);
    const csrfToken = secret();
    const expiresAt = new Date(now().getTime() + Math.min(SESSION_MS, token.expiresIn * 1000));
    await sql`INSERT INTO stats_web_sessions(token_hash,user_id,display_name,encrypted_token,csrf_token,expires_at)
      VALUES(${tokenHash},${user.id},${user.name},${encrypt(token.token, tokenHash)},${csrfToken},${expiresAt})`.execute(
      options.db,
    );
    return reply
      .header('Set-Cookie', [
        cookie(cookieName, sessionToken, Math.floor((expiresAt.getTime() - now().getTime()) / 1000)),
        cookie(stateCookie, '', 0),
      ])
      .redirect('/');
  });
  app.get('/api/session', async (request) => {
    const current = await session(request);
    return {
      user: { id: current.user_id, name: current.display_name },
      csrf: current.csrf_token,
      administrator: await options.identity.teamMember(current.user_id),
      refreshSeconds: 60,
      retentionDays: 60,
    };
  });
  app.post('/api/logout', async (request, reply) => {
    const current = await session(request);
    csrf(request, current);
    await sql`DELETE FROM stats_web_sessions WHERE token_hash=${current.token_hash}`.execute(options.db);
    return reply.header('Set-Cookie', cookie(cookieName, '', 0)).send({ ok: true });
  });
  app.get('/api/guilds', async (request) => {
    const current = await session(request);
    const global = await options.identity.teamMember(current.user_id);
    const memberships = await options.identity.guilds(current.token);
    const active = new Set(await options.store.guildIds());
    const deployed = global ? new Set(await options.store.allGuildIds()) : active;
    const items = [];
    let botNames: ReadonlyMap<string, string> | undefined;
    for (const guildId of global ? deployed : memberships.map((g) => g.id).filter((id) => deployed.has(id))) {
      const settings = await options.store.settings(guildId);
      const membership = memberships.find((g) => g.id === guildId);
      // The guild list establishes membership, not access to individual records.
      // Resolve roles only for the server being read, rather than every menu item.
      const level = global ? 'instance_admin' : 'unknown';
      if (global && !membership && active.has(guildId) && botNames === undefined) {
        try {
          botNames = new Map((await options.identity.guildNames()).map(guild => [guild.id, guild.name]));
        } catch {
          botNames = new Map();
          options.logger.warn({}, 'Discord guild names unavailable; using retained metadata');
        }
      }
      const discordName = membership?.name ?? botNames?.get(guildId);
      if (discordName && (!settings.nameKnown || discordName !== settings.name))
        await options.store.rememberGuildName(guildId, discordName);
      items.push({
        id: guildId,
        name: discordName ?? settings.name,
        nameKnown: !!discordName || settings.nameKnown,
        level,
        enabled: settings.enabled,
        isMember: membership !== undefined && active.has(guildId),
        inactive: !active.has(guildId),
      });
    }
    return { guilds: items };
  });
  app.get('/api/instance', async (request) => {
    await session(request);
    return options.store.instanceOverview();
  });
  app.get('/api/activity', async (request) => {
    const current = await session(request);
    const query = request.query as Record<string, unknown>;
    const selected = await scope(current, query);
    const period = periodFor(query, selected.kind === 'global' ? (await options.store.adminSnapshotStatus()).snapshotAt : undefined);
    if (!period) throw Object.assign(new Error('invalid_period'), { statusCode: 400 });
    if (query.channel !== undefined && !validId(query.channel))
      throw Object.assign(new Error('invalid_channel'), { statusCode: 400 });
    const requested = {
      ...period,
      ...(typeof query.channel === 'string' ? { channelId: query.channel } : {}),
    };
    if (query.mode === 'overview' && selected.guildId !== null) {
      const report = await options.store.report({ ...selected, kind: 'guild' }, requested, {
        includeUsers: false,
      });
      return { ...report, collection: await options.store.collectionStatus(selected), users: [], scope: 'overview', accessLevel: selected.accessLevel };
    }
    const offset = typeof query.offset === 'string' && /^\d+$/.test(query.offset) ? Number(query.offset) : 0;
    if (offset > 1_000_000) throw Object.assign(new Error('invalid_offset'), { statusCode: 400 });
    const report = selected.kind === 'global'
      ? await options.store.adminReport(selected, requested, { offset })
      : await options.store.report(selected, requested, { offset });
    const guildFeatures = selected.accessLevel === 'instance_admin' && selected.guildId !== null
      ? await options.store.guildFeatures(selected.guildId) : undefined;
    return { ...report, collection: await options.store.collectionStatus(selected), scope: selected.kind, accessLevel: selected.accessLevel, offset,
      ...(guildFeatures ? { guildFeatures } : {}) };
  });
  app.get('/api/export', async (request, reply) => {
    const current = await session(request);
    const query = request.query as Record<string, unknown>;
    const selected = await scope(current, query, true);
    const period = periodFor(query, selected.kind === 'global' ? (await options.store.adminSnapshotStatus()).snapshotAt : undefined);
    if (!period || !['csv', 'json'].includes(String(query.format)))
      return reply.code(400).send({ error: 'invalid_export' });
    if (query.channel !== undefined && !validId(query.channel))
      return reply.code(400).send({ error: 'invalid_channel' });
    const requested = {
      ...period,
      ...(typeof query.channel === 'string' ? { channelId: query.channel } : {}),
    };
    const report = selected.kind === 'global'
      ? await options.store.adminReport(selected, requested, { limit:10_000 })
      : await options.store.report(selected, requested, { limit: 10_000 });
    // Bound response memory; users can also select a channel or narrower period. Never silently truncate.
    if (report.truncated) return reply.code(413).send({ error: 'export_too_large' });
    const filename = `picket-voice-${selected.guildId ?? 'instance'}-${now().toISOString().slice(0, 10)}.${query.format}`;
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    const format = query.format as 'json' | 'csv';
    return reply
      .type(format === 'json' ? 'application/json' : 'text/csv; charset=utf-8')
      .send(exportActivity(report.users, format, selected.kind === 'global'));
  });
  app.get('/api/privacy', async (request) => {
    const current = await session(request);
    const query = request.query as Record<string, unknown>;
    if (!validId(query.guild)) throw Object.assign(new Error('invalid_guild'), { statusCode: 400 });
    await access(current, query.guild);
    return {
      optedOut:
        (await options.store.privacy(query.guild, current.user_id)) ||
        ((await options.buffer.isExcluded?.(query.guild, current.user_id)) ?? false),
    };
  });
  app.post('/api/privacy', async (request) => {
    const current = await session(request);
    csrf(request, current);
    const body = request.body as Record<string, unknown>;
    if (
      !body ||
      !validId(body.guild) ||
      typeof body.optedOut !== 'boolean' ||
      typeof body.erase !== 'boolean' ||
      (body.erase && body.confirm !== 'DELETE')
    )
      throw Object.assign(new Error('invalid_privacy_action'), { statusCode: 400 });
    await access(current, body.guild);
    // A database erasure cutoff also guards records concurrently replayed by another replica.
    if (body.optedOut) await options.buffer.setExcluded?.(body.guild, current.user_id, true);
    await options.store.setPrivacy(body.guild, current.user_id, body.optedOut, body.erase);
    if (!body.optedOut) await options.buffer.setExcluded?.(body.guild, current.user_id, false);
    if (body.erase) await options.buffer.erase(body.guild, current.user_id);
    return { ok: true };
  });
  app.post('/api/privacy/erase-all', async (request) => {
    const current = await session(request);
    csrf(request, current);
    if ((request.body as Record<string, unknown>)?.confirm !== 'DELETE')
      throw Object.assign(new Error('invalid_privacy_action'), { statusCode: 400 });
    const ownGuilds = new Set([
      ...(await options.store.personalGuildIds(current.user_id)),
      ...((await options.buffer.personalGuildIds?.(current.user_id)) ?? []),
    ]);
    for (const guildId of ownGuilds) {
      await options.buffer.setExcluded?.(guildId, current.user_id, true);
      await options.store.setPrivacy(guildId, current.user_id, true, true);
      await options.buffer.erase(guildId, current.user_id);
    }
    return { ok: true };
  });
  app.get('/api/admin/status', async (request) => {
    const current = await session(request);
    if (!(await options.identity.teamMember(current.user_id)))
      throw Object.assign(new Error('forbidden'), { statusCode: 403 });
    return { buffer: await options.buffer.status(), retentionDays: 60, refreshSeconds: 60 };
  });
  return app;
}
