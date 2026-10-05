import { UserId } from '@picket/kernel';
import type { TimerAsset } from '../src/domain/asset';

export const OWNER = UserId.assert('500000000000000001');
export const OTHER = UserId.assert('500000000000000002');
export const NOW = new Date('2026-10-05T12:00:00Z');
export const HOUR_MS = 3_600_000;

export const REGION = 'allodsbight';
export const LOCATION = 'mercyswail';

let counter = 0;

/** Asset d'essai : un stockpile actif de 50 h démarré à `NOW`, sauf indication contraire. */
export function makeAsset(overrides: Partial<TimerAsset> = {}): TimerAsset {
  counter += 1;
  return {
    id: `asset${String(counter).padStart(5, '0')}`,
    boardId: '00000000-0000-4000-8000-000000000001',
    type: 'stockpile',
    name: `Depot ${counter}`,
    code: '123456',
    regionKey: REGION,
    locationKey: LOCATION,
    ownerId: OWNER,
    direction: 'down',
    durationS: 50 * 3600,
    startedAt: NOW,
    status: 'active',
    struckAt: null,
    frozenAt: null,
    rev: 0,
    ...overrides,
  };
}

export const unix = (date: Date): number => Math.floor(date.getTime() / 1000);
