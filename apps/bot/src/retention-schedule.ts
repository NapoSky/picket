const parisHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' });

/** Dernière échéance de 3 h à Paris, y compris les journées de 23 ou 25 heures. */
export function latestRetentionSchedule(now: Date): Date {
  const candidate = new Date(now);
  candidate.setUTCMinutes(0, 0, 0);
  for (let hours = 0; hours < 27; hours += 1) {
    if (parisHour.format(candidate) === '03') return candidate;
    candidate.setUTCHours(candidate.getUTCHours() - 1);
  }
  throw new Error('Unable to resolve nightly retention schedule');
}
