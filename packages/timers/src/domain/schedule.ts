import { deadline, type TimerAsset } from './asset';
import type { BoardSettings } from './board-settings';
import { ABANDONED_AFTER_DAYS } from './constants';

/** Alert already reserved in the database for (asset, deadline, threshold). */
export interface AlertRow {
  readonly assetId: string;
  readonly dueAt: Date;
  readonly thresholdMin: number;
  /** `null`: threshold caught up without sending, or message already removed. */
  readonly messageId: string | null;
  readonly ackedAt: Date | null;
  /** Unconfirmed send, recoverable under the board lock after a restart. */
  readonly pending?: boolean;
}

export interface AlertClaim {
  readonly assetId: string;
  readonly dueAt: Date;
  readonly thresholdMin: number;
  /** Only the threshold closest to the deadline sends a message; catch up farther thresholds silently. */
  readonly send: boolean;
}

const MINUTE_MS = 60_000;

/**
 * Reached thresholds not yet reserved. After interruption, send only the alert closest to the deadline
 * rather than replaying every threshold. Refresh changes the deadline and rearms all thresholds.
 */
export function planAlerts(
  assets: readonly TimerAsset[],
  existing: readonly AlertRow[],
  settings: BoardSettings,
  now: Date,
): AlertClaim[] {
  if (!settings.alertsEnabled) return [];
  const ascending = [...settings.alertThresholdsMin].sort((a, b) => a - b);
  const claims: AlertClaim[] = [];
  for (const asset of assets) {
    const end = deadline(asset);
    if (end === null || end.getTime() <= now.getTime()) continue;
    const remaining = end.getTime() - now.getTime();
    const reached = ascending.filter((threshold) => threshold * MINUTE_MS >= remaining);
    const closest = reached[0];
    if (closest === undefined) continue;
    const known = new Set(
      existing.filter((row) => row.assetId === asset.id && row.dueAt.getTime() === end.getTime() && !row.pending).map((row) => row.thresholdMin),
    );
    for (const threshold of reached) {
      if (!known.has(threshold)) claims.push({ assetId: asset.id, dueAt: end, thresholdMin: threshold, send: threshold === closest });
    }
  }
  return claims;
}

/**
 * Alert messages to remove: asset struck, deleted or refreshed (deadline changed), deadline elapsed, or
 * alert superseded by a closer threshold.
 */
export function staleAlerts(assets: readonly TimerAsset[], existing: readonly AlertRow[], now: Date): AlertRow[] {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const live = existing.filter((row) => row.messageId !== null);
  return live.filter((row) => {
    const end = byId.get(row.assetId) === undefined ? null : deadline(byId.get(row.assetId) as TimerAsset);
    if (end === null || end.getTime() <= now.getTime() || end.getTime() !== row.dueAt.getTime()) return true;
    const closer = live.some(
      (other) => other.assetId === row.assetId && other.dueAt.getTime() === row.dueAt.getTime() && other.thresholdMin < row.thresholdMin,
    );
    return closer;
  });
}

/** Assets to delete: struck or expired longer than the board's purge delay. */
export function purgeCandidates(assets: readonly TimerAsset[], settings: BoardSettings, now: Date): TimerAsset[] {
  if (settings.purgeAfterHours === null) return [];
  const delay = settings.purgeAfterHours * 3_600_000;
  return assets.filter((asset) => {
    const reference = asset.status === 'struck' ? asset.struckAt : deadline(asset);
    return reference !== null && reference.getTime() + delay <= now.getTime();
  });
}

const DAY_MS = 24 * 3_600_000;

/** Time at which an empty board is deleted for inactivity. */
export const abandonedAt = (lastActivityAt: Date): Date => new Date(lastActivityAt.getTime() + ABANDONED_AFTER_DAYS * DAY_MS);

/** Empty board with no changes for `ABANDONED_AFTER_DAYS`: no longer in use. */
export const isAbandoned = (assets: readonly TimerAsset[], lastActivityAt: Date, now: Date): boolean =>
  assets.length === 0 && abandonedAt(lastActivityAt).getTime() <= now.getTime();

export interface WakeInput {
  readonly assets: readonly TimerAsset[];
  readonly settings: BoardSettings;
  readonly now: Date;
  readonly needsSync: boolean;
  readonly lastActivityAt: Date;
}

/**
 * Next board work time: pending rendering, alert threshold, deadline (display expired), purge or deletion of
 * an inactive empty board. `null` means nothing to schedule.
 */
export function nextWake(input: WakeInput): Date | null {
  const { assets, settings, now } = input;
  if (input.needsSync) return now;
  const nowMs = now.getTime();
  const candidates: number[] = [];
  for (const asset of assets) {
    const end = deadline(asset);
    if (end !== null && end.getTime() > nowMs) {
      candidates.push(end.getTime());
      if (settings.alertsEnabled) {
        for (const threshold of settings.alertThresholdsMin) {
          const fire = end.getTime() - threshold * MINUTE_MS;
          if (fire > nowMs) candidates.push(fire);
        }
      }
    }
    if (settings.purgeAfterHours !== null) {
      const reference = asset.status === 'struck' ? asset.struckAt : end;
      if (reference !== null) {
        const at = reference.getTime() + settings.purgeAfterHours * 3_600_000;
        candidates.push(at > nowMs ? at : nowMs);
      }
    }
  }
  if (assets.length === 0) candidates.push(Math.max(abandonedAt(input.lastActivityAt).getTime(), nowMs));
  return candidates.length === 0 ? null : new Date(Math.min(...candidates));
}
