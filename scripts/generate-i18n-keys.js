'use strict';
// Génère src/keys.generated.ts (type `MessageKey`) à partir de locales/en.json, la langue source.
// Usage : `pnpm i18n:keys` ; le test du package vérifie que le fichier est à jour.
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function flatten(value, prefix = '') {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child !== null && typeof child === 'object' ? flatten(child, path) : [path];
  });
}

/** Les clés de pluriel (`x_one`, `x_other`) sont exposées sous le nom `x`. */
function messageKeys(catalog) {
  return [...new Set(flatten(catalog).map((key) => key.replace(PLURAL_SUFFIX, '')))].sort();
}

function renderKeys(catalog) {
  const union = messageKeys(catalog).map((key) => `  | '${key}'`).join('\n');
  return [
    '// Fichier généré par scripts/generate-i18n-keys.js : ne pas modifier à la main.',
    'export type MessageKey =',
    `${union};`,
    '',
  ].join('\n');
}

module.exports = { flatten, messageKeys, renderKeys };

if (require.main === module) {
  const root = join(__dirname, '..', 'packages', 'i18n');
  const catalog = JSON.parse(readFileSync(join(root, 'locales', 'en.json'), 'utf8'));
  writeFileSync(join(root, 'src', 'keys.generated.ts'), renderKeys(catalog));
  console.log('packages/i18n/src/keys.generated.ts updated');
}
