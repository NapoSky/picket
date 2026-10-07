import { err, ok, type Result, type RoleId } from '@picket/kernel';
import {
  MAX_ALERT_ROLES,
  MAX_ALERT_THRESHOLDS,
  MAX_PURGE_HOURS,
  MAX_THRESHOLD_MIN,
  MIN_THRESHOLD_MIN,
} from './constants';

/** Réglages propres à chaque board. */
export interface BoardSettings {
  readonly alertsEnabled: boolean;
  /** Minutes avant l'échéance, du plus lointain au plus proche. */
  readonly alertThresholdsMin: readonly number[];
  readonly alertRoleIds: readonly RoleId[];
  /** Sans notification push, même pour les rôles mentionnés. */
  readonly alertSilent: boolean;
  /** Barrer et rafraîchir réservés au propriétaire de l'asset et aux officiers. */
  readonly restrictChanges: boolean;
  /** Heures après lesquelles un asset barré ou expiré est supprimé ; `null` : jamais. */
  readonly purgeAfterHours: number | null;
  readonly resetOnNewWar: boolean;
}

export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  alertsEnabled: true,
  alertThresholdsMin: [120],
  alertRoleIds: [],
  alertSilent: true,
  restrictChanges: false,
  purgeAfterHours: 24,
  resetOnNewWar: false,
};

const SNOWFLAKE = /^\d{15,25}$/u;

function isThresholdList(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= MAX_ALERT_THRESHOLDS &&
    value.every((item) => Number.isInteger(item) && item >= MIN_THRESHOLD_MIN && item <= MAX_THRESHOLD_MIN)
  );
}

/** Lecture tolérante d'un JSON stocké : un champ absent ou invalide retombe sur sa valeur par défaut. */
export function parseBoardSettings(raw: unknown): BoardSettings {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const defaults = DEFAULT_BOARD_SETTINGS;
  const roles = Array.isArray(source['alertRoleIds'])
    ? (source['alertRoleIds'] as unknown[]).filter((id): id is RoleId => typeof id === 'string' && SNOWFLAKE.test(id)).slice(0, MAX_ALERT_ROLES)
    : defaults.alertRoleIds;
  const purge = source['purgeAfterHours'];
  return {
    alertsEnabled: typeof source['alertsEnabled'] === 'boolean' ? source['alertsEnabled'] : defaults.alertsEnabled,
    alertThresholdsMin: isThresholdList(source['alertThresholdsMin']) ? sortThresholds(source['alertThresholdsMin']) : defaults.alertThresholdsMin,
    alertRoleIds: roles,
    alertSilent: typeof source['alertSilent'] === 'boolean' ? source['alertSilent'] : defaults.alertSilent,
    restrictChanges: typeof source['restrictChanges'] === 'boolean' ? source['restrictChanges'] : defaults.restrictChanges,
    purgeAfterHours:
      typeof purge === 'number' && Number.isInteger(purge) && purge >= 1 && purge <= MAX_PURGE_HOURS
        ? purge
        : purge === null
          ? null
          : defaults.purgeAfterHours,
    resetOnNewWar: typeof source['resetOnNewWar'] === 'boolean' ? source['resetOnNewWar'] : defaults.resetOnNewWar,
  };
}

const sortThresholds = (values: readonly number[]): number[] => [...new Set(values)].sort((a, b) => b - a);

export interface SettingsPatch {
  readonly alertsEnabled?: boolean;
  readonly alertThresholdsMin?: readonly number[];
  readonly alertRole?: { readonly action: 'add' | 'remove' | 'clear'; readonly roleId?: RoleId };
  readonly alertSilent?: boolean;
  readonly restrictChanges?: boolean;
  /** 0 : jamais. */
  readonly purgeAfterHours?: number;
  readonly resetOnNewWar?: boolean;
}

export type SettingsError =
  | 'invalid_thresholds'
  | 'too_many_roles'
  | 'invalid_role'
  | 'invalid_purge';

export function applySettingsPatch(current: BoardSettings, patch: SettingsPatch): Result<BoardSettings, SettingsError> {
  let next: BoardSettings = { ...current };

  if (patch.alertThresholdsMin !== undefined) {
    // Une liste valide à un doublon près (« 2h, 2h ») est acceptée et dédoublonnée.
    const sorted = sortThresholds(patch.alertThresholdsMin);
    if (!isThresholdList(sorted)) return err('invalid_thresholds');
    next = { ...next, alertThresholdsMin: sorted };
  }

  if (patch.alertRole !== undefined) {
    const { action, roleId } = patch.alertRole;
    if (action === 'clear') {
      next = { ...next, alertRoleIds: [] };
    } else {
      if (roleId === undefined || !SNOWFLAKE.test(roleId)) return err('invalid_role');
      if (action === 'add' && !next.alertRoleIds.includes(roleId)) {
        if (next.alertRoleIds.length >= MAX_ALERT_ROLES) return err('too_many_roles');
        next = { ...next, alertRoleIds: [...next.alertRoleIds, roleId] };
      }
      if (action === 'remove') next = { ...next, alertRoleIds: next.alertRoleIds.filter((id) => id !== roleId) };
    }
  }

  if (patch.purgeAfterHours !== undefined) {
    if (!Number.isInteger(patch.purgeAfterHours) || patch.purgeAfterHours < 0 || patch.purgeAfterHours > MAX_PURGE_HOURS) {
      return err('invalid_purge');
    }
    next = { ...next, purgeAfterHours: patch.purgeAfterHours === 0 ? null : patch.purgeAfterHours };
  }

  return ok({
    ...next,
    ...(patch.alertsEnabled !== undefined ? { alertsEnabled: patch.alertsEnabled } : {}),
    ...(patch.alertSilent !== undefined ? { alertSilent: patch.alertSilent } : {}),
    ...(patch.restrictChanges !== undefined ? { restrictChanges: patch.restrictChanges } : {}),
    ...(patch.resetOnNewWar !== undefined ? { resetOnNewWar: patch.resetOnNewWar } : {}),
  });
}

export const settingsEqual = (a: BoardSettings, b: BoardSettings): boolean => JSON.stringify(a) === JSON.stringify(b);
