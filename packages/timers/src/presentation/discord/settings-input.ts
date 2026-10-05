import type { OptionValue } from '@picket/discord';
import { RoleId, err, ok, type Result } from '@picket/kernel';
import type { SettingsPatch } from '../../domain/board-settings';
import { parseThresholds } from '../../domain/duration';

export type SettingsInputError = 'role_needed' | 'invalid_thresholds' | 'invalid_role';

/** Options de `/timers settings` : celles qui sont renseignées forment le correctif, aucune option montre les réglages. */
export function parseSettingsOptions(options: Readonly<Record<string, OptionValue>>): Result<SettingsPatch, SettingsInputError> {
  const patch: { -readonly [K in keyof SettingsPatch]: SettingsPatch[K] } = {};
  const bool = (name: string): boolean | undefined => (typeof options[name] === 'boolean' ? (options[name] as boolean) : undefined);
  const int = (name: string): number | undefined => (typeof options[name] === 'number' ? (options[name] as number) : undefined);

  const alerts = bool('alerts');
  if (alerts !== undefined) patch.alertsEnabled = alerts;
  const silent = bool('silent');
  if (silent !== undefined) patch.alertSilent = silent;
  const restrict = bool('restrict-changes');
  if (restrict !== undefined) patch.restrictChanges = restrict;
  const reset = bool('reset-on-new-war');
  if (reset !== undefined) patch.resetOnNewWar = reset;
  const maxActive = int('max-active');
  if (maxActive !== undefined) patch.maxActive = maxActive;
  const purge = int('purge-after');
  if (purge !== undefined) patch.purgeAfterHours = purge;

  const duplicates = options['duplicates'];
  if (duplicates === 'warn' || duplicates === 'refuse') patch.duplicates = duplicates;

  const thresholds = options['thresholds'];
  if (typeof thresholds === 'string') {
    const parsed = parseThresholds(thresholds);
    if (!parsed.ok) return err('invalid_thresholds');
    patch.alertThresholdsMin = parsed.value;
  }

  const action = options['alert-role-action'];
  const role = options['alert-role'];
  if (action === 'clear') {
    patch.alertRole = { action: 'clear' };
  } else if (role !== undefined) {
    const roleId = RoleId.parse(role);
    if (!roleId.ok) return err('invalid_role');
    patch.alertRole = { action: action === 'remove' ? 'remove' : 'add', roleId: roleId.value };
  } else if (action === 'add' || action === 'remove') {
    return err('role_needed');
  }

  return ok(patch);
}
