import { integer, validateTemplate, queueSize } from '@picket/voice';
const input = {
  name: 'Combat',
  channelName: 'Combat',
  categoryId: '600000000000000001',
  capacity: 99,
  idleMinutes: 15,
};
it('accepts only explicit numeric quantities and safe limits', () => {
  for (const v of ['', '0', '-1', '1.2', '1e1', 'Infinity', '10x'])
    expect(() => integer(v, 1, 10)).toThrow();
  expect(integer('10', 1, 10)).toBe(10);
});
it('validates names and the hard capacity and cleanup bounds', () => {
  expect(validateTemplate(input)).toEqual(input);
  for (const v of [
    { capacity: 0 },
    { capacity: 100 },
    { idleMinutes: 31 },
    { name: '\n' },
    { categoryId: 'other' },
  ])
    expect(() => validateTemplate({ ...input, ...v })).toThrow();
});
it('counts the complete deployment across templates', () => {
  expect(
    queueSize({
      a: { quantity: 3, revision: 1 },
      b: { quantity: 2, revision: 1 },
    }),
  ).toBe(5);
});
