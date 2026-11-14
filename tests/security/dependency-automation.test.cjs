const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { assessAudit, main: audit } = require('../../scripts/dependency-audit.cjs');
const { eligiblePull, eligibleRun, retryPull } = require('../../scripts/retry-dependency-ci.cjs');

function report(severities = []) {
  const vulnerabilities = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  const advisories = {};
  severities.forEach((severity, id) => {
    vulnerabilities[severity]++;
    advisories[id] = { severity, module_name: `package-${id}`, github_advisory_id: `GHSA-aaaa-bbbb-ccc${id}`, patched_versions: null };
  });
  return { advisories, metadata: { vulnerabilities } };
}

test('low/moderate findings remain visible and non-blocking; high/critical block even without a fix', () => {
  const assessed = assessAudit(JSON.stringify(report(['low', 'moderate'])), 1);
  assert.equal(assessed.blocking, false);
  assert.match(assessed.summary, /package-0/);
  assert.match(assessed.summary, /package-1/);
  assert.match(assessed.summary, /No published fix/);
  for (const severity of ['high', 'critical']) assert.equal(assessAudit(JSON.stringify(report([severity])), 1).blocking, true);
  assert.equal(assessAudit(JSON.stringify(report()), 0).blocking, false);
});

test('network errors, invalid JSON, missing counts and unknown severities fail closed', () => {
  for (const output of ['not JSON', '{}', JSON.stringify({ error: { code: 'EAI_AGAIN' } }),
    JSON.stringify({ advisories: {}, metadata: { vulnerabilities: { high: 0 } } })]) {
    assert.throws(() => assessAudit(output, 1));
  }
  const invalid = report(['low']);
  invalid.advisories[0].severity = 'unknown';
  assert.throws(() => assessAudit(JSON.stringify(invalid), 1));
  const incomplete = report();
  incomplete.metadata.vulnerabilities.high = 1;
  assert.throws(() => assessAudit(JSON.stringify(incomplete), 1));
  assert.throws(() => assessAudit(JSON.stringify(report()), null));
  assert.throws(() => assessAudit(JSON.stringify(report()), 2));
  assert.throws(() => assessAudit(JSON.stringify(report()), 1));
});

