import type { AccessPolicy } from '@picket/discord';
import type { ResolveAccess } from '../../application/permissions-use-cases';

/** Adapt the access use case to the interaction pipeline's port. */
export function createGuildAccessPolicy(resolveAccess: ResolveAccess): AccessPolicy {
  return {
    levelOf: (interaction, guildId) =>
      resolveAccess.execute({
        guildId,
        roleIds: interaction.memberRoleIds,
        permissions: interaction.memberPermissions,
      }),
  };
}
