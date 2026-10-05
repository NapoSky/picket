import { RoleId } from '@picket/kernel';
import { parseSettingsOptions } from '@picket/timers';

describe('parseSettingsOptions', () => {
  it('turns the options given into a patch, and nothing for no option (the command then shows the settings)', () => {
    expect(parseSettingsOptions({})).toEqual({ ok: true, value: {} });
    expect(
      parseSettingsOptions({
        alerts: false,
        thresholds: '6h, 30m',
        silent: false,
        duplicates: 'refuse',
        'restrict-changes': true,
        'max-active': 20,
        'purge-after': 0,
        'reset-on-new-war': true,
      }),
    ).toEqual({
      ok: true,
      value: {
        alertsEnabled: false,
        alertThresholdsMin: [360, 30],
        alertSilent: false,
        duplicates: 'refuse',
        restrictChanges: true,
        maxActive: 20,
        purgeAfterHours: 0,
        resetOnNewWar: true,
      },
    });
  });

  it('adds a role by default, removes it on request, and clears without a role', () => {
    const role = '400000000000000011';
    expect(parseSettingsOptions({ 'alert-role': role })).toEqual({ ok: true, value: { alertRole: { action: 'add', roleId: RoleId.assert(role) } } });
    expect(parseSettingsOptions({ 'alert-role': role, 'alert-role-action': 'remove' })).toEqual({
      ok: true,
      value: { alertRole: { action: 'remove', roleId: RoleId.assert(role) } },
    });
    expect(parseSettingsOptions({ 'alert-role-action': 'clear' })).toEqual({ ok: true, value: { alertRole: { action: 'clear' } } });
    expect(parseSettingsOptions({ 'alert-role': role, 'alert-role-action': 'clear' })).toEqual({ ok: true, value: { alertRole: { action: 'clear' } } });
  });

  it('refuses a role action without a role, a malformed role, and unreadable thresholds', () => {
    expect(parseSettingsOptions({ 'alert-role-action': 'add' })).toEqual({ ok: false, error: 'role_needed' });
    expect(parseSettingsOptions({ 'alert-role-action': 'remove' })).toEqual({ ok: false, error: 'role_needed' });
    expect(parseSettingsOptions({ 'alert-role': 'not a role' })).toEqual({ ok: false, error: 'invalid_role' });
    expect(parseSettingsOptions({ thresholds: 'soon' })).toEqual({ ok: false, error: 'invalid_thresholds' });
  });

  it('ignores options of the wrong type and unknown choices instead of guessing', () => {
    expect(parseSettingsOptions({ alerts: 'yes', silent: 1, 'max-active': '20', duplicates: 'maybe' })).toEqual({ ok: true, value: {} });
  });
});
