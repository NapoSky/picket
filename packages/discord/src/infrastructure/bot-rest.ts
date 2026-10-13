import { REST, DefaultRestOptions, type RESTOptions } from '@discordjs/rest';
import type { Secret } from '@picket/kernel';

export type DiscordBotRestClient = REST;

/** One authenticated counter per process, shared by every adapter and Gateway shard.
 * The deployment must budget for the maximum simultaneous replicas, including rollout.
 * Interaction webhooks deliberately keep a separate, unauthenticated client.
 */
export function createDiscordBotRest(token: Secret, options: Partial<RESTOptions> = {}, budget?: { acquire(): Promise<void> }): DiscordBotRestClient {
  const request = options.makeRequest ?? DefaultRestOptions.makeRequest;
  return new REST({ version: '10', timeout: 10_000, retries: 2, globalRequestsPerSecond: 20, ...options,
    ...(budget ? { makeRequest: async (url, init) => { await budget.acquire(); return request(url, init); } } : {}),
  })
    .setToken(token.reveal());
}
