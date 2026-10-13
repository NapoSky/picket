import type { GuildChannels } from '@picket/discord';
import type { Clock, GuildId, UserId } from '@picket/kernel';
import type { SettingsChange, SettingsResult, WarStore } from './ports';

export class ConfigureWarLog {
  constructor(private readonly store: WarStore, private readonly channels: GuildChannels, private readonly clock: Clock) {}
  async execute(guildId: GuildId, actor: UserId, change: SettingsChange): Promise<SettingsResult | 'channel_blocked' | 'channel_unavailable'> {
    let channel = change.kind === 'channel' ? change.channelId : null;
    if (change.kind === 'enable') channel = (await this.store.subscription(guildId)).channelId;
    if (channel) {
      try { if ((await this.channels.inspect(guildId, channel, { textOnly: true })).kind === 'blocked') return 'channel_blocked'; }
      catch { return 'channel_unavailable'; }
    }
    return this.store.configure(guildId, actor, change, this.clock.now());
  }
}
