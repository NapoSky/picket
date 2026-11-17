// Trusted default-branch controller. Reads GitHub metadata only; never executes PR code.
const { appendFileSync, readFileSync } = require('node:fs');
const { githubApi } = require('./retry-dependency-ci.cjs');

function eligiblePull(pull, repository, base) {
  return pull.state === 'open' && !pull.draft && pull.user?.login === 'dependabot[bot]' &&
    /^dependabot\/(?:npm_and_yarn|github_actions|docker)\//.test(pull.head?.ref ?? '') &&
    pull.head?.repo?.full_name === repository && pull.base?.repo?.full_name === repository && pull.base.ref === base;
}

function composeAsset(path) {
  // deploy contains Compose configuration and its supporting assets. Also protect
  // development/renamed/nested Compose files regardless of the Dependabot ecosystem.
  return typeof path !== 'string' || path.startsWith('deploy/') ||
    /(?:^|\/)(?:docker[-.])?compose(?:[./-]|$)/i.test(path);
}

function eligibleFiles(files, count) {
  return Number.isSafeInteger(count) && count > 0 && files.length === count && files.every(file =>
    !composeAsset(file.filename) && (file.previous_filename === undefined || !composeAsset(file.previous_filename)));
}

function needsDocs(files) {
  return files.some(({ filename: path }) => path.startsWith('docs/') || path.endsWith('.md') ||
    path.startsWith('.github/workflows/') || ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
      '.nvmrc', 'scripts/generate-doc-diagrams.mjs'].includes(path));
}

function latestWorkflowsPass(runs, required) {
  const latest = new Map();
  for (const run of runs) {
    const previous = latest.get(run.path);
    if (!previous || run.run_number > previous.run_number ||
        (run.run_number === previous.run_number && run.id > previous.id)) latest.set(run.path, run);
  }
  return required.every(path => latest.has(path)) && [...latest.values()].every(run =>
    run.status === 'completed' && run.conclusion === 'success');
}

function workflowsPass(runs, pull, files, repository) {
  const current = runs.filter(run => run.event === 'pull_request' && run.head_sha === pull.head.sha &&
    run.head_branch === pull.head.ref && run.head_repository?.full_name === repository);
  const required = ['.github/workflows/ci.yml', ...(needsDocs(files) ? ['.github/workflows/docs.yml'] : [])];
  return latestWorkflowsPass(current, required);
}

function mainChecksPass(runs, base, sha) {
  return latestWorkflowsPass(runs.filter(run => run.head_sha === sha && run.head_branch === base &&
    ['push', 'workflow_dispatch'].includes(run.event)), ['.github/workflows/ci.yml']);
}

async function dispatchMainChecks({ api, base, sha }) {
  // A merge made with GITHUB_TOKEN does not trigger push workflows. Dispatch both
  // explicitly, and recover a missed dispatch on the next scheduled controller run.
  const branch = await api.get(`/branches/${encodeURIComponent(base)}`);
  if (branch.commit.sha !== sha) return; // A newer main commit has superseded this merge.
  const runs = await api.list(`/actions/runs?head_sha=${sha}&per_page=100`, 'workflow_runs');
  for (const path of ['ci.yml', 'docs.yml']) {
    if (!runs.some(run => run.path === `.github/workflows/${path}` && run.head_sha === sha &&
        run.head_branch === base && ['push', 'workflow_dispatch'].includes(run.event))) {
      await api.post(`/actions/workflows/${path}/dispatches`, { ref: base });
    }
  }
}

