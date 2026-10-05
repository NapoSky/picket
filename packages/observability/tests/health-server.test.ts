import type { AddressInfo } from 'node:net';
import { createHealthServer } from '@picket/observability';

async function start(isReady: () => Promise<boolean>) {
  const server = createHealthServer({ isReady });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const get = (path: string, method = 'GET') => fetch(`http://127.0.0.1:${port}${path}`, { method });
  return { get, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

describe('health server', () => {
  it('reports liveness regardless of readiness', async () => {
    const { get, close } = await start(async () => false);
    expect((await get('/healthz')).status).toBe(200);
    await close();
  });

  it('follows readiness, including draining and failing probes', async () => {
    let ready = true;
    const { get, close } = await start(async () => ready);
    expect((await get('/readyz')).status).toBe(200);
    ready = false;
    expect((await get('/readyz')).status).toBe(503);
    await close();

    const failing = await start(async () => {
      throw new Error('db down');
    });
    expect((await failing.get('/readyz')).status).toBe(503);
    await failing.close();
  });

  it('exposes nothing else and only answers GET', async () => {
    const { get, close } = await start(async () => true);
    expect((await get('/metrics')).status).toBe(404);
    expect((await get('/healthz', 'POST')).status).toBe(405);
    await close();
  });
});
