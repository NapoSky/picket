import { ephemeral, type CommandEntry, type RootDescriptor } from '@picket/discord';
import type { GetGuildStatus } from '../../application/get-guild-status';

export const PICKET_ROOT: RootDescriptor = {
  name: 'picket',
  description: 'commands.picket.description',
  groups: {
    permissions: 'commands.picket.groups.permissions',
    settings: 'commands.picket.groups.settings',
    data: 'commands.picket.groups.data',
  },
};

export function statusCommand(useCase: GetGuildStatus): CommandEntry {
  return {
    path: ['picket', 'status'],
    description: 'commands.picket.status.description',
    level: 'member',
    handler: async ({ guildId, t }) => {
      const status = await useCase.execute(guildId);
      const features =
        status.enabledFeatures.length > 0 ? status.enabledFeatures.join(', ') : t('levels.none');
      return ephemeral(
        t('status.body', {
          locale: status.locale ?? t('status.languageAuto'),
          timezone: status.timezone,
          features,
          audit: t(status.auditChannelConfigured ? 'status.auditConfigured' : 'status.auditMissing'),
        }),
      );
    },
  };
}