test('audit artifacts and CI summary retain full findings, and process errors produce a failing artifact', () => {
  const directory = mkdtempSync(join(tmpdir(), 'picket-audit-'));
  try {
    const output = JSON.stringify(report(['low', 'moderate']));
    const summaryPath = join(directory, 'step-summary.md');
    assert.equal(audit({ directory, summaryPath, run: (_command, args) => {
      assert.deepEqual(args, ['pnpm', 'audit', '--json', '--audit-level', 'low']);
      return { status: 1, stdout: output };
    } }), 0);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'report.json'))), JSON.parse(output));
    assert.match(readFileSync(summaryPath, 'utf8'), /non-blocking/);
    assert.equal(audit({ directory, run: () => ({ status: null, error: new Error('spawn failed') }) }), 2);
    assert.match(readFileSync(join(directory, 'error.txt'), 'utf8'), /not a clean audit/);
    assert.equal(existsSync(join(directory, 'report.json')), false);
    assert.equal(audit({ directory, run: () => ({ status: 1, stdout: JSON.stringify(report(['critical'])) }) }), 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('advisory text cannot inject HTML or extra table rows into the CI summary', () => {
  const input = report(['moderate']);
  input.advisories[0].module_name = '<script>|\nmalicious';
  const { summary } = assessAudit(JSON.stringify(input), 1);
  assert.ok(!summary.includes('<script>'));
  assert.match(summary, /&lt;script&gt;&#124; malicious/);
});

const repository = 'NapoSky/picket';
const now = Date.parse('2026-11-14T12:00:00Z');
const pull = {
  number: 26, state: 'open', draft: false, user: { login: 'dependabot[bot]' },
  base: { ref: 'main', repo: { full_name: repository } },
  head: { ref: 'dependabot/npm_and_yarn/minor-and-patch-test', sha: 'current', repo: { full_name: repository } },
};
const run = {
  id: 100, run_number: 20, run_attempt: 1, path: '.github/workflows/ci.yml', event: 'pull_request', status: 'completed',
  conclusion: 'failure', head_sha: pull.head.sha, head_branch: pull.head.ref, head_repository: { full_name: repository },
  created_at: '2026-11-14T10:00:00Z',
};
const testJob = { id: 200, name: 'Typecheck, build and tests', conclusion: 'failure' };

function fakeApi({ runs = [run], jobs = [testJob], logs = 'Error: read ECONNRESET', freshPull = pull, freshRun = run } = {}) {
  const writes = [];
  return {
    writes,
    list: async (path, key) => key === 'workflow_runs' ? structuredClone(runs) : structuredClone(jobs),
    logs: async () => logs,
    get: async path => structuredClone(path.startsWith('/pulls/') ? freshPull : freshRun),
    post: async path => { writes.push(path); },
  };
}

test('only our open bot npm PRs and the managed npm lockfile PR are eligible', () => {
  assert.ok(eligiblePull(pull, repository, 'main'));
  const candidate = structuredClone(pull);
  candidate.head.ref = 'maintenance/npm-lockfile';
  candidate.user.login = 'github-actions[bot]';
  assert.ok(eligiblePull(candidate, repository, 'main'));
  for (const ref of ['dependabot/docker_compose/deploy/group', 'dependabot/docker/node', 'dependabot/github_actions/group']) {
    assert.equal(eligiblePull({ ...pull, head: { ...pull.head, ref } }, repository, 'main'), false);
  }
  for (const changed of [
    { state: 'closed' }, { draft: true }, { user: { login: 'someone' } },
    { head: { ...pull.head, repo: { full_name: 'other/fork' } } },
    { base: { ...pull.base, ref: 'other' } },
  ]) assert.equal(eligiblePull({ ...pull, ...changed }, repository, 'main'), false);
});

test('stale, rerun, foreign, manual and expired runs cannot be retried', () => {
  assert.ok(eligibleRun(run, pull, repository, now));
  for (const changed of [
    { head_sha: 'old' }, { run_attempt: 2 }, { head_repository: { full_name: 'other/fork' } },
    { event: 'workflow_dispatch' }, { status: 'in_progress' }, { conclusion: 'success' },
    { created_at: '2026-10-01T00:00:00Z' }, { path: '.github/workflows/deploy.yml' },
  ]) assert.equal(eligibleRun({ ...run, ...changed }, pull, repository, now), false);
});

test('one retry is issued for transient failures, while deterministic, audit and secret failures are retained', async () => {
  for (const logs of ['Error: read ECONNRESET', 'HTTP 503', 'ERR_PNPM_FETCH_502', 'Exceeded timeout of 7000 ms for a test.']) {
    const api = fakeApi({ logs });
    await retryPull({ api, repository, pull, now });
    assert.deepEqual(api.writes, ['/actions/runs/100/rerun-failed-jobs']);
  }
  for (const options of [
    { logs: 'Expected true, received false' },
    { jobs: [testJob, { id: 201, name: 'Dependency audit', conclusion: 'failure' }] },
    { jobs: [{ id: 202, name: 'Secret scan', conclusion: 'failure' }] },
    { jobs: [{ ...testJob, name: 'Unknown job' }] },
  ]) {
    const api = fakeApi(options);
    await retryPull({ api, repository, pull, now });
    assert.deepEqual(api.writes, []);
  }
});

test('a daily catch-up cannot spend another retry on the same workflow and commit', async () => {
  const api = fakeApi({ runs: [run, { ...run, id: 99, run_number: 19, run_attempt: 2 }] });
  await retryPull({ api, repository, pull, now });
  assert.deepEqual(api.writes, []);
});

test('a newer successful or running run takes precedence over an earlier failure', async () => {
  for (const newer of [{ ...run, id: 101, run_number: 21, conclusion: 'success' },
    { ...run, id: 101, run_number: 21, status: 'in_progress' }]) {
    const api = fakeApi({ runs: [run, newer] });
    await retryPull({ api, repository, pull, now });
    assert.deepEqual(api.writes, []);
  }
});

test('a changed/closed PR or a manual retry during log inspection cancels the write', async () => {
  for (const options of [
    { freshPull: { ...pull, state: 'closed' } },
    { freshPull: { ...pull, head: { ...pull.head, sha: 'new' } } },
    { freshRun: { ...run, run_attempt: 2 } },
  ]) {
    const api = fakeApi(options);
    await retryPull({ api, repository, pull, now });
    assert.deepEqual(api.writes, []);
  }
});

test('the completion hook only handles the triggering run', async () => {
  const api = fakeApi();
  await retryPull({ api, repository, pull, now, onlyRunId: 999 });
  assert.deepEqual(api.writes, []);
});

test('the explicitly dispatched maintenance CI is retryable while Docker/Compose dispatches are excluded', async () => {
  const maintenancePull = { ...pull, user: { login: 'github-actions[bot]' }, head: { ...pull.head, ref: 'maintenance/npm-lockfile' } };
  const maintenanceRun = { ...run, event: 'workflow_dispatch', head_branch: maintenancePull.head.ref };
  const api = fakeApi({ runs: [maintenanceRun], freshRun: maintenanceRun, freshPull: maintenancePull });
  await retryPull({ api, repository, pull: maintenancePull, now });
  assert.deepEqual(api.writes, ['/actions/runs/100/rerun-failed-jobs']);
  for (const branch of ['dependabot/docker_compose/deploy/group', 'dependabot/docker/node']) {
    assert.equal(eligibleRun({ ...maintenanceRun, head_branch: branch }, { ...pull, head: { ...pull.head, ref: branch } }, repository, now), false);
  }
});

test('an unavailable log or API response never causes a retry', async () => {
  const api = fakeApi();
  api.logs = async () => { throw new Error('GitHub unavailable'); };
  await assert.rejects(retryPull({ api, repository, pull, now }), /GitHub unavailable/);
  assert.deepEqual(api.writes, []);
});
