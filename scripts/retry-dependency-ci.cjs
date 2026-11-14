// A privileged controller: GitHub API metadata/logs only, never PR code or artifacts.
const { appendFileSync, readFileSync } = require('node:fs');

const WORKFLOWS = new Set(['.github/workflows/ci.yml', '.github/workflows/docs.yml']);
const JOBS = new Set(['Typecheck, build and tests', 'Container image (build, scan, SBOM)', 'build']);
const TRANSIENT = /\b(?:ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|ENETUNREACH)\b|ERR_PNPM_FETCH_(?:429|502|503|504)\b|socket hang up|Exceeded timeout of \d+ ms for a test|(?:HTTP|status(?: code)?|response(?: code)?)[: =]+(?:429|502|503|504)\b/i;

function npmBranch(pull) {
  return (pull.user?.login === 'dependabot[bot]' && pull.head?.ref?.startsWith('dependabot/npm_and_yarn/')) ||
    (pull.user?.login === 'github-actions[bot]' && pull.head?.ref === 'maintenance/npm-lockfile');
}

function runEvent(run) {
  return run.event === 'pull_request' || (run.event === 'workflow_dispatch' && run.head_branch === 'maintenance/npm-lockfile');
}

function eligiblePull(pull, repository, base) {
  return pull.state === 'open' && !pull.draft && npmBranch(pull) &&
    pull.head?.repo?.full_name === repository && pull.base?.ref === base &&
    pull.base?.repo?.full_name === repository;
}

function eligibleRun(run, pull, repository, now) {
  return WORKFLOWS.has(run.path) && runEvent(run) && run.status === 'completed' &&
    ['failure', 'timed_out'].includes(run.conclusion) && run.run_attempt === 1 &&
    run.head_repository?.full_name === repository && run.head_branch === pull.head.ref && run.head_sha === pull.head.sha &&
    now - Date.parse(run.created_at) < 30 * 24 * 60 * 60 * 1000;
}

async function retryPull({ api, repository, pull, now = Date.now(), onlyRunId }) {
  const runs = await api.list(`/actions/runs?branch=${encodeURIComponent(pull.head.ref)}&per_page=100`, 'workflow_runs');
  const messages = [];
  for (const path of WORKFLOWS) {
    const sameWorkflow = runs.filter(run => run.path === path && runEvent(run) && run.head_sha === pull.head.sha);
    const latest = sameWorkflow.sort((a, b) => b.run_number - a.run_number || b.id - a.id)[0];
    if (!latest || (onlyRunId && latest.id !== onlyRunId)) continue;
    if (sameWorkflow.some(run => run.run_attempt > 1)) {
      messages.push(`${path}: retry already used for this commit`);
      continue;
    }
    if (!eligibleRun(latest, pull, repository, now)) continue;
    const jobs = await api.list(`/actions/runs/${latest.id}/jobs?filter=latest&per_page=100`, 'jobs');
    const failed = jobs.filter(job => ['failure', 'timed_out'].includes(job.conclusion));
    let retryable = failed.length > 0;
    for (const job of failed) {
      // Audit and secret-scan failures are never automatically rerun.
      if (!JOBS.has(job.name)) { retryable = false; break; }
      if (job.conclusion !== 'timed_out') {
        const logs = await api.logs(`/actions/jobs/${job.id}/logs`);
        if (!TRANSIENT.test(logs)) { retryable = false; break; }
      }
    }
    if (!retryable) {
      messages.push(`${path}: persistent or unclassified failure; retained for review`);
      continue;
    }
    // Guard against a manual retry, a new commit, or closure during inspection.
    const freshPull = await api.get(`/pulls/${pull.number}`);
    const freshRun = await api.get(`/actions/runs/${latest.id}`);
    if (!eligiblePull(freshPull, repository, pull.base.ref) || freshPull.head.sha !== pull.head.sha ||
        !eligibleRun(freshRun, freshPull, repository, now)) continue;
    await api.post(`/actions/runs/${latest.id}/rerun-failed-jobs`);
    messages.push(`${path}: retried failed jobs once (${latest.id})`);
  }
  return messages;
}

function githubApi(repository, token) {
  const base = `https://api.github.com/repos/${repository}`;
  async function request(path, method = 'GET') {
    const response = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GitHub API ${method} ${path.split('?')[0]} returned ${response.status}`);
    return response;
  }
  return {
    get: async path => (await request(path)).json(),
    post: async path => { await request(path, 'POST'); },
    logs: async path => {
      const response = await request(path);
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) throw new Error('Job log too large to classify safely');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks).toString('utf8');
    },
    list: async (path, key) => {
      const all = [];
      for (let page = 1; ; page++) {
        const data = await (await request(`${path}&page=${page}`)).json();
        const items = key ? data[key] : data;
        if (!Array.isArray(items)) throw new Error('Invalid paginated GitHub response');
        all.push(...items);
        if (items.length < 100) return all;
      }
    },
  };
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !process.env.GH_TOKEN) throw new Error('Missing GitHub controller configuration');
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const base = event.repository.default_branch;
  const api = githubApi(repository, process.env.GH_TOKEN);
  const pulls = await api.list(`/pulls?state=open&base=${encodeURIComponent(base)}&per_page=100`);
  const lines = ['## npm dependency CI retries', '', 'Only transient failures are retried, once per workflow and commit. Audit failures and Docker/Compose PRs are excluded.', ''];
  for (const pull of pulls.filter(p => eligiblePull(p, repository, base))) {
    const messages = await retryPull({ api, repository, pull, onlyRunId: event.workflow_run?.id });
    lines.push(`PR #${pull.number}: ${messages.join('; ') || 'no eligible failure'}`, '');
  }
  const summary = lines.join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

module.exports = { eligiblePull, eligibleRun, retryPull, githubApi };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
