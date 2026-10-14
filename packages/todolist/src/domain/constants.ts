/** Grammar and rendering limits (see `docs/guide/todolists.md`). */
export const MAX_INPUT_LENGTH = 4000;
export const MAX_ITEMS = 100;
export const ITEMS_PER_PAGE = 25;
export const MAX_ITEM_TEXT = 300;
export const MAX_FACTOR = 999;
export const MAX_CATEGORY_NAME = 100;

/**
 * Discord embed descriptions allow 4,096 characters. Each ticked item grows by 3 characters (`🇦・x` becomes
 * `✅・~~x~~`): 25 clicks on a full page must stay below the limit.
 */
export const PAGE_SOFT_BUDGET = 3800;
export const PAGE_HARD_BUDGET = 4020;

export const ITEM_SEPARATOR = '・';
export const DONE_MARKER = '✅';
export const REGIONAL_INDICATOR_A = 0x1f1e6;

/** Regional-indicator emoji for an item: 0 gives 🇦. */
export const letterEmoji = (index: number): string => String.fromCodePoint(REGIONAL_INDICATOR_A + index);
