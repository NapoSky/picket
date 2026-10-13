import { latestCronSchedule } from '@picket/config';
import type { Clock, Logger } from '@picket/kernel';
import type { PostgresStatsStore } from '@picket/stats';

export function buildStatsRefreshJob(store: PostgresStatsStore, clock: Clock, logger: Logger,
  cron = '0 0,12 * * *', timeZone = 'Europe/Paris') {
  return {
    async execute() {
      const scheduledAt = latestCronSchedule(cron, clock.now(), timeZone);
      const state = await store.adminSnapshotStatus();
      if (!state.dirty && state.scheduledAt && state.scheduledAt >= scheduledAt) return false;
      const started = Date.now();
      const refreshed = await store.refreshAdminSnapshot(scheduledAt);
      if (refreshed) logger.info({ durationMs: Date.now() - started, scheduledAt, cron, timeZone }, 'admin statistics snapshot refreshed');
      return refreshed;
    },
  };
}
