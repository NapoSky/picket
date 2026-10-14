import type { ChannelId, GuildId } from '@picket/kernel';

export const FEATURES = ['timers', 'todolists', 'warlog', 'stats'] as const;
export type Feature = (typeof FEATURES)[number];
export type GuildFeatures = Readonly<Record<Exclude<Feature,'stats'>, boolean> & { stats?: boolean }>;

export interface GuildSettings {
  readonly guildId: GuildId;
  /** `null`: automatic (Discord user's locale); otherwise force this locale for the entire guild. */
  readonly locale: string | null;
  readonly timezone: string;
  readonly auditChannelId: ChannelId | null;
  readonly auditFailure?: string;
  readonly features: GuildFeatures;
  readonly installedAt: Date;
}

export function enabledFeatures(settings: GuildSettings): readonly Feature[] {
  return FEATURES.filter((feature) => settings.features[feature]);
}

export type SettingsChange =
  | { readonly kind: 'language'; readonly locale: string | null }
  | { readonly kind: 'timezone'; readonly timezone: string }
  | { readonly kind: 'audit_channel'; readonly channelId: ChannelId | null }
  | { readonly kind: 'feature'; readonly feature: Feature; readonly enabled: boolean };

export type SettingsRejection = 'unsupported_language' | 'invalid_timezone';

export type SettingsDecision =
  | { readonly kind: 'apply'; readonly next: GuildSettings }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'rejected'; readonly reason: SettingsRejection };

// IANA names only: `Intl` also accepts offsets (+01:00), which have no daylight-saving rules.
const IANA_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;

/** Valid IANA name (case corrected: europe/paris becomes Europe/Paris), or `null` if unknown. */
export function normalizeTimeZone(input: string): string | null {
  const candidate = input.trim();
  if (candidate.length > 64 || !IANA_NAME.test(candidate)) return null;
  try {
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone: candidate }).resolvedOptions().timeZone;
    // For aliases (Asia/Kolkata becomes Asia/Calcutta), keep the entered, more recognizable name.
    return resolved.toLowerCase() === candidate.toLowerCase() ? resolved : candidate;
  } catch {
    return null;
  }
}

export function decideSettingsChange(
  current: GuildSettings,
  change: SettingsChange,
  supportedLocales: readonly string[],
): SettingsDecision {
  switch (change.kind) {
    case 'language':
      if (change.locale !== null && !supportedLocales.includes(change.locale)) {
        return { kind: 'rejected', reason: 'unsupported_language' };
      }
      return change.locale === current.locale
        ? { kind: 'unchanged' }
        : { kind: 'apply', next: { ...current, locale: change.locale } };
    case 'timezone': {
      const timezone = normalizeTimeZone(change.timezone);
      if (timezone === null) return { kind: 'rejected', reason: 'invalid_timezone' };
      return timezone === current.timezone ? { kind: 'unchanged' } : { kind: 'apply', next: { ...current, timezone } };
    }
    case 'audit_channel':
      return change.channelId === current.auditChannelId
        ? { kind: 'unchanged' }
        : { kind: 'apply', next: { ...current, auditChannelId: change.channelId } };
    case 'feature':
      return current.features[change.feature] === change.enabled
        ? { kind: 'unchanged' }
        : { kind: 'apply', next: { ...current, features: { ...current.features, [change.feature]: change.enabled } } };
  }
}

/** Audit log before/after column content. */
export function settingsSnapshot(settings: GuildSettings): Record<string, unknown> {
  return {
    language: settings.locale,
    timezone: settings.timezone,
    auditChannelId: settings.auditChannelId,
    features: settings.features,
  };
}
