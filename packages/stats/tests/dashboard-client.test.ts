import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const A = '700000000000000001', B = '700000000000000002';
const source = readFileSync(resolve('packages/stats/static/app.js'), 'utf8');
const html = readFileSync(resolve('packages/stats/static/index.html'), 'utf8');
const settle = () => new Promise<void>(done => setImmediate(done));

// Run the actual client with a minimal DOM and controlled HTTP responses. Layout
// is verified separately in Chromium; these tests cover requests and state transitions.
interface ClientElement {
  hidden: boolean; disabled: boolean; checked: boolean; value: string; textContent: string;
  download: string; href: string; click(): void;
  options: ClientElement[]; dataset: Record<string, string>; style: Record<string, string>;
  listeners: Record<string, (event?: { target: { value: string } }) => unknown>;
  classList: { toggle(): void };
  addEventListener(type: string, handler: (event?: { target: { value: string } }) => unknown): void;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
  querySelector(): null;
  replaceChildren(...children: ClientElement[]): void;
  append(...children: ClientElement[]): void;
  prepend(...children: ClientElement[]): void;
}
function element(): ClientElement {
  const attributes = new Map<string, string>();
  return {
    hidden: false, disabled: false, checked: false, value: '', textContent: '', download: '', href: '', click() {},
    options: [] as ReturnType<typeof element>[],
    dataset: {} as Record<string, string>, style: {} as Record<string, string>,
    listeners: {} as Record<string, (event?: { target: { value: string } }) => unknown>,
    classList: { toggle() {} },
    addEventListener(type: string, handler: (event?: { target: { value: string } }) => unknown) { this.listeners[type] = handler; },
    setAttribute(name: string, value: string) { attributes.set(name, value); },
    removeAttribute(name: string) { attributes.delete(name); },
    hasAttribute(name: string) { return attributes.has(name); },
    querySelector() { return null; },
    replaceChildren(...children: ReturnType<typeof element>[]) { this.options = children; },
    append(...children: ReturnType<typeof element>[]) { this.options.push(...children); },
    prepend(...children: ReturnType<typeof element>[]) { this.options.unshift(...children); },
  };
}

