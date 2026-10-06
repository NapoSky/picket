import { ephemeral, type CommandEntry, type RootDescriptor } from '@picket/discord';
import type { ShowPermissions } from '../../application/permissions-use-cases';
import type { GetGuildStatus } from '../../application/get-guild-status';

export const PICKET_ROOT: RootDescriptor = {
  name: 'picket',
  description: 'commands.picket.description',
};

export function statusCommand(useCase: GetGuildStatus, permissions: ShowPermissions): CommandEntry {
  return {
    path: ['picket', 'status'],
    description: 'commands.picket.status.description',
    level: 'member',
    handler: async ({ guildId, interaction, t }) => {
      const status = await useCase.execute(guildId);
      const features =
        status.enabledFeatures.some((feature) => feature !== 'warlog') ? status.enabledFeatures.filter((feature) => feature !== 'warlog').join(', ') : t('levels.none');
      const overview = await permissions.execute({ guildId, roleIds: interaction.memberRoleIds, permissions: interaction.memberPermissions });
      const roles = (values: readonly string[]) => values.length === 0 ? t('levels.none') : values.slice(0, 25).map((role) => role === guildId ? '@everyone' : `<@&${role}>`).join(', ') + (values.length > 25 ? ` (+${values.length - 25})` : '');
      return ephemeral([
        t('status.body', {
          locale: status.locale ?? t('status.languageAuto'),
          timezone: status.timezone,
          features,
          audit: t(status.auditChannelConfigured ? 'status.auditConfigured' : 'status.auditMissing'),
        }),
        t('panel.statusReserved'),
        t('permissions.show.level', { level: t(`levels.${overview.yourLevel ?? 'none'}`) }),
        t('permissions.show.officers', { roles: overview.config.officer.length === 0 ? t('permissions.show.noOfficers') : roles(overview.config.officer) }),
        t('permissions.show.members', { roles: roles(overview.config.member) }),
        ...overview.warnings.map((warning) => t(`permissions.warnings.${warning}`)),
      ].join('\n'));
    },
  };
}
