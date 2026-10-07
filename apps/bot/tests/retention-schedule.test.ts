import { latestRetentionSchedule } from '../src/retention-schedule';

describe('retention schedule at 3 AM Europe/Paris', () => {
  it.each([
    ['2026-01-07T01:59:59Z', '2026-01-06T02:00:00Z'],
    ['2026-01-07T02:00:00Z', '2026-01-07T02:00:00Z'],
    ['2026-07-07T00:59:59Z', '2026-07-06T01:00:00Z'],
    ['2026-07-07T01:00:00Z', '2026-07-07T01:00:00Z'],
    ['2026-03-29T00:59:59Z', '2026-03-28T02:00:00Z'],
    ['2026-03-29T01:00:00Z', '2026-03-29T01:00:00Z'],
    ['2026-10-25T01:59:59Z', '2026-10-24T01:00:00Z'],
    ['2026-10-25T02:00:00Z', '2026-10-25T02:00:00Z'],
    ['2026-10-07T22:30:00Z', '2026-10-07T01:00:00Z'],
  ])('resolves the most recent deadline at %s to %s', (now, expected) => {
    expect(latestRetentionSchedule(new Date(now))).toEqual(new Date(expected));
  });
});