type Failure = { status: number; error: string; retry?: number };
async function client(language = 'en', administrator = false) {
  let instant = Date.parse('2026-10-15T08:00:00Z');
  class Clock extends Date { static override now() { return instant; } }
  const nodes = new Map([...html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)].map(([tag, id]) => {
    const node = element();
    node.hidden = /\bhidden\b/.test(tag);
    const key = tag.match(/data-i18n="([^"]+)"/)?.[1];
    if (key) node.dataset.i18n = key;
    return [id!, node] as const;
  }));
  const get = (id: string) => nodes.get(id)!;
  get('period').value = '7';
  get('access').value = 'personal';
  for (const [, page] of html.matchAll(/<button[^>]*data-page="([^"]+)"/g)) {
    const node = element(); node.dataset.page = page!;
    nodes.set(`nav:${page}`, node);
  }
  const requests: string[] = [];
  const downloads: ClientElement[] = [];
  const intervals = new Map<number, () => unknown>();
  let failure: Failure | null = null;
  const activityPatch: Record<string, unknown> = {};
  const exportBounds: { from?: string; to?: string } = {};
  const features = new Map([A, B].map(id => [id, [
    { feature: 'timers', enabled: id === A }, { feature: 'todolists', enabled: true },
    { feature: 'warlog', enabled: id === B }, { feature: 'stats', enabled: false },
  ]]));
  const response = (body: unknown, status = 200, retry?: number, headers: Record<string, string | undefined> = {}) => ({
    ok: status < 400, status, json: async () => body, blob: async () => ({}),
    headers: { get: (name: string) => headers[name.toLowerCase()] ??
      (name.toLowerCase() === 'retry-after' && retry !== undefined ? String(retry) : null) },
  });
  const context = {
    document: {
      hidden: false, documentElement: { dataset: {} }, getElementById: get,
      querySelectorAll: (selector: string) => selector === '[data-i18n]' ? [...nodes.values()].filter(n => n.dataset.i18n)
        : selector === '[data-page]' ? [...nodes.values()].filter(n => n.dataset.page) : [],
      createElement: (tag: string) => { const node = element(); if (tag === 'a') downloads.push(node); return node; }, createElementNS: element, createTextNode: element,
    },
    localStorage: { getItem: (key: string) => key === 'picket-language' ? language : null, setItem() {} },
    navigator: { language: 'en-US' }, Date: Clock, Intl, URLSearchParams,
    URL: { createObjectURL: () => 'blob:export', revokeObjectURL() {} }, setTimeout() {},
    Option: function (text: string, value: string) { return Object.assign(element(), { textContent: text, value }); },
    setInterval: (handler: () => unknown, ms: number) => intervals.set(ms, handler),
    fetch: async (path: string) => {
      requests.push(path);
      if (path === '/api/session') return response({ user: { id: 'test-user', name: 'Member' }, csrf: 'test', administrator,
        periodLimits: { timezone: 'UTC', earliestStart: '2026-08-17', today: '2026-10-15' } });
      if (path === '/api/guilds') return response({ guilds: [A, B].map(id => ({ id, name: id, level: 'unknown', isMember: true, enabled: true,
        periodLimits: { timezone: id === A ? 'Europe/Paris' : 'UTC', earliestStart: '2026-08-17', today: '2026-10-15' } })) });
      if (path === '/api/admin/status') return response({ buffer: { bytes: 0, count: 0, oldest: null } });
      if (path.startsWith('/api/activity')) {
        if (failure) return response({ error: failure.error }, failure.status, failure.retry);
        const query = new URLSearchParams(path.split('?')[1]);
        const from = query.has('start') ? `${query.get('start')}T00:00:00Z` : '2026-10-08T08:00:00Z';
        const to = query.has('end') ? new Date(Date.parse(`${query.get('end')}T00:00:00Z`) + 86400_000).toISOString() : new Date(instant).toISOString();
        return response({ scope: query.get('guild') === 'all' ? 'global' : query.get('mode') === 'overview' ? 'overview' : administrator ? 'guild' : 'self',
          from, to,
          ...(administrator && query.get('mode') !== 'overview' && features.has(query.get('guild')!)
            ? { guildFeatures: features.get(query.get('guild')!) } : {}),
          accessLevel: administrator ? 'instance_admin' : query.get('guild') === A ? 'officer' : 'member', seconds: 7200, activeUsers: 2, sessions: 3, inVoice: 1,
          daily: [], hourly: [], channels: [], users: [], timezone: 'UTC', peakConcurrency: 2, updatedAt: new Date(instant).toISOString(),
          collection: { recovering: false, delayed: false }, ...activityPatch });
      }
      if (path.startsWith('/api/export')) return response([], 200, undefined, {
        'x-picket-period-from': exportBounds.from, 'x-picket-period-to': exportBounds.to,
      });
      if (path.startsWith('/api/privacy')) return response({ optedOut: false });
      throw new Error(`Unexpected request: ${path}`);
    },
  };
  await runInNewContext(`(async () => { ${source}\n })()`, context);
  const change = async (id: string, value: string) => {
    get(id).value = value;
    get(id).listeners.change!({ target: { value } });
    await settle();
  };
  const refresh = async () => { get('refresh').listeners.click!(); await settle(); };
  const click = async (id: string) => { get(id).listeners.click!(); await settle(); };
  const input = async (id: string, value: string) => { get(id).value = value; get(id).listeners.input!(); await settle(); };
  const count = (path: string) => requests.filter(request => request.startsWith(path)).length;
  const advance = async (ms: number) => {
    instant += ms;
    intervals.get(60000)!(); intervals.get(1000)!();
    await settle();
  };
  return { get, requests, downloads, count, change, refresh, click, input, advance, features, activityPatch, exportBounds, fail: (value: Failure | null) => { failure = value; } };
}

it('applies custom dates explicitly, resets pagination and keeps draft edits out of requests and exports', async () => {
  const c = await client();
  await c.click('nav:activity');
  await c.click('next');
  const reads = c.count('/api/activity');
  await c.change('period', 'custom');
  await c.input('period-start', '2026-10-10');
  await c.input('period-end', '2026-10-11');
  expect(c.get('calendar-period').hidden).toBe(false);
  expect(c.get('calendar-limits').textContent).toContain('Europe/Paris');
  expect(c.get('period-pending').hidden).toBe(false);
  expect(c.count('/api/activity')).toBe(reads);
  await c.click('period-apply');
  const query = new URLSearchParams(c.requests.filter(p => p.startsWith('/api/activity')).at(-1)!.split('?')[1]);
  expect(query.get('start')).toBe('2026-10-10');
  expect(query.get('end')).toBe('2026-10-11');
  expect(query.get('offset')).toBe('0');
  expect(query.has('days')).toBe(false);
  expect(c.get('period-pending').hidden).toBe(true);
  await c.input('period-start', '2026-10-01');
  await c.input('period-end', '2026-10-02');
  await c.click('export-csv');
  const download = new URLSearchParams(c.requests.findLast(p => p.startsWith('/api/export'))!.split('?')[1]);
  expect(download.get('from')).toBe('2026-10-10T00:00:00Z');
  expect(download.get('to')).toBe('2026-10-12T00:00:00.000Z');
  expect(download.has('start')).toBe(false);
  expect(download.has('days')).toBe(false);
  expect(c.downloads[0]!.download).toContain('20261010T000000Z_20261012T000000Z');
  await c.advance(60000);
  expect(c.requests.filter(p => p.startsWith('/api/activity')).at(-1)).toContain('start=2026-10-10');
  expect(c.get('period-pending').hidden).toBe(false);
  await c.change('language', 'fr');
  expect(c.get('period-pending').textContent).toContain('ne sont pas appliquées');
  expect(c.get('period-summary').textContent).toContain('Période affichée');
  await c.change('period', '14');
  expect(c.get('calendar-period').hidden).toBe(true);
  expect(c.requests.filter(p => p.startsWith('/api/activity')).at(-1)).toContain('days=14');
});

