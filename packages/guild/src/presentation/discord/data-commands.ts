import { ephemeral, type CommandEntry, type GuildGate } from '@picket/discord';
import type {
  CancelGuildDeletion,
  GetSuspension,
  RequestGuildDeletion,
} from '../../application/guild-lifecycle-use-cases';

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

/** Les commandes d'une guilde suspendue sont refusées ; le pipeline affiche la date de suppression. */
export function createGuildGate(getSuspension: GetSuspension): GuildGate {
  return {
    suspensionOf: async (guildId) => {
      const purgeAt = await getSuspension.execute(guildId);
      return purgeAt === null ? null : { purgeAt };
    },
  };
}

export function dataCommands(deps: { request: RequestGuildDeletion; cancel: CancelGuildDeletion }): CommandEntry[] {
  const requestDeletion: CommandEntry = {
    path: ['picket', 'data', 'delete'],
    description: 'commands.picket.data.delete.description',
    level: 'admin',
    options: [
      {
        type: 'boolean',
        name: 'confirm',
        description: 'commands.picket.data.delete.options.confirm.description',
      },
    ],
    handler: async ({ interaction, guildId, t }) => {
      if (interaction.options['confirm'] !== true) {
        return ephemeral(t('data.confirmPrompt', { date: isoDate(deps.request.previewPurgeAt()) }));
      }
      const result = await deps.request.execute(guildId, interaction.userId);
      return ephemeral(
        t(result.alreadyScheduled ? 'data.alreadyScheduled' : 'data.scheduled', { date: isoDate(result.purgeAt) }),
      );
    },
  };

  const cancelDeletion: CommandEntry = {
    path: ['picket', 'data', 'cancel-deletion'],
    description: 'commands.picket.data.cancelDeletion.description',
    level: 'admin',
    availableWhenSuspended: true,
    handler: async ({ interaction, guildId, t }) =>
      ephemeral(
        t((await deps.cancel.execute(guildId, interaction.userId)) ? 'data.cancelled' : 'data.nothingScheduled'),
      ),
  };

  return [requestDeletion, cancelDeletion];
}
