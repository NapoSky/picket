import type { AccessPolicy } from '@picket/discord';
import type { ResolveAccess } from '../../application/permissions-use-cases';

/** Adapte le cas d'usage d'accès au port attendu par le pipeline d'interactions. */
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
