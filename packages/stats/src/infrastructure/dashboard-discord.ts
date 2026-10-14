import { createHash } from 'node:crypto';
import { Secret } from '@picket/kernel';
import { createDiscordOAuthRest, DiscordAPIError, HTTPError, RateLimitError,
  type DiscordBotRestClient, type DiscordOAuthRestClient } from '@picket/discord';

export interface OAuthUser {
  readonly id: string;
  readonly name: string;
}
export interface OAuthGuild {
  readonly id: string;
  readonly name: string;
  readonly permissions: string;
  readonly owner: boolean;
}
export interface OAuthToken {
  readonly token: string;
  readonly expiresIn: number;
}
export interface DashboardIdentityProvider {
  exchange(code: string): Promise<OAuthToken>;
  user(token: string): Promise<OAuthUser>;
  guilds(token: string, fresh?: boolean): Promise<readonly OAuthGuild[]>;
  guildNames(): Promise<readonly Pick<OAuthGuild, 'id' | 'name'>[]>;
  memberRoles(token: string, guildId: string, fresh?: boolean): Promise<readonly string[]>;
  teamMember(userId: string, fresh?: boolean): Promise<boolean>;
}

const id = (value: unknown): value is string => typeof value === 'string' && /^\d{15,25}$/.test(value);
const ACCESS_CACHE_MS = 5 * 60_000;
const tokenKey = (token: string) => createHash('sha256').update(token).digest('hex');

/** Deliberately excludes request URLs, bearer tokens and response bodies. */
export class DashboardDiscordError extends Error {
  readonly statusCode: number | undefined;
  constructor(
    readonly operation: 'user' | 'guilds' | 'membership',
    readonly upstreamStatus?: number,
    readonly upstreamFailure?: 'timeout' | 'network',
    readonly retryAfterSeconds?: number,
  ) {
    super('Discord identity unavailable');
    this.name = 'DashboardDiscordError';
    this.statusCode = upstreamStatus === 401 ? 401
      : operation === 'membership' && (upstreamStatus === 403 || upstreamStatus === 404) ? 403 : undefined;
  }
}

