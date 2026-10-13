import { FoxholeApi } from '../src';

const body = { version: 1, lastUpdated: 1_000, mapItems: [{ iconType: 56, x: .1, y: .2, flags: 1, teamId: 'WARDENS' }] };
const make = () => {
  let now = 1_000;
  const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
  return { fetcher, api: new FoxholeApi('https://example.invalid', 'test', fetcher, () => now), advance: (ms: number) => { now += ms; } };
};
it('uses ETags, cached 304 data, cache lifetimes and an identified user agent', async () => {
  const { api, fetcher, advance } = make();
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify(body), { headers: { ETag: 'v1', 'Cache-Control': 'max-age=5' } }));
  expect((await api.map('WestgateHex')).version).toBe(1);
  await api.map('WestgateHex'); expect(fetcher).toHaveBeenCalledTimes(1);
  advance(6_000); fetcher.mockResolvedValueOnce(new Response(null, { status: 304 }));
  expect((await api.map('WestgateHex')).items).toHaveLength(1);
  expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({ 'If-None-Match': 'v1', 'User-Agent': expect.stringContaining('PICKET/test') });
});
it('honours Retry-After rather than treating 429 as an empty map', async () => {
  const { api, fetcher, advance } = make(); fetcher.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '20' } }));
  await expect(api.map('WestgateHex')).rejects.toThrow('rate limited');
  await expect(api.map('WestgateHex')).rejects.toThrow('cooling down'); expect(fetcher).toHaveBeenCalledTimes(1);
  advance(20_000); fetcher.mockResolvedValueOnce(new Response(JSON.stringify(body)));
  await expect(api.map('WestgateHex')).resolves.toMatchObject({ version: 1 });
});
it('never caches malformed data or accepts a 304 without its body', async () => {
  const { api, fetcher } = make(); fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...body, mapItems: null }), { headers: { ETag: 'bad' } }));
  await expect(api.map('WestgateHex')).rejects.toThrow('Malformed');
  fetcher.mockResolvedValueOnce(new Response(null, { status: 304 }));
  await expect(api.map('WestgateHex')).rejects.toThrow('without cached');
});
it('filters home regions and validates payload factions', async () => {
  const { api, fetcher } = make(); fetcher.mockResolvedValueOnce(new Response(JSON.stringify(['HomeRegionC','WestgateHex','HomeRegionW'])));
  expect(await api.maps()).toEqual(['WestgateHex']);
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...body, mapItems: [{ ...body.mapItems[0], teamId: 'OTHER' }] })));
  await expect(api.map('WestgateHex')).rejects.toThrow('faction');
});
