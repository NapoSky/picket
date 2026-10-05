import { builtinModules } from 'node:module';
import { dirname, resolve, sep } from 'node:path';

export interface Violation {
  readonly file: string;
  readonly rule: string;
  readonly detail: string;
}

const IMPORT_PATTERN =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

export function extractSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (specifier !== undefined) specifiers.push(specifier);
  }
  return specifiers;
}

const FORBIDDEN_IN_PURE_LAYERS: readonly RegExp[] = [
  /^@discordjs\//,
  /^discord\.js$/,
  /^discord-api-types(\/|$)/,
  /^kysely(\/|$)/,
  /^pg(-boss)?(\/|$)/,
  /^fastify(\/|$)/,
  /^pino(\/|$)/,
];

const NODE_BUILTINS = new Set(builtinModules);

function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith('node:') || NODE_BUILTINS.has(specifier.split('/')[0] ?? specifier);
}

/** `kernel`, `domain/` et `application/` : aucune dépendance technique (Discord, base, HTTP, Node). */
export function isPureLayer(relativePath: string): boolean {
  const normalized = relativePath.split(sep).join('/');
  return (
    /^packages\/kernel\/src\//.test(normalized) ||
    /^packages\/[^/]+\/src\/(domain|application)\//.test(normalized)
  );
}

const LAYER_ORDER = ['domain', 'application', 'infrastructure', 'presentation'] as const;
type Layer = (typeof LAYER_ORDER)[number];

// Couches que chaque couche a le droit d'importer au sein d'un même package.
const ALLOWED_LAYER_IMPORTS: Record<Layer, readonly Layer[]> = {
  domain: ['domain'],
  application: ['domain', 'application'],
  infrastructure: ['domain', 'application', 'infrastructure'],
  presentation: ['domain', 'application', 'presentation'],
};

function layerOf(relativePath: string): { pkg: string; layer: Layer } | undefined {
  const match = /^packages\/([^/]+)\/src\/(domain|application|infrastructure|presentation)(\/|$)/.exec(
    relativePath.split(sep).join('/'),
  );
  return match ? { pkg: match[1] as string, layer: match[2] as Layer } : undefined;
}

const PROCESS_ENV_ALLOWED = [/^packages\/config\//, /^packages\/testing\//, /^apps\/[^/]+\/src\/(main|cli)\.ts$/, /^tests\//];

export function checkFile(relativePath: string, source: string): Violation[] {
  const violations: Violation[] = [];
  const file = relativePath.split(sep).join('/');
  const specifiers = extractSpecifiers(source);

  if (isPureLayer(file)) {
    for (const specifier of specifiers) {
      if (isNodeBuiltin(specifier) || FORBIDDEN_IN_PURE_LAYERS.some((pattern) => pattern.test(specifier))) {
        violations.push({ file, rule: 'pure-layer', detail: specifier });
      }
    }
  }

  for (const specifier of specifiers) {
    if (/^@picket\/[^/]+\/.+/.test(specifier)) {
      violations.push({ file, rule: 'public-api-only', detail: specifier });
    }
  }

  const origin = layerOf(file);
  if (origin) {
    for (const specifier of specifiers) {
      if (!specifier.startsWith('.')) continue;
      const target = layerOf(
        resolve('/', dirname(file), specifier).slice(1).split(sep).join('/'),
      );
      if (target && target.pkg === origin.pkg && !ALLOWED_LAYER_IMPORTS[origin.layer].includes(target.layer)) {
        violations.push({ file, rule: 'layering', detail: `${origin.layer} -> ${target.layer} (${specifier})` });
      }
    }
  }

  if (/\bprocess\.env\b/.test(source) && !PROCESS_ENV_ALLOWED.some((pattern) => pattern.test(file))) {
    violations.push({ file, rule: 'process-env', detail: 'process.env outside @picket/config' });
  }

  return violations;
}
