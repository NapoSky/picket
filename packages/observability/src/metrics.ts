import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from '@prometheus-io/client';
import type { MetricComponent, MetricOperation, MetricOutcome, MetricSignal, OperationalMetrics } from '@picket/kernel';

const COMPONENTS = new Set<MetricComponent>(['default', 'interactions', 'dashboard', 'bot', 'webhook', 'oauth',
  'gateway', 'job-runner', 'warlog-poller', 'timers', 'retention', 'audit', 'voice', 'voice-metadata',
  'stats-maintenance', 'stats-refresh', 'war-publish', 'war-hooks']);
const OPERATIONS = new Set<MetricOperation>(['interaction', 'acknowledgement', 'deferred', 'deferred_delivery',
  'discord_rest', 'discord_budget', 'database_acquire', 'database_query', 'lease_acquire', 'lease_renew',
  'loop', 'war_poll', 'http', 'diagnostic']);
const OUTCOMES = new Set<MetricOutcome>(['success', 'error', 'timeout', 'rejected', 'duplicate', 'limited', 'standby']);
const SIGNALS = new Set<MetricSignal>(['pool_total', 'pool_idle', 'pool_waiting', 'pool_max', 'role_enabled',
  'role_leader', 'ready', 'draining', 'shards_expected', 'shards_connected', 'loop_active',
  'loop_last_success', 'loop_interval', 'war_last_success', 'buffer_bytes', 'buffer_max_bytes',
  'buffer_rejections', 'dashboard_enabled', 'task_schedule', 'task_success', 'war_pending_guilds', 'war_delivery_overdue',
  'stats_snapshot_dirty', 'stats_snapshot_updated']);

/** One registry per process, and finite labels even if a caller supplies malformed input. */
export function createMetrics(options: { service: string; version: string; runtime?: boolean }) {
  const registry = new Registry();
  registry.setDefaultLabels({ service: options.service });
  if (options.runtime !== false) collectDefaultMetrics({ register: registry });
  new Gauge({ name: 'picket_build_info', help: 'Running immutable image version', labelNames: ['version'],
    registers: [registry] }).set({ version: options.version }, 1);
  const operations = new Counter({ name: 'picket_operations_total', help: 'Completed operational work',
    labelNames: ['operation', 'component', 'outcome'], registers: [registry] });
  const duration = new Histogram({ name: 'picket_operation_duration_seconds', help: 'Operational work duration',
    labelNames: ['operation', 'component'], buckets: [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2, 2.5, 5, 10, 30, 60, 120], registers: [registry] });
  const signals = new Map<MetricSignal, Gauge<'component'>>();
  for (const signal of SIGNALS) signals.set(signal, new Gauge({ name: `picket_${signal}`, help: `Operational ${signal}`,
    labelNames: ['component'], registers: [registry] }));
  const collectors: (() => void | Promise<void>)[] = [];
  const metrics: OperationalMetrics = {
    record(operation, seconds, outcome, component = 'default') {
      if (!OPERATIONS.has(operation) || !OUTCOMES.has(outcome) || !Number.isFinite(seconds) || seconds < 0) return;
      const safeComponent = COMPONENTS.has(component) ? component : 'default';
      operations.inc({ operation, component: safeComponent, outcome });
      duration.observe({ operation, component: safeComponent }, seconds);
    },
    set(signal, value, component = 'default') {
      if (!Number.isFinite(value)) return;
      signals.get(signal)?.set({ component: COMPONENTS.has(component) ? component : 'default' }, value);
    },
  };
  return {
    ...metrics,
    contentType: registry.contentType,
    collect(collector: () => void | Promise<void>) { collectors.push(collector); },
    async render(): Promise<string> {
      await Promise.all(collectors.map(collector => collector()));
      return registry.metrics();
    },
    close() { registry.clear(); },
  };
}
