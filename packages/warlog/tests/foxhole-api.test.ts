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
it('accepts text anchors outside the map without clamping their positions', async () => {
  const { api, fetcher } = make();
  const labels = [
    { text: 'The Squeeze', x: 0.3175878, y: 1.0565143, mapMarkerType: 'Minor' },
    { text: 'Whispering Gulch', x: 0.49615276, y: 1.0449303, mapMarkerType: 'Minor' },
    { text: 'Outside edge', x: -0.01, y: 0.5, mapMarkerType: 'Major' },
  ];
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ mapTextItems: labels })));
  expect(await api.labels('ReachingTrailHex')).toEqual(labels.map(({ mapMarkerType, ...label }) => ({ ...label, major: mapMarkerType === 'Major' })));
});
it('ignores unnamed text anchors without discarding useful labels', async () => {
  const { api, fetcher } = make();
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ mapTextItems: [
    { text: '', x: 0.71211976, y: 0.41616037, mapMarkerType: 'Minor' },
    { text: '   ', x: 0.5, y: 0.5, mapMarkerType: 'Minor' },
    { text: 'Nevish Line', x: 0.2, y: 0.3, mapMarkerType: 'Major' },
  ] })));
  expect(await api.labels('NevishLineHex')).toEqual([{ text: 'Nevish Line', x: 0.2, y: 0.3, major: true }]);
});
it.each([null, 123, 'x'.repeat(257)])('rejects malformed map label text', async text => {
  const { api, fetcher } = make();
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ mapTextItems: [{ text, x: 0.1, y: 0.2, mapMarkerType: 'Major' }] })));
  await expect(api.labels('NevishLineHex')).rejects.toThrow('Malformed map label text');
});
it.each([null, '1.05', Infinity, NaN])('rejects invalid text anchor coordinate %s', async x => {
  const { api, fetcher } = make();
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ mapTextItems: [{ text: 'Bad anchor', x, y: 0.5, mapMarkerType: 'Minor' }] })));
  await expect(api.labels('ReachingTrailHex')).rejects.toThrow('Malformed map label coordinate');
});
it.each([-0.01, 1.0565143])('still rejects dynamic map item coordinate %s outside the map', async y => {
  const { api, fetcher } = make();
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...body, mapItems: [{ ...body.mapItems[0], y }] })));
  await expect(api.map('ReachingTrailHex')).rejects.toThrow('Malformed');
});
