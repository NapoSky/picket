import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Locale } from 'discord-api-types/v10';
import { DEFAULT_LOCALE, LOCALES_DIR, createI18n, loadCatalogs, validateCatalogs } from '@picket/i18n';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { renderKeys } = require('../../../scripts/generate-i18n-keys.js') as { renderKeys(catalog: unknown): string };
const { readFileSync } = require('node:fs') as typeof import('node:fs');

const discordLocales = Object.values(Locale) as string[];

describe('shipped catalogs', () => {
  const catalogs = loadCatalogs();

  it('ships English as the source and French', () => {
    expect(Object.keys(catalogs)).toEqual(expect.arrayContaining(['en', 'fr']));
  });

  it('passes every CI check (known keys, placeholders, Discord limits, locale file names)', () => {
    expect(validateCatalogs(catalogs, discordLocales)).toEqual([]);
  });

  it('keeps the generated MessageKey type in sync with en.json (run `pnpm i18n:keys`)', () => {
    const generated = readFileSync(join(__dirname, '..', 'src', 'keys.generated.ts'), 'utf8');
    expect(generated).toBe(renderKeys(catalogs['en']));
  });

  it('translates every English key into French (no silent fallback for shipped languages)', () => {
    const flat = (value: unknown, prefix = ''): string[] =>
      Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
        typeof v === 'object' && v !== null ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`],
      );
    expect(flat(catalogs['fr']).sort()).toEqual(flat(catalogs['en']).sort());
  });

  it('discovers every file of the locales directory', () => {
    const files = readdirSync(LOCALES_DIR).filter((name) => name.endsWith('.json'));
    expect(Object.keys(catalogs).sort()).toEqual(files.map((f) => f.replace('.json', '')).sort());
  });
});

describe('validateCatalogs', () => {
  const en = { a: { greet: 'Hello {{name}}', plain: 'x' }, commands: { c: 'short' } };
  const run = (other: unknown, codes = ['en', 'fr']) => validateCatalogs({ en, fr: other }, codes);

  it('accepts a partial translation (missing keys fall back to English)', () => {
    expect(run({ a: { plain: 'y' } })).toEqual([]);
  });

  it('rejects unknown keys, changed placeholders, empty values and over-long command texts', () => {
    expect(run({ a: { nope: 'x' } })).toEqual(['fr: unknown key "a.nope"']);
    expect(run({ a: { greet: 'Bonjour {{nom}}' } })[0]).toMatch(/placeholders of "a.greet"/);
    expect(run({ a: { greet: 'Bonjour' } })[0]).toMatch(/placeholders of "a.greet"/);
    expect(run({ a: { plain: '  ' } })).toEqual(['fr: empty value for "a.plain"']);
    expect(run({ commands: { c: 'x'.repeat(101) } })[0]).toMatch(/101 characters/);
  });

  it('tolerates placeholder spacing and ordering', () => {
    expect(run({ a: { greet: 'Bonjour {{ name }}' } })).toEqual([]);
  });

  it('rejects a file name that is not a Discord locale code', () => {
    expect(validateCatalogs({ en, klingon: {} }, ['en'])).toEqual(['klingon: not a Discord locale code (file name)']);
  });
});

describe('createI18n', () => {
  const i18n = createI18n({
    en: { hello: 'Hello {{name}}', only: 'only english', commands: { x: 'Say it' } },
    fr: { hello: 'Bonjour {{name}}', commands: { x: 'Dis-le' } },
    'pt-BR': { hello: 'Olá {{name}}' },
  });

  it('translates with parameters and without HTML escaping', () => {
    expect(i18n.translator('fr').t('hello' as never, { name: "L'équipe <b>" })).toBe("Bonjour L'équipe <b>");
  });

  it('falls back to English for a missing key', () => {
    expect(i18n.translator('fr').t('only' as never)).toBe('only english');
  });

  it.each([
    [['fr'], 'fr'],
    [['fr-CA'], 'fr'],
    [['en-US'], 'en'],
    [['pt-BR'], 'pt-BR'],
    [['pt-br'], 'pt-BR'],
    [['de', 'fr'], 'fr'],
    [['de'], 'en'],
    [[undefined, null, ''], 'en'],
    [[], 'en'],
  ] as [string[], string][])('resolves %j to %s', (candidates, expected) => {
    expect(i18n.resolve(...candidates)).toBe(expected);
  });

  it('prefers the first supported candidate (user locale before guild locale)', () => {
    expect(i18n.resolve('en-US', 'fr')).toBe('en');
    expect(i18n.resolve('de', 'fr')).toBe('fr');
  });

  it('exposes command texts with localizations only for languages that translated them', () => {
    expect(i18n.text('commands.x' as never)).toEqual({ default: 'Say it', localizations: { fr: 'Dis-le' } });
    expect(i18n.text('hello' as never).localizations).toEqual({ fr: 'Bonjour {{name}}', 'pt-BR': 'Olá {{name}}' });
  });

  it('refuses a catalog set without the source language', () => {
    expect(() => createI18n({ fr: {} })).toThrow(/Missing source catalog/);
  });

  it('unresolvable locale yields the default translator', () => {
    expect(i18n.translator('xx').locale).toBe(DEFAULT_LOCALE);
  });
});
