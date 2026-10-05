import { formatDuration, parseDuration, parseThresholds } from '@picket/timers';

const seconds = (input: string, unit: 'hours' | 'minutes' = 'hours') => {
  const result = parseDuration(input, unit);
  return result.ok ? result.value : 'invalid';
};

describe('parseDuration', () => {
  it.each([
    ['50', 180_000],
    ['1.5', 5_400],
    ['1,5h', 5_400],
    ['90m', 5_400],
    ['2d', 172_800],
    ['1d 12h', 129_600],
    ['2h30m', 9_000],
    ['2H 30M', 9_000],
    [' 3 h ', 10_800],
  ])('reads %j as %i seconds (a bare number is in hours)', (input, expected) => {
    expect(seconds(input)).toBe(expected);
  });

  it('reads a bare number in the default unit, minutes for alert thresholds', () => {
    expect(seconds('30', 'minutes')).toBe(1_800);
    expect(seconds('30m', 'hours')).toBe(1_800);
  });

  it.each(['', '   ', 'abc', '2h30', '1.5h30m', '2 3', '-5', '1e3', '5x', '12:30', 'h', '1.2.3h'])(
    'TIM-EC-19: rejects %j instead of guessing (parseFloat("50abc") used to be 50)',
    (input) => {
      expect(seconds(input)).toBe('invalid');
    },
  );

  it('answers a hostile input in linear time', () => {
    const started = Date.now();
    expect(seconds('1'.repeat(10_000))).toBe('invalid');
    expect(seconds(`${'1 '.repeat(15)}x`)).toBe('invalid');
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe('formatDuration', () => {
  it.each([
    [180_000, '2d 2h'],
    [5_400, '1h 30m'],
    [3_600, '1h'],
    [86_400, '1d'],
    [60, '1m'],
    [45, '45s'],
    [0, '0m'],
    [-5, '0m'],
  ])('writes %i seconds as %j', (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });
});

describe('parseThresholds', () => {
  it('reads a list in minutes, hours and days', () => {
    expect(parseThresholds('6h, 2h, 30m')).toEqual({ ok: true, value: [360, 120, 30] });
    expect(parseThresholds('2h;30m')).toEqual({ ok: true, value: [120, 30] });
    expect(parseThresholds('90')).toEqual({ ok: true, value: [90] });
    expect(parseThresholds('1d')).toEqual({ ok: true, value: [1440] });
  });

  it.each(['', ' , ', 'soon', '45s', '2h, nope', Array.from({ length: 21 }, () => '5m').join(',')])('rejects %j', (input) => {
    expect(parseThresholds(input).ok).toBe(false);
  });
});
