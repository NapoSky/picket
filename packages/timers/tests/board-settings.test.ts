import { RoleId } from '@picket/kernel';
import { DEFAULT_BOARD_SETTINGS, applySettingsPatch, parseBoardSettings, settingsEqual, type SettingsPatch } from '@picket/timers';

const role = (n: number) => RoleId.assert(`4000000000000000${String(10 + n)}`);
const apply = (patch: SettingsPatch, current = DEFAULT_BOARD_SETTINGS) => applySettingsPatch(current, patch);
const settings = (patch: SettingsPatch, current = DEFAULT_BOARD_SETTINGS) => {
  const result = apply(patch, current);
  if (!result.ok) throw new Error(`expected settings, got ${result.error}`);
  return result.value;
};

describe('parseBoardSettings', () => {
  it('falls back to the defaults for anything missing or malformed', () => {
    expect(parseBoardSettings({})).toEqual(DEFAULT_BOARD_SETTINGS);
    expect(parseBoardSettings(null)).toEqual(DEFAULT_BOARD_SETTINGS);
    expect(parseBoardSettings('nope')).toEqual(DEFAULT_BOARD_SETTINGS);
    expect(
      parseBoardSettings({ alertsEnabled: 'yes', alertThresholdsMin: [1], maxActive: 0, purgeAfterHours: -4, duplicates: 'maybe', alertRoleIds: 'x' }),
    ).toEqual(DEFAULT_BOARD_SETTINGS);
  });

  it('keeps valid stored values, thresholds from the farthest to the closest, and drops invalid roles', () => {
    const parsed = parseBoardSettings({
      alertsEnabled: false,
      alertThresholdsMin: [30, 360, 120],
      alertRoleIds: [role(1), 'bad', role(2)],
      alertSilent: false,
      restrictChanges: true,
      purgeAfterHours: 48,
      resetOnNewWar: true,
    });
    expect(parsed).toEqual({
      alertsEnabled: false,
      alertThresholdsMin: [360, 120, 30],
      alertRoleIds: [role(1), role(2)],
      alertSilent: false,
      restrictChanges: true,
      purgeAfterHours: 48,
      resetOnNewWar: true,
    });
    expect(parseBoardSettings({ maxActive: 100, regionEmoji: '🌍', locationEmoji: '📍', duplicates: 'warn' })).toEqual(DEFAULT_BOARD_SETTINGS);
  });
});

describe('applySettingsPatch', () => {
  it('changes only what the patch names', () => {
    const next = settings({ alertSilent: false, restrictChanges: true });
    expect(next).toEqual({ ...DEFAULT_BOARD_SETTINGS, alertSilent: false, restrictChanges: true });
    expect(settingsEqual(next, DEFAULT_BOARD_SETTINGS)).toBe(false);
    expect(settingsEqual(settings({}), DEFAULT_BOARD_SETTINGS)).toBe(true);
  });

  it('sorts and deduplicates thresholds, and bounds them (5 minutes to 7 days, 4 at most)', () => {
    expect(settings({ alertThresholdsMin: [30, 360, 30, 120] }).alertThresholdsMin).toEqual([360, 120, 30]);
    for (const bad of [[], [4], [10_081], [1, 2, 3, 4, 5].map((n) => n * 10 + 5), [1.5]]) {
      expect(apply({ alertThresholdsMin: bad })).toEqual({ ok: false, error: 'invalid_thresholds' });
    }
  });

  it('adds, removes and clears notified roles, with a limit of five', () => {
    const one = settings({ alertRole: { action: 'add', roleId: role(1) } });
    expect(one.alertRoleIds).toEqual([role(1)]);
    expect(settings({ alertRole: { action: 'add', roleId: role(1) } }, one).alertRoleIds).toEqual([role(1)]);
    expect(settings({ alertRole: { action: 'remove', roleId: role(1) } }, one).alertRoleIds).toEqual([]);
    expect(settings({ alertRole: { action: 'clear' } }, one).alertRoleIds).toEqual([]);

    const full = [1, 2, 3, 4, 5].reduce((current, n) => settings({ alertRole: { action: 'add', roleId: role(n) } }, current), DEFAULT_BOARD_SETTINGS);
    expect(apply({ alertRole: { action: 'add', roleId: role(6) } }, full)).toEqual({ ok: false, error: 'too_many_roles' });
    expect(apply({ alertRole: { action: 'add' } })).toEqual({ ok: false, error: 'invalid_role' });
  });

  it('turns auto-purge off with 0 and bounds it to 30 days', () => {
    expect(settings({ purgeAfterHours: 48 }).purgeAfterHours).toBe(48);
    expect(settings({ purgeAfterHours: 0 }, { ...DEFAULT_BOARD_SETTINGS, purgeAfterHours: 48 }).purgeAfterHours).toBeNull();
    expect(apply({ purgeAfterHours: 721 })).toEqual({ ok: false, error: 'invalid_purge' });
    expect(apply({ purgeAfterHours: -1 })).toEqual({ ok: false, error: 'invalid_purge' });
  });

});
