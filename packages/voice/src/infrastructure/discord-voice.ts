import { channelPermissions, type DiscordBotRestClient } from '@picket/discord';
import type { GuildId } from '@picket/kernel';
import type {
  ManagedVoiceChannel,
  VoiceDiscord,
  VoiceIdentity,
} from '../application/ports';
import { VoiceError, type TemplateInput } from '../domain/model';
interface Channel {
  id: string;
  guild_id: string;
  type: number;
  position?: number;
  parent_id?: string | null;
  permission_overwrites?: {
    id: string;
    type: number;
    allow: string;
    deny: string;
  }[];
}
interface Member {
  roles: string[];
  communication_disabled_until?: string | null;
}
interface Role {
  id: string;
  permissions: string;
}
const missing = (error: unknown) => (error as { code?: number }).code === 10003;
const VIEW_CHANNEL = 1n << 10n,
  MANAGE_CHANNELS = 1n << 4n,
  MEMBER_CONNECT = 1n << 20n;
export class DiscordVoice implements VoiceDiscord {
  private categories = new Map<string, { until: number; channel: Channel }>();
  private members = new Map<string, { until: number; member: Member }>();
  private async categoryValue(id: string, fresh: boolean): Promise<Channel> {
    const cached = this.categories.get(id);
    if (!fresh && cached && cached.until > Date.now()) return cached.channel;
    const channel = (await this.rest.get(`/channels/${id}`)) as Channel;
    if (this.categories.size >= 3000) this.categories.clear();
    this.categories.set(id, { until: Date.now() + 30_000, channel });
    return channel;
  }
  private async memberValue(
    guildId: string,
    userId: string,
    fresh: boolean,
  ): Promise<Member> {
    const key = `${guildId}:${userId}`,
      cached = this.members.get(key);
    if (!fresh && cached && cached.until > Date.now()) return cached.member;
    const member = (await this.rest.get(
      `/guilds/${guildId}/members/${userId}`,
    )) as Member;
    if (this.members.size >= 3000) this.members.clear();
    this.members.set(key, { until: Date.now() + 30_000, member });
    return member;
  }
  private identity: Promise<string> | undefined;
  private roles = new Map<
    string,
    { until: number; roles: Role[]; bot: Member; botId: string }
  >();
  constructor(
    private readonly rest: DiscordBotRestClient,
    private readonly createRest: DiscordBotRestClient = rest,
  ) {}
  private async context(guildId: GuildId, fresh = false) {
    const cached = this.roles.get(guildId);
    if (!fresh && cached && cached.until > Date.now()) return cached;
    this.identity ??= (this.rest.get('/users/@me') as Promise<{ id: string }>)
      .then((x) => x.id)
      .catch((e) => {
        this.identity = undefined;
        throw e;
      });
    const botId = await this.identity;
    const [roles, bot] = await Promise.all([
      this.rest.get(`/guilds/${guildId}/roles`) as Promise<Role[]>,
      this.rest.get(`/guilds/${guildId}/members/${botId}`) as Promise<Member>,
    ]);
    const result = { until: Date.now() + 30_000, roles, bot, botId };
    if (this.roles.size >= 1000) this.roles.clear();
    this.roles.set(guildId, result);
    return result;
  }
  async category(
    guildId: GuildId,
    categoryId: string,
    identity?: VoiceIdentity,
    fresh = false,
  ): Promise<void> {
    try {
      const [channel, ctx] = await Promise.all([
        this.categoryValue(categoryId, fresh),
        this.context(guildId, fresh),
      ]);
      if (channel.guild_id !== guildId || channel.type !== 4)
        throw new VoiceError('access');
      const perms = channelPermissions(
        guildId,
        ctx.botId,
        ctx.bot.roles,
        ctx.roles,
        channel.permission_overwrites ?? [],
      );
      if (
        (perms & (VIEW_CHANNEL | MANAGE_CHANNELS)) !==
        (VIEW_CHANNEL | MANAGE_CHANNELS)
      )
        throw new VoiceError('access'); // View Channel + Manage Channels; never request Connect.
      if (identity) {
        const member = await this.memberValue(guildId, identity.userId, fresh);
        const p = channelPermissions(
          guildId,
          identity.userId,
          member.roles,
          ctx.roles,
          channel.permission_overwrites ?? [],
        );
        if (
          (p & (VIEW_CHANNEL | MEMBER_CONNECT)) !==
            (VIEW_CHANNEL | MEMBER_CONNECT) ||
          (member.communication_disabled_until &&
            Date.parse(member.communication_disabled_until) > Date.now())
        )
          throw new VoiceError('access');
      }
    } catch (e) {
      if (e instanceof VoiceError) throw e;
      throw new VoiceError(
        (e as { status?: number }).status === 403 || missing(e)
          ? 'access'
          : 'unavailable',
      );
    }
  }
  async create(
    guildId: GuildId,
    input: TemplateInput,
    name: string,
  ): Promise<string> {
    // This client has retries=0: a lost POST response must become uncertain, never a duplicate channel.
    const channel = (await this.createRest.post(`/guilds/${guildId}/channels`, {
      body: {
        type: 2,
        name,
        parent_id: input.categoryId,
        user_limit: input.capacity,
      },
    })) as Channel;
    if (channel.guild_id !== guildId || channel.type !== 2)
      throw new Error('Unexpected voice creation response');
    return channel.id;
  }
  async exists(guildId: GuildId, channelId: string): Promise<boolean> {
    try {
      const c = (await this.rest.get(`/channels/${channelId}`)) as Channel;
      if (c.guild_id !== guildId || c.type !== 2)
        throw new VoiceError('access');
      return true;
    } catch (e) {
      if (missing(e)) return false;
      throw e;
    }
  }
  async orderChannels(
    guildId: GuildId,
    managed: readonly ManagedVoiceChannel[],
  ): Promise<void> {
    const categories = new Map<string, number>();
    for (const channel of managed)
      categories.set(
        channel.categoryId,
        (categories.get(channel.categoryId) ?? 0) + 1,
      );
    if (![...categories.values()].some((count) => count > 1)) return;

    // Read current positions only when reconciliation is pending; never poll an idle guild.
    const channels = (await this.rest.get(
      `/guilds/${guildId}/channels`,
    )) as Channel[];
    if (
      channels.some(
        (channel) => channel.guild_id && channel.guild_id !== guildId,
      )
    )
      throw new Error('Unexpected guild channel response');
    const compareId = (a: string, b: string) =>
      a.length - b.length || a.localeCompare(b);
    const current = channels
      .filter((channel) => channel.type === 2 || channel.type === 13)
      .sort(
        (a, b) =>
          (a.position ?? 0) - (b.position ?? 0) || compareId(a.id, b.id),
      );
    const known = new Map(
      managed.map((channel) => [channel.channelId, channel]),
    );
    const collator = new Intl.Collator('en', {
      numeric: true,
      sensitivity: 'base',
    });
    const templateNames = new Map<string, string>();
    for (const channel of managed) {
      const previous = templateNames.get(channel.templateId);
      if (
        previous === undefined ||
        collator.compare(channel.templateName, previous) < 0
      )
        templateNames.set(channel.templateId, channel.templateName);
    }
    const desired = [...current];
    const changed = new Set<string>();
    for (const [categoryId, count] of categories) {
      if (count < 2) continue;
      const slots = current.flatMap((channel, index) => {
        const entry = known.get(channel.id);
        return channel.type === 2 &&
          channel.parent_id === categoryId &&
          entry?.categoryId === categoryId
          ? [index]
          : [];
      });
      const sorted = slots
        .map((index) => current[index]!)
        .sort((a, b) => {
          const left = known.get(a.id)!,
            right = known.get(b.id)!;
          const leftNumber = / · (\d+)$/.exec(left.name)?.[1];
          const rightNumber = / · (\d+)$/.exec(right.name)?.[1];
          return (
            collator.compare(
              templateNames.get(left.templateId)!,
              templateNames.get(right.templateId)!,
            ) ||
            compareId(left.templateId, right.templateId) ||
            (leftNumber && rightNumber
              ? collator.compare(leftNumber, rightNumber)
              : 0) ||
            collator.compare(left.name, right.name) ||
            compareId(a.id, b.id)
          );
        });
      slots.forEach((index, offset) => {
        desired[index] = sorted[offset]!;
        if (current[index]!.id !== desired[index]!.id) changed.add(categoryId);
      });
    }
    if (!changed.size) return;
    // Preserve every other voice/stage channel's slot. Include the affected category's
    // siblings so tied Discord positions also become a deterministic, unique order.
    const positions = desired.flatMap((channel, position) =>
      channel.parent_id && changed.has(channel.parent_id)
        ? [{ id: channel.id, position }]
        : [],
    );
    await this.rest.patch(`/guilds/${guildId}/channels`, { body: positions });
  }
  async remove(channelId: string): Promise<void> {
    try {
      await this.rest.delete(`/channels/${channelId}`);
    } catch (e) {
      if (!missing(e)) throw e;
    }
  }
}
