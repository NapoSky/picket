import { latestCronSchedule, loadConfig, ConfigError } from '../src';
const valid = { DISCORD_APPLICATION_ID:'123456789012345678',DISCORD_PUBLIC_KEY:'a'.repeat(64),DISCORD_BOT_TOKEN:'test',DATABASE_URL:'postgres://test:test@localhost/test' };
describe('instance cron schedules',()=>{
  it.each([
    ['2026-01-07T11:00:00Z','Europe/Paris','2026-01-07T11:00:00Z'],
    ['2026-07-07T09:59:59Z','Europe/Paris','2026-07-06T22:00:00Z'],
    ['2026-07-07T10:00:00Z','Europe/Paris','2026-07-07T10:00:00Z'],
    ['2026-03-29T10:00:00Z','Europe/Paris','2026-03-29T10:00:00Z'],
    ['2026-10-25T11:00:00Z','Europe/Paris','2026-10-25T11:00:00Z'],
    ['2026-01-07T12:00:00Z','UTC','2026-01-07T12:00:00Z'],
    ['2026-01-07T12:00:00Z','Asia/Kolkata','2026-01-07T06:30:00Z'],
  ])('resolves inclusive noon/midnight at %s in %s',(now,tz,expected)=>{
    expect(latestCronSchedule('0 0,12 * * *',new Date(now),tz)).toEqual(new Date(expected));
  });
  it('accepts lists, steps and a shared instance zone',()=>{
    const config=loadConfig({...valid,TZ:'UTC',STATS_ADMIN_REFRESH_CRON:'*/15 0-23 * * *'});
    expect(config.timeZone).toBe('UTC');
    expect(latestCronSchedule(config.statsAdminRefreshCron,new Date('2026-01-07T12:42:00Z'),config.timeZone)).toEqual(new Date('2026-01-07T12:30:00Z'));
  });
  it.each(['0 0 0,12 * * *','0 25 * * *','H 0 * * *','garbage'])('rejects invalid or nondeterministic cron %s',value=>{
    expect(()=>loadConfig({...valid,STATS_ADMIN_REFRESH_CRON:value})).toThrow(ConfigError);
  });
  it('rejects an unknown instance zone',()=>expect(()=>loadConfig({...valid,TZ:'Unknown/Zone'})).toThrow(ConfigError));
  it('accepts standard named weekdays without treating THU as a hashed field',()=>{
    expect(latestCronSchedule('0 0 * * THU',new Date('2026-01-07T12:00:00Z'),'UTC')).toEqual(new Date('2026-01-01T00:00:00Z'));
  });
});
