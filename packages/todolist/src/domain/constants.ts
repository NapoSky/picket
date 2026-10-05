/** Limites de la grammaire et du rendu (voir `docs/guide/todolists.md`). */
export const MAX_INPUT_LENGTH = 4000;
export const MAX_ITEMS = 100;
export const ITEMS_PER_PAGE = 25;
export const MAX_ITEM_TEXT = 300;
export const MAX_FACTOR = 999;
export const MAX_CATEGORY_NAME = 100;

/**
 * Longueur d'une description d'embed : 4096 chez Discord. Chaque item coché grandit de 3 caractères
 * (`🇦・x` devient `✅・~~x~~`) : 25 clics sur une page pleine doivent rester sous la limite.
 */
export const PAGE_SOFT_BUDGET = 3800;
export const PAGE_HARD_BUDGET = 4020;

export const ITEM_SEPARATOR = '・';
export const DONE_MARKER = '✅';
export const REGIONAL_INDICATOR_A = 0x1f1e6;

/** Emoji lettre régionale d'un item : 0 donne 🇦. */
export const letterEmoji = (index: number): string => String.fromCodePoint(REGIONAL_INDICATOR_A + index);
