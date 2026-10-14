import type { DestinationStream } from 'pino';
import type { OperationalMetrics, MetricComponent } from '@picket/kernel';

// Keep only operational fields. Error messages/stacks, URLs, identifiers, input,
// display names and arbitrary logger bindings never enter the monitoring store.
const NUMBERS = ['durationMs', 'port', 'healthPort', 'shardCount', 'restGlobalRps', 'databasePoolMax',
  'code', 'status', 'backoffMs', 'silentForMs', 'retry_at', 'drainMs'];
const FAILURES: Readonly<Record<string, MetricComponent>> = {
  'timer sweep failed for a board': 'timers',
  'war log delivery failed': 'war-publish',
  'war log delivery pass failed': 'war-publish',
  'audit delivery failed': 'audit',
  'guild log persistence unavailable': 'retention',
};

export function monitoringRecord(record: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const field of ['level', 'time', 'service', 'version']) output[field] = record[field];
  // Application messages are static descriptions; reject interpolated identifiers/URLs/tokens.
  output.msg = typeof record.msg === 'string' && /^[a-zA-Z][a-zA-Z ,;:.'()_-]{0,180}$/.test(record.msg)
    ? record.msg : 'application diagnostic';
  for (const field of NUMBERS) if (typeof record[field] === 'number' && Number.isFinite(record[field])) output[field] = record[field];
  const error = record.err as { type?: unknown; code?: unknown } | undefined;
  if (error && typeof error.type === 'string' && ['Error', 'TypeError', 'DatabaseError', 'DiscordAPIError', 'HTTPError',
    'RateLimitError', 'VoiceBufferFullError', 'HandlerTimeoutError', 'TimeoutError'].includes(error.type)) output.error_type = error.type;
  if (error && typeof error.code === 'string' && (/^[0-9A-Z]{5}$/.test(error.code)
    || ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOENT', 'EACCES'].includes(error.code))) output.error_code = error.code;
  return output;
}

/** Best-effort stdout sink: monitoring is independent of tenant persistence and exports. */
export function createMonitoringDestination(output: DestinationStream = process.stdout, metrics?: OperationalMetrics): DestinationStream {
  return { write(chunk: string) {
    for (const line of chunk.split('\n')) {
      if (!line) continue;
      try {
        const record = JSON.parse(line) as Record<string, unknown>;
        const component = typeof record.msg === 'string' ? FAILURES[record.msg] : undefined;
        if (component && Number(record.level) >= 40) metrics?.record('diagnostic', 0, 'error', component);
        output.write(JSON.stringify(monitoringRecord(record)) + '\n');
      }
      catch { /* A broken monitoring sink must never fail application work. */ }
    }
  } };
}
