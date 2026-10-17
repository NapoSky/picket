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

  it('ships English as the source, French, German, Spanish, Brazilian Portuguese, Polish and Simplified Chinese', () => {
    expect(Object.keys(catalogs)).toEqual(expect.arrayContaining(['en', 'fr', 'de', 'es-ES', 'pt-BR', 'pl', 'zh-CN']));
  });

  it('passes every CI check (known keys, placeholders, Discord limits, locale file names)', () => {
    expect(validateCatalogs(catalogs, discordLocales)).toEqual([]);
  });

  it('keeps the generated MessageKey type in sync with en.json (run `pnpm i18n:keys`)', () => {
    const generated = readFileSync(join(__dirname, '..', 'src', 'keys.generated.ts'), 'utf8');
    expect(generated).toBe(renderKeys(catalogs['en']));
  });

  it.each(Object.keys(catalogs).filter((locale) => locale !== DEFAULT_LOCALE))('translates every English key into %s (no silent fallback)', (locale) => {
    const flat = (value: unknown, prefix = ''): string[] =>
      Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
        typeof v === 'object' && v !== null ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`],
      );
    const sourceKeys = flat(catalogs['en']);
    // Additional locale-specific plurals are checked by validateCatalogs above.
    expect(flat(catalogs[locale]).filter((key) => sourceKeys.includes(key)).sort()).toEqual(sourceKeys.sort());
  });

  it.each([
    ['de-DE', 'de', 'Gespeichert.'],
    ['de', 'de', 'Gespeichert.'],
    ['es', 'es-ES', 'Guardado.'],
    ['es-ES', 'es-ES', 'Guardado.'],
    ['es-419', 'es-ES', 'Guardado.'],
    ['ES-mx', 'es-ES', 'Guardado.'],
    ['pt-BR', 'pt-BR', 'Salvo.'],
    ['pt-br', 'pt-BR', 'Salvo.'],
    ['pt', 'pt-BR', 'Salvo.'],
    ['pt-PT', 'pt-BR', 'Salvo.'],
    ['pl', 'pl', 'Zapisano.'],
    ['pl-PL', 'pl', 'Zapisano.'],
    ['zh-CN', 'zh-CN', '已保存。'],
    ['zh-cn', 'zh-CN', '已保存。'],
    ['zh', 'zh-CN', '已保存。'],
  ])('provides the %s user with the %s catalog', (candidate, locale, saved) => {
    const i18n = createI18n(catalogs);
    expect(i18n.resolve(candidate, 'fr')).toBe(locale);
    expect(i18n.translator(candidate).t('panel.saved')).toBe(saved);
  });

  it.each([
    ['de', 'zugelassene Rolle', 'zugelassene Rollen', 'Seite', 'Seiten'],
    ['es-ES', 'rol permitido', 'roles permitidos', 'página', 'páginas'],
  ])('renders counts and interpolated Discord timestamps in %s', (locale, role, roles, page, pages) => {
    const t = createI18n(catalogs).translator(locale).t;
    for (const count of [0, 1, 2]) {
      expect(t('panel.roleCount', { count })).toBe(`${count} ${count === 1 ? role : roles}`);
      expect(t('audit.pageCount', { count })).toBe(`${count} ${count === 1 ? page : pages}`);
    }
    expect(t('panel.deletionDate', { timestamp: 1791370800 })).toContain('<t:1791370800:F> (<t:1791370800:R>)');
  });

  it('renders Portuguese counts and timer alerts with the resource name and Discord timestamp', () => {
    const t = createI18n(catalogs).translator('pt-BR').t;
    expect(t('panel.roleCount', { count: 1 })).toBe('1 cargo permitido');
    expect(t('panel.roleCount', { count: 2 })).toBe('2 cargos permitidos');
    expect(t('audit.pageCount', { count: 1 })).toBe('1 página');
    expect(t('audit.pageCount', { count: 2 })).toBe('2 páginas');
    expect(t('timers.alert.text', { icon: '⏱️', name: 'Alpha', place: 'Blemish', time: '<t:1791370800:R>' }))
      .toBe('⏱️ **Alpha** (Blemish) expira <t:1791370800:R>.');
  });

  it.each([
    [0, 'dozwolonych ról', 'stron'],
    [1, 'dozwolona rola', 'strona'],
    [2, 'dozwolone role', 'strony'],
    [5, 'dozwolonych ról', 'stron'],
    [12, 'dozwolonych ról', 'stron'],
    [21, 'dozwolonych ról', 'stron'],
    [22, 'dozwolone role', 'strony'],
    [25, 'dozwolonych ról', 'stron'],
    [112, 'dozwolonych ról', 'stron'],
    [1.5, 'dozwolonej roli', 'strony'],
  ])('renders Polish plurals for %s', (count, roles, pages) => {
    const t = createI18n(catalogs).translator('pl').t;
    expect(t('panel.roleCount', { count })).toBe(`${count} ${roles}`);
    expect(t('audit.pageCount', { count })).toBe(`${count} ${pages}`);
  });

  it('preserves Polish alert interpolation and Discord timestamps', () => {
    const t = createI18n(catalogs).translator('pl').t;
    expect(t('timers.alert.text', { icon: '⏱️', name: 'Alpha', place: 'Blemish', time: '<t:1791370800:R>' }))
      .toBe('⏱️ **Alpha** (Blemish) wygasa <t:1791370800:R>.');
    expect(t('panel.deletionDate', { timestamp: 1791370800 })).toContain('<t:1791370800:F> (<t:1791370800:R>)');
  });

  it('renders Chinese counts without singular or plural changes and preserves alert parameters', () => {
    const t = createI18n(catalogs).translator('zh-CN').t;
    for (const count of [0, 1, 2, 25, 1.5]) {
      expect(t('panel.roleCount', { count })).toBe(`${count} 个获准身份组`);
      expect(t('audit.pageCount', { count })).toBe(`${count} 页`);
    }
    expect(t('timers.alert.text', { icon: '⏱️', name: 'Alpha', place: 'Blemish', time: '<t:1791370800:R>' }))
      .toBe('⏱️ **Alpha**（Blemish）将于 <t:1791370800:R> 到期。');
    expect(t('panel.deletionDate', { timestamp: 1791370800 }))
      .toBe('**删除日期**：<t:1791370800:F>（<t:1791370800:R>）。');
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

  it('accepts locale-specific plural forms while validating their keys and placeholders', () => {
    const en = { items_one: '{{count}} item', items_other: '{{count}} items', plain: 'x' };
    const run = (pl: unknown) => validateCatalogs({ en, pl }, ['pl']);
    expect(run({ items_few: '{{count}} elementy', items_many: '{{count}} elementów' })).toEqual([]);
    expect(run({ items_few: 'elementy' })[0]).toMatch(/placeholders of "items_few"/);
    expect(run({ items_many: '' })[0]).toMatch(/empty value/);
    expect(run({ items_two: '{{count}} elementy' })).toEqual(['pl: unknown key "items_two"']);
    expect(run({ nope_few: 'x' })).toEqual(['pl: unknown key "nope_few"']);
    expect(run({ plain_many: 'x' })).toEqual(['pl: unknown key "plain_many"']);
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
    [['pt'], 'pt-BR'],
    [['pt-PT'], 'pt-BR'],
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

  it('prefers exact or base matches and never arbitrarily chooses between regional catalogs', () => {
    const catalogs = { en: {}, 'es-ES': {}, 'es-419': {}, fr: {} };
    const regional = createI18n(catalogs);
    expect(regional.resolve('es-419')).toBe('es-419');
    expect(regional.resolve('es-MX', 'fr')).toBe('fr');
    expect(regional.resolve('es')).toBe('en');
    expect(createI18n({ ...catalogs, es: {} }).resolve('es-MX')).toBe('es');
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