export class DashboardDiscord implements DashboardIdentityProvider {
  readonly #guildCache = new Map<string, { at: number; guilds: readonly OAuthGuild[] }>();
  #team: { at: number; ids: Set<string> } | null = null;
  #botGuilds: { at: number; guilds: readonly Pick<OAuthGuild, 'id' | 'name'>[] } | null = null;
  readonly #oauth = new Map<string, {
    client: DiscordOAuthRestClient; expires: number; globalCooldown: number; invalid: boolean;
    cooldowns: Map<string, number>; pending: Map<string, Promise<unknown>>;
    members: Map<string, { at: number; roles: readonly string[] }>;
  }>();
  constructor(
    readonly applicationId: string,
    readonly clientSecret: string,
    readonly callbackUrl: string,
    readonly rest: DiscordBotRestClient,
    readonly fetcher: typeof fetch = fetch,
    readonly metrics?: import('@picket/kernel').OperationalMetrics,
  ) {}

  private async request(path: string, token: string): Promise<unknown> {
    const operation = path.endsWith('/member') ? 'membership' : path.startsWith('/users/@me/guilds') ? 'guilds' : 'user';
    const key = tokenKey(token);
    const instant = Date.now();
    for (const [key, state] of this.#oauth) {
      if (state.expires > instant || state.pending.size) continue;
      state.client.clearHashSweeper(); state.client.clearHandlerSweeper();
      this.#oauth.delete(key);
    }
    let state = this.#oauth.get(key);
    if (!state) {
      if (this.#oauth.size >= 1000) throw new Error('Discord OAuth client capacity reached');
      state = {
        client: createDiscordOAuthRest(new Secret(token), {
          makeRequest: (url, init) => this.fetcher(url, {
            method: init.method ?? 'GET', headers: init.headers as NonNullable<RequestInit['headers']>, signal: init.signal ?? null,
          }),
          // Short waits are handled by the SDK. Long quotas return a retry delay
          // instead of keeping an HTTP request queued indefinitely.
          rejectOnRateLimit: limit => Math.max(limit.retryAfter, limit.timeToReset, limit.sublimitTimeout) > 2000,
        }, this.metrics),
        expires: instant + 8 * 60 * 60 * 1000, globalCooldown: 0, invalid: false,
        cooldowns: new Map(), pending: new Map(), members: new Map(),
      };
      this.#oauth.set(key, state);
    }
    if (state.invalid) throw new DashboardDiscordError(operation, 401);
    const cooldown = Math.max(state.globalCooldown, state.cooldowns.get(operation) ?? 0);
    if (cooldown > instant)
      throw new DashboardDiscordError(operation, 429, undefined, Math.ceil((cooldown - instant) / 1000));
    const pending = state.pending.get(path);
    if (pending) return pending;
    // Coalesce simultaneous reads, including fresh export checks.
    const query = path.indexOf('?');
    const request = state.client.get((query < 0 ? path : path.slice(0, query)) as `/${string}`,
      query < 0 ? {} : { query: new URLSearchParams(path.slice(query + 1)) });
    const result = request.catch(error => {
      if (error instanceof RateLimitError) {
        const retryMs = Math.max(error.retryAfter, error.timeToReset, error.sublimitTimeout);
        const retrySeconds = Math.max(1, Math.ceil(Number.isFinite(retryMs) ? retryMs / 1000 : 60));
        if (error.global) state.globalCooldown = Date.now() + retrySeconds * 1000;
        else state.cooldowns.set(operation, Date.now() + retrySeconds * 1000);
        throw new DashboardDiscordError(operation, 429, undefined, retrySeconds);
      }
      if (error instanceof DiscordAPIError || error instanceof HTTPError) {
        if (error.status === 401) {
          state.invalid = true;
          state.members.clear();
          this.#guildCache.delete(key);
        }
        if (operation === 'membership' && (error.status === 403 || error.status === 404)) state.members.delete(path.split('/')[4]!);
        throw new DashboardDiscordError(operation, error.status);
      }
      throw new DashboardDiscordError(operation, undefined,
        error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'timeout' : 'network');
    });
    state.pending.set(path, result);
    try {
      return await result;
    } finally {
      state.pending.delete(path);
    }
  }

  async exchange(code: string): Promise<OAuthToken> {
    const response = await this.fetcher('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.applicationId,
        client_secret: this.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.callbackUrl,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error('Discord authorization failed');
    const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown; scope?: unknown };
    if (
      typeof body.access_token !== 'string' ||
      typeof body.expires_in !== 'number' ||
      typeof body.scope !== 'string' ||
      !['identify', 'guilds', 'guilds.members.read'].every((scope) =>
        body.scope!.toString().split(' ').includes(scope),
      )
    )
      throw new Error('Discord authorization scopes missing');
    return { token: body.access_token, expiresIn: body.expires_in };
  }

  async user(token: string): Promise<OAuthUser> {
    const data = (await this.request('/users/@me', token)) as {
      id?: unknown;
      username?: unknown;
      global_name?: unknown;
    };
    if (!id(data.id) || typeof data.username !== 'string') throw new Error('Invalid Discord identity');
    return { id: data.id, name: typeof data.global_name === 'string' ? data.global_name : data.username };
  }

  async guilds(token: string, fresh = false): Promise<readonly OAuthGuild[]> {
    const key = tokenKey(token);
    if (this.#oauth.get(key)?.invalid) throw new DashboardDiscordError('guilds', 401);
    const cached = this.#guildCache.get(key);
    if (cached && !fresh && Date.now() - cached.at < ACCESS_CACHE_MS) return cached.guilds;
    this.#guildCache.delete(key);
    // Bound cache size and remove expired access tokens from memory.
    for (const [key, value] of this.#guildCache)
      if (Date.now() - value.at >= ACCESS_CACHE_MS) this.#guildCache.delete(key);
    const guilds: OAuthGuild[] = [];
    let after = '';
    for (let page = 0; page < 10; page++) {
      const data = await this.request(`/users/@me/guilds?limit=200${after ? `&after=${after}` : ''}`, token);
      if (!Array.isArray(data)) throw new Error('Invalid Discord guild response');
      for (const guild of data as Record<string, unknown>[])
        if (
          id(guild.id) &&
          typeof guild.name === 'string' &&
          typeof guild.permissions === 'string' &&
          /^\d+$/.test(guild.permissions)
        )
          guilds.push({
            id: guild.id,
            name: guild.name,
            permissions: guild.permissions,
            owner: guild.owner === true,
          });
      if (data.length < 200) {
        if (this.#guildCache.size < 1000) this.#guildCache.set(key, { at: Date.now(), guilds });
        return guilds;
      }
      const last = data.at(-1) as { id?: unknown };
      if (!id(last.id)) throw new Error('Invalid Discord pagination');
      after = last.id;
    }
    throw new Error('Discord guild pagination limit reached');
  }

  /** Names for the bot's servers, including those the signed-in administrator has not joined. */
  async guildNames(): Promise<readonly Pick<OAuthGuild, 'id' | 'name'>[]> {
    if (this.#botGuilds && Date.now() - this.#botGuilds.at < ACCESS_CACHE_MS) return this.#botGuilds.guilds;
    const guilds: Pick<OAuthGuild, 'id' | 'name'>[] = [];
    let after = '';
    for (let page = 0; page < 10; page++) {
      const query = new URLSearchParams({ limit: '200', ...(after ? { after } : {}) });
      const data = await this.rest.get('/users/@me/guilds', { query });
      if (!Array.isArray(data) || !data.every(guild => id(guild?.id) && typeof guild.name === 'string' && guild.name.trim()))
        throw new Error('Invalid Discord guild names');
      guilds.push(...data.map(guild => ({ id: guild.id as string, name: guild.name as string })));
      if (data.length < 200) {
        this.#botGuilds = { at: Date.now(), guilds };
        return guilds;
      }
      const next = data.at(-1)!.id as string;
      if (after && BigInt(next) <= BigInt(after)) throw new Error('Invalid Discord guild pagination');
      after = next;
    }
    throw new Error('Discord guild names pagination limit reached');
  }

  async memberRoles(token: string, guildId: string, fresh = false): Promise<readonly string[]> {
    if (!id(guildId)) throw new Error('Invalid guild');
    const key = tokenKey(token);
    const state = this.#oauth.get(key);
    if (state?.invalid) throw new DashboardDiscordError('membership', 401);
    const cached = state?.members.get(guildId);
    // Cache only successful checks, without extending their lifetime on hits.
    // Expired rights must not authorize reads during a Discord outage.
    if (!fresh && state && state.expires > Date.now() && cached && Date.now() - cached.at < ACCESS_CACHE_MS) return cached.roles;
    state?.members.delete(guildId);
    const data = (await this.request(`/users/@me/guilds/${guildId}/member`, token)) as { roles?: unknown };
    if (!Array.isArray(data.roles) || !data.roles.every(id)) throw new Error('Invalid Discord membership');
    const current = this.#oauth.get(key);
    if (current?.invalid) throw new DashboardDiscordError('membership', 401);
    if (current && current.members.size < 1000) current.members.set(guildId, { at: Date.now(), roles: data.roles as string[] });
    return data.roles as string[];
  }

  async teamMember(userId: string, fresh = false): Promise<boolean> {
    if (!this.#team || fresh || Date.now() - this.#team.at >= ACCESS_CACHE_MS) {
      this.#team = null;
      const data = (await this.rest.get('/applications/@me')) as {
        id?: string;
        team?: { members?: { membership_state?: number; user?: { id?: string } }[] } | null;
      };
      if (data.id !== this.applicationId) throw new Error('OAuth application and bot application differ');
      const ids = new Set(
        (data.team?.members ?? [])
          .filter((m) => m.membership_state === 2 && id(m.user?.id))
          .map((m) => m.user!.id!),
      );
      this.#team = { at: Date.now(), ids };
    }
    return this.#team.ids.has(userId);
  }
}
