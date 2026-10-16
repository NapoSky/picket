import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify from 'fastify';
import { exportActivity } from '../application/activity-export';
import { parsePeriod } from '../domain/model';
import { FEATURES } from '@picket/guild';

export type PreviewRole = 'member' | 'officer' | 'admin';
const A = '700000000000000001', B = '700000000000000002', U = '300000000000000001';
const C = '600000000000000001', D = '600000000000000002';

/** Offline UI sandbox. Never registered by the production composition root. */
export function createStatsDevServer(role: PreviewRole = 'admin', now = new Date()) {
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 });
  const guilds = [
    { id: A, name: 'Demo regiment', level: role === 'admin' ? 'instance_admin' : role === 'member' ? 'member' : 'officer', enabled: true, isMember: true },
    { id: B, name: 'Demo allies', level: role === 'admin' ? 'instance_admin' : 'member', enabled: true, isMember: true },
    ...['Iron Vanguard', 'Harbour Logistics', 'Reserve Company'].map((name, index) => ({
      id: String(BigInt(A) + BigInt(index + 2)), name,
      level: role === 'admin' ? 'instance_admin' : 'member', enabled: index !== 2, isMember: true,
    })),
  ];
  const channels = [{ id: C, name: 'Operations' }, { id: D, name: 'Logistics' },
    { id: String(BigInt(C) + 2n), name: 'Training' }, { id: String(BigInt(C) + 3n), name: 'Briefing' }];
  let signedIn = true;
  const excluded = new Set<string>();
  const names = ['Captain', 'Sage', 'Vesper', 'Rook', 'Ash', 'Flint', 'Beacon', 'Harrier', 'Atlas', 'Ember', 'Moss', 'Kestrel'];
  const peoplePerGuild = [36, 24, 18, 12, 8];
  const midnight = new Date(now);
  midnight.setUTCHours(0, 0, 0, 0);
  // Deterministic profiles: regular regiment, weekend allies, operation spikes,
  // morning logistics, and a reserve whose collection stopped ten days ago.
  // Six identities are shared across guilds so deduplication remains visible.
  let segments = Array.from({ length: 60 }, (_, day) => guilds.flatMap((guild, g) => {
    if (!guild.enabled && day < 10) return [];
    const date = new Date(midnight.getTime() - day * 86400_000);
    const weekend = [0, 6].includes(date.getUTCDay());
    const threshold = [weekend ? 90 : 55, weekend ? 95 : 25, day % 6 === 0 ? 100 : 20,
      weekend ? 25 : 80, 35][g]!;
    return Array.from({ length: peoplePerGuild[g]! }, (_, user) => {
      if (user !== 0 && (day + user + g) % 7 !== 0 && (user * 37 + day * 19 + g * 11) % 100 >= threshold) return [];
      const identity = user < 6 ? user : g * 100 + user;
      const name = identity < names.length ? names[identity]! : `${names[user % names.length]} ${identity + 1}`;
      const started = date.getTime() + ([18, 21, 19, 6, 14][g]! * 60 + user % 6 * 10) * 60_000;
      const parts = user % 3 + 1;
      const partSeconds = (20 + (user * 13 + day * 17 + g * 7) % 100 + (g === 2 && day % 6 === 0 ? 60 : 0)) * 60;
      return Array.from({ length: parts }, (_, part) => {
        const start = started + part * partSeconds * 1000;
        const end = Math.min(start + partSeconds * 1000, now.getTime() - 300_000);
        if (end <= start) return [];
        const channel = channels[(user + day + g + part) % channels.length]!;
        return [{ guildId: guild.id, userId: String(BigInt(U) + BigInt(identity)), name,
          channel: channel.name, channelId: channel.id, startedAt: new Date(start).toISOString(),
          endedAt: new Date(end).toISOString(), confirmedThrough: new Date(end).toISOString(),
          seconds: (end - start) / 1000, quality: 'observed', endReason: part === parts - 1 ? 'disconnect' : 'move' }];
      }).flat();
    }).flat();
  })).flat();
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (request.url.startsWith('/api/') && !signedIn) return reply.code(401).send({ error: 'unauthenticated' });
  });
  app.get('/api/session', async () => ({ user: { id: U, name: 'Captain' }, csrf: 'preview', administrator: role === 'admin', refreshSeconds: 60, retentionDays: 60 }));
  app.get('/api/guilds', async () => ({ guilds }));
  app.get('/api/instance', async () => ({ activeGuilds: guilds.length,
    features: [
      { feature: 'timers', enabledGuilds: 5 }, { feature: 'todolists', enabledGuilds: 4 },
      { feature: 'voice', enabledGuilds: 5 }, { feature: 'warlog', enabledGuilds: 2 }, { feature: 'stats', enabledGuilds: guilds.filter((g) => g.enabled).length },
    ], updatedAt: now.toISOString() }));
  app.get('/auth/discord', async (_request, reply) => { signedIn = true; return reply.redirect('/'); });
  app.post('/api/logout', async () => { signedIn = false; return { ok: true }; });

  function report(query: Record<string, unknown>, exporting = false) {
    const global = query.guild === 'all';
    const guild = guilds.find((g) => g.id === query.guild);
    if ((global && role !== 'admin') || (!global && !guild)) throw Object.assign(new Error('forbidden'), { statusCode: 403 });
    const days = query.days === undefined ? 7 : Number(query.days);
    const period = Number.isInteger(days) && days >= 1 && days <= 60
      ? parsePeriod(query.from ?? new Date(now.getTime() - days * 86400_000).toISOString(), query.to, now) : null;
    if (!period) throw Object.assign(new Error('invalid_period'), { statusCode: 400 });
    const scope = global ? 'global' : query.mode === 'overview' && !exporting ? 'overview' :
      query.mode !== 'personal' && (role === 'admin' || guild?.level === 'officer') ? 'guild' : 'self';
    const visible = segments.filter((s) => (global || s.guildId === guild!.id) &&
      (scope !== 'self' || s.userId === U) && (!query.channel || s.channelId === query.channel) &&
      s.endedAt > period.from.toISOString() && s.startedAt < period.to.toISOString()).map((s) => ({ ...s,
        seconds: (Math.min(Date.parse(s.endedAt), period.to.getTime()) - Math.max(Date.parse(s.startedAt), period.from.getTime())) / 1000,
      }));
    const people = new Map<string, { guildId: string; userId: string; name: string; seconds: number; sessions: number; lastActivity: string }>();
    for (const s of visible) {
      const key = `${s.guildId}:${s.userId}`, old = people.get(key);
      people.set(key, { guildId: s.guildId, userId: s.userId, name: s.name, seconds: (old?.seconds ?? 0) + s.seconds,
        sessions: (old?.sessions ?? 0) + 1, lastActivity: !old || s.endedAt > old.lastActivity ? s.endedAt : old.lastActivity });
    }
    const firstDay = new Date(period.from);
    firstDay.setUTCHours(0, 0, 0, 0);
    const dailyFor = (items: typeof visible) => {
      return Array.from({ length: Math.floor((period.to.getTime() - firstDay.getTime()) / 86400_000) + 1 }, (_, index) => {
        const start = Math.max(firstDay.getTime() + index * 86400_000, period.from.getTime());
        const end = Math.min(firstDay.getTime() + (index + 1) * 86400_000, period.to.getTime());
        const active = items.filter((s) => Date.parse(s.startedAt) < end && Date.parse(s.endedAt) > start);
        return { day: new Date(firstDay.getTime() + index * 86400_000).toISOString().slice(0, 10),
          seconds: active.reduce((sum, s) => sum + Math.max(0, Math.min(Date.parse(s.endedAt), end) - Math.max(Date.parse(s.startedAt), start)) / 1000, 0),
          users: new Set(active.map((s) => s.userId)).size };
      });
    };
    const changes = new Map<number, number>();
    const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, seconds: 0 }));
    for (const item of visible) {
      const start = Math.max(Date.parse(item.startedAt), period.from.getTime());
      const end = Math.min(Date.parse(item.endedAt), period.to.getTime());
      changes.set(start, (changes.get(start) ?? 0) + 1);
      changes.set(end, (changes.get(end) ?? 0) - 1);
      for (let slot = Math.floor(start / 3600_000) * 3600_000; slot < end; slot += 3600_000) {
        hourly[new Date(slot).getUTCHours()]!.seconds += (Math.min(end, slot + 3600_000) - Math.max(start, slot)) / 1000;
      }
    }
    let concurrent = 0, peakConcurrency = 0;
    for (const [, delta] of [...changes].sort(([a], [b]) => a - b)) {
      concurrent += delta;
      peakConcurrency = Math.max(peakConcurrency, concurrent);
    }
    const guildFeatures = role === 'admin' && guild && scope !== 'overview' && !exporting
      ? FEATURES.map(feature => ({ feature, enabled: feature === 'stats' ? guild.enabled
        : feature === 'timers' || feature === 'voice' || (feature === 'todolists' ? guild.id !== B : [A, B].includes(guild.id)) }))
      : undefined;
    return { scope, ...(guildFeatures ? { guildFeatures } : {}), ...(global ? {snapshotAt:now.toISOString()} : {}), from: period.from.toISOString(), to: period.to.toISOString(), timezone: 'UTC',
      seconds: visible.reduce((sum, s) => sum + s.seconds, 0), activeUsers: new Set(visible.map((s) => s.userId)).size,
      sessions: visible.length, inVoice: 0, peakConcurrency,
      serverActivity: guilds.filter((g) => global || g.id === guild!.id).map((g) => {
        const items = visible.filter((s) => s.guildId === g.id);
        return { guildId: g.id, seconds: items.reduce((sum, s) => sum + s.seconds, 0),
          activeUsers: new Set(items.map((s) => s.userId)).size, sessions: items.length, inVoice: 0,
          daily: dailyFor(items) };
      }),
      updatedAt: now.toISOString(), interruptedAt: null, interruptedSegments: 0, truncated: false, offset: 0,
      daily: dailyFor(visible),
      channels: channels.map((c) => ({ ...c, seconds: visible.filter((s) => s.channelId === c.id).reduce((sum, s) => sum + s.seconds, 0) })),
      hourly,
      users: scope === 'overview' ? [] : [...people.values()].sort((a, b) => b.seconds - a.seconds),
      recent: scope === 'overview' ? [] : [...visible].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 100),
    };
  }
  app.get('/api/activity', async (request) => report(request.query as Record<string, unknown>));
  app.get('/api/export', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    if (query.format !== 'csv' && query.format !== 'json') return reply.code(400).send({ error: 'invalid_export' });
    const data = report(query, true);
    return reply.type(query.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json')
      .header('Content-Disposition', `attachment; filename="picket-demo.${query.format}"`)
      .send(exportActivity(data.users, query.format, data.scope === 'global'));
  });
  app.get('/api/privacy', async (request) => ({ optedOut: excluded.has((request.query as { guild: string }).guild) }));
  app.post('/api/privacy', async (request, reply) => {
    const body = request.body as { guild: string; optedOut: boolean; erase?: boolean; confirm?: string };
    if (!guilds.some((g) => g.id === body.guild)) return reply.code(400).send({ error: 'invalid_guild' });
    if (body.erase && body.confirm !== 'DELETE') return reply.code(400).send({ error: 'invalid_confirmation' });
    if (body.optedOut || body.erase) excluded.add(body.guild); else excluded.delete(body.guild);
    if (body.erase) segments = segments.filter((s) => s.guildId !== body.guild || s.userId !== U);
    return { ok: true };
  });
  app.post('/api/privacy/erase-all', async (request, reply) => {
    if ((request.body as { confirm?: string }).confirm !== 'DELETE') return reply.code(400).send({ error: 'invalid_confirmation' });
    segments = segments.filter((s) => s.userId !== U);
    guilds.forEach((g) => excluded.add(g.id));
    return { ok: true };
  });
  app.get('/api/admin/status', async (_request, reply) => role === 'admin' ? { buffer: { bytes: 0, count: 0, oldest: null } } : reply.code(403).send({ error: 'forbidden' }));
  for (const [path, file, type] of [
    ['/', 'index.html', 'text/html; charset=utf-8'], ['/app.js', 'app.js', 'text/javascript'],
    ['/style.css', 'style.css', 'text/css'], ['/logo.png', 'logo.png', 'image/png'], ['/banner.jpg', 'banner.jpg', 'image/jpeg'],
  ] as const) app.get(path, async (_request, reply) => {
    const data = await readFile(join(__dirname, '..', '..', 'static', file));
    return reply.type(type).send(file === 'index.html' ? data.toString().replace('<body>',
      `<body><p role="status" style="text-align:center;padding:12px">Development preview · Fictitious data · ${role} access</p>`) : data);
  });
  return app;
}
