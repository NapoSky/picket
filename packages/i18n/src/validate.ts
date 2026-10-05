import { DEFAULT_LOCALE, type Catalogs } from './i18n';

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;
const DISCORD_TEXT_MAX = 100;

function flatten(value: unknown, prefix = ''): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof child === 'string') out.set(path, child);
      else if (child !== null && typeof child === 'object') for (const [k, v] of flatten(child, path)) out.set(k, v);
      else out.set(path, null);
    }
  }
  return out;
}

const placeholders = (text: string): string[] => [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1] as string))].sort();

/**
 * Contrôles exécutés en CI sur chaque catalogue (y compris ceux proposés par Weblate).
 * Une clé absente d'une langue est tolérée : elle retombe sur l'anglais.
 */
export function validateCatalogs(catalogs: Catalogs, validLocaleCodes: readonly string[]): string[] {
  const problems: string[] = [];
  const source = flatten(catalogs[DEFAULT_LOCALE]);

  for (const [locale, catalog] of Object.entries(catalogs)) {
    // La langue source (`en`) sert de valeur par défaut ; les autres noms de fichier sont des codes de langue Discord.
    if (locale !== DEFAULT_LOCALE && !validLocaleCodes.includes(locale)) {
      problems.push(`${locale}: not a Discord locale code (file name)`);
    }
    for (const [key, text] of flatten(catalog)) {
      const reference = source.get(key);
      if (reference === undefined) {
        problems.push(`${locale}: unknown key "${key}"`);
        continue;
      }
      if (typeof text !== 'string' || text.trim() === '') {
        problems.push(`${locale}: empty value for "${key}"`);
        continue;
      }
      if (reference !== null && placeholders(reference).join() !== placeholders(text).join()) {
        problems.push(`${locale}: placeholders of "${key}" differ from the source (${placeholders(reference).join(', ') || 'none'})`);
      }
      // Les textes de commandes sont envoyés à Discord, qui les limite à 100 caractères.
      if (key.startsWith('commands.') && text.length > DISCORD_TEXT_MAX) {
        problems.push(`${locale}: "${key}" is ${text.length} characters long (Discord limit: ${DISCORD_TEXT_MAX})`);
      }
    }
  }
  return problems;
}
