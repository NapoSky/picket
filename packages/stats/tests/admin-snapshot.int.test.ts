import { createDatabase, sql } from '@picket/persistence';
import { createTestDatabase, queryAsAdmin, type TestDatabase } from '@picket/testing';
import { PostgresStatsStore, type StatsPeriod, type ActivityReport } from '../src';
const A='700000000000000001',B='700000000000000002',U='300000000000000001',V='300000000000000002',C='600000000000000001',D='600000000000000002';
const global={kind:'global' as const,guildId:null,userId:U};
describe('native admin snapshots',()=>{
  let database:TestDatabase,store:PostgresStatsStore,now:Date,base:Date;
  const date=(offset:number)=>new Date(base.getTime()+offset);
  async function segment(id:string,guild:string,user:string,channel:string,start:Date,end:Date,quality='observed') {
    await queryAsAdmin(database,`INSERT INTO stats_voice_segments(id,guild_id,user_id,channel_id,shard_id,started_at,ended_at,confirmed_through,quality,end_reason)
      VALUES($1,$2,$3,$4,0,$5,$6,$6,$7,'leave')`,[id,guild,user,channel,start,end,quality]);
  }
  beforeEach(async()=>{
    database=await createTestDatabase();now=new Date();base=new Date(now);base.setUTCHours(0,0,0,0);base.setUTCDate(base.getUTCDate()-3);
    store=new PostgresStatsStore(database.handle.db,()=>now);
    await queryAsAdmin(database,'INSERT INTO guild_registry(guild_id) VALUES($1),($2)',[A,B]);
    await queryAsAdmin(database,'INSERT INTO guild_settings(guild_id) VALUES($1),($2)',[A,B]);
    await segment('across-midnight',A,U,C,date(86400000-600000),date(86400000+600000));
    await segment('same-person-other-server',B,U,D,date(86400000-300000),date(86400000+900000));
    await segment('afternoon',A,V,C,date(86400000+43200000),date(86400000+50400000));
    await segment('another-session',A,V,D,date(172800000+60000),date(172800000+360000),'interrupted');
    await segment('expired',A,V,C,new Date(now.getTime()-61*86400000),new Date(now.getTime()-61*86400000+600000));
    await queryAsAdmin(database,`INSERT INTO stats_users(guild_id,user_id,name,last_seen_at) VALUES($1,$3,'Alice',$5),($2,$3,'Alice',$5),($1,$4,'Bob',$5)`,[A,B,U,V,now]);
  });
  afterEach(async()=>database.drop());
  const period=():StatsPeriod=>({from:new Date(now.getTime()-7*86400000),to:now});
  function same(cached:ActivityReport,live:ActivityReport) {
    for(const field of ['seconds','activeUsers','sessions','peakConcurrency','interruptedSegments'] as const)expect(cached[field]).toBeCloseTo(live[field],5);
    expect(cached.daily).toEqual(live.daily);
    expect(cached.serverActivity).toEqual(live.serverActivity);
    const hours=(r:ActivityReport)=>Array.from({length:24},(_,hour)=>r.hourly.find(h=>h.hour===hour)?.seconds??0);
    expect(hours(cached)).toEqual(hours(live));
    expect(cached.users.map(u=>({...u,lastActivity:new Date(u.lastActivity).toISOString()}))).toEqual(live.users);
    expect(cached.recent.map(u=>({...u,startedAt:new Date(u.startedAt).toISOString(),endedAt:u.endedAt?new Date(u.endedAt).toISOString():null,confirmedThrough:new Date(u.confirmedThrough).toISOString()}))).toEqual(live.recent);
  }
  it('matches live calculations across midnight, shared people, channels and partial periods',async()=>{
    await store.refreshAdminSnapshot();
    for(const p of [period(),{from:date(86400000-120000),to:date(86400000+420000)},{from:date(86400000),to:date(2*86400000)},{...period(),channelId:C}]) {
      same(await store.adminReport(global,p),await store.report(global,p));
    }
    const cached=await store.adminReport(global,period());
    expect(cached.activeUsers).toBe(2);expect(cached.serverActivity.reduce((n,g)=>n+g.activeUsers,0)).toBe(3);
  });
  it('preserves immediate joins/leaves, including zero-duration segments at midnight',async()=>{
    const W='300000000000000003';
    await segment('immediate-midnight',A,W,C,date(86400000),date(86400000));
    await segment('immediate-afternoon',A,W,C,date(86400000+4000000),date(86400000+4000000));
    await store.refreshAdminSnapshot();same(await store.adminReport(global,period()),await store.report(global,period()));
    same(await store.adminReport(global,{from:date(86400000-1000),to:date(86400000+1000)}),await store.report(global,{from:date(86400000-1000),to:date(86400000+1000)}));
  });
  it('freezes totals and recent facts until a concurrent refresh, and preserves pagination',async()=>{
    await store.refreshAdminSnapshot();const old=await store.adminReport(global,period());
    await segment('late-replayed',B,V,C,date(86400000+1000),date(86400000+61000),'replayed');
    expect(await store.adminReport(global,period())).toEqual(old);
    await store.refreshAdminSnapshot();const updated=await store.adminReport(global,period());expect(updated.seconds).toBe(old.seconds+60);
    expect(updated.recent).toHaveLength(old.recent.length+1);
    const page=await store.adminReport(global,period(),{limit:1});expect(page.users).toHaveLength(1);expect(page.truncated).toBe(true);
    const next=await store.adminReport(global,period(),{limit:1,offset:1});expect(next.users[0]).not.toEqual(page.users[0]);
  });
  it('blocks stale snapshots immediately after erasure and removes physical copies on refresh',async()=>{
    await store.refreshAdminSnapshot();await store.setPrivacy(A,U,true,true);
    expect((await store.adminSnapshotStatus()).dirty).toBe(true);
    await expect(store.adminReport(global,period())).rejects.toMatchObject({message:'stats_snapshot_pending',statusCode:503});
    await store.refreshAdminSnapshot();same(await store.adminReport(global,period()),await store.report(global,period()));
    expect(await queryAsAdmin(database,'SELECT user_id FROM stats_admin_days WHERE guild_id=$1 AND user_id=$2',[A,U])).toEqual([]);
  });
  it('enforces the current 60-day cutoff even when the snapshot is older',async()=>{
    const start=new Date(now.getTime()-60*86400000+1000),end=new Date(start.getTime()+600000);
    await segment('oldest-boundary',A,U,C,start,end);await store.refreshAdminSnapshot();
    now=new Date(now.getTime()+301000);
    same(await store.adminReport(global,{from:new Date(now.getTime()-60*86400000),to:now}),
      await store.report(global,{from:new Date(now.getTime()-60*86400000),to:new Date(now.getTime()-301000)}));
  });
  it('never republishes an erased contribution when erasure races a rebuild',async()=>{
    await store.refreshAdminSnapshot();
    const original=(await queryAsAdmin<{definition:string}>(database,"SELECT pg_get_functiondef('stats_admin_clock()'::regprocedure) AS definition"))[0]!.definition;
    await queryAsAdmin(database,`CREATE OR REPLACE FUNCTION stats_admin_clock() RETURNS timestamptz LANGUAGE plpgsql STABLE
      SET search_path=pg_catalog,public AS $$ BEGIN PERFORM pg_advisory_xact_lock(727015);
      RETURN COALESCE(NULLIF(current_setting('app.stats_snapshot_at',true),'')::timestamptz,statement_timestamp()); END $$`);
    const control=createDatabase({connectionString:database.adminUrl,maxConnections:1});
    try {
      await control.db.connection().execute(async connection=>{
        await sql`SELECT pg_advisory_lock(727015)`.execute(connection);
        const rebuilding=store.refreshAdminSnapshot().then(()=>null,error=>error as {code:string});
        try {
          let blocked=false;
          for(let n=0;n<300;n++) {
            blocked=(await sql<{n:string}>`SELECT COUNT(*) AS n FROM pg_stat_activity
              WHERE datname=current_database() AND wait_event='advisory' AND query LIKE 'SELECT picket_stats_admin_refresh%'`.execute(connection)).rows[0]!.n!=='0';
            if(blocked)break;
            await new Promise(resolve=>setTimeout(resolve,10));
          }
          expect(blocked).toBe(true);
          // The revision row must remain writable while the heavy SQL is running.
          await store.setPrivacy(A,U,true,true);
          await expect(store.adminReport(global,period())).rejects.toMatchObject({statusCode:503});
        } finally { await sql`SELECT pg_advisory_unlock(727015)`.execute(connection); }
        expect(await rebuilding).toMatchObject({code:'40001'});
      });
    } finally { await control.close();await queryAsAdmin(database,original); }
    expect((await store.adminSnapshotStatus()).dirty).toBe(true);
    await store.refreshAdminSnapshot();
    same(await store.adminReport(global,period()),await store.report(global,period()));
  });
  it('returns the exact latest 100 facts for a historical cutoff inside a dense day',async()=>{
    await queryAsAdmin(database,`INSERT INTO stats_voice_segments(id,guild_id,user_id,channel_id,shard_id,started_at,ended_at,confirmed_through,quality,end_reason)
      SELECT 'dense-'||n,$1,$2,$3,0,$4::timestamptz+n*interval '2 seconds',$4::timestamptz+n*interval '2 seconds'+interval '1 second',
        $4::timestamptz+n*interval '2 seconds'+interval '1 second','observed','leave' FROM generate_series(1,200) n`,[A,V,C,date(2*86400000+5*3600000)]);
    await store.refreshAdminSnapshot();
    const p={from:date(86400000),to:date(2*86400000+5*3600000+242000)};
    same(await store.adminReport(global,p),await store.report(global,p));
    expect((await store.adminReport(global,p)).recent).toHaveLength(100);
  });
  it('denies direct view reads and guarded functions without a trusted global context',async()=>{
    await store.refreshAdminSnapshot();
    for(const table of ['stats_admin_days','stats_admin_hours','stats_admin_peaks','stats_admin_live','stats_admin_snapshot_state'])
      await expect(sql`SELECT * FROM ${sql.table(table)}`.execute(database.handle.db)).rejects.toThrow(/permission denied/);
    await expect(sql`SELECT picket_stats_admin_report(${period().from},${now},NULL,1000,0,${now})`.execute(database.handle.db)).rejects.toThrow(/global stats context/);
    await expect(store.adminReport({kind:'guild',guildId:A,userId:U},period())).rejects.toMatchObject({statusCode:403});
  });
  it('does not expose old connected-person snapshots after a prolonged outage',async()=>{
    await store.refreshAdminSnapshot();now=new Date(now.getTime()+61*86400000);
    await expect(store.adminReport(global,period())).rejects.toMatchObject({statusCode:503});
  });
  it('invalidates on guild purge and can bootstrap after a backup without snapshot data',async()=>{
    await store.refreshAdminSnapshot();await queryAsAdmin(database,'DELETE FROM guild_registry WHERE guild_id=$1',[B]);
    await expect(store.adminReport(global,period())).rejects.toMatchObject({statusCode:503});
    await queryAsAdmin(database,'DELETE FROM stats_admin_snapshot_state');expect((await store.adminSnapshotStatus()).dirty).toBe(true);
    await store.refreshAdminSnapshot();expect((await store.adminSnapshotStatus()).dirty).toBe(false);
  });
});
