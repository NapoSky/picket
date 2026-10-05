import Fastify, { type FastifyInstance } from 'fastify';
import { InteractionType, type APIInteraction } from 'discord-api-types/v10';
import type { Clock, Logger } from '@picket/kernel';
import type { InteractionPipeline } from '../application/pipeline';
import type { InteractionReplies } from '../application/messaging';
import { deliverDeferred } from './deliver-deferred';
import { toIncomingInteraction } from './interaction-mapper';
import { toWireResponse } from './reply-mapper';
import { createSignatureVerifier, isTimestampFresh } from './signature';

export interface InteractionServerOptions {
  readonly publicKey: string;
  readonly pipeline: InteractionPipeline;
  readonly replies: InteractionReplies;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly timestampToleranceSeconds?: number;
}

const BODY_LIMIT_BYTES = 256 * 1024;
const DEFAULT_TOLERANCE_SECONDS = 300;

export function createInteractionServer(options: InteractionServerOptions): FastifyInstance {
  const verifySignature = createSignatureVerifier(options.publicKey);
  const tolerance = options.timestampToleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const inFlight = new Set<Promise<void>>();

  const app = Fastify({
    logger: false,
    bodyLimit: BODY_LIMIT_BYTES,
    requestTimeout: 10_000,
    // Plus long que le délai d'inactivité des connexions du reverse proxy (Traefik : 90 s), sinon 502 intermittents.
    keepAliveTimeout: 120_000,
  });

  // Corps brut indispensable : la signature porte sur les octets reçus.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  app.post('/interactions', async (request, reply) => {
    const signature = request.headers['x-signature-ed25519'];
    const timestamp = request.headers['x-signature-timestamp'];
    const body = request.body;

    if (
      typeof signature !== 'string' ||
      typeof timestamp !== 'string' ||
      !Buffer.isBuffer(body) ||
      !isTimestampFresh(timestamp, options.clock.now().getTime(), tolerance) ||
      !verifySignature(signature, timestamp, body)
    ) {
      return reply.code(401).send({ error: 'invalid request signature' });
    }

    let payload: APIInteraction;
    try {
      payload = JSON.parse(body.toString('utf8')) as APIInteraction;
    } catch {
      return reply.code(400).send({ error: 'invalid json' });
    }

    if (payload.type === InteractionType.Ping) {
      return reply.code(200).send({ type: 1 });
    }

    const interaction = toIncomingInteraction(payload);
    if (!interaction.ok) {
      options.logger.warn({ reason: interaction.error.message }, 'rejected malformed interaction');
      return reply.code(400).send({ error: 'invalid interaction' });
    }

    const response = await options.pipeline.handle(interaction.value);
    if (response.kind === 'deferred') {
      // Livrer avant que Discord ait reçu l'accusé échouerait : on attend la fin de la réponse HTTP. Le travail
      // continue ensuite sans elle ; l'arrêt de la réplique l'attend (hook `onClose`).
      const acknowledged = new Promise<void>((resolve) => reply.raw.once('close', resolve));
      const work: Promise<void> = acknowledged
        .then(() =>
          deliverDeferred({
            reply: response,
            interaction: interaction.value,
            replies: options.replies,
            logger: options.logger,
          }),
        )
        .finally(() => inFlight.delete(work));
      inFlight.add(work);
    }
    return reply.code(200).send(toWireResponse(response));
  });

  app.addHook('onClose', async () => {
    await Promise.allSettled([...inFlight]);
  });

  return app;
}
