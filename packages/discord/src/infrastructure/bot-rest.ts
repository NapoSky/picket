import { REST, type RESTOptions } from '@discordjs/rest';
import type { Secret } from '@picket/kernel';

export type DiscordBotRestClient = REST;

/** One authenticated counter per process, shared by every adapter and Gateway shard.
 * The deployment must budget for the maximum simultaneous replicas, including rollout.
 * Interaction webhooks deliberately keep a separate, unauthenticated client.
 */
export function createDiscordBotRest(token: Secret, options: Partial<RESTOptions> = {}): DiscordBotRestClient {
  return new REST({ version: '10', timeout: 10_000, retries: 2, globalRequestsPerSecond: 20, ...options })
    .setToken(token.reveal());
}
