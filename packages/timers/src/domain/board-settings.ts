import { err, ok, type Result, type RoleId } from '@picket/kernel';
import {
  DEFAULT_MAX_ACTIVE,
  HARD_MAX_ACTIVE,
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
  /** `warn` : on ajoute et on prévient ; `refuse` : on n'ajoute pas un doublon actif. */
  readonly duplicates: 'warn' | 'refuse';
  /** Barrer et rafraîchir réservés au propriétaire de l'asset et aux officiers. */
  readonly restrictChanges: boolean;
  readonly maxActive: number;
  /** Heures après lesquelles un asset barré ou expiré est supprimé ; `null` : jamais. */
  readonly purgeAfterHours: number | null;
  readonly resetOnNewWar: boolean;
  /** Icône devant la région dans l'en-tête de chaque lieu : emoji Unicode ou emoji personnalisé ; `null` : celle par défaut. */
  readonly regionEmoji: string | null;
  readonly locationEmoji: string | null;
}

const CUSTOM_EMOJI = /^<a?:[A-Za-z0-9_]{2,32}:\d{15,25}>$/u;
const UNICODE_EMOJI = /^(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)$/u;

/** Un seul emoji, Unicode ou personnalisé (`<:nom:123…>`) : rien d'autre ne doit pouvoir entrer dans un titre de champ. */
export const isValidEmoji = (value: string): boolean => value.length <= 64 && (CUSTOM_EMOJI.test(value) || UNICODE_EMOJI.test(value));

export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  alertsEnabled: true,
  alertThresholdsMin: [120],
  alertRoleIds: [],
  alertSilent: true,
  duplicates: 'warn',
  restrictChanges: false,
  maxActive: DEFAULT_MAX_ACTIVE,
  purgeAfterHours: 24,
  resetOnNewWar: false,
  regionEmoji: null,
  locationEmoji: null,
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
  const maxActive = source['maxActive'];
  const purge = source['purgeAfterHours'];
  return {
    alertsEnabled: typeof source['alertsEnabled'] === 'boolean' ? source['alertsEnabled'] : defaults.alertsEnabled,
    alertThresholdsMin: isThresholdList(source['alertThresholdsMin']) ? sortThresholds(source['alertThresholdsMin']) : defaults.alertThresholdsMin,
    alertRoleIds: roles,
    alertSilent: typeof source['alertSilent'] === 'boolean' ? source['alertSilent'] : defaults.alertSilent,
    duplicates: source['duplicates'] === 'refuse' ? 'refuse' : 'warn',
    restrictChanges: typeof source['restrictChanges'] === 'boolean' ? source['restrictChanges'] : defaults.restrictChanges,
    maxActive:
      typeof maxActive === 'number' && Number.isInteger(maxActive) && maxActive >= 1 && maxActive <= HARD_MAX_ACTIVE
        ? maxActive
        : defaults.maxActive,
    purgeAfterHours:
      typeof purge === 'number' && Number.isInteger(purge) && purge >= 1 && purge <= MAX_PURGE_HOURS
        ? purge
        : purge === null
          ? null
          : defaults.purgeAfterHours,
    resetOnNewWar: typeof source['resetOnNewWar'] === 'boolean' ? source['resetOnNewWar'] : defaults.resetOnNewWar,
    regionEmoji: typeof source['regionEmoji'] === 'string' && isValidEmoji(source['regionEmoji']) ? source['regionEmoji'] : null,
    locationEmoji: typeof source['locationEmoji'] === 'string' && isValidEmoji(source['locationEmoji']) ? source['locationEmoji'] : null,
  };
}

const sortThresholds = (values: readonly number[]): number[] => [...new Set(values)].sort((a, b) => b - a);

export interface SettingsPatch {
  readonly alertsEnabled?: boolean;
  readonly alertThresholdsMin?: readonly number[];
  readonly alertRole?: { readonly action: 'add' | 'remove' | 'clear'; readonly roleId?: RoleId };
  readonly alertSilent?: boolean;
  readonly duplicates?: 'warn' | 'refuse';
  readonly restrictChanges?: boolean;
  readonly maxActive?: number;
  /** 0 : jamais. */
  readonly purgeAfterHours?: number;
  readonly resetOnNewWar?: boolean;
  /** `null` : revenir à l'icône par défaut. */
  readonly regionEmoji?: string | null;
  readonly locationEmoji?: string | null;
}

export type SettingsError =
  | 'invalid_thresholds'
  | 'too_many_roles'
  | 'invalid_role'
  | 'invalid_max_active'
  | 'invalid_purge'
  | 'invalid_emoji'
  | 'max_active_below_current';

/** `activeNow` : le plafond ne peut pas passer sous le nombre d'assets actifs déjà présents. */
export function applySettingsPatch(current: BoardSettings, patch: SettingsPatch, activeNow: number): Result<BoardSettings, SettingsError> {
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

  if (patch.maxActive !== undefined) {
    if (!Number.isInteger(patch.maxActive) || patch.maxActive < 1 || patch.maxActive > HARD_MAX_ACTIVE) return err('invalid_max_active');
    if (patch.maxActive < activeNow) return err('max_active_below_current');
    next = { ...next, maxActive: patch.maxActive };
  }

  if (patch.purgeAfterHours !== undefined) {
    if (!Number.isInteger(patch.purgeAfterHours) || patch.purgeAfterHours < 0 || patch.purgeAfterHours > MAX_PURGE_HOURS) {
      return err('invalid_purge');
    }
    next = { ...next, purgeAfterHours: patch.purgeAfterHours === 0 ? null : patch.purgeAfterHours };
  }

  for (const key of ['regionEmoji', 'locationEmoji'] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value !== null && !isValidEmoji(value)) return err('invalid_emoji');
    next = { ...next, [key]: value };
  }

  return ok({
    ...next,
    ...(patch.alertsEnabled !== undefined ? { alertsEnabled: patch.alertsEnabled } : {}),
    ...(patch.alertSilent !== undefined ? { alertSilent: patch.alertSilent } : {}),
    ...(patch.duplicates !== undefined ? { duplicates: patch.duplicates } : {}),
    ...(patch.restrictChanges !== undefined ? { restrictChanges: patch.restrictChanges } : {}),
    ...(patch.resetOnNewWar !== undefined ? { resetOnNewWar: patch.resetOnNewWar } : {}),
  });
}

export const settingsEqual = (a: BoardSettings, b: BoardSettings): boolean => JSON.stringify(a) === JSON.stringify(b);
