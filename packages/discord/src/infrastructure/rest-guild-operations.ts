import { Routes, ChannelType, type APIChannel, type RESTGetCurrentApplicationResult, type APIGuild } from 'discord-api-types/v10';
import { ChannelId, GuildId, UserId } from '@picket/kernel';
import type { GuildOperationsDiscord, OperatorScope } from '../application/guild-operations';
import { DiscordAPIError, type DiscordBotRestClient } from './bot-rest';

export class DiscordRestGuildOperations implements GuildOperationsDiscord {
  private cached: { scope: OperatorScope; until: number } | undefined;
  constructor(private readonly rest: DiscordBotRestClient, private readonly departureRest?: DiscordBotRestClient) {}

  async scope(channelId: ChannelId, fresh = false): Promise<OperatorScope> {
    if (!fresh && this.cached?.scope.channelId === channelId && this.cached.until > Date.now()) return this.cached.scope;
    const [channel, application] = await Promise.all([
      this.rest.get(Routes.channel(channelId)) as Promise<APIChannel>,
      this.rest.get(Routes.currentApplication()) as Promise<RESTGetCurrentApplicationResult>,
    ]);
    if (!('guild_id' in channel) || !channel.guild_id ||
      ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
      throw new Error('Operator channel must be a server text or announcement channel');
    }
    const ownerId = application.team?.owner_user_id ?? application.owner?.id;
    if (!ownerId) throw new Error('Application owner unavailable');
    const owner = application.team
      ? application.team.members.find(member => member.user.id === ownerId)?.user
      : application.owner;
    if (!owner?.username) throw new Error('Application owner identity unavailable');
    const scope: OperatorScope = {
      guildId: GuildId.assert(channel.guild_id), channelId, ownerId: UserId.assert(ownerId),
      ownerName: owner.global_name || owner.username,
    };
    this.cached = { scope, until: Date.now() + 30_000 };
    return scope;
  }

  async guild(guildId: GuildId): Promise<{ name: string } | null> {
    try {
      const guild = await this.rest.get(Routes.guild(guildId)) as APIGuild;
      return { name: guild.name };
    } catch (error) {
      if (error instanceof DiscordAPIError && error.code === 10004) return null;
      throw error;
    }
  }

  async leave(guildId: GuildId, notAfter?: Date): Promise<void> {
    // No automatic retry: a lost response must never remove a subsequent reinstallation.
    if (!this.departureRest || this.departureRest.options.retries !== 0) throw new Error('A non-retrying REST client is required for departures');
    const remaining = notAfter ? notAfter.getTime() - Date.now() : 10_000;
    if (remaining <= 0) throw new Error('Departure confirmation expired before dispatch');
    await this.departureRest.delete(Routes.userGuild(guildId), { signal: AbortSignal.timeout(Math.min(10_000, remaining)) });
  }
}
