import { createDiscordBotRest } from '@picket/discord';
import { Secret } from '@picket/kernel';
import { DashboardDiscord } from '../src';

it('paginates bot guild names and caches metadata without returning permissions', async () => {
  const rest = createDiscordBotRest(new Secret('unused'));
  const first = Array.from({ length: 200 }, (_, index) => ({
    id: String(700000000000000000n + BigInt(index)), name: `Regiment ${index}`, permissions: '8', owner: true,
  }));
  const last = { id: '700000000000000200', name: 'Last regiment' };
  const get = jest.spyOn(rest, 'get').mockResolvedValueOnce(first).mockResolvedValueOnce([last]);
  const provider = new DashboardDiscord('900000000000000001', 'secret', 'https://stats.example/auth/callback', rest);
  const names = await provider.guildNames();
  expect(names).toHaveLength(201);
  expect(names[0]).toEqual({ id: first[0]!.id, name: first[0]!.name });
  expect(names.at(-1)).toEqual(last);
  expect(get.mock.calls[0]![0]).toBe('/users/@me/guilds');
  expect(get.mock.calls[1]![1]!.query!.get('after')).toBe(first.at(-1)!.id);
  expect(await provider.guildNames()).toBe(names);
  expect(get).toHaveBeenCalledTimes(2);
});

it('rejects malformed names without caching partial responses', async () => {
  const rest = createDiscordBotRest(new Secret('unused'));
  const get = jest.spyOn(rest, 'get').mockResolvedValueOnce([{ id: '700000000000000001', name: '' }])
    .mockResolvedValueOnce([{ id: '700000000000000001', name: 'Regiment' }]);
  const provider = new DashboardDiscord('900000000000000001', 'secret', 'https://stats.example/auth/callback', rest);
  await expect(provider.guildNames()).rejects.toThrow('Invalid Discord guild names');
  expect(await provider.guildNames()).toEqual([{ id: '700000000000000001', name: 'Regiment' }]);
  expect(get).toHaveBeenCalledTimes(2);
});
