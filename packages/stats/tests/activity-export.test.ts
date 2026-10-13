import { exportActivity } from '../src/application/activity-export';

const row = {
  guildId: '700000000000000001', userId: '407197937387700225',
  name: 'elchap1567', seconds: 49353, lastActivity: '2026-10-13T04:33:10.000Z',
};

describe('activity download contract', () => {
  it('exports a flat JSON array and the matching CSV columns', () => {
    expect(JSON.parse(exportActivity([row], 'json'))).toEqual([{
      userId: '407197937387700225', username: 'elchap1567', totalSeconds: 49353,
      lastActivityDate: '2026-10-13T04:33:10+00:00',
    }]);
    expect(exportActivity([row], 'csv')).toBe(
      'user_id,username,total_seconds,last_activity_date\r\n' +
      '407197937387700225,elchap1567,49353,2026-10-13T04:33:10+00:00\r\n',
    );
  });
  it('preserves fractional precision and separates global rows by guild', () => {
    const other = { ...row, guildId: '700000000000000002', seconds: 0.125, lastActivity: '2026-10-13T04:33:10.125Z' };
    expect(JSON.parse(exportActivity([row, other], 'json', true))).toEqual([
      expect.objectContaining({ guildId: row.guildId, userId: row.userId }),
      expect.objectContaining({ guildId: other.guildId, totalSeconds: 0.125, lastActivityDate: '2026-10-13T04:33:10.125+00:00' }),
    ]);
    expect(exportActivity([other], 'csv', true)).toContain('guild_id,user_id,username,total_seconds,last_activity_date\r\n');
  });
  it('preserves Unicode, quotes, commas and line breaks in names', () => {
    expect(exportActivity([{ ...row, name: 'élchap, "Captain"\nFox' }], 'csv')).toContain('"élchap, ""Captain""\nFox"');
    expect(JSON.parse(exportActivity([{ ...row, name: '=SUM(A1:A2)' }], 'json'))[0].username).toBe('=SUM(A1:A2)');
  });
  it.each(['=SUM(A1:A2)', '+cmd', '-cmd', '@cmd', ' \t=cmd'])('neutralises spreadsheet formulas: %s', (name) => {
    expect(exportActivity([{ ...row, name }], 'csv')).toContain(",\u0027" + name + ',49353,');
  });
  it('provides an empty array or only the CSV header when no rows match', () => {
    expect(exportActivity([], 'json')).toBe('[]');
    expect(exportActivity([], 'csv')).toBe('user_id,username,total_seconds,last_activity_date\r\n');
  });
});
