import type { Logger } from '@picket/kernel';
import type { IncomingInteraction, Reply } from '../application/interaction';
import type { InteractionReplies } from '../application/messaging';

type Deferred = Extract<Reply, { kind: 'deferred' }>;

/**
 * Exécute le travail différé après l'accusé de réception puis livre le résultat. Ne lève jamais :
 * si Discord refuse la livraison (jeton expiré, message supprimé), il n'y a plus rien à tenter.
 */
export async function deliverDeferred(options: {
  readonly reply: Deferred;
  readonly interaction: IncomingInteraction;
  readonly replies: InteractionReplies;
  readonly logger: Logger;
}): Promise<void> {
  const { reply, interaction, replies, logger } = options;
  const target = { applicationId: interaction.applicationId, token: interaction.token };
  try {
    const result = await reply.run();
    if (result?.kind === 'panel') {
      if (reply.update && !result.update) await replies.followUp(target, result.panel);
      else await replies.editOriginal(target, result.panel);
      return;
    }
    const content = result?.kind === 'message' ? result.content : null;
    if (reply.update) {
      if (content !== null) await replies.followUp(target, content);
    } else if (content !== null) {
      await replies.editOriginal(target, content);
    } else {
      await replies.deleteOriginal(target);
    }
  } catch (error) {
    logger.error({ err: error }, 'deferred reply delivery failed');
  }
}
