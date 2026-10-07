import { REST, type RESTOptions } from '@discordjs/rest';
import { ChannelType, PermissionFlagsBits, Routes, type APIChannel, type APIGuild, type APIGuildMember, type APIRole, type APIUser } from 'discord-api-types/v10';
import { UserId, type ChannelId, type GuildId, type Secret } from '@picket/kernel';
import { channelPermissions, type AuditChannelAccess, type GuildChannels } from '../application/guild-channels';
import { mapRestError } from './rest-messaging';

export class DiscordRestGuildChannels implements GuildChannels {
  readonly #rest: REST;
  #identity: Promise<string> | undefined;
  constructor(token: Secret, options: Partial<RESTOptions> = {}) {
    this.#rest = new REST({ version: '10', timeout: 10_000, retries: 2, ...options }).setToken(token.reveal());
  }
  async inspect(guildId: GuildId, channelId: ChannelId): Promise<AuditChannelAccess> {
    try {
      const channel = await this.#rest.get(Routes.channel(channelId)) as APIChannel;
      if (!('guild_id' in channel) || channel.guild_id !== guildId) return { kind: 'blocked', reason: 'wrong_guild' };
      if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) return { kind: 'blocked', reason: 'unsupported_channel' };
      this.#identity ??= (this.#rest.get(Routes.user('@me')) as Promise<APIUser>).then((user) => UserId.assert(user.id)).catch((error: unknown) => { this.#identity = undefined; throw error; });
      const userId = await this.#identity;
      const [member, roles, guild] = await Promise.all([
        this.#rest.get(Routes.guildMember(guildId, userId)) as Promise<APIGuildMember>,
        this.#rest.get(Routes.guildRoles(guildId)) as Promise<APIRole[]>,
        this.#rest.get(Routes.guild(guildId)) as Promise<APIGuild>,
      ]);
      const required = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.EmbedLinks;
      const actual = channelPermissions(guildId, userId, member.roles, roles, channel.permission_overwrites ?? []);
      if ((actual & required) !== required || (member.communication_disabled_until && new Date(member.communication_disabled_until).getTime() > Date.now())) return { kind: 'blocked', reason: 'missing_permissions' };
      return { kind: 'ready', locale: guild.preferred_locale ?? null };
    } catch (error) {
      const mapped = mapRestError(error);
      if (mapped.reason === 'unknown_channel' || mapped.reason === 'missing_access' || mapped.reason === 'missing_permissions') return { kind: 'blocked', reason: mapped.reason };
      throw mapped;
    }
  }
}
