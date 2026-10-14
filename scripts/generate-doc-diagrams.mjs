import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const archive = resolve(root, process.argv[2] ?? 'draft/pra-example/archify.zip');
if (!existsSync(archive)) throw new Error('Supply the Archify ZIP: pnpm docs:diagrams /path/to/archify.zip');
const run = join(root, '.archify', `docs-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(run, { recursive: true });

// Keep the generator and its machine-specific receipts outside the published directory.
const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).trim().split('\n');
if (entries.some((entry) => !entry.startsWith('archify/') || entry.includes('\\') || entry.split('/').includes('..'))) {
  throw new Error('Unexpected archive paths');
}
execFileSync('unzip', ['-q', archive, '-d', run]);
const skill = join(run, 'archify');
const { version: generatorVersion } = JSON.parse(readFileSync(join(skill, 'skill-release.json'), 'utf8'));
const checks = [];
const artifacts = [];
let updateNotice;
for (const locale of ['fr', 'en']) {
  for (const name of ['self-hosted', 'data-lifecycle']) {
    const input = `docs/diagrams/${name}.${locale}.json`;
    const specification = JSON.parse(readFileSync(join(root, input), 'utf8'));
    const output = `docs/public/diagrams/${locale}/${name}.html`;
    if (specification.meta.output !== output) throw new Error(`Unexpected output in ${input}`);
    const evidence = join(run, locale, name);
    mkdirSync(evidence, { recursive: true });
    const staged = join(evidence, `${name}.html`);
    let stdout;
    try {
      stdout = execFileSync(process.execPath, [join(skill, 'bin/archify.mjs'), 'finalize', specification.diagram_type,
        input, staged, '--repo-root', '.', '--quality', 'showcase', '--out-dir', evidence, '--json'],
      { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    } catch (error) {
      const summary = error.stdout?.toString();
      if (summary) {
        try {
          for (const diagnostic of JSON.parse(summary).diagnostics ?? []) {
            console.error(`${diagnostic.code}: ${diagnostic.message.replaceAll(root, '<repository>')}`);
          }
        } catch { console.error('Archify returned an unreadable receipt.'); }
      }
      console.error(`Archify validation failed for ${input}; inspect the ignored .archify directory.`);
      process.exit(1);
    }
    const receipt = JSON.parse(stdout);
    if (!receipt.ok || Object.values(receipt.gates).some((gate) => gate !== 'pass')) {
      throw new Error(`Incomplete validation for ${input}`);
    }
    const html = readFileSync(staged, 'utf8');
    if (html.includes(root) || /(?:\/home\/|\/Users\/|\/tmp\/|file:\/\/\/|[A-Z]:\\Users\\)/i.test(html)) {
      throw new Error(`Machine-specific path found in ${output}`);
    }
    artifacts.push({ staged, output });
    checks.push({ input, output, generatorVersion, type: specification.diagram_type, revision: specification.meta.repository.revision,
      specificationSha256: receipt.specification.sha256, artifactSha256: receipt.artifact.sha256,
      gates: receipt.gates });
    console.log(`${output}: all four gates passed`);
    if (receipt.update?.noticeRequired) updateNotice ??= receipt.update.noticeText;
  }
}
if (updateNotice) console.log(updateNotice);
for (const { staged, output } of artifacts) {
  mkdirSync(dirname(join(root, output)), { recursive: true });
  copyFileSync(staged, join(root, output));
}
// Only portable facts enter the repository; full receipts stay in .archify.
writeFileSync(join(root, 'docs/diagrams/checks.json'), JSON.stringify(checks, null, 2) + '\n');
const notices = ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'assets/JetBrainsMono-OFL.txt'];
writeFileSync(join(root, 'docs/public/diagrams/NOTICE.txt'),
  'Generated with Archify. Notices for the embedded viewer and font follow.\n\n' +
  notices.map((name) => `--- Archify ${name} ---\n${readFileSync(join(skill, name), 'utf8')}`).join('\n\n'));
