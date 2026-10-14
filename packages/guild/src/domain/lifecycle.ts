const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_RETENTION_DAYS = 30;

/** `requested`: an administrator requested deletion; `left`: the bot left the guild. */
export type DeactivationReason = 'requested' | 'left';

/** Permanent deletion date for a deactivated guild. */
export function purgeDate(inactiveSince: Date, retentionDays: number): Date {
  return new Date(inactiveSince.getTime() + retentionDays * DAY_MS);
}

/** Oldest deactivation date for guilds that must now be purged. */
export function purgeCutoff(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * DAY_MS);
}

/** Formule Discord : `(guild_id >> 22) % shard_count`. */
export function shardOf(guildId: string, shardCount: number): number {
  return Number((BigInt(guildId) >> 22n) % BigInt(shardCount));
}
