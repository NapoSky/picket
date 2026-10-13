import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabase, sql } from '@picket/persistence';
import { PostgresLeaseStore } from '@picket/coordination';
import { performance } from 'node:perf_hooks';
import { createTestDatabase, queryAsAdmin, type TestDatabase } from '@picket/testing';
import { PostgresStatsStore } from '../src';
// Standard integration fixture stays small; stats:test:load exercises 50 people
// and eight disconnect/reconnect or channel segments per person/day over 60 days.
const extended = process.env.npm_lifecycle_event === 'stats:test:load';
const peoplePerGuild = Number(process.env.STATS_LOAD_PEOPLE ?? (extended ? 50 : 10));
const segmentsPerDay = Number(process.env.STATS_LOAD_SEGMENTS ?? (extended ? 8 : 2));
if (!Number.isInteger(peoplePerGuild) || peoplePerGuild < 1 || peoplePerGuild > 200 ||
    !Number.isInteger(segmentsPerDay) || segmentsPerDay < 1 || segmentsPerDay > 48)
  throw new Error('Invalid stats load profile: people 1–200; segments 1–48');
// Synthetic closed facts isolate query costs; they are not a claim about production traffic.
describe('300-guild retained voice workload', () => {
  let database: TestDatabase;
  let dashboard: ReturnType<typeof createDatabase>;
  beforeAll(async () => {
    database = await createTestDatabase();
    dashboard = createDatabase({
      connectionString: database.appUrl,
      maxConnections: 2,
      applicationName: 'stats-load-dashboard',
    });
  });
  afterAll(async () => { await dashboard.close(); await database.drop(); });
  it(`keeps scoped and global totals consistent on ${300 * peoplePerGuild * 60 * segmentsPerDay} segments`, async () => {
    await queryAsAdmin(
      database,
      `INSERT INTO guild_registry(guild_id,registered_at) SELECT (700000000000000000+n)::text,now() FROM generate_series(1,300) n`,
    );
    await queryAsAdmin(database, `INSERT INTO guild_settings(guild_id) SELECT guild_id FROM guild_registry`);
    await queryAsAdmin(
      database,
      `INSERT INTO stats_voice_segments(id,guild_id,user_id,channel_id,shard_id,started_at,ended_at,confirmed_through,current_roles,quality,end_reason)
      SELECT md5(g.guild_id||':'||person||':'||day||':'||part),g.guild_id,(300000000000000000+(g.guild_id::numeric-700000000000000000)*1000+person)::text,(600000000000000001+part%2)::text,0,
        now()-day*interval '1 day'+part*interval '30 minutes'+(person%4)*interval '1 minute',now()-day*interval '1 day'+part*interval '30 minutes'+(person%4)*interval '1 minute'+(10+person%5)*interval '1 minute',
        now()-day*interval '1 day'+part*interval '30 minutes'+(person%4)*interval '1 minute'+(10+person%5)*interval '1 minute',ARRAY['400000000000000001'],'observed',CASE WHEN part%2=0 THEN 'leave' ELSE 'move' END
      FROM guild_registry g CROSS JOIN generate_series(1,${peoplePerGuild}) person CROSS JOIN generate_series(1,60) day CROSS JOIN generate_series(0,${segmentsPerDay - 1}) part`,
    );
    await queryAsAdmin(
      database,
      "INSERT INTO stats_settings(guild_id,guild_name,observed_through) SELECT guild_id,'Synthetic regiment',now() FROM guild_registry",
    );
    await queryAsAdmin(
      database,
      "INSERT INTO stats_users(guild_id,user_id,name,last_seen_at) SELECT guild_id,user_id,'Member '||user_id,MAX(confirmed_through) FROM stats_voice_segments GROUP BY guild_id,user_id",
    );
    const to = new Date();
    const store = new PostgresStatsStore(dashboard.db,()=>to);
    const period = { from: new Date(to.getTime() - 60 * 86_400_000), to };
    const times: number[] = [];
    for (let n = 0; n < 10; n++) {
      const start = performance.now();
      const report = await store.report(
        { kind: 'guild', guildId: String(700000000000000001n + BigInt(n)), userId: '300000000000000001' },
        period,
      );
      times.push(performance.now() - start);
      expect(report.activeUsers).toBe(peoplePerGuild);
      expect(report.peakConcurrency).toBe(peoplePerGuild);
      expect(report.hourly.reduce((sum, row) => sum + row.seconds, 0)).toBeCloseTo(report.seconds, 3);
    }
    const mainStore = new PostgresStatsStore(database.handle.db,()=>to);
    const leases = new PostgresLeaseStore(database.handle.db);
    const lease = (await leases.acquire('stats-load-checkpoints', 'writer', 900_000))!;
    const start = performance.now();
    const primaryTimes: number[] = [];
    const primaryWrites = Promise.all(
      Array.from({ length: 20 }, async (_, n) => {
        const began = performance.now();
        await mainStore.checkpoint(String(700000000000000001n + BigInt(n)), lease, new Date());
        primaryTimes.push(performance.now() - began);
      }),
    );
    const global = await store.report(
      { kind: 'global', guildId: null, userId: '300000000000000001' },
      period,
    );
    const globalMs = performance.now() - start;
    expect(globalMs).toBeLessThan(120_000);
    await primaryWrites;

    expect(global.activeUsers).toBe(300 * peoplePerGuild);
    expect(global.users).toHaveLength(Math.min(1000, 300 * peoplePerGuild));
    expect(global.truncated).toBe(300 * peoplePerGuild > 1000);
    expect(global.serverActivity).toHaveLength(300);
    expect(global.serverActivity.every((g) => g.activeUsers === peoplePerGuild)).toBe(true);
    expect(global.serverActivity.reduce((sum, g) => sum + g.seconds, 0)).toBeCloseTo(global.seconds, 3);
    expect(global.serverActivity.flatMap((g) => g.daily).reduce((sum, d) => sum + d.seconds, 0)).toBeCloseTo(global.seconds, 3);
    expect(global.peakConcurrency).toBe(300 * peoplePerGuild);
    expect(global.seconds).toBeGreaterThan(100_000);
    expect(global.hourly.reduce((sum, row) => sum + row.seconds, 0)).toBeCloseTo(global.seconds, 2);
    const refreshStart=performance.now();
    await mainStore.refreshAdminSnapshot();
    const initialRefreshMs=performance.now()-refreshStart;
    const concurrentStart=performance.now();
    const refreshing=mainStore.refreshAdminSnapshot();
    let refreshingObserved=false;
    for(let n=0;n<300;n++) {
      refreshingObserved=(await sql<{n:string}>`SELECT COUNT(*) AS n FROM pg_stat_activity
        WHERE datname=current_database() AND state='active' AND query LIKE 'SELECT picket_stats_admin_refresh%'`.execute(dashboard.db)).rows[0]!.n!=='0';
      if(refreshingObserved)break;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    expect(refreshingObserved).toBe(true);
    const refreshWrites=Promise.all(Array.from({length:20},async(_,n)=>{
      const began=performance.now();
      await mainStore.checkpoint(String(700000000000000001n+BigInt(n)),lease,new Date());
      return performance.now()-began;
    }));
    const duringRefreshStart=performance.now();
    const duringRefresh=await store.adminReport({kind:'global',guildId:null,userId:'300000000000000001'},period);
    const duringRefreshMs=performance.now()-duringRefreshStart;
    expect(duringRefresh.seconds).toBeCloseTo(global.seconds,2);
    await refreshing;
    const concurrentRefreshMs=performance.now()-concurrentStart;
    const refreshCheckpointTimes=await refreshWrites;
    const snapshotTimes:number[]=[];
    for(let n=0;n<3;n++) {
      const began=performance.now();
      const cached=await store.adminReport({kind:'global',guildId:null,userId:'300000000000000001'},period);
      snapshotTimes.push(performance.now()-began);
      expect(cached.activeUsers).toBe(global.activeUsers);
      expect(cached.sessions).toBe(global.sessions);
      expect(cached.seconds).toBeCloseTo(global.seconds,2);
      expect(cached.peakConcurrency).toBe(global.peakConcurrency);
      expect(cached.users).toHaveLength(global.users.length);
      expect(cached.serverActivity).toHaveLength(300);
      expect(cached.hourly.reduce((sum,r)=>sum+r.seconds,0)).toBeCloseTo(cached.seconds,2);
    }
    expect(Math.max(...snapshotTimes)).toBeLessThan(15_000);
    await leases.release(lease);
    const snapshotSize=await queryAsAdmin(database,"SELECT pg_size_pretty(SUM(pg_total_relation_size(oid))::bigint) AS size FROM pg_class WHERE relname IN ('stats_admin_days','stats_admin_hours','stats_admin_peaks','stats_admin_live')");
    const size = await queryAsAdmin(
      database,
      "SELECT pg_size_pretty(pg_total_relation_size('stats_voice_segments')) AS size",
    );
    const measurements = {
      guilds: 300,
      peoplePerGuild,
      segmentsPerDay,
      days: 60,
      segments: 300 * peoplePerGuild * 60 * segmentsPerDay,
      dashboardPool: 2,
      mainPool: 4,
      p95GuildMs: Math.round(times.sort((a, b) => a - b)[9]!),
      globalMs: Math.round(globalMs),
      initialRefreshMs:Math.round(initialRefreshMs),
      concurrentRefreshMs:Math.round(concurrentRefreshMs),
      adminReadDuringRefreshMs:Math.round(duringRefreshMs),
      p95AdminSnapshotMs:Math.round(Math.max(...snapshotTimes)),
      p95CheckpointDuringRefreshMs:Math.round(refreshCheckpointTimes.sort((a,b)=>a-b)[18]!),
      snapshotSize:snapshotSize[0]!.size,
      p95PrimaryCheckpointMs: Math.round(primaryTimes.sort((a, b) => a - b)[18]!),
      segmentsSize: size[0]!.size,
    };
    await writeFile(join(tmpdir(), 'picket-stats-benchmark.json'), JSON.stringify(measurements, null, 2));
    console.info(JSON.stringify(measurements));
  }, 1_200_000);
});
