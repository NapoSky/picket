// Keep the complete audit visible; only high/critical advisories block CI.
const { spawnSync } = require('node:child_process');
const { mkdirSync, writeFileSync, appendFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');

const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const escape = value => String(value).replace(/[&<>|\r\n]/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '|': '&#124;', '\r': ' ', '\n': ' ',
})[c]);

function assessAudit(output, status) {
  if (status !== 0 && status !== 1) throw new Error('Audit command did not complete normally');
  const report = JSON.parse(output);
  if (!report || report.error || !report.advisories || Array.isArray(report.advisories) ||
      typeof report.advisories !== 'object' || !report.metadata?.vulnerabilities) {
    throw new Error('Unrecognized or unsuccessful pnpm audit report');
  }
  for (const severity of severities) {
    if (!Number.isSafeInteger(report.metadata.vulnerabilities[severity]) || report.metadata.vulnerabilities[severity] < 0) {
      throw new Error('Missing or invalid audit severity counts');
    }
  }
  const advisories = Object.values(report.advisories);
  for (const advisory of advisories) {
    if (!advisory || !severities.includes(advisory.severity) || typeof advisory.module_name !== 'string' ||
        typeof advisory.github_advisory_id !== 'string' || !/^GHSA-[\w-]+$/.test(advisory.github_advisory_id)) {
      throw new Error('Unrecognized audit advisory');
    }
  }
  // Our only accepted exception is low. Missing high/critical details must not
  // silently turn an incomplete report into a passing security check.
  for (const severity of ['high', 'critical']) {
    if (report.metadata.vulnerabilities[severity] !== advisories.filter(a => a.severity === severity).length) {
      throw new Error('Blocking audit counts disagree with the advisory details; review report or exceptions');
    }
  }
  if (status === 1 && advisories.length === 0 &&
      Object.values(report.metadata.vulnerabilities).every(count => count === 0)) {
    throw new Error('Audit failed without any reported vulnerability');
  }
  // Counts may include the reviewed audit.ignore entries in pnpm 12.6.0.
  // The advisories map contains the findings that remain after those exceptions.
  const blocking = advisories.filter(a => a.severity === 'high' || a.severity === 'critical');
  const rows = advisories.map(a => `| ${escape(a.severity)} | ${escape(a.module_name)} | ` +
    `[${a.github_advisory_id}](https://github.com/advisories/${a.github_advisory_id}) | ` +
    `${escape(a.patched_versions ?? 'No published fix')} |`);
  const summary = [
    '## Dependency audit', '',
    `${blocking.length} blocking high/critical finding(s); ${advisories.length - blocking.length} non-blocking finding(s).`, '',
    'All workspace dependencies are audited, including development tools. Low/moderate findings require triage when relevant to our actual exposure.',
    'Reviewed exceptions from pnpm-workspace.yaml still apply; the deepmerge backport is checked separately before this audit.', '',
    '| Severity | Package | Advisory | Patched versions |', '| --- | --- | --- | --- |', ...rows, '',
    'The complete pnpm JSON report is available in the dependency-audit artifact.', '',
  ].join('\n');
  return { report, blocking: blocking.length > 0, summary };
}

function main({ run = spawnSync, directory = 'dependency-audit', summaryPath = process.env.GITHUB_STEP_SUMMARY } = {}) {
  mkdirSync(directory, { recursive: true });
  for (const file of ['report.json', 'summary.md', 'error.txt']) rmSync(join(directory, file), { force: true });
  // Override audit.level only for collection so low/moderate details are retained.
  const result = run('corepack', ['pnpm', 'audit', '--json', '--audit-level', 'low'], {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
  });
  try {
    if (result.error || result.signal) throw new Error('Audit command failed or timed out');
    const assessed = assessAudit(result.stdout, result.status);
    writeFileSync(join(directory, 'report.json'), JSON.stringify(assessed.report, null, 2) + '\n');
    writeFileSync(join(directory, 'summary.md'), assessed.summary);
    if (summaryPath) appendFileSync(summaryPath, assessed.summary);
    console.log(assessed.summary);
    return assessed.blocking ? 1 : 0;
  } catch (error) {
    const message = `Dependency audit unavailable: ${error.message}. This is a CI failure, not a clean audit.\n`;
    writeFileSync(join(directory, 'error.txt'), message);
    if (summaryPath) appendFileSync(summaryPath, message);
    console.error(message);
    return 2;
  }
}

module.exports = { assessAudit, main };
if (require.main === module) process.exitCode = main();
