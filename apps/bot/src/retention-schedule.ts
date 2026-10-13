import { latestCronSchedule } from '@picket/config';

/** Dernière échéance de 3 h dans le fuseau de l’instance, changements d’heure compris. */
export function latestRetentionSchedule(now: Date, timeZone = 'Europe/Paris'): Date {
  return latestCronSchedule('0 3 * * *', now, timeZone);
}
