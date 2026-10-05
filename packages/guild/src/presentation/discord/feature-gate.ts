import type { FeatureGate } from '@picket/discord';
import type { GuildSettingsRepository } from '../../application/guild-settings-repository';
import { FEATURES, type Feature } from '../../domain/guild-settings';

const isFeature = (value: string): value is Feature => (FEATURES as readonly string[]).includes(value);

/** Une fonctionnalité inconnue est toujours refusée. */
export function createFeatureGate(settings: GuildSettingsRepository): FeatureGate {
  return {
    isEnabled: async (guildId, feature) => {
      if (!isFeature(feature)) return false;
      return (await settings.findOrCreate(guildId)).features[feature];
    },
  };
}
