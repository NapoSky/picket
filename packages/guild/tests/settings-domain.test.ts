import { ChannelId, GuildId } from '@picket/kernel';
import { decideSettingsChange, normalizeTimeZone, settingsSnapshot, type GuildSettings } from '@picket/guild';

const guildId = GuildId.assert('700000000000000001');
const channel = ChannelId.assert('600000000000000001');
const locales = ['en', 'fr'];

const current = (overrides: Partial<GuildSettings> = {}): GuildSettings => ({
  guildId,
  locale: null,
  timezone: 'UTC',
  auditChannelId: null,
  features: { timers: true, todolists: true, warlog: false },
  installedAt: new Date('2026-10-05T00:00:00Z'),
  ...overrides,
});

describe('normalizeTimeZone', () => {
  it.each([
    ['Europe/Paris', 'Europe/Paris'],
    ['  europe/paris ', 'Europe/Paris'],
    ['UTC', 'UTC'],
    ['America/Argentina/Buenos_Aires', 'America/Argentina/Buenos_Aires'],
    ['Asia/Kolkata', 'Asia/Kolkata'],
  ])('accepts %j as %j', (input, expected) => {
    expect(normalizeTimeZone(input)).toBe(expected);
  });

  it.each(['', 'Mars/Olympus', '+01:00', 'GMT+1x', 'Europe/', '../etc/passwd', 'a'.repeat(65), 'Europe/Paris; DROP TABLE'])(
    'rejects %j',
    (input) => {
      expect(normalizeTimeZone(input)).toBeNull();
    },
  );
});

describe('decideSettingsChange', () => {
  it('changes the language, and back to automatic', () => {
    const forced = decideSettingsChange(current(), { kind: 'language', locale: 'fr' }, locales);
    expect(forced).toEqual({ kind: 'apply', next: current({ locale: 'fr' }) });
    expect(decideSettingsChange(current({ locale: 'fr' }), { kind: 'language', locale: null }, locales)).toEqual({
      kind: 'apply',
      next: current(),
    });
  });

  it('rejects a language without catalog', () => {
    expect(decideSettingsChange(current(), { kind: 'language', locale: 'xx' }, locales)).toEqual({
      kind: 'rejected',
      reason: 'unsupported_language',
    });
  });

  it('stores the canonical time zone name and rejects unknown ones', () => {
    expect(decideSettingsChange(current(), { kind: 'timezone', timezone: 'europe/paris' }, locales)).toEqual({
      kind: 'apply',
      next: current({ timezone: 'Europe/Paris' }),
    });
    expect(decideSettingsChange(current(), { kind: 'timezone', timezone: 'Nowhere/Land' }, locales)).toEqual({
      kind: 'rejected',
      reason: 'invalid_timezone',
    });
  });

  it('sets and clears the audit channel', () => {
    const set = decideSettingsChange(current(), { kind: 'audit_channel', channelId: channel }, locales);
    expect(set).toEqual({ kind: 'apply', next: current({ auditChannelId: channel }) });
    expect(decideSettingsChange(current({ auditChannelId: channel }), { kind: 'audit_channel', channelId: null }, locales)).toEqual({
      kind: 'apply',
      next: current(),
    });
  });

  it('toggles one feature without touching the others', () => {
    expect(decideSettingsChange(current(), { kind: 'feature', feature: 'warlog', enabled: true }, locales)).toEqual({
      kind: 'apply',
      next: current({ features: { timers: true, todolists: true, warlog: true } }),
    });
  });

  it.each([
    [{ kind: 'language', locale: null }],
    [{ kind: 'timezone', timezone: 'UTC' }],
    [{ kind: 'audit_channel', channelId: null }],
    [{ kind: 'feature', feature: 'timers', enabled: true }],
  ] as const)('reports %j as unchanged when the value is already set', (change) => {
    expect(decideSettingsChange(current(), change, locales)).toEqual({ kind: 'unchanged' });
  });
});

describe('settingsSnapshot', () => {
  it('exposes what an audit entry needs, without installation metadata', () => {
    expect(settingsSnapshot(current({ locale: 'fr', auditChannelId: channel }))).toEqual({
      language: 'fr',
      timezone: 'UTC',
      auditChannelId: channel,
      features: { timers: true, todolists: true, warlog: false },
    });
  });
});
