import { createI18n } from '@picket/i18n';

/** Catalogues réels (en, fr, …) : les tests vérifient les textes livrés, pas des doublures. */
export const testI18n = createI18n();
export const englishT = testI18n.translator('en').t;
