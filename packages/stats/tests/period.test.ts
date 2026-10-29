import { activityFilename, calendarLimits, resolveStatsPeriod, StatsPeriodError } from '../src/domain/period';

const now = new Date('2026-10-29T12:00:00Z');
describe('shared reporting period contract', () => {
  it.each([
    ['Europe/Paris', '2026-10-25', '2026-11-01T12:00:00Z', '2026-10-24T22:00:00Z', '2026-10-25T23:00:00Z', 25],
    ['Europe/Paris', '2026-03-29', '2026-04-01T12:00:00Z', '2026-03-28T23:00:00Z', '2026-03-29T22:00:00Z', 23],
    ['Asia/Kathmandu', '2026-10-25', now.toISOString(), '2026-10-24T18:15:00Z', '2026-10-25T18:15:00Z', 24],
    ['America/Santiago', '2026-09-06', '2026-10-01T12:00:00Z', '2026-09-06T04:00:00Z', '2026-09-07T03:00:00Z', 23],
  ])('includes the whole civil day in %s on %s', (zone, day, clock, from, to, hours) => {
    const period = resolveStatsPeriod({ start: day, end: day }, String(zone), new Date(clock!));
    expect(period).toEqual({ from: new Date(from!), to: new Date(to!) });
    expect((period.to.getTime() - period.from.getTime()) / 3600_000).toBe(hours);
  });
  it('includes the end date and caps today at now', () => {
    expect(resolveStatsPeriod({ start: '2026-10-20', end: '2026-10-25' }, 'UTC', now))
      .toEqual({ from: new Date('2026-10-20T00:00:00Z'), to: new Date('2026-10-26T00:00:00Z') });
    expect(resolveStatsPeriod({ start: '2026-10-29', end: '2026-10-29' }, 'UTC', now))
      .toEqual({ from: new Date('2026-10-29T00:00:00Z'), to: now });
  });
  it('offers only fully retained start days and preserves an exact midnight cutoff', () => {
    expect(calendarLimits('UTC', now)).toEqual({ timezone: 'UTC', earliestStart: '2026-08-31', today: '2026-10-29' });
    expect(calendarLimits('UTC', new Date('2026-10-29T00:00:00Z')).earliestStart).toBe('2026-08-30');
    expect(() => resolveStatsPeriod({ start: '2026-08-30', end: '2026-08-31' }, 'UTC', now)).toThrow('invalid_period');
    expect(resolveStatsPeriod({ start: '2026-08-31', end: '2026-08-31' }, 'UTC', now).from.toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });
  it.each([
    { start: '2026-10-20' }, { end: '2026-10-20' },
    { start: '2026-09-31', end: '2026-10-01' },
    { start: '2026-10-25', end: '2026-10-20' },
    { start: '2026-10-20', end: '2026-10-30' },
    { start: '20/10/2026', end: '2026-10-25' },
    { start: '2026-10-20T00:00:00Z', end: '2026-10-25' },
    { start: ['2026-10-20'], end: '2026-10-25' },
    { start: '2026-10-20', end: '2026-10-25', days: 7 },
    { start: '2026-10-20', end: '2026-10-25', from: '2026-10-20T00:00:00Z' },
    { start: '2026-10-20', end: '2026-10-25', to: '2026-10-25T00:00:00Z' },
    { days: 0 }, { days: 61 }, { days: '7.5' }, { days: 'bad' }, { days: ['7'] },
  ])('rejects invalid and conflicting inputs: %j', input => {
    expect(() => resolveStatsPeriod(input, 'UTC', now)).toThrow('invalid_period');
  });
  it('keeps rolling defaults, custom days and exact timestamp bounds', () => {
    expect(resolveStatsPeriod({}, 'UTC', now)).toEqual({ from: new Date('2026-10-22T12:00:00Z'), to: now });
    expect(resolveStatsPeriod({ days: 60 }, 'Europe/Paris', now).from.toISOString()).toBe('2026-08-30T12:00:00.000Z');
    expect(resolveStatsPeriod({ days: '14' }, 'UTC', now).from.toISOString()).toBe('2026-10-15T12:00:00.000Z');
    expect(resolveStatsPeriod({ from: '2026-10-21T18:30:00Z', to: '2026-10-21T20:15:00Z' }, 'UTC', now))
      .toEqual({ from: new Date('2026-10-21T18:30:00Z'), to: new Date('2026-10-21T20:15:00Z') });
  });
  it('distinguishes periods not yet in the snapshot from empty observed periods', () => {
    const snapshot = new Date('2026-10-28T12:00:00Z');
    expect(() => resolveStatsPeriod({ start: '2026-10-29', end: '2026-10-29' }, 'UTC', now, snapshot))
      .toThrow('period_unavailable');
    expect(() => resolveStatsPeriod({ from: snapshot.toISOString(), to: now.toISOString() }, 'UTC', now, snapshot))
      .toThrow('period_unavailable');
    const partial = resolveStatsPeriod({ start: '2026-10-28', end: '2026-10-29' }, 'UTC', now, snapshot);
    expect(partial.from < snapshot).toBe(true);
    expect(partial.to > snapshot).toBe(true);
    expect(resolveStatsPeriod({ days: 7 }, 'UTC', now, snapshot).to).toEqual(snapshot);
    expect(() => resolveStatsPeriod({}, 'UTC', now, new Date('2026-08-01T12:00:00Z'))).toThrow('stats_snapshot_pending');
    expect(new StatsPeriodError('stats_snapshot_pending').statusCode).toBe(503);
  });
  it('identifies the exact effective UTC bounds in download names', () => {
    expect(activityFilename('instance', '2026-10-24T22:00:00Z', '2026-10-25T23:00:00Z', 'csv'))
      .toBe('picket-voice-instance-20261024T220000Z_20261025T230000Z.csv');
  });
  it('explicitly trims an expiring frozen export while keeping reports and calendar dates strict', () => {
    const frozen = { from: '2026-08-30T11:59:30Z', to: '2026-10-29T11:59:30Z' };
    expect(() => resolveStatsPeriod(frozen, 'UTC', now)).toThrow('invalid_period');
    expect(resolveStatsPeriod(frozen, 'UTC', now, undefined, { trimExpiredExportStart: true }))
      .toEqual({ from: new Date('2026-08-30T12:00:00Z'), to: new Date(frozen.to) });
    for (const input of [{ ...frozen, from: '2026-08-29T00:00:00Z' },
      { from: '2026-07-01T00:00:00Z', to: '2026-07-02T00:00:00Z' },
      { start: '2026-08-30', end: '2026-08-31' }])
      expect(() => resolveStatsPeriod(input, 'UTC', now, undefined, { trimExpiredExportStart: true })).toThrow('invalid_period');
  });
});
