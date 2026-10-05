const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_RETENTION_DAYS = 30;

/** `requested` : un administrateur a demandé la suppression ; `left` : le bot a quitté le serveur. */
export type DeactivationReason = 'requested' | 'left';

/** Date de suppression définitive d'une guilde désactivée. */
export function purgeDate(inactiveSince: Date, retentionDays: number): Date {
  return new Date(inactiveSince.getTime() + retentionDays * DAY_MS);
}

/** Plus ancienne date de désactivation dont la guilde doit être purgée maintenant. */
export function purgeCutoff(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * DAY_MS);
}

/** Formule Discord : `(guild_id >> 22) % shard_count`. */
export function shardOf(guildId: string, shardCount: number): number {
  return Number((BigInt(guildId) >> 22n) % BigInt(shardCount));
}
