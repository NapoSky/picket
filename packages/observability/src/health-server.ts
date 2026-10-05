import { createServer, type Server } from 'node:http';

export interface HealthServerOptions {
  readonly isReady: () => Promise<boolean>;
}

/** `/healthz` : le processus répond (liveness). `/readyz` : prêt à recevoir du trafic (503 en drain ou base HS). */
export function createHealthServer(options: HealthServerOptions): Server {
  return createServer((request, response) => {
    const respond = (status: number, body: string): void => {
      response.writeHead(status, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      response.end(body);
    };

    if (request.method !== 'GET') return respond(405, 'method not allowed');
    if (request.url === '/healthz') return respond(200, 'ok');
    if (request.url === '/readyz') {
      options.isReady().then(
        (ready) => respond(ready ? 200 : 503, ready ? 'ready' : 'not ready'),
        () => respond(503, 'not ready'),
      );
      return;
    }
    respond(404, 'not found');
  });
}
