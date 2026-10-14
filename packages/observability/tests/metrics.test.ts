import type { AddressInfo } from 'node:net';
import { createMetrics, createHealthServer } from '@picket/observability';

describe('internal operational metrics', () => {
  it('keeps registries isolated, refreshes scrape-time gauges and bounds labels at runtime', async () => {
    const a = createMetrics({ service: 'picket', version: 'sha256:abc', runtime: false });
    const b = createMetrics({ service: 'picket-stats', version: 'sha256:def', runtime: false });
    let waiting = 2;
    a.collect(() => a.set('pool_waiting', waiting));
    a.record('interaction', 0.1, 'success', 'interactions');
    a.record('interaction', 1, 'error', 'interactions');
    a.record('discord_rest', 0.2, 'limited', '900000000000000001' as never);
    a.record('https://discord.com/SECRET' as never, 1, 'success');
    a.record('http', Number.NaN, 'success');
    const first = await a.render();
    expect(first).toContain('picket_pool_waiting{component="default",service="picket"} 2');
    expect(first).toContain('outcome="error"');
    expect(first).not.toMatch(/900000000000000001|SECRET|NaN/);
    waiting = 0;
    expect(await a.render()).toContain('picket_pool_waiting{component="default",service="picket"} 0');
    expect(await b.render()).not.toContain('operation="interaction"');
    a.close(); b.close();
  });

  it('serves Prometheus format only on the internal listener, and hides collection errors', async () => {
    let failing = false;
    const metrics = createMetrics({ service: 'picket', version: 'image', runtime: false });
    metrics.collect(() => { if (failing) throw new Error('SECRET DATABASE URL'); });
    const server = createHealthServer({ isReady: async () => true, metrics });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/metrics`;
    try {
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('version=0.0.4');
      expect(await response.text()).toContain('picket_build_info');
      failing = true;
      const unavailable = await fetch(url);
      expect(unavailable.status).toBe(503);
      expect(await unavailable.text()).toBe('metrics unavailable');
      expect((await fetch(url, { method: 'POST' })).status).toBe(405);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); metrics.close(); }
  });
});
