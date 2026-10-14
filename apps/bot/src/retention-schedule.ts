import { latestCronSchedule } from '@picket/config';

/** Most recent 03:00 deadline in the instance timezone, including daylight-saving changes. */
export function latestRetentionSchedule(now: Date, timeZone = 'Europe/Paris'): Date {
  return latestCronSchedule('0 3 * * *', now, timeZone);
}
