import { REST, DefaultRestOptions, type RESTOptions } from '@discordjs/rest';
import type { Secret, OperationalMetrics, MetricComponent } from '@picket/kernel';

export type DiscordBotRestClient = REST;
export type DiscordOAuthRestClient = REST;
export { DiscordAPIError, HTTPError, RateLimitError } from '@discordjs/rest';

/** Each OAuth token has its own quota; never share a mutable bot client with it. */
export function createDiscordOAuthRest(token: Secret, options: Partial<RESTOptions> = {}, metrics?: OperationalMetrics): DiscordOAuthRestClient {
  return new REST({ version: '10', authPrefix: 'Bearer', timeout: 8_000, retries: 2,
    globalRequestsPerSecond: 20, ...instrumentRestOptions(options, metrics, 'oauth') }).setToken(token.reveal());
}

/** Records each actual attempt, including retries and HTTP 429; never records URLs or bodies. */
export function instrumentRestOptions(options: Partial<RESTOptions>, metrics?: OperationalMetrics,
  component: MetricComponent = 'bot', budget?: { acquire(): Promise<void> }): Partial<RESTOptions> {
  const request = options.makeRequest ?? DefaultRestOptions.makeRequest;
  if (!metrics && !budget) return options;
  return { ...options, makeRequest: async (url, init) => {
    if (budget) {
      const waiting = Date.now();
      try { await budget.acquire(); metrics?.record('discord_budget', (Date.now() - waiting) / 1000, 'success', component); }
      catch (error) { metrics?.record('discord_budget', (Date.now() - waiting) / 1000, 'error', component); throw error; }
    }
    init.signal?.throwIfAborted();
    const started = Date.now();
    try {
      const response = await request(url, init);
      metrics?.record('discord_rest', (Date.now() - started) / 1000,
        response.status === 429 ? 'limited' : response.status >= 400 ? 'error' : 'success', component);
      return response;
    } catch (error) {
      metrics?.record('discord_rest', (Date.now() - started) / 1000, 'error', component);
      throw error;
    }
  } };
}

/** One authenticated counter per process, shared by every adapter and Gateway shard.
 * The deployment must budget for the maximum simultaneous replicas, including rollout.
 * Interaction webhooks deliberately keep a separate, unauthenticated client.
 */
export function createDiscordBotRest(token: Secret, options: Partial<RESTOptions> = {}, budget?: { acquire(): Promise<void> }, metrics?: OperationalMetrics): DiscordBotRestClient {
  return new REST({ version: '10', timeout: 10_000, retries: 2, globalRequestsPerSecond: 20,
    ...instrumentRestOptions(options, metrics, 'bot', budget) })
    .setToken(token.reveal());
}
