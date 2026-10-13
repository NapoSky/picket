import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { createStatsDevServer } from '@picket/stats';

const staticDirectory = join(dirname(fileURLToPath(import.meta.url)), 'static');

export default defineConfig(({ mode }) => {
  let role = mode === 'development' ? 'admin' : mode;
  if (!['member', 'officer', 'admin'].includes(role)) {
    throw new Error('Stats preview mode must be member, officer or admin. Use --mode <role>.');
  }
  return {
    root: staticDirectory,
    // No real application credentials are needed or loaded in this offline preview.
    envDir: false,
    clearScreen: false,
    server: {
      host: '127.0.0.1',
      port: 8082,
      strictPort: true,
      fs: { strict: true, allow: [staticDirectory] },
    },
    plugins: [{
      name: 'picket-stats-preview',
      config(config) {
        // Vite parses the positional argument as root. This preview uses it as
        // the role selector and always serves the same dashboard assets.
        if (config.root && config.root !== staticDirectory) {
          if (!['member', 'officer', 'admin'].includes(config.root)) {
            throw new Error('Stats preview role must be member, officer or admin.');
          }
          if (mode !== 'development' && mode !== config.root) {
            throw new Error('The positional role and --mode must match.');
          }
          role = config.root;
        }
        return { root: staticDirectory };
      },
      async configureServer(server) {
        const api = createStatsDevServer(role);
        await api.ready();
        server.middlewares.use((request, response, next) => {
          const path = request.url?.split('?')[0] ?? '';
          if (path.startsWith('/api/') || path.startsWith('/auth/')) api.routing(request, response);
          else next();
        });
        server.httpServer?.once('close', () => { void api.close(); });
      },
      transformIndexHtml(html) {
        return html.replace('<html ', '<html data-development="true" ').replace('<body>', `<body><p role="status" style="text-align:center;padding:12px">Development preview · Fictitious data · ${role} access</p>`);
      },
    }],
  };
});
