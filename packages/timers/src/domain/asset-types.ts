export const ASSET_TYPE_IDS = ['stockpile', 'facility', 'field', 'naval_ship', 'tank', 'train'] as const;
export type AssetTypeId = (typeof ASSET_TYPE_IDS)[number];

/** `down` : compte à rebours vers `début + durée` ; `up` : ancienneté depuis le début. */
export type Direction = 'down' | 'up';

export interface CodeRule {
  readonly mode: 'required' | 'optional' | 'none';
  readonly pattern: RegExp;
  readonly maxLength: number;
  /** Mis en majuscules à l'enregistrement. */
  readonly uppercase: boolean;
}

export interface AssetType {
  readonly id: AssetTypeId;
  /** Deux lettres, utilisées dans les `custom_id`. */
  readonly short: string;
  readonly icon: string;
  readonly direction: Direction;
  /** Durée proposée à la saisie ; sans effet pour un type `up`, où elle n'est jamais demandée. */
  readonly defaultDurationS: number;
  readonly code: CodeRule;
  /** Rang dans un lieu : les stockpiles d'abord. */
  readonly order: number;
  /** Le propriétaire est-il affiché dans le tableau ? Pas pour un champ, qui n'a pas de responsable à relancer. */
  readonly showOwner: boolean;
}

const HOUR = 3600;
const NO_CODE: CodeRule = { mode: 'none', pattern: /^$/u, maxLength: 0, uppercase: false };
// Un seul format de code partout (saisie, validation, rendu) : 3 à 6 caractères alphanumériques.
const SHORT_CODE: CodeRule = { mode: 'optional', pattern: /^[A-Za-z0-9]{3,6}$/u, maxLength: 6, uppercase: true };

/** Les durées de 50 h et 48 h sont celles du bot d'origine : leur lien avec les règles du jeu reste à confirmer. */
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
