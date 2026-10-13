import { REST, DefaultRestOptions, type RESTOptions } from '@discordjs/rest';
import type { Secret } from '@picket/kernel';

export type DiscordBotRestClient = REST;
export type DiscordOAuthRestClient = REST;
export { DiscordAPIError, HTTPError, RateLimitError } from '@discordjs/rest';

/** Each OAuth token has its own quota; never share a mutable bot client with it. */
export function createDiscordOAuthRest(token: Secret, options: Partial<RESTOptions> = {}): DiscordOAuthRestClient {
  return new REST({ version: '10', authPrefix: 'Bearer', timeout: 8_000, retries: 2,
    globalRequestsPerSecond: 20, ...options }).setToken(token.reveal());
}

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