it('rejects incomplete, inverted, impossible and unavailable calendar dates without a read', async () => {
  const c = await client('fr');
  await c.change('period', 'custom');
  const reads = c.count('/api/activity');
  for (const [start, end] of [['2026-10-10', ''], ['2026-10-12', '2026-10-10'],
    ['2026-09-31', '2026-10-01'], ['2026-08-01', '2026-08-02'], ['2026-10-10', '2026-10-16']]) {
    await c.input('period-start', start!); await c.input('period-end', end!);
    await c.click('period-apply');
    expect(c.get('period-error').hidden).toBe(false);
    expect(c.count('/api/activity')).toBe(reads);
  }
});

it('shows the effective snapshot limit and explains periods not yet available', async () => {
  const c = await client('en', true);
  Object.assign(c.activityPatch, { snapshotAt: '2026-10-14T12:00:00Z', periodLimitedBySnapshot: true, to: '2026-10-14T12:00:00Z' });
  await c.click('nav:admin');
  expect(c.get('period-snapshot-note').hidden).toBe(false);
  expect(c.get('metric-live-help').textContent).toContain('independent');
  await c.click('export-json');
  expect(new URLSearchParams(c.requests.findLast(p => p.startsWith('/api/export'))!.split('?')[1]).get('to')).toBe('2026-10-14T12:00:00Z');
  c.fail({ status: 400, error: 'period_unavailable' });
  await c.change('period', '1');
  expect(c.get('notice').textContent).toContain('latest scheduled snapshot');
  expect(c.get('period-summary').hidden).toBe(true);
  expect(c.get('export-json').disabled).toBe(true);
});
it('identifies and names the actual download bounds when the oldest history expires', async () => {
  const c = await client('fr');
  await c.click('nav:activity');
  Object.assign(c.activityPatch, { from: '2026-08-16T08:00:00Z', to: '2026-10-15T08:00:00Z' });
  await c.change('period', '60');
  c.exportBounds.from = '2026-08-16T08:00:01Z';
  c.exportBounds.to = '2026-10-15T08:00:00Z';
  await c.click('export-csv');
  expect(c.get('notice').textContent).toContain('L’historique disponible a changé');
  expect(c.downloads[0]!.download).toContain('20260816T080001Z_20261015T080000Z');
});

it('clears the live collection warning after recovery while retaining historical interruptions and snapshot time', async () => {
  const c = await client('en', true);
  await c.click('nav:admin');
  Object.assign(c.activityPatch, { snapshotAt: '2026-10-14T12:00:00Z', updatedAt: '2026-10-14T12:00:00Z',
    interruptedSegments: 7, collection: { recovering: true, delayed: true } });
  await c.refresh();
  expect(c.get('notice').textContent).toContain('interrupted or recovering');
  await c.change('language', 'fr');
  expect(c.get('notice').textContent).toContain('interrompue ou en cours de reprise');
  c.activityPatch.collection = { recovering: false, delayed: false };
  await c.advance(60000);
  expect(c.get('notice').hidden).toBe(true);
  c.activityPatch.collection = { recovering: false, delayed: true };
  await c.refresh();
  expect(c.get('notice').textContent).toContain('confirmée récemment');
  await c.change('language', 'en');
  expect(c.get('notice').textContent).toContain('not been confirmed recently');
});

it('shows current server feature states only in Administration and refreshes and translates them', async () => {
  const c = await client('en', true);
  const states = () => c.get('guild-feature-states').options.map(card => card.options[1]!.textContent);
  expect(c.get('guild-features').hidden).toBe(true);
  await c.click('nav:admin');
  expect(c.get('guild-features').hidden).toBe(true);
  await c.change('guild', A);
  expect(c.get('guild-features').hidden).toBe(false);
  expect(states()).toEqual(['Enabled', 'Enabled', 'Disabled', 'Disabled']);
  await c.change('period', '1');
  await c.change('channel', '600000000000000001');
  expect(states()).toEqual(['Enabled', 'Enabled', 'Disabled', 'Disabled']);
  await c.change('guild', B);
  expect(states()).toEqual(['Disabled', 'Enabled', 'Enabled', 'Disabled']);
  c.features.get(B)![1]!.enabled = false;
  await c.refresh();
  expect(states()).toEqual(['Disabled', 'Disabled', 'Enabled', 'Disabled']);
  await c.change('language', 'fr');
  expect(states()).toEqual(['Désactivé', 'Désactivé', 'Activé', 'Désactivé']);
  await c.click('nav:activity');
  expect(c.get('guild-features').hidden).toBe(true);
  await c.click('nav:admin');
  await c.change('guild', A);
  c.fail({ status: 503, error: 'discord_unavailable' });
  await c.change('guild', B);
  expect(c.get('guild-features').hidden).toBe(true);
  expect(states()).toEqual([]);
});

