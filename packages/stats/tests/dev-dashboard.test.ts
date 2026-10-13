import { createStatsDevServer } from '../src/infrastructure/dev-dashboard';

const A = '700000000000000001', B = '700000000000000002';
describe('offline dashboard development environment', () => {
  const now = new Date('2026-10-13T12:00:00Z');
  it('serves the real UI and identifies all data as fictitious', async () => {
    const app = createStatsDevServer('member', now);
    try {
      const page = await app.inject('/');
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('Development preview · Fictitious data');
      expect((await app.inject('/app.js')).body).toContain('translations');
      expect((await app.inject('/api/session')).json()).toMatchObject({ administrator: false });
      const overview = (await app.inject(`/api/activity?guild=${A}&mode=overview`)).json();
      const own = (await app.inject(`/api/activity?guild=${A}&mode=guild`)).json();
      expect(overview.activeUsers).toBeGreaterThan(20);
      expect(overview.users).toEqual([]);
      expect(own.users).toHaveLength(1);
      expect(own.seconds).toBeLessThan(overview.seconds);
      expect((await app.inject('/api/activity?guild=all')).statusCode).toBe(403);
      expect((await app.inject('/api/admin/status')).statusCode).toBe(403);
    } finally { await app.close(); }
  });
  it('simulates officer scopes, working filters and the common export contract', async () => {
    const app = createStatsDevServer('officer', now);
    try {
      expect((await app.inject(`/api/activity?guild=${A}&mode=guild`)).json().users.length).toBeGreaterThan(20);
      expect((await app.inject(`/api/activity?guild=${B}&mode=guild`)).json().users).toHaveLength(1);
      const all = (await app.inject(`/api/export?guild=${A}&mode=guild&format=json&days=7`)).json();
      const narrow = (await app.inject(`/api/export?guild=${A}&mode=guild&format=json&days=1&channel=600000000000000001`)).json();
      expect(Array.isArray(all)).toBe(true);
      expect(all.find((row: { username: string }) => row.username === 'Captain')).toMatchObject({ totalSeconds: expect.any(Number), lastActivityDate: expect.any(String) });
      expect(narrow.reduce((sum: number, row: { totalSeconds: number }) => sum + row.totalSeconds, 0)).toBeLessThan(all.reduce((sum: number, row: { totalSeconds: number }) => sum + row.totalSeconds, 0));
      expect((await app.inject(`/api/export?guild=${A}&format=csv`)).body.split('\r\n')[0]).toBe('user_id,username,total_seconds,last_activity_date');
    } finally { await app.close(); }
  });
  it('supports global administration, erasure and sign-out in isolated fixtures', async () => {
    const app = createStatsDevServer('admin', now);
    try {
      const exported = (await app.inject('/api/export?guild=all&format=json')).json();
      expect(exported.length).toBeGreaterThan(60);
      expect(exported[0]).toHaveProperty('guildId');
      expect((await app.inject({ method: 'POST', url: '/api/privacy/erase-all', payload: { confirm: 'DELETE' } })).statusCode).toBe(200);
      expect((await app.inject(`/api/activity?guild=${A}&mode=personal`)).json().users).toEqual([]);
      expect((await app.inject(`/api/privacy?guild=${A}`)).json()).toEqual({ optedOut: true });
      await app.inject({ method: 'POST', url: '/api/logout' });
      expect((await app.inject('/api/session')).statusCode).toBe(401);
      await app.inject('/auth/discord');
      expect((await app.inject('/api/session')).statusCode).toBe(200);
    } finally { await app.close(); }
  });
  it('provides additive server voice series and distinct people series under the same filters', async () => {
    const app = createStatsDevServer('admin', now);
    try {
      const data = (await app.inject('/api/activity?guild=all&days=7')).json();
      expect(data.serverActivity).toHaveLength(5);
      expect(data.activeUsers).toBeGreaterThan(50);
      expect(data.activeUsers).toBeLessThan(data.serverActivity.reduce((sum: number, g: { activeUsers: number }) => sum + g.activeUsers, 0));
      expect(data.serverActivity[4]).toMatchObject({ seconds: 0, activeUsers: 0 });
      expect(data.peakConcurrency).toBeGreaterThan(10);
      expect(data.hourly.reduce((sum: number, h: { seconds: number }) => sum + h.seconds, 0)).toBeCloseTo(data.seconds);
      expect(data.serverActivity.reduce((sum: number, g: { seconds: number }) => sum + g.seconds, 0)).toBe(data.seconds);
      expect(data.daily.reduce((sum: number, d: { seconds: number }) => sum + d.seconds, 0)).toBeCloseTo(data.seconds);
      for (const day of data.daily) {
        const contributions = data.serverActivity.map((g: { daily: { day: string; seconds: number; users: number }[] }) => g.daily.find((d) => d.day === day.day));
        expect(contributions.reduce((sum: number, d: { seconds: number } | undefined) => sum + (d?.seconds ?? 0), 0)).toBeCloseTo(day.seconds);
        expect(Math.max(...contributions.map((d: { users: number } | undefined) => d?.users ?? 0))).toBeLessThanOrEqual(day.users);
      }
      const filtered = (await app.inject('/api/activity?guild=all&days=1&channel=600000000000000001')).json();
      expect(filtered.seconds).toBeLessThan(data.seconds);
      expect(filtered.serverActivity.reduce((sum: number, g: { seconds: number }) => sum + g.seconds, 0)).toBe(filtered.seconds);
      expect(filtered.daily.reduce((sum: number, d: { seconds: number }) => sum + d.seconds, 0)).toBeCloseTo(filtered.seconds);
      const history = (await app.inject('/api/activity?guild=all&days=60')).json();
      expect(history.activeUsers).toBe(74);
      expect(history.users).toHaveLength(98);
      expect(history.serverActivity[4].activeUsers).toBe(8);
      expect(history.seconds).toBeGreaterThan(data.seconds);
      expect(new Set(data.serverActivity[0].daily.map((day: { users: number }) => day.users)).size).toBeGreaterThan(2);
    } finally { await app.close(); }
  });
  it.each(['member', 'officer', 'admin'] as const)('shares deployment counts in the %s preview without granting global voice access', async (role) => {
    const app = createStatsDevServer(role, now);
    try {
      expect((await app.inject('/api/instance')).json()).toEqual({ activeGuilds: 5, updatedAt: now.toISOString(), features: [
        { feature: 'timers', enabledGuilds: 5 }, { feature: 'todolists', enabledGuilds: 4 },
        { feature: 'warlog', enabledGuilds: 2 }, { feature: 'stats', enabledGuilds: 4 },
      ] });
      expect((await app.inject('/api/activity?guild=all')).statusCode).toBe(role === 'admin' ? 200 : 403);
      await app.inject({ method: 'POST', url: '/api/logout' });
      expect((await app.inject('/api/instance')).statusCode).toBe(401);
    } finally { await app.close(); }
  });
});
