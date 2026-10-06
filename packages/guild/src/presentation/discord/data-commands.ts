import type { GuildGate } from '@picket/discord';
import type { GetSuspension } from '../../application/guild-lifecycle-use-cases';

/** Les commandes d'une guilde suspendue sont refusées ; le pipeline affiche la date de suppression. */
export function createGuildGate(getSuspension: GetSuspension): GuildGate {
  return {
    suspensionOf: async (guildId) => {
      const purgeAt = await getSuspension.execute(guildId);
      return purgeAt === null ? null : { purgeAt };
    },
  };
}
