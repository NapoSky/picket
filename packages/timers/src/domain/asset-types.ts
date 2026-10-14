export const ASSET_TYPE_IDS = ['stockpile', 'facility', 'field', 'naval_ship', 'tank', 'train'] as const;
export type AssetTypeId = (typeof ASSET_TYPE_IDS)[number];

/** `down`: countdown to `start + duration`; `up`: age since start. */
export type Direction = 'down' | 'up';

export interface CodeRule {
  readonly mode: 'required' | 'optional' | 'none';
  readonly pattern: RegExp;
  readonly maxLength: number;
  /** Convert to uppercase when stored. */
  readonly uppercase: boolean;
}

export interface AssetType {
  readonly id: AssetTypeId;
  /** Two letters used in `custom_id` values. */
  readonly short: string;
  readonly icon: string;
  readonly direction: Direction;
  /** Suggested input duration; irrelevant to `up` types, which never request a duration. */
  readonly defaultDurationS: number;
  readonly code: CodeRule;
  /** Rank within a location: stockpiles first. */
  readonly order: number;
  /** Display the owner on the board? Not for a field, which has no responsible person to remind. */
  readonly showOwner: boolean;
}

const HOUR = 3600;
const NO_CODE: CodeRule = { mode: 'none', pattern: /^$/u, maxLength: 0, uppercase: false };
// One code format for input, validation and rendering: 3 to 6 alphanumeric characters.
const SHORT_CODE: CodeRule = { mode: 'optional', pattern: /^[A-Za-z0-9]{3,6}$/u, maxLength: 6, uppercase: true };

/**
 * The 50 h and 48 h durations come from the original bot; their relation to game rules remains unconfirmed.
 */
export const ASSET_TYPES: Readonly<Record<AssetTypeId, AssetType>> = {
  stockpile: {
    id: 'stockpile',
    short: 'st',
    icon: '📦',
    direction: 'down',
    defaultDurationS: 50 * HOUR,
    code: { mode: 'required', pattern: /^\d{6}$/u, maxLength: 6, uppercase: false },
    order: 1,
    showOwner: true,
  },
  facility: { id: 'facility', short: 'fa', icon: '🏭', direction: 'down', defaultDurationS: 50 * HOUR, code: NO_CODE, order: 2, showOwner: true },
  field: { id: 'field', short: 'fi', icon: '⛏️', direction: 'up', defaultDurationS: HOUR, code: NO_CODE, order: 3, showOwner: false },
  naval_ship: { id: 'naval_ship', short: 'ns', icon: '⚓', direction: 'down', defaultDurationS: 48 * HOUR, code: SHORT_CODE, order: 4, showOwner: true },
  tank: { id: 'tank', short: 'ta', icon: '⚙️', direction: 'down', defaultDurationS: 48 * HOUR, code: SHORT_CODE, order: 5, showOwner: true },
  train: { id: 'train', short: 'tr', icon: '🚂', direction: 'down', defaultDurationS: 48 * HOUR, code: SHORT_CODE, order: 6, showOwner: true },
};

export const isAssetTypeId = (value: string): value is AssetTypeId => (ASSET_TYPE_IDS as readonly string[]).includes(value);

export function assetTypeByShort(short: string): AssetType | undefined {
  return ASSET_TYPE_IDS.map((id) => ASSET_TYPES[id]).find((type) => type.short === short);
}
