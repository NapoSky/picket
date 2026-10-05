import { ephemeral, type CommandEntry } from '@picket/discord';
import type { MessageKey } from '@picket/i18n';
import { RoleId, type GuildId } from '@picket/kernel';
import type { ShowPermissions, UpdatePermissions } from '../../application/permissions-use-cases';
import { everyoneRoleId, type PermissionWarning } from '../../domain/permissions';

const WARNING_KEYS: Readonly<Record<PermissionWarning, MessageKey>> = {
  no_officer_role: 'permissions.warnings.no_officer_role',
  member_open_to_everyone: 'permissions.warnings.member_open_to_everyone',
};

function renderRole(guildId: GuildId, roleId: RoleId): string {
  return roleId === everyoneRoleId(guildId) ? '@everyone' : `<@&${roleId}>`;
}

function renderRoles(guildId: GuildId, roles: readonly RoleId[], empty: string): string {
  return roles.length === 0 ? empty : roles.map((role) => renderRole(guildId, role)).join(', ');
}

export function permissionsCommands(deps: { show: ShowPermissions; update: UpdatePermissions }): CommandEntry[] {
  const show: CommandEntry = {
    path: ['picket', 'permissions', 'show'],
    description: 'commands.picket.permissions.show.description',
    level: 'member',
    handler: async ({ interaction, guildId, t }) => {
      const overview = await deps.show.execute({
        guildId,
        roleIds: interaction.memberRoleIds,
        permissions: interaction.memberPermissions,
      });
      const lines = [
        t('permissions.show.level', { level: t(`levels.${overview.yourLevel ?? 'none'}`) }),
        t('permissions.show.officers', {
          roles: renderRoles(guildId, overview.config.officer, t('permissions.show.noOfficers')),
        }),
        t('permissions.show.members', {
          roles: renderRoles(guildId, overview.config.member, t('permissions.show.noMembers')),
        }),
      ];
      if (overview.warnings.length > 0) {
        lines.push(
          '',
          ...overview.warnings.map((warning) => t('permissions.show.warning', { text: t(WARNING_KEYS[warning]) })),
        );
      }
      return ephemeral(lines.join('\n'));
    },
  };

  const set: CommandEntry = {
    path: ['picket', 'permissions', 'set'],
    description: 'commands.picket.permissions.set.description',
    level: 'admin',
    options: [
      {
        type: 'string',
        name: 'level',
        description: 'commands.picket.permissions.set.options.level.description',
        required: true,
        choices: [
          { name: 'commands.picket.permissions.set.options.level.choices.officer', value: 'officer' },
          { name: 'commands.picket.permissions.set.options.level.choices.member', value: 'member' },
        ],
      },
      {
        type: 'role',
        name: 'role',
        description: 'commands.picket.permissions.set.options.role.description',
        required: true,
      },
      {
        type: 'string',
        name: 'action',
        description: 'commands.picket.permissions.set.options.action.description',
        required: true,
        choices: [
          { name: 'commands.picket.permissions.set.options.action.choices.add', value: 'add' },
          { name: 'commands.picket.permissions.set.options.action.choices.remove', value: 'remove' },
        ],
      },
      {
        type: 'boolean',
        name: 'confirm',
        description: 'commands.picket.permissions.set.options.confirm.description',
      },
    ],
    handler: async ({ interaction, guildId, t }) => {
      const { level, action, role, confirm } = interaction.options;
      if (level !== 'officer' && level !== 'member') return ephemeral(t('permissions.set.invalidLevel'));
      if (action !== 'add' && action !== 'remove') return ephemeral(t('permissions.set.invalidAction'));
      const roleId = RoleId.parse(role);
      if (!roleId.ok) return ephemeral(t('permissions.set.invalidRole'));

      const decision = await deps.update.execute({
        guildId,
        actorId: interaction.userId,
        change: { level, action, roleId: roleId.value, confirmed: confirm === true },
      });

      const params = { target: renderRole(guildId, roleId.value), level: t(`levels.${level}`) };
      switch (decision.kind) {
        case 'rejected':
          return ephemeral(t('permissions.set.everyoneNotOfficer'));
        case 'confirmation_required':
          return ephemeral(t('permissions.set.confirmationRequired'));
        case 'unchanged':
          return ephemeral(
            t(decision.reason === 'already_present' ? 'permissions.set.alreadyPresent' : 'permissions.set.notPresent', params),
          );
        case 'apply':
          return ephemeral(t(action === 'add' ? 'permissions.set.added' : 'permissions.set.removed', params));
      }
    },
  };

  return [show, set];
}
