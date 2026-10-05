import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkFile, extractSpecifiers } from './rules';

const ROOT = join(__dirname, '..', '..');

function listSources(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist') return [];
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listSources(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [full] : [];
  });
}

describe('architecture rules on the repository', () => {
  it('has no violation', () => {
    const files = ['packages', 'apps']
      .flatMap((dir) => {
        try {
          return listSources(join(ROOT, dir));
        } catch {
          return [];
        }
      })
      .filter((file) => !/[\\/]tests[\\/]/.test(file));

    const violations = files.flatMap((file) =>
      checkFile(relative(ROOT, file), readFileSync(file, 'utf8')),
    );
    expect(violations).toEqual([]);
  });
});

describe('architecture rules detect violations (guard against a vacuous test)', () => {
  it('extracts every import form', () => {
    const source = `
      import { a } from 'x';
      import type { B } from "y";
      import 'side-effect';
      export * from './z';
      const c = await import('lazy');
      const d = require('legacy');
      import {
        multi,
        line,
      } from 'multi';
    `;
    expect(extractSpecifiers(source)).toEqual(['x', 'y', 'side-effect', './z', 'lazy', 'legacy', 'multi']);
  });

  it('forbids technical imports in domain, application and kernel', () => {
    const bad = `import { REST } from '@discordjs/rest'; import fs from 'node:fs'; import { Kysely } from 'kysely';`;
    for (const file of [
      'packages/todolists/src/domain/a.ts',
      'packages/timers/src/application/b.ts',
      'packages/kernel/src/c.ts',
    ]) {
      expect(checkFile(file, bad).map((v) => v.detail)).toEqual(['@discordjs/rest', 'node:fs', 'kysely']);
    }
    expect(checkFile('packages/timers/src/infrastructure/b.ts', bad)).toEqual([]);
  });

  it('forbids bare node builtins in pure layers', () => {
    expect(checkFile('packages/guild/src/domain/a.ts', `import { createHash } from 'crypto';`)).toHaveLength(1);
  });

  it('forbids deep imports across packages', () => {
    const violations = checkFile('packages/timers/src/presentation/a.ts', `import x from '@picket/guild/src/domain/y';`);
    expect(violations.map((v) => v.rule)).toEqual(['public-api-only']);
  });

  it('enforces layering inside a package', () => {
    expect(
      checkFile('packages/timers/src/domain/a.ts', `import { x } from '../infrastructure/repo';`).map((v) => v.rule),
    ).toEqual(['layering']);
    expect(
      checkFile('packages/timers/src/application/a.ts', `import { x } from '../presentation/view';`).map((v) => v.rule),
    ).toEqual(['layering']);
    expect(checkFile('packages/timers/src/infrastructure/a.ts', `import { x } from '../domain/model';`)).toEqual([]);
  });

  it('keeps process.env inside @picket/config and main entrypoints', () => {
    expect(checkFile('packages/timers/src/infrastructure/a.ts', 'const x = process.env.FOO;')).toHaveLength(1);
    expect(checkFile('packages/config/src/index.ts', 'const x = process.env.FOO;')).toEqual([]);
    expect(checkFile('apps/bot/src/main.ts', 'loadConfig(process.env);')).toEqual([]);
    expect(checkFile('apps/bot/src/cli.ts', 'loadConfig(process.env);')).toEqual([]);
    expect(checkFile('apps/bot/src/other.ts', 'loadConfig(process.env);')).toHaveLength(1);
  });
});
