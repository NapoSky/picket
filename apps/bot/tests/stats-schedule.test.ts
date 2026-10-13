import { noopLogger } from '@picket/kernel';
import type { PostgresStatsStore } from '@picket/stats';
import { buildStatsRefreshJob } from '../src/stats-schedule';
describe('leased admin refresh scheduling',()=>{
  let now=new Date('2026-07-07T10:00:00Z');
  const clock={now:()=>now};
  const state={snapshotAt:null as Date|null,scheduledAt:null as Date|null,dirty:true};
  const store={adminSnapshotStatus:jest.fn(async()=>({...state})),refreshAdminSnapshot:jest.fn(async(at:Date)=>{
    state.snapshotAt=new Date(now);state.scheduledAt=at;state.dirty=false;return true;
  })};
  beforeEach(()=>{now=new Date('2026-07-07T10:00:00Z');state.snapshotAt=null;state.scheduledAt=null;state.dirty=true;});
  const job=()=>buildStatsRefreshJob(store as unknown as PostgresStatsStore,clock,noopLogger,'0 0,12 * * *','Europe/Paris');
  it('catches up a missed deadline once and waits for the next one',async()=>{
    expect(await job().execute()).toBe(true);
    expect(store.refreshAdminSnapshot).toHaveBeenCalledWith(new Date('2026-07-07T10:00:00Z'));
    now=new Date('2026-07-07T11:00:00Z');expect(await job().execute()).toBe(false);
    now=new Date('2026-07-07T22:00:00Z');expect(await job().execute()).toBe(true);
  });
  it('refreshes immediately after invalidation even between deadlines',async()=>{
    await job().execute();state.dirty=true;now=new Date('2026-07-07T11:00:00Z');
    expect(await job().execute()).toBe(true);
    expect(store.refreshAdminSnapshot).toHaveBeenCalledTimes(2);
  });
  it('does not acknowledge a failed refresh and retries',async()=>{
    store.refreshAdminSnapshot.mockRejectedValueOnce(new Error('unavailable'));
    await expect(job().execute()).rejects.toThrow('unavailable');
    expect(await job().execute()).toBe(true);
  });
});
