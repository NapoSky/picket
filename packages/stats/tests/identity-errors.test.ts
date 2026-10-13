import { createDiscordBotRest } from '@picket/discord';
import { Secret } from '@picket/kernel';
import { DashboardDiscord, DashboardDiscordError } from '../src';

const guildId = '700000000000000001';
function provider(fetcher: typeof fetch) {
  return new DashboardDiscord('900000000000000001', 'secret', 'https://stats.example/auth/callback',
    createDiscordBotRest(new Secret('unused')), fetcher);
}

it.each([401, 403, 404, 429, 500])('keeps Discord membership status %i without retaining credentials or response bodies', async status => {
  const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockImplementation(async () =>
    new Response(JSON.stringify({ message: 'private-response', code: 0 }), { status, headers: {
      'Content-Type': 'application/json', ...(status === 429 ? { 'Retry-After': '60' } : {}),
    } }));
  const identity = provider(fetcher);
  const error = await identity.memberRoles('private-token', guildId).catch(value => value);
  expect(error).toBeInstanceOf(DashboardDiscordError);
  expect(error).toMatchObject({ operation: 'membership', upstreamStatus: status });
  expect(error.statusCode).toBe(status === 401 ? 401 : status === 403 || status === 404 ? 403 : undefined);
  expect(JSON.stringify(error)).not.toMatch(/private-token|private-response/);
});

it.each(['TimeoutError', 'TypeError'])('classifies %s without logging the original fetch error', async name => {
  const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockRejectedValue(Object.assign(new Error('private-token'), { name }));
  await expect(provider(fetcher).guilds('private-token')).rejects.toMatchObject({
    operation: 'guilds', upstreamFailure: name === 'TimeoutError' ? 'timeout' : 'network',
  });
});
