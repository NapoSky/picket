import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import i18next, { type Resource } from 'i18next';
import type { MessageKey } from './keys.generated';

export type { MessageKey } from './keys.generated';

export type MessageParams = Readonly<Record<string, string | number>>;

export interface Translator {
  readonly locale: string;
  t(key: MessageKey, params?: MessageParams): string;
}

/** Command text: default value (English) and translations indexed by Discord locale code. */
export interface LocalizedText {
  readonly default: string;
  readonly localizations: Readonly<Record<string, string>>;
}

export interface I18n {
  readonly defaultLocale: string;
  readonly locales: readonly string[];
  /** First supported candidate (exact, language only, unique variant), otherwise the default locale. */
  resolve(...candidates: readonly (string | null | undefined)[]): string;
  translator(locale: string): Translator;
  text(key: MessageKey): LocalizedText;
}

export const DEFAULT_LOCALE = 'en';

// The `locales` directory is a sibling of `src` and `dist`.
export const LOCALES_DIR = join(__dirname, '..', 'locales');

export type Catalogs = Readonly<Record<string, unknown>>;

/** Discover every added locale here (for example through Weblate) without changing code. */
export function loadCatalogs(directory: string = LOCALES_DIR): Catalogs {
  const catalogs: Record<string, unknown> = {};
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.json')).sort()) {
    catalogs[file.slice(0, -'.json'.length)] = JSON.parse(readFileSync(join(directory, file), 'utf8'));
  }
  return catalogs;
}

export function createI18n(catalogs: Catalogs = loadCatalogs()): I18n {
  if (!(DEFAULT_LOCALE in catalogs)) throw new Error(`Missing source catalog "${DEFAULT_LOCALE}"`);

  const instance = i18next.createInstance();
  void instance.init({
    initAsync: false,
    lng: DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: Object.keys(catalogs),
    resources: Object.fromEntries(
      Object.entries(catalogs).map(([locale, translation]) => [locale, { translation }]),
    ) as unknown as Resource,
    // Content goes to Discord, not HTML; allowed_mentions neutralizes mentions.
    interpolation: { escapeValue: false },
    nsSeparator: false,
    returnNull: false,
  });

  const locales = Object.keys(catalogs);
  const known = new Map(locales.map((locale) => [locale.toLowerCase(), locale]));
  // For example, `es` and `es-419` use `es-ES` while it is our only Spanish variant.
  // With multiple variants, require an exact match or a language-only catalog.
  const variants = new Map<string, string[]>();
  for (const locale of locales) {
    const language = locale.toLowerCase().split('-')[0]!;
    variants.set(language, [...(variants.get(language) ?? []), locale]);
  }
  const uniqueVariants = new Map([...variants].flatMap(([language, choices]) =>
    choices.length === 1 ? [[language, choices[0]!] as const] : [],
  ));

  const resolve: I18n['resolve'] = (...candidates) => {
    for (const candidate of candidates) {
      if (!candidate) continue;
      const lower = candidate.toLowerCase();
      const language = lower.split('-')[0] ?? lower;
      const match = known.get(lower) ?? known.get(language) ?? uniqueVariants.get(language);
      if (match) return match;
    }
    return DEFAULT_LOCALE;
  };

  return {
    defaultLocale: DEFAULT_LOCALE,
    locales,
    resolve,
    translator(locale) {
      const resolved = resolve(locale);
      const fixed = instance.getFixedT(resolved) as unknown as (key: string, options?: Record<string, unknown>) => string;
      return { locale: resolved, t: (key, params) => fixed(key, params ? { ...params } : undefined) };
    },
    text(key) {
      const localizations: Record<string, string> = {};
      for (const locale of locales) {
        if (locale !== DEFAULT_LOCALE && instance.exists(key, { lng: locale, fallbackLng: [] })) {
          localizations[locale] = instance.t(key, { lng: locale, fallbackLng: [] });
        }
      }
      return { default: instance.t(key, { lng: DEFAULT_LOCALE }), localizations };
    },
  };
}
