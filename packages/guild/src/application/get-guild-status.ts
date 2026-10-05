import type { GuildId } from '@picket/kernel';
import { enabledFeatures, type Feature } from '../domain/guild-settings';
import type { GuildSettingsRepository } from './guild-settings-repository';

export interface GuildStatus {
  readonly locale: string | null;
  readonly timezone: string;
  readonly enabledFeatures: readonly Feature[];
  readonly auditChannelConfigured: boolean;
}

export class GetGuildStatus {
  readonly #repository: GuildSettingsRepository;

  constructor(repository: GuildSettingsRepository) {
    this.#repository = repository;
  }

  async execute(guildId: GuildId): Promise<GuildStatus> {
    const settings = await this.#repository.findOrCreate(guildId);
    return {
      locale: settings.locale,
      timezone: settings.timezone,
      enabledFeatures: enabledFeatures(settings),
      auditChannelConfigured: settings.auditChannelId !== null,
    };
  }
}
