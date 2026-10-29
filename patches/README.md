# Dependency security patches

## deepmerge 4.3.1 — GHSA-gcqx-w48m-w2h4

Jest's configuration loader depends on `deepmerge@4.3.1`. The
[reviewed advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)
lists no fixed release as of 2026-10-29. The latest npm release is still 4.3.1.

`deepmerge@4.3.1.patch` implements the mitigation described in
[the upstream report](https://github.com/TehShrike/deepmerge/issues/273):

- Reject `__proto__`, `constructor` and `prototype` in both target and source loops.
- Write ordinary data properties with `Object.defineProperty`.
- Abort on throwing proxy membership checks while preserving null/primitive targets.

The patch covers the source and both published CJS/UMD bundles. pnpm records its
hash in the lockfile and applies it during frozen installs. The Docker build
copies this directory into the production dependency stage so that pnpm can
resolve the same patched lockfile; Jest remains a development dependency.

`pnpm audit` works from package versions, so it still reports this locally fixed
4.3.1. The single `audit.ignore` entry is specific to this backport. The audit CI
job first runs `node scripts/check-dependency-patches.cjs`, which resolves the
actual package used by Jest and verifies attack cases from the report, the target
copy path, nested arrays, proxy checks and ordinary Jest configuration merging.
An absent or ineffective patch fails that job before the audit runs. The same
check is included in the unit suite. Other advisories keep the existing audit
threshold.

When upstream publishes a fixed version, upgrade Jest/deepmerge, remove the patch,
its `patchedDependencies` entry, this advisory's `audit.ignore` entry and the
corresponding regression checker. A version change deliberately fails the checker
until this review is done. Do not enable `allowUnusedPatches`.
