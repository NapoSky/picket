import type { DiscordBotRestClient } from '@picket/discord';

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
  memberRoles(token: string, guildId: string): Promise<readonly string[]>;
  teamMember(userId: string, fresh?: boolean): Promise<boolean>;
}

const id = (value: unknown): value is string => typeof value === 'string' && /^\d{15,25}$/.test(value);

export class DashboardDiscord implements DashboardIdentityProvider {
  readonly #guildCache = new Map<string, { at: number; guilds: readonly OAuthGuild[] }>();
  #team: { at: number; ids: Set<string> } | null = null;
  #botGuilds: { at: number; guilds: readonly Pick<OAuthGuild, 'id' | 'name'>[] } | null = null;
  constructor(
    readonly applicationId: string,
    readonly clientSecret: string,
    readonly callbackUrl: string,
    readonly rest: DiscordBotRestClient,
    readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request(path: string, token: string): Promise<unknown> {
    const response = await this.fetcher(`https://discord.com/api/v10${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error('Discord identity unavailable');
    return response.json();
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
    const cached = this.#guildCache.get(token);
    if (cached && !fresh && Date.now() - cached.at < 120_000) return cached.guilds;
    // Bound cache size and remove expired access tokens from memory.
    for (const [key, value] of this.#guildCache)
      if (Date.now() - value.at >= 120_000) this.#guildCache.delete(key);
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
        if (this.#guildCache.size < 1000) this.#guildCache.set(token, { at: Date.now(), guilds });
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
    if (this.#botGuilds && Date.now() - this.#botGuilds.at < 120_000) return this.#botGuilds.guilds;
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

  async memberRoles(token: string, guildId: string): Promise<readonly string[]> {
    if (!id(guildId)) throw new Error('Invalid guild');
    const data = (await this.request(`/users/@me/guilds/${guildId}/member`, token)) as { roles?: unknown };
    if (!Array.isArray(data.roles) || !data.roles.every(id)) throw new Error('Invalid Discord membership');
    return data.roles as string[];
  }

  async teamMember(userId: string, fresh = false): Promise<boolean> {
    if (!this.#team || fresh || Date.now() - this.#team.at > 120_000) {
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
