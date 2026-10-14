import type { GuildGate } from '@picket/discord';
import type { GetSuspension } from '../../application/guild-lifecycle-use-cases';

/** Reject commands for suspended guilds; the pipeline displays the deletion date. */
export function createGuildGate(getSuspension: GetSuspension): GuildGate {
  return {
    suspensionOf: async (guildId) => {
      const purgeAt = await getSuspension.execute(guildId);
      return purgeAt === null ? null : { purgeAt };
    },
  };
}
