import { createDiscordBotRest } from '@picket/discord';
import { Secret } from '@picket/kernel';
import { DashboardDiscord, DashboardDiscordError } from '../src';

const G = '700000000000000001', R = '400000000000000001', O = '400000000000000002';
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const fetcher = () => jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
const provider = (requester: typeof fetch) => new DashboardDiscord('900000000000000001', 'secret',
  'https://stats.example/auth/callback', createDiscordBotRest(new Secret('unused')), requester);

it('lets the native REST client wait and recover from a short Discord 429', async () => {
  const fetch = fetcher().mockResolvedValueOnce(json({ retry_after: 0.02, global: false }, 429, {
    'Retry-After': '0.02', 'X-RateLimit-Limit': '1', 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': '0.02',
  })).mockResolvedValueOnce(json({ roles: [R] }));
  const started = Date.now();
  expect(await provider(fetch).memberRoles('oauth-token', G)).toEqual([R]);
  expect(Date.now() - started).toBeGreaterThanOrEqual(20);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(new Headers(fetch.mock.calls[0]![1]!.headers).get('Authorization')).toBe('Bearer oauth-token');
});

it('remembers a long cooldown without sending more requests and keeps OAuth token quotas separate', async () => {
  const fetch = fetcher().mockResolvedValueOnce(json({ retry_after: 60, global: false }, 429, { 'Retry-After': '60' }))
    .mockResolvedValueOnce(json({ roles: [R] })).mockResolvedValueOnce(json({ roles: [O] }));
  const identity = provider(fetch);
  await expect(identity.memberRoles('limited-token', G)).rejects.toMatchObject({ upstreamStatus: 429, retryAfterSeconds: 61 });
  await expect(identity.memberRoles('limited-token', G)).rejects.toBeInstanceOf(DashboardDiscordError);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await identity.memberRoles('other-token', G)).toEqual([R]);
  expect(fetch).toHaveBeenCalledTimes(2);
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_001);
  expect(await identity.memberRoles('limited-token', G)).toEqual([O]);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('uses successful-response rate headers to wait before sending another membership check', async () => {
  const fetch = fetcher().mockResolvedValueOnce(json({ roles: [R] }, 200, {
    'X-RateLimit-Limit': '1', 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': '0.03',
  })).mockResolvedValueOnce(json({ roles: [R] }));
  const identity = provider(fetch);
  expect(await identity.memberRoles('token', G, true)).toEqual([R]);
  const started = Date.now();
  expect(await identity.memberRoles('token', G, true)).toEqual([R]);
  expect(Date.now() - started).toBeGreaterThanOrEqual(30);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('applies a global cooldown to every OAuth operation for that token', async () => {
  const fetch = fetcher().mockResolvedValueOnce(json({ retry_after: 60, global: true }, 429, {
    'Retry-After': '60', 'X-RateLimit-Global': 'true',
  }));
  const identity = provider(fetch);
  await expect(identity.memberRoles('token', G)).rejects.toMatchObject({ upstreamStatus: 429 });
  await expect(identity.guilds('token', true)).rejects.toMatchObject({ operation: 'guilds', upstreamStatus: 429 });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('coalesces concurrent membership checks, caches reads and forces fresh checks for exports', async () => {
  const fetch = fetcher().mockResolvedValueOnce(json({ roles: [R, O] })).mockResolvedValueOnce(json({ roles: [R] }));
  const identity = provider(fetch);
  expect(await Promise.all([identity.memberRoles('token', G), identity.memberRoles('token', G)]))
    .toEqual([[R, O], [R, O]]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await identity.memberRoles('token', G)).toEqual([R, O]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await identity.memberRoles('token', G, true)).toEqual([R]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('expires cached roles after five minutes without extending their lifetime on reads', async () => {
  const fetch = fetcher().mockResolvedValueOnce(json({ roles: [R, O] })).mockResolvedValueOnce(json({ roles: [R] }));
  const identity = provider(fetch);
  const instant = Date.now();
  expect(await identity.memberRoles('token', G)).toEqual([R, O]);
  jest.spyOn(Date, 'now').mockReturnValue(instant + 299_000);
  expect(await identity.memberRoles('token', G)).toEqual([R, O]);
  expect(fetch).toHaveBeenCalledTimes(1);
  jest.spyOn(Date, 'now').mockReturnValue(instant + 301_000);
  expect(await identity.memberRoles('token', G)).toEqual([R]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('isolates role caches by token and guild and invalidates all cached rights on a revoked token', async () => {
  const otherGuild = '700000000000000002';
  const fetch = fetcher().mockResolvedValueOnce(json({ roles: [R] })).mockResolvedValueOnce(json({ roles: [O] }))
    .mockResolvedValueOnce(json({ roles: [] })).mockResolvedValueOnce(json({ message: 'revoked', code: 0 }, 401));
  const identity = provider(fetch);
  expect(await identity.memberRoles('token', G)).toEqual([R]);
  expect(await identity.memberRoles('token', otherGuild)).toEqual([O]);
  expect(await identity.memberRoles('other-token', G)).toEqual([]);
  await expect(identity.memberRoles('token', G, true)).rejects.toMatchObject({ upstreamStatus: 401 });
  await expect(identity.memberRoles('token', otherGuild)).rejects.toMatchObject({ upstreamStatus: 401 });
  await expect(identity.guilds('token')).rejects.toMatchObject({ upstreamStatus: 401 });
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(await identity.memberRoles('other-token', G)).toEqual([]);
});

it.each([403, 404, 500])('does not reuse old roles after a fresh check fails with %i', async status => {
  const fetch = fetcher().mockResolvedValueOnce(json({ roles: [R, O] }))
    .mockImplementation(async () => json({ message: 'failed', code: 0 }, status));
  const identity = provider(fetch);
  expect(await identity.memberRoles('token', G)).toEqual([R, O]);
  await expect(identity.memberRoles('token', G, true)).rejects.toMatchObject({ upstreamStatus: status });
  await expect(identity.memberRoles('token', G)).rejects.toMatchObject({ upstreamStatus: status });
});

it('fails closed when the role cache expires during a Discord outage', async () => {
  const fetch = fetcher().mockResolvedValueOnce(json({ roles: [R] })).mockRejectedValue(new TypeError('network'));
  const identity = provider(fetch);
  const instant = Date.now();
  await identity.memberRoles('token', G);
  jest.spyOn(Date, 'now').mockReturnValue(instant + 301_000);
  await expect(identity.memberRoles('token', G)).rejects.toMatchObject({ upstreamFailure: 'network' });
});

it('keeps failures out of the in-flight cache and preserves fresh OAuth guild queries', async () => {
  const fetch = fetcher().mockResolvedValueOnce(json({ message: 'revoked', code: 0 }, 401))
    .mockResolvedValueOnce(json([{ id: G, name: 'Regiment', permissions: '0' }]))
    .mockResolvedValueOnce(json([]));
  const identity = provider(fetch);
  await expect(identity.guilds('token')).rejects.toMatchObject({ upstreamStatus: 401 });
  await expect(identity.guilds('token')).rejects.toMatchObject({ upstreamStatus: 401 });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await identity.guilds('new-token')).toHaveLength(1);
  expect(await identity.guilds('new-token', true)).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(String(fetch.mock.calls[1]![0])).toContain('/users/@me/guilds?limit=200');
});
