const { test } = require('node:test');
const assert = require('node:assert/strict');
const { eligiblePull, eligibleFiles, needsDocs, workflowsPass, mainChecksPass, dispatchMainChecks, mergePull } = require('../../scripts/merge-dependabot.cjs');

const repository = 'NapoSky/picket';
const base = 'main';
const pull = {
  number: 29, state: 'open', draft: false, user: { login: 'dependabot[bot]' },
  head: { ref: 'dependabot/npm_and_yarn/i18next', sha: 'head', repo: { full_name: repository } },
  base: { ref: base, sha: 'base', repo: { full_name: repository } },
  mergeable: true, mergeable_state: 'clean', changed_files: 2,
};
const files = [{ filename: 'packages/i18n/package.json' }, { filename: 'pnpm-lock.yaml' }];
const runs = ['ci.yml', 'docs.yml'].map((path, i) => ({
  id: i + 1, run_number: 1, path: `.github/workflows/${path}`, event: 'pull_request',
  head_sha: pull.head.sha, head_branch: pull.head.ref, head_repository: { full_name: repository },
  status: 'completed', conclusion: 'success',
}));

function fakeApi(options = {}) {
  const writes = [];
  let reads = 0;
  let runReads = 0;
  return {
    writes,
    get: async path => {
      if (path.startsWith('/branches/')) return { commit: { sha: options.mainSha ?? 'a'.repeat(40) } };
      return structuredClone(reads++ ? options.freshPull ?? options.pull ?? pull : options.pull ?? pull);
    },
    list: async (path, key) => {
      if (path.includes('/files?')) return structuredClone(options.files ?? files);
      if (path.includes('/reviews?')) return structuredClone(options.reviews ?? []);
      if (path.includes('head_sha=')) return structuredClone(options.mainRuns ?? []);
      if (key === 'workflow_runs') return structuredClone(runReads++ ? options.freshRuns ?? options.runs ?? runs : options.runs ?? runs);
      throw new Error(`Unexpected request ${path}`);
    },
    put: async (path, body) => { writes.push({ path, body }); return { merged: true, sha: 'a'.repeat(40) }; },
    post: async (path, body) => { writes.push({ path, body }); },
  };
}

test('only same-repository Dependabot npm, Actions and Docker PRs targeting main are eligible', () => {
  for (const ecosystem of ['npm_and_yarn', 'github_actions', 'docker']) {
    assert.equal(eligiblePull({ ...pull, head: { ...pull.head, ref: `dependabot/${ecosystem}/test` } }, repository, base), true);
  }
  for (const change of [
    { user: { login: 'someone' } }, { user: { login: 'github-actions[bot]' } }, { draft: true }, { state: 'closed' },
    { head: { ...pull.head, ref: 'dependabot/docker_compose/deploy/test' } },
    { head: { ...pull.head, repo: { full_name: 'other/fork' } } },
    { base: { ...pull.base, ref: 'other' } }, { base: { ...pull.base, repo: { full_name: 'other/fork' } } },
  ]) assert.equal(eligiblePull({ ...pull, ...change }, repository, base), false);
});

test('Compose and supporting deployment assets stay manual, including renamed and mixed PRs', () => {
  assert.equal(eligibleFiles(files, 2), true);
  for (const path of ['deploy/compose.yml', 'deploy/backup/Dockerfile', 'compose.dev.yml', 'compose.yaml',
    'docker-compose.prod.yaml', 'nested/compose/asset.json', 'nested/docker-compose.yml']) {
    assert.equal(eligibleFiles([...files, { filename: path }], 3), false);
    assert.equal(eligibleFiles([{ filename: 'new.yml', previous_filename: path }], 1), false);
  }
  for (const count of [0, 1, 3, undefined]) assert.equal(eligibleFiles(files, count), false);
  assert.equal(eligibleFiles([{ filename: null }], 1), false);
});

test('CI is mandatory and Docs is mandatory for every path in its PR trigger', () => {
  for (const filename of ['README.md', 'docs/index.md', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
    '.nvmrc', '.github/workflows/ci.yml', 'scripts/generate-doc-diagrams.mjs']) {
    assert.equal(needsDocs([{ filename }]), true);
    assert.equal(workflowsPass([runs[0]], pull, [{ filename }], repository), false);
  }
  const source = [{ filename: 'apps/bot/package.json' }];
  assert.equal(needsDocs(source), false);
  assert.equal(workflowsPass([runs[0]], pull, source, repository), true);
  assert.equal(workflowsPass([runs[1]], pull, source, repository), false);
  assert.equal(workflowsPass(runs, pull, files, repository), true);
});

test('failed, pending, skipped, stale or foreign runs cannot authorize a merge; extra workflows must pass too', () => {
  for (const change of [
    { status: 'in_progress', conclusion: null }, { conclusion: 'failure' }, { conclusion: 'cancelled' }, { conclusion: 'skipped' },
    { head_sha: 'old' }, { head_branch: 'other' }, { event: 'workflow_dispatch' },
    { head_repository: { full_name: 'other/fork' } },
  ]) assert.equal(workflowsPass([{ ...runs[0], ...change }, runs[1]], pull, files, repository), false);
  const newer = { ...runs[0], id: 3, run_number: 2, status: 'in_progress', conclusion: null };
  assert.equal(workflowsPass([...runs, newer], pull, files, repository), false);
  const extra = { ...newer, path: '.github/workflows/another-check.yml' };
  assert.equal(workflowsPass([...runs, extra], pull, files, repository), false);
  assert.equal(workflowsPass([...runs, { ...extra, status: 'completed', conclusion: 'success' }], pull, files, repository), true);
});

