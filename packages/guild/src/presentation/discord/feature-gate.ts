import type { FeatureGate } from '@picket/discord';
import type { GuildSettingsRepository } from '../../application/guild-settings-repository';
import { FEATURES, type Feature } from '../../domain/guild-settings';

const isFeature = (value: string): value is Feature => (FEATURES as readonly string[]).includes(value);

/** Always reject an unknown feature. */
export function createFeatureGate(settings: GuildSettingsRepository): FeatureGate {
  return {
    isEnabled: async (guildId, feature) => {
      if (!isFeature(feature)) return false;
      return (await settings.findOrCreate(guildId)).features[feature] ?? false;
    },
  };
}