async function mergePull({ api, repository, base, number }) {
  const pull = await api.get(`/pulls/${number}`);
  if (!eligiblePull(pull, repository, base) || pull.mergeable !== true || !['clean', 'blocked'].includes(pull.mergeable_state)) return false;
  const files = await api.list(`/pulls/${number}/files?per_page=100`);
  if (!eligibleFiles(files, pull.changed_files)) return false;
  const runsPath = `/actions/runs?branch=${encodeURIComponent(pull.head.ref)}&per_page=100`;
  if (!workflowsPass(await api.list(runsPath, 'workflow_runs'), pull, files, repository)) return false;
  const reviews = await api.list(`/pulls/${number}/reviews?per_page=100`);
  const latestReviews = new Map();
  for (const review of reviews) {
    if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) latestReviews.set(review.user.id, review.state);
  }
  if ([...latestReviews.values()].includes('CHANGES_REQUESTED')) return false;
  // Refuse a changed head/base or checks restarted while inspecting the PR.
  const fresh = await api.get(`/pulls/${number}`);
  if (!eligiblePull(fresh, repository, base) || fresh.head.sha !== pull.head.sha || fresh.base.sha !== pull.base.sha ||
      fresh.mergeable !== true || !['clean', 'blocked'].includes(fresh.mergeable_state) ||
      !workflowsPass(await api.list(runsPath, 'workflow_runs'), fresh, files, repository)) return false;
  // main requires one approval. Approve only after all checks and race guards,
  // without bypassing GitHub's remaining branch-protection requirements.
  if (fresh.mergeable_state === 'blocked' && !reviews.some(review => review.user?.login === 'github-actions[bot]' &&
      review.state === 'APPROVED' && review.commit_id === fresh.head.sha)) {
    await api.post(`/pulls/${number}/reviews`, { event: 'APPROVE', commit_id: fresh.head.sha });
  }
  const merged = await api.put(`/pulls/${number}/merge`, { sha: fresh.head.sha, merge_method: 'squash' });
  if (!merged.merged || !/^[a-f0-9]{40}$/.test(merged.sha ?? '')) throw new Error(`PR #${number}: merge did not complete`);
  await dispatchMainChecks({ api, base, sha: merged.sha });
  return true;
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !process.env.GH_TOKEN) throw new Error('Missing GitHub controller configuration');
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const base = event.repository.default_branch;
  const api = githubApi(repository, process.env.GH_TOKEN);
  const lines = ['## Dependabot automatic merges', '', 'Compose assets remain manual. All current PR workflows must succeed.', ''];
  // Recover if a previous merge succeeded but a subsequent workflow dispatch failed.
  const branch = await api.get(`/branches/${encodeURIComponent(base)}`);
  const closed = await api.list(`/pulls?state=closed&base=${encodeURIComponent(base)}&sort=updated&direction=desc&per_page=100`);
  const previous = closed.find(p => p.merged_at && p.merge_commit_sha === branch.commit.sha && p.user?.login === 'dependabot[bot]');
  if (previous) {
    const files = await api.list(`/pulls/${previous.number}/files?per_page=100`);
    const detail = await api.get(`/pulls/${previous.number}`);
    if (detail.merged_by?.login === 'github-actions[bot]' && eligibleFiles(files, detail.changed_files)) {
      await dispatchMainChecks({ api, base, sha: branch.commit.sha });
    }
  }
  const mainRuns = await api.list(`/actions/runs?head_sha=${branch.commit.sha}&per_page=100`, 'workflow_runs');
  const mainReady = mainChecksPass(mainRuns, base, branch.commit.sha);
  if (!mainReady) lines.push('Waiting for successful default-branch CI/workflows before another automatic merge.', '');
  const pulls = mainReady ? await api.list(`/pulls?state=open&base=${encodeURIComponent(base)}&per_page=100`) : [];
  for (const pull of pulls.filter(p => eligiblePull(p, repository, base))) {
    const merged = await mergePull({ api, repository, base, number: pull.number });
    lines.push(`PR #${pull.number}: ${merged ? 'merged; main CI/Docs dispatched' : 'waiting for successful workflows, mergeability or manual review'}`, '');
    if (merged) break; // Let main validation and Dependabot refresh before another merge.
  }
  const summary = lines.join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

module.exports = { eligiblePull, eligibleFiles, needsDocs, workflowsPass, mainChecksPass, dispatchMainChecks, mergePull };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
