import {
  eligible,
  overlapSeconds,
  parsePeriod,
  STATS_RETENTION_MS,
  validTargets,
  type StatsConfig,
} from '../src/domain/model';
const guild = '700000000000000001';
const config: StatsConfig = {
  guildId: guild,
  enabled: true,
  roles: ['400000000000000001', '400000000000000002'],
  excludedChannels: ['600000000000000002'],
  afkChannelId: '600000000000000003',
  changedAt: new Date(),
};
const person = {
  userId: '300000000000000001',
  channelId: '600000000000000001',
  roles: ['400000000000000002'],
  name: 'Alice',
  bot: false,
};
describe('vocal eligibility and time windows', () => {
  it('requires explicit roles and rejects everyone even alongside valid roles', () => {
    expect(validTargets(guild, [])).toBe(false);
    expect(validTargets(guild, [guild, ...config.roles])).toBe(false);
    expect(eligible({ ...config, roles: [guild] }, person)).toBe(false);
    expect(eligible(config, person)).toBe(true);
  });
  it.each([
    { ...person, bot: true },
    { ...person, channelId: null },
    { ...person, channelId: config.afkChannelId },
    { ...person, channelId: config.excludedChannels[0]! },
    { ...person, roles: [] },
  ])('excludes ineligible people and channels', (p) => expect(eligible(config, p)).toBe(false));
  it('clips a presence spanning midnight or the retention boundary', () => {
    expect(
      overlapSeconds(
        new Date('2026-10-12T23:30:00Z'),
        new Date('2026-10-13T01:00:00Z'),
        new Date('2026-10-13T00:00:00Z'),
        new Date('2026-10-14T00:00:00Z'),
      ),
    ).toBe(3600);
    expect(overlapSeconds(new Date(0), new Date(1000), new Date(1000), new Date(2000))).toBe(0);
  });
  it('allows 60 days and rejects older, future or inverted periods', () => {
    const now = new Date('2026-10-13T12:00:00Z');
    expect(
      parsePeriod(new Date(now.getTime() - STATS_RETENTION_MS).toISOString(), undefined, now),
    ).not.toBeNull();
    expect(parsePeriod('2020-01-01', undefined, now)).toBeNull();
    expect(parsePeriod('invalid', undefined, now)).toBeNull();
    expect(parsePeriod(now.toISOString(), now.toISOString(), now)).toBeNull();
    expect(parsePeriod(undefined, '2030-01-01', now)).toBeNull();
  });
});
