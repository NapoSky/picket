export const STATS_RETENTION_MS = 60 * 24 * 60 * 60 * 1_000;
export const STATS_REFRESH_MS = 120_000;
export type VoiceQuality = 'observed' | 'snapshot' | 'replayed' | 'interrupted';
export type EndReason =
  'leave' | 'move' | 'excluded' | 'role_lost' | 'disabled' | 'privacy' | 'recovery' | 'retention';

export interface VoicePerson {
  readonly userId: string;
  readonly channelId: string | null;
  readonly roles: readonly string[];
  readonly bot: boolean;
  readonly name: string;
}

export interface StatsConfig {
  readonly guildId: string;
  readonly timezone?: string;
  readonly enabled: boolean;
  readonly roles: readonly string[];
  readonly excludedChannels: readonly string[];
  readonly afkChannelId: string | null;
  readonly changedAt: Date;
  readonly enabledAt?: Date | null;
}

export interface VoiceObservation extends VoicePerson {
  readonly key: string;
  readonly guildId: string;
  readonly shardId: number;
  readonly at: string;
  readonly quality: VoiceQuality;
  readonly channelName: string;
}

export function validTargets(guildId: string, roles: readonly string[]): boolean {
  return roles.length > 0 && !roles.includes(guildId);
}

export function eligible(config: StatsConfig, person: VoicePerson): boolean {
  return (
    config.enabled &&
    validTargets(config.guildId, config.roles) &&
    !person.bot &&
    person.channelId !== null &&
    person.channelId !== config.afkChannelId &&
    !config.excludedChannels.includes(person.channelId) &&
    person.roles.some((role) => config.roles.includes(role))
  );
}

/** Half-open intervals: moves at the same instant never double count. */
export function overlapSeconds(start: Date, end: Date, from: Date, to: Date): number {
  return (
    Math.max(0, Math.min(end.getTime(), to.getTime()) - Math.max(start.getTime(), from.getTime())) / 1_000
  );
}

export interface StatsScope {
  readonly kind: 'self' | 'guild' | 'global';
  readonly guildId: string | null;
  readonly userId: string;
}
export interface StatsPeriod {
  readonly from: Date;
  readonly to: Date;
  readonly channelId?: string;
}

export function parsePeriod(from: unknown, to: unknown, now: Date): StatsPeriod | null {
  const until = to === undefined ? now : typeof to === 'string' ? new Date(to) : new Date(NaN);
  const since =
    from === undefined
      ? new Date(now.getTime() - 7 * 86_400_000)
      : typeof from === 'string'
        ? new Date(from)
        : new Date(NaN);
  if (
    !Number.isFinite(since.getTime()) ||
    !Number.isFinite(until.getTime()) ||
    since >= until ||
    until > now ||
    since.getTime() < now.getTime() - STATS_RETENTION_MS
  )
    return null;
  return { from: since, to: until };
}
