import { parsePeriod, STATS_RETENTION_MS, type StatsPeriod } from './model';

const DAY = 86_400_000;
export class StatsPeriodError extends Error {
  readonly statusCode: number;
  constructor(code: 'invalid_period' | 'period_unavailable' | 'stats_snapshot_pending') {
    super(code);
    this.statusCode = code === 'stats_snapshot_pending' ? 503 : 400;
  }
}

/** Civil dates always use the report's zone, never the viewer's browser zone. */
const formatters = new Map<string, Intl.DateTimeFormat>();
export function calendarDate(instant: Date, timezone: string): string {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en', {
      timeZone: timezone, calendar: 'iso8601', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    formatters.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(instant);
  const part = (kind: string) => parts.find(p => p.type === kind)!.value;
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function nextDate(value: string): string {
  return new Date(Date.parse(`${value}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
}

/** Find the first instant of a civil day, including zones whose DST skips midnight. */
function dayStart(value: string, timezone: string): Date {
  const centre = Date.parse(`${value}T00:00:00Z`);
  let low = centre - 2 * DAY, high = centre + 2 * DAY;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (calendarDate(new Date(middle), timezone) < value) low = middle + 1;
    else high = middle;
  }
  if (calendarDate(new Date(low), timezone) !== value) throw new StatsPeriodError('invalid_period');
  return new Date(low);
}

export function calendarLimits(timezone: string, now: Date) {
  const cutoff = new Date(now.getTime() - STATS_RETENTION_MS);
  const first = calendarDate(cutoff, timezone);
  return { timezone, today: calendarDate(now, timezone),
    earliestStart: dayStart(first, timezone).getTime() < cutoff.getTime() ? nextDate(first) : first };
}

/** Shared contract for Discord, HTTP and the offline preview. End dates are inclusive. */
export function resolveStatsPeriod(input: Readonly<Record<string, unknown>>, timezone: string, now: Date,
  snapshotAt?: Date | null, options: { readonly trimExpiredExportStart?: boolean } = {}): StatsPeriod {
  if (snapshotAt && snapshotAt.getTime() <= now.getTime() - STATS_RETENTION_MS)
    throw new StatsPeriodError('stats_snapshot_pending');
  const calendar = input.start !== undefined || input.end !== undefined;
  let period: StatsPeriod | null;
  if (calendar) {
    if (input.days !== undefined || input.from !== undefined || input.to !== undefined ||
      !validDate(input.start) || !validDate(input.end) || input.start > input.end)
      throw new StatsPeriodError('invalid_period');
    const limits = calendarLimits(timezone, now);
    if (input.start < limits.earliestStart || input.end > limits.today)
      throw new StatsPeriodError('invalid_period');
    period = { from: dayStart(input.start, timezone),
      to: new Date(Math.min(dayStart(nextDate(input.end), timezone).getTime(), now.getTime())) };
    if (period.from >= period.to) throw new StatsPeriodError('invalid_period');
  } else {
    const days = input.days === undefined ? 7 :
      typeof input.days === 'number' ? input.days :
        typeof input.days === 'string' && /^\d+$/.test(input.days) ? Number(input.days) : NaN;
    if (!Number.isInteger(days) || days < 1 || days > 60) throw new StatsPeriodError('invalid_period');
    const end = snapshotAt ?? now;
    let from = input.from;
    // A displayed 60-day report starts expiring immediately. A frozen export may
    // trim that expired prefix; HTTP receipts expose its effective bounds to the UI.
    // Never expand history, accept a >60-day request, or revive a fully expired range.
    if (options.trimExpiredExportStart && typeof from === 'string' && typeof input.to === 'string') {
      const start = Date.parse(from), to = Date.parse(input.to), cutoff = now.getTime() - STATS_RETENTION_MS;
      if (start < cutoff && to > cutoff && to <= now.getTime() && to - start <= STATS_RETENTION_MS)
        from = new Date(cutoff).toISOString();
    }
    period = parsePeriod(from ?? new Date(Math.max(now.getTime() - STATS_RETENTION_MS,
      end.getTime() - days * DAY)).toISOString(), input.to ?? end.toISOString(), now);
    if (!period) throw new StatsPeriodError('invalid_period');
  }
  if (snapshotAt && period.from >= snapshotAt) throw new StatsPeriodError('period_unavailable');
  return period;
}

/** UTC instants make file names unambiguous even on a daylight-saving transition. */
export function activityFilename(scope: string, from: string, to: string, format: 'csv' | 'json'): string {
  const stamp = (value: string) => new Date(value).toISOString().replace(/[-:]/g, '').replace('.000', '');
  return `picket-voice-${scope}-${stamp(from)}_${stamp(to)}.${format}`;
}
