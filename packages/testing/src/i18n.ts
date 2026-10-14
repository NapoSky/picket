import { createI18n } from '@picket/i18n';

/** Real catalogs (en, fr, etc.): tests verify shipped text, not doubles. */
export const testI18n = createI18n();
export const englishT = testI18n.translator('en').t;
