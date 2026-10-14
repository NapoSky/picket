import { latestCronSchedule } from '@picket/config';
import type { Clock, Logger, OperationalMetrics } from '@picket/kernel';
import type { PostgresStatsStore } from '@picket/stats';

export function buildStatsRefreshJob(store: PostgresStatsStore, clock: Clock, logger: Logger,
  cron = '0 0,12 * * *', timeZone = 'Europe/Paris', metrics?: OperationalMetrics) {
  return {
    async execute() {
      const scheduledAt = latestCronSchedule(cron, clock.now(), timeZone);
      const state = await store.adminSnapshotStatus();
      metrics?.set('stats_snapshot_dirty', Number(state.dirty), 'stats-refresh');
      metrics?.set('stats_snapshot_updated', state.snapshotAt ? state.snapshotAt.getTime() / 1000 : 0, 'stats-refresh');
      metrics?.set('task_schedule', scheduledAt.getTime() / 1000, 'stats-refresh');
      metrics?.set('task_success', state.scheduledAt ? state.scheduledAt.getTime() / 1000 : 0, 'stats-refresh');
      if (!state.dirty && state.scheduledAt && state.scheduledAt >= scheduledAt) return false;
      const started = Date.now();
      const refreshed = await store.refreshAdminSnapshot(scheduledAt);
      if (refreshed) {
        metrics?.set('task_success', scheduledAt.getTime() / 1000, 'stats-refresh');
        metrics?.set('stats_snapshot_dirty', 0, 'stats-refresh');
        metrics?.set('stats_snapshot_updated', clock.now().getTime() / 1000, 'stats-refresh');
      }
      if (refreshed) logger.info({ durationMs: Date.now() - started, scheduledAt, cron, timeZone }, 'admin statistics snapshot refreshed');
      return refreshed;
    },
  };
}
