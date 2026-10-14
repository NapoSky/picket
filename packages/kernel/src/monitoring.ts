/** Operational measurements only: never carry tenant IDs, URLs, tokens or SQL. */
export type MetricOperation = 'interaction' | 'acknowledgement' | 'deferred' | 'deferred_delivery'
  | 'discord_rest' | 'discord_budget' | 'database_acquire' | 'database_query'
  | 'lease_acquire' | 'lease_renew' | 'loop' | 'war_poll' | 'http' | 'diagnostic';
export type MetricOutcome = 'success' | 'error' | 'timeout' | 'rejected' | 'duplicate' | 'limited' | 'standby';
export type MetricComponent = 'default' | 'interactions' | 'dashboard' | 'bot' | 'webhook' | 'oauth'
  | 'gateway' | 'job-runner' | 'warlog-poller' | 'timers' | 'retention' | 'audit'
  | 'voice' | 'voice-metadata' | 'stats-maintenance' | 'stats-refresh' | 'war-publish' | 'war-hooks';
export type MetricSignal = 'pool_total' | 'pool_idle' | 'pool_waiting' | 'pool_max'
  | 'role_enabled' | 'role_leader' | 'ready' | 'draining' | 'shards_expected' | 'shards_connected'
  | 'loop_active' | 'loop_last_success' | 'loop_interval' | 'war_last_success'
  | 'buffer_bytes' | 'buffer_max_bytes' | 'buffer_rejections' | 'dashboard_enabled'
  | 'task_schedule' | 'task_success' | 'war_pending_guilds' | 'war_delivery_overdue'
  | 'stats_snapshot_dirty' | 'stats_snapshot_updated';

export interface OperationalMetrics {
  record(operation: MetricOperation, seconds: number, outcome: MetricOutcome, component?: MetricComponent): void;
  set(signal: MetricSignal, value: number, component?: MetricComponent): void;
}
