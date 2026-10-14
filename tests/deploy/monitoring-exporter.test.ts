import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

it('collects only aggregate operational metadata and counts restarts across rollout replacements', async () => {
  await promisify(execFile)('python3', ['tests/deploy/monitoring_exporter_test.py']);
});
