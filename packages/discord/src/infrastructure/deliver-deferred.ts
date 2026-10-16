import type { Logger, OperationalMetrics } from '@picket/kernel';
import type { IncomingInteraction, Reply } from '../application/interaction';
import type { InteractionReplies } from '../application/messaging';

type Deferred = Extract<Reply, { kind: 'deferred' }>;

/**
 * Run deferred work after acknowledgement, then deliver the result. Never throws: if Discord refuses
 * delivery (expired token or deleted message), no further attempt is possible.
 */
export async function deliverDeferred(options: {
  readonly reply: Deferred;
  readonly interaction: IncomingInteraction;
  readonly replies: InteractionReplies;
  readonly logger: Logger;
  readonly metrics?: OperationalMetrics;
}): Promise<void> {
  const { reply, interaction, replies, logger } = options;
  const target = { applicationId: interaction.applicationId, token: interaction.token };
  const started = Date.now();
  let failed = false;
  try {
    const result = await reply.run();
    if (result?.kind === 'deleteOriginal') {
      await replies.deleteOriginal(target);
      return;
    }
    if (result?.kind === 'file') {
      const content = { content: result.content, file: result.file };
      if (reply.update) await replies.followUp(target, content);
      else await replies.editOriginal(target, content);
      return;
    }
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
    failed = true;
    logger.error({ err: error, guild_id: interaction.guildId, interaction_id: interaction.id }, 'deferred reply delivery failed');
  } finally {
    options.metrics?.record('deferred_delivery', (Date.now() - started) / 1000, failed ? 'error' : 'success', 'interactions');
  }
}