it('keeps server feature states hidden for regiment officers', async () => {
  const c = await client();
  await c.click('nav:activity');
  await c.change('access', 'guild');
  expect(c.get('guild-features').hidden).toBe(true);
  expect(c.get('guild-feature-states').options).toEqual([]);
});

it('reuses privacy reads for period changes and revisited servers, while explicit refresh checks them again', async () => {
  const c = await client();
  expect(c.get('startup').hidden).toBe(true);
  expect(c.get('metric-hours').textContent).toBe('2');
  await c.change('period', '1');
  await c.change('period', '7');
  expect(c.count('/api/privacy')).toBe(1);
  expect(c.count('/api/guilds')).toBe(1);
  await c.change('guild', B);
  await c.change('guild', A);
  expect(c.count('/api/privacy')).toBe(2);
  await c.refresh();
  expect(c.count('/api/privacy')).toBe(3);
});

it('honors the Discord retry delay, keeps same-view figures and never presents them as another server', async () => {
  const c = await client('fr');
  c.fail({ status: 503, error: 'discord_rate_limited', retry: 223 });
  await c.refresh();
  expect(c.get('metric-hours').textContent).toBe('2');
  expect(c.get('updated').textContent).toContain('chiffres précédents');
  expect(c.get('notice').textContent).toContain('223');
  expect(c.get('refresh').disabled).toBe(true);
  const attempts = c.count('/api/activity');
  await c.advance(60000);
  expect(c.count('/api/activity')).toBe(attempts);
  expect(c.get('notice').textContent).toContain('163');
  await c.change('language', 'en');
  expect(c.get('notice').textContent).toContain('163 seconds');
  await c.change('guild', B);
  expect(c.count('/api/activity')).toBe(attempts);
  expect(c.get('metric-hours').textContent).toBe('—');
  expect(c.get('updated').textContent).toBe('Activity could not be loaded.');
  c.fail(null);
  await c.advance(164000);
  expect(c.count('/api/activity')).toBe(attempts + 1);
  expect(c.get('metric-hours').textContent).toBe('2');
  expect(c.get('refresh').disabled).toBe(false);
});

it('learns officer access from the selected report and keeps it while refreshing the server menu', async () => {
  const c = await client();
  await c.click('nav:activity');
  expect(c.get('access-field').hidden).toBe(false);
  await c.change('access', 'guild');
  expect(c.requests.at(-1)).toContain('mode=guild');
  await c.advance(301000);
  expect(c.count('/api/guilds')).toBe(2);
  expect(c.requests.filter(request => request.startsWith('/api/activity')).at(-1)).toContain('mode=guild');
  expect(c.get('access-field').hidden).toBe(false);
  await c.change('guild', B);
  expect(c.get('access-field').hidden).toBe(true);
  expect(c.get('scope-badge').textContent).toBe('YOUR DATA ONLY');
});

it('removes figures after forbidden access but preserves them after a temporary dependency failure', async () => {
  const c = await client();
  c.fail({ status: 503, error: 'discord_unavailable' });
  await c.refresh();
  expect(c.get('metric-hours').textContent).toBe('2');
  expect(c.get('notice').textContent).toContain('Discord access checks are temporarily unavailable');
  expect(c.get('updated').textContent).toContain('Previous figures');
  c.fail({ status: 403, error: 'forbidden' });
  await c.refresh();
  expect(c.get('metric-hours').textContent).toBe('—');
  expect(c.get('updated').textContent).toBe('Activity could not be loaded.');
  expect(c.get('welcome').hidden).toBe(true);
});

it('expires revoked sessions, removes figures and stops background activity requests', async () => {
  const c = await client();
  c.fail({ status: 401, error: 'unauthenticated' });
  await c.refresh();
  expect(c.get('welcome').hidden).toBe(false);
  expect(c.get('workspace').hidden).toBe(true);
  expect(c.get('login-status').hidden).toBe(false);
  expect(c.get('metric-hours').textContent).toBe('—');
  const attempts = c.count('/api/activity');
  await c.advance(60000);
  expect(c.count('/api/activity')).toBe(attempts);
});
