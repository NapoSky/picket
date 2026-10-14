import type { UserId } from '@picket/kernel';
import { findLocation, findRegion } from '@picket/game-data';
import { ASSET_TYPES, type AssetTypeId, type Direction } from './asset-types';

export type AssetStatus = 'active' | 'struck';

export interface TimerAsset {
  readonly id: string;
  readonly boardId: string;
  readonly type: AssetTypeId;
  readonly name: string;
  readonly code: string | null;
  readonly regionKey: string;
  readonly locationKey: string;
  readonly ownerId: UserId;
  readonly direction: Direction;
  readonly durationS: number;
  readonly startedAt: Date;
  readonly status: AssetStatus;
  readonly struckAt: Date | null;
  /** Deadline displayed when struck; preserve the original duration. */
  readonly frozenAt: Date | null;
  readonly rev: number;
}

/** Active countdown deadline; `null` for an age or struck asset. */
export function deadline(asset: TimerAsset): Date | null {
  return asset.status === 'active' && asset.direction === 'down' ? new Date(asset.startedAt.getTime() + asset.durationS * 1000) : null;
}

/** Instant displayed on the board: deadline, age or a struck asset's frozen instant. */
export function displayedMoment(asset: TimerAsset): Date {
  if (asset.status === 'struck') return asset.frozenAt ?? asset.startedAt;
  return deadline(asset) ?? asset.startedAt;
}

/** Expired is informational only: keep the asset displayed until struck or purged. */
export function isExpired(asset: TimerAsset, now: Date): boolean {
  const end = deadline(asset);
  return end !== null && end.getTime() <= now.getTime();
}

export function strikeAsset(asset: TimerAsset, now: Date): TimerAsset {
  return { ...asset, status: 'struck', struckAt: now, frozenAt: displayedMoment(asset), rev: asset.rev + 1 };
}

/** Reset the timer: countdowns restart with their duration, ages restart at 0. */
export function refreshAsset(asset: TimerAsset, now: Date): TimerAsset {
  return { ...asset, startedAt: now, rev: asset.rev + 1 };
}

/** Re-adding a struck asset restores its position: same identifier, new start. */
export function reactivateAsset(
  asset: TimerAsset,
  request: { readonly ownerId: UserId; readonly durationS: number; readonly now: Date },
): TimerAsset {
  return {
    ...asset,
    status: 'active',
    struckAt: null,
    frozenAt: null,
    startedAt: request.now,
    durationS: request.durationS,
    ownerId: request.ownerId,
    rev: asset.rev + 1,
  };
}

/** Same resource: type, case-insensitive name, location and code. */
export function sameResource(a: Pick<TimerAsset, 'type' | 'name' | 'code' | 'regionKey' | 'locationKey'>, b: typeof a): boolean {
  return (
    a.type === b.type &&
    a.regionKey === b.regionKey &&
    a.locationKey === b.locationKey &&
    a.name.toLowerCase() === b.name.toLowerCase() &&
    (a.code ?? '') === (b.code ?? '')
  );
}

export const activeAssets = (assets: readonly TimerAsset[]): TimerAsset[] => assets.filter((asset) => asset.status === 'active');

/** Region, location, type, name: display order, identical everywhere. */
export function compareAssets(a: TimerAsset, b: TimerAsset): number {
  const regionA = findRegion(a.regionKey)?.order ?? Number.MAX_SAFE_INTEGER;
  const regionB = findRegion(b.regionKey)?.order ?? Number.MAX_SAFE_INTEGER;
  if (regionA !== regionB) return regionA - regionB;
  if (a.regionKey !== b.regionKey) return a.regionKey.localeCompare(b.regionKey);
  const locationA = findLocation(a.regionKey, a.locationKey)?.order ?? Number.MAX_SAFE_INTEGER;
  const locationB = findLocation(b.regionKey, b.locationKey)?.order ?? Number.MAX_SAFE_INTEGER;
  if (locationA !== locationB) return locationA - locationB;
  if (a.locationKey !== b.locationKey) return a.locationKey.localeCompare(b.locationKey);
  const typeOrder = ASSET_TYPES[a.type].order - ASSET_TYPES[b.type].order;
  if (typeOrder !== 0) return typeOrder;
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}
