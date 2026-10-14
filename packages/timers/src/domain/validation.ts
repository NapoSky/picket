import { err, ok, type Result } from '@picket/kernel';
import { findLocation, findRegion } from '@picket/game-data';
import { ASSET_TYPES, isAssetTypeId, type AssetType, type AssetTypeId, type Direction } from './asset-types';
import { MAX_DURATION_S, MAX_NAME_LENGTH, MIN_DURATION_S } from './constants';
import { parseDuration } from './duration';

export type ValidationError =
  | { readonly code: 'unknown_type' }
  | { readonly code: 'unknown_region' }
  | { readonly code: 'unknown_location' }
  | { readonly code: 'name_empty' }
  | { readonly code: 'name_too_long'; readonly max: number }
  | { readonly code: 'code_required' }
  | { readonly code: 'code_invalid' }
  | { readonly code: 'duration_invalid' }
  | { readonly code: 'duration_too_short'; readonly minSeconds: number }
  | { readonly code: 'duration_too_long'; readonly maxSeconds: number };

/** Raw input: everything comes from a user; assume nothing is valid. */
export interface AssetInput {
  readonly type: string;
  readonly regionKey: string;
  readonly locationKey: string;
  readonly name: string;
  readonly code: string;
  readonly duration: string;
}

export interface ValidAsset {
  readonly type: AssetTypeId;
  readonly regionKey: string;
  readonly locationKey: string;
  readonly name: string;
  readonly code: string | null;
  readonly durationS: number;
  readonly direction: Direction;
}

/**
 * Collapse spaces and remove control characters. Store the name as-is; escape Markdown and mentions when
 * rendering. Measure length here against what will actually be displayed.
 */
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

const NORMALIZED_CODE = /[\s\p{Cc}\p{Cf}]/gu;

function validateCode(type: AssetType, raw: string): Result<string | null, ValidationError> {
  const rule = type.code;
  const code = raw.replace(NORMALIZED_CODE, '');
  if (rule.mode === 'none') return ok(null);
  if (code === '') return rule.mode === 'required' ? err({ code: 'code_required' }) : ok(null);
  if (!rule.pattern.test(code)) return err({ code: 'code_invalid' });
  return ok(rule.uppercase ? code.toUpperCase() : code);
}

/** One rule for every entry path: the same input always gives the same result. */
export function validateAssetInput(input: AssetInput): Result<ValidAsset, ValidationError> {
  if (!isAssetTypeId(input.type)) return err({ code: 'unknown_type' });
  const type = ASSET_TYPES[input.type];

  if (findRegion(input.regionKey) === undefined) return err({ code: 'unknown_region' });
  if (findLocation(input.regionKey, input.locationKey) === undefined) return err({ code: 'unknown_location' });

  const name = normalizeName(input.name);
  if (name === '') return err({ code: 'name_empty' });
  if (Array.from(name).length > MAX_NAME_LENGTH) return err({ code: 'name_too_long', max: MAX_NAME_LENGTH });

  const code = validateCode(type, input.code);
  if (!code.ok) return code;

  // An age (`up`) has no duration: ignore input rather than reject it.
  let durationS = type.defaultDurationS;
  if (type.direction === 'down') {
    const parsed = parseDuration(input.duration, 'hours');
    if (!parsed.ok) return err({ code: 'duration_invalid' });
    if (parsed.value < MIN_DURATION_S) return err({ code: 'duration_too_short', minSeconds: MIN_DURATION_S });
    if (parsed.value > MAX_DURATION_S) return err({ code: 'duration_too_long', maxSeconds: MAX_DURATION_S });
    durationS = parsed.value;
  }

  return ok({
    type: type.id,
    regionKey: input.regionKey,
    locationKey: input.locationKey,
    name,
    code: code.value,
    durationS,
    direction: type.direction,
  });
}
