/** Un asset occupe un bouton : 25 par message (limite Discord). */
export const MAX_ACTIVE_PER_PAGE = 25;
export const MAX_NAME_LENGTH = 15;

export const MIN_DURATION_S = 60;
export const MAX_DURATION_S = 30 * 24 * 3600;

/** Quota fixe par tableau, toutes pages confondues. */
export const MAX_ACTIVE_PER_BOARD = 50;
export const MAX_BOARDS_PER_GUILD = 10;
/** Un board sans aucun timer et sans modification depuis ce délai est supprimé avec ses données. */
export const ABANDONED_AFTER_DAYS = 30;

export const MAX_ALERT_THRESHOLDS = 4;
export const MIN_THRESHOLD_MIN = 5;
export const MAX_THRESHOLD_MIN = 7 * 24 * 60;
export const MAX_ALERT_ROLES = 5;
export const MAX_PURGE_HOURS = 30 * 24;

export const BOARD_COLOR = 0x2b5fb3;

/** Icônes fixes d'en-tête de lieu (emojis de la communauté PICKET). */
export const DEFAULT_REGION_EMOJI = '<:region:1556691725001687090>';
export const DEFAULT_LOCATION_EMOJI = '<:Storage:1556691752050499734>';
