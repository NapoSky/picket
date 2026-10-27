import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
let startup: string;

beforeAll(async () => {
  // Replace only the image's entrypoint; execute the actual validation in sh.
  startup = (await readFile(resolve('deploy/monitoring/grafana-start.sh'), 'utf8'))
    .replace('exec /run.sh', 'exec sh -c \'printf "grafana-started\\n"\'');
});

const boot = (webhook: string, host = 'monitoring.example.org') => execute('sh', ['-c', startup], {
  env: { ...process.env, MONITORING_HOST: host, MONITORING_DISCORD_WEBHOOK_URL: webhook },
});

it('disables plugin preinstallation and automatic updates for the read-only Grafana image', async () => {
  const compose = await readFile(resolve('deploy/compose.yml'), 'utf8');
  const grafana = compose.split('\n  grafana:\n')[1]?.split(/\n  [a-z][a-z-]*:\n/)[0];

  expect(grafana).toContain('<<: *hardening');
  expect(grafana).toContain('GF_PLUGINS_PREINSTALL_DISABLED: "true"');
  expect(grafana).toContain('GF_PLUGINS_PREINSTALL_AUTO_UPDATE: "false"');
});

it.each([
  'discord.com', 'canary.discord.com', 'ptb.discord.com',
  'discordapp.com', 'canary.discordapp.com', 'ptb.discordapp.com',
])('starts Grafana with a webhook from %s', async (domain) => {
  const result = await boot(`https://${domain}/api/webhooks/123/test-token`);
  expect(result.stdout.trim()).toBe('grafana-started');
  expect(result.stderr).toBe('');
});

it.each([
  '', 'http://discord.com/api/webhooks/123/test-token',
  'https://discord.com.example.org/api/webhooks/123/test-token',
  'https://canary.discord.com.example.org/api/webhooks/123/test-token',
  'https://discord.com@evil.example.org/api/webhooks/123/test-token',
  'https://evil.example.org/api/webhooks/123/test-token',
  'https://discord.com/not-a-webhook/123/test-token',
])('refuses an invalid webhook without exposing its URL (%#)', async (webhook) => {
  await expect(boot(webhook)).rejects.toMatchObject({
    code: 1, stdout: '', stderr: 'Set MONITORING_DISCORD_WEBHOOK_URL to a Discord webhook in .env\n',
  });
});

it('refuses an unset monitoring hostname', async () => {
  await expect(boot('https://canary.discord.com/api/webhooks/123/test-token', '')).rejects.toMatchObject({
    code: 1, stdout: '', stderr: 'Set MONITORING_HOST in .env\n',
  });
});
