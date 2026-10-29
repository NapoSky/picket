'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { join } = require('node:path');

/** Resolve the exact transitive package Jest uses, including pnpm's patch hash. */
function verifyDependencyPatches() {
  const lockfile = readFileSync(join(__dirname, '..', 'pnpm-lock.yaml'), 'utf8');
  const versions = [...lockfile.matchAll(/^  deepmerge@([^\s:]+):$/gm)].map(match => match[1].split('(')[0]);
  assert.ok(versions.length > 0, 'Review/remove the deepmerge exception when the dependency disappears');
  assert.ok(versions.every(version => version === '4.3.1'),
    'Review every deepmerge version before applying the advisory exception');
  const jestRequire = createRequire(require.resolve('jest/package.json'));
  const cliRequire = createRequire(jestRequire.resolve('jest-cli/package.json'));
  const configRequire = createRequire(cliRequire.resolve('jest-config'));
  assert.equal(configRequire('deepmerge/package.json').version, '4.3.1',
    'Review/remove the deepmerge backport and GHSA-gcqx-w48m-w2h4 exception after an upstream update');

  let checked = 0;
  for (const entry of ['deepmerge', 'deepmerge/dist/umd.js']) {
    const merge = configRequire(entry);
    const payload = () => JSON.parse('{"__proto__":{"picketPrototypeProbe":true}}');
    const safe = result => {
      assert.equal(Object.getPrototypeOf(result), Object.prototype, entry);
      assert.equal(result.picketPrototypeProbe, undefined, entry);
      for (const key of ['__proto__', 'constructor', 'prototype'])
        assert.equal(Object.hasOwn(result, key), false, `${entry}: ${key}`);
      assert.equal(Object.prototype.picketPrototypeProbe, undefined, entry);
      checked++;
    };

    // All target shapes from the advisory, and both target/source copy paths.
    safe(merge(Object.create(null), payload()));
    safe(merge(null, payload()));
    safe(merge(undefined, payload()));
    safe(merge(0, payload()));
    safe(merge({ session: null }, { session: payload() }).session);
    safe(merge({ session: undefined }, { session: payload() }).session);
    safe(merge(payload(), {}));
    safe(merge(payload(), payload()));
    safe(merge({}, { entries: [payload()] }).entries[0]);
    safe(merge.all([Object.create(null), payload(), { safe: true }]));
    safe(merge({}, JSON.parse('{"constructor":{"prototype":{"picketPrototypeProbe":true}},"prototype":{"picketPrototypeProbe":true}}')));
    assert.throws(() => merge(new Proxy({}, { has() { throw new Error('denied has check'); } }), { safe: 1 }),
      /denied has check/, entry);
    checked++;

    // Jest relies on recursive globals, array concatenation, symbols and functions.
    const hook = () => 'hook', key = Symbol('configuration');
    const target = { globals: { first: 1 }, transforms: ['first'], hook, [key]: { first: 1 } };
    assert.deepEqual(merge.all([target, { globals: { second: 2 }, transforms: ['second'], [key]: { second: 2 } }]),
      { globals: { first: 1, second: 2 }, transforms: ['first', 'second'], hook, [key]: { first: 1, second: 2 } });
    assert.deepEqual(target.globals, { first: 1 });
    assert.deepEqual(merge({ nested: null }, { nested: { safe: true } }), { nested: { safe: true } });
    const result = merge({}, { safe: true });
    assert.deepEqual(Object.getOwnPropertyDescriptor(result, 'safe'),
      { value: true, writable: true, enumerable: true, configurable: true });
    checked++;
  }
  return checked;
}

module.exports = { verifyDependencyPatches };
if (require.main === module) {
  const checked = verifyDependencyPatches();
  console.log(`Dependency patch verified: ${checked} security and compatibility checks (deepmerge CJS/UMD).`);
}