test('a passing PR merges with an expected SHA and dispatches CI and Docs on main', async () => {
  const api = fakeApi();
  assert.equal(await mergePull({ api, repository, base, number: 29 }), true);
  assert.deepEqual(api.writes, [
    { path: '/pulls/29/merge', body: { sha: 'head', merge_method: 'squash' } },
    { path: '/actions/workflows/ci.yml/dispatches', body: { ref: 'main' } },
    { path: '/actions/workflows/docs.yml/dispatches', body: { ref: 'main' } },
  ]);
});

test('another automatic merge waits for successful main CI and every other triggered main workflow', () => {
  const mainRuns = runs.map(run => ({ ...run, head_sha: 'main-sha', head_branch: base, event: 'workflow_dispatch' }));
  assert.equal(mainChecksPass(mainRuns, base, 'main-sha'), true);
  assert.equal(mainChecksPass([], base, 'main-sha'), false);
  assert.equal(mainChecksPass(mainRuns, base, 'new-main-sha'), false);
  assert.equal(mainChecksPass(mainRuns.slice(1), base, 'main-sha'), false);
  assert.equal(mainChecksPass([mainRuns[0], { ...mainRuns[1], status: 'in_progress', conclusion: null }], base, 'main-sha'), false);
  assert.equal(mainChecksPass([mainRuns[0], { ...mainRuns[1], conclusion: 'failure' }], base, 'main-sha'), false);
});

test('manual reviews, changed heads/bases, conflicts and restarted workflows prevent writes', async () => {
  for (const options of [
    { reviews: [{ user: { id: 1 }, state: 'CHANGES_REQUESTED' }] },
    { freshPull: { ...pull, head: { ...pull.head, sha: 'new' } } },
    { freshPull: { ...pull, base: { ...pull.base, sha: 'new-base' } } },
    { freshPull: { ...pull, state: 'closed' } },
    { pull: { ...pull, mergeable: null } }, { pull: { ...pull, mergeable_state: 'dirty' } },
    { freshRuns: [{ ...runs[0], conclusion: 'failure' }, runs[1]] },
    { files: [{ filename: 'deploy/compose.yml' }, files[1]] },
  ]) {
    const api = fakeApi(options);
    assert.equal(await mergePull({ api, repository, base, number: 29 }), false);
    assert.deepEqual(api.writes, []);
  }
  const api = fakeApi({ reviews: [{ user: { id: 1 }, state: 'CHANGES_REQUESTED' }, { user: { id: 1 }, state: 'APPROVED' }] });
  assert.equal(await mergePull({ api, repository, base, number: 29 }), true);
});

test('a required approval is supplied only after all checks pass and is bound to the checked commit', async () => {
  const blocked = { ...pull, mergeable_state: 'blocked' };
  const api = fakeApi({ pull: blocked });
  assert.equal(await mergePull({ api, repository, base, number: 29 }), true);
  assert.deepEqual(api.writes[0], { path: '/pulls/29/reviews', body: { event: 'APPROVE', commit_id: 'head' } });
  const failing = fakeApi({ pull: blocked, runs: [{ ...runs[0], conclusion: 'failure' }, runs[1]] });
  assert.equal(await mergePull({ api: failing, repository, base, number: 29 }), false);
  assert.deepEqual(failing.writes, []);
  const reviewed = fakeApi({ pull: blocked, reviews: [{ user: { id: 1, login: 'github-actions[bot]' }, state: 'APPROVED', commit_id: 'head' }] });
  assert.equal(await mergePull({ api: reviewed, repository, base, number: 29 }), true);
  assert.equal(reviewed.writes[0].path, '/pulls/29/merge');
});

test('post-merge dispatches recover missing workflows without duplicating existing runs or dispatching an old main', async () => {
  const sha = 'a'.repeat(40);
  const api = fakeApi({ mainRuns: [{ ...runs[0], head_sha: sha, head_branch: base, event: 'workflow_dispatch' }] });
  await dispatchMainChecks({ api, base, sha });
  assert.deepEqual(api.writes, [{ path: '/actions/workflows/docs.yml/dispatches', body: { ref: base } }]);
  const stale = fakeApi({ mainSha: 'newer' });
  await dispatchMainChecks({ api: stale, base, sha });
  assert.deepEqual(stale.writes, []);
});

test('a rejected merge or unavailable API fails without dispatching a deployment pipeline', async () => {
  const api = fakeApi();
  api.put = async () => ({ merged: false });
  await assert.rejects(mergePull({ api, repository, base, number: 29 }), /merge did not complete/);
  assert.deepEqual(api.writes, []);
  api.list = async () => { throw new Error('GitHub unavailable'); };
  await assert.rejects(mergePull({ api, repository, base, number: 29 }), /GitHub unavailable/);
});
