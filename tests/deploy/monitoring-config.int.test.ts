import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

describe('production monitoring configurations', () => {
  it('validates Prometheus expressions and simulated outages, rollouts, low traffic and backup absence', async () => {
    const mounted = ['--rm', '-v', `${resolve('deploy/monitoring')}:/etc/prometheus:ro`,
      '-v', `${resolve('tests/deploy/monitoring-alerts.yml')}:/tests/alerts.yml:ro`,
      '--entrypoint', 'promtool', 'prom/prometheus:v3.15.0'];
    await execute('docker', ['run', ...mounted, 'check', 'config', '/etc/prometheus/prometheus.yml']);
    const result = await execute('docker', ['run', ...mounted, 'test', 'rules', '/tests/alerts.yml']);
    expect(result.stdout).toContain('SUCCESS');
  }, 120_000);

  it('validates Loki retention and the Alloy pipeline using their official binaries', async () => {
    await execute('docker', ['run', '--rm', '-v', `${resolve('deploy/monitoring/loki.yml')}:/config.yml:ro`,
      'grafana/loki:3.7.8', '-config.file=/config.yml', '-verify-config=true']);
    await execute('docker', ['run', '--rm', '-v', `${resolve('deploy/monitoring/config.alloy')}:/config.alloy:ro`,
      'grafana/alloy:v1.20.1', 'validate', '/config.alloy']);
  }, 120_000);
});
