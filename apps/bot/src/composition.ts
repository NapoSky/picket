import {
  CommandRegistry,
  ComponentRegistry,
  InteractionPipeline,
  PostgresInteractionReceipts,
  INTERACTION_RECEIPT_RETENTION_DAYS,
  ShardRunner,
  createWsShardConnector,
  type DiscordBotRestClient,
  type AccessPolicy,
  type CommandEntry,
  type ComponentFamily,
  type FeatureGate,
  type GatewayEventHandler,
  type GuildGate,
  type GuildLanguage,
  type GuildRoles,
  type GuildChannels,
  type InteractionReplies,
  type Messaging,
} from '@picket/discord';
import { PostgresGatewaySessionStore, PostgresKeyedLock, PostgresLeaseStore, LeaderElector, startLeasedLoop, type KeyedLock } from '@picket/coordination';
import {
  CancelGuildDeletion,
  ExportGuildData,
  GetGuildLocale,
  GetGuildSettings,
  GetGuildStatus,
  GetSuspension,
  HandleGuildAvailable,
  HandleGuildRemoved,
  HandleRoleDeleted,
  ObserveSupportGuildEvents,
  PostgresSupportGuildEventsRepository,
  PublishSupportGuildEvents,
  PICKET_ROOT,
  PostgresGuildLifecycleRepository,
  PostgresGuildDataExportRepository,
  PostgresGuildSettingsRepository,
  PostgresGuildAuditRepository,
  PublishGuildAudit,
  PostgresPermissionRepository,
  PurgeInactiveGuilds,
  ReconcileGuilds,
  RequestGuildDeletion,
  ResolveAccess,
  ShowPermissions,
  UpdateGuildSettings,
  UpdatePermissions,
  createGuildAccessPolicy,
  createFeatureGate,
  createGuildEventHandler,
  createGuildGate,
  createGuildLanguage,
  createSettingsPanel,
  settingsHomeButton,
  statusCommand,
} from '@picket/guild';
import type { I18n } from '@picket/i18n';
import { noopLogger, type ChannelId, type Clock, type Logger, type Secret, type OperationalMetrics } from '@picket/kernel';
import { createAppState, purgeExpiredJournals, withTenant, type Db } from '@picket/persistence';
import {
  CreateTodolist,
  TODOLIST_ROOT,
  TickTodolistItem,
  todolistCommands,
  todolistFamily,
} from '@picket/todolist';
import {
  AcknowledgeAlert,
  AddAsset,
  BoardMaintenance,
  CleanupBoard,
  CreateBoard,
  GetBoardSettings,
  ListActiveAssets,
  PostgresTimerStore,
  RandomAssetIds,
  RefreshAsset,
  RenderCoalescer,
  RepairBoard,
  StrikeAsset,
  TIMERS_FEATURE,
  TIMERS_ROOT,
  TimerSweep,
  UpdateBoardSettings,
  createTimerSettingsPanel,
  timersCommands,
  timersFamily,
  type Localizer,
  type TimerUseCaseDeps,
} from '@picket/timers';
import { latestRetentionSchedule } from './retention-schedule';
import { buildStatsRefreshJob } from './stats-schedule';
import { ConfigureWarLog, FoxholeApi, PostgresWarStore, PublishWarLog, WARLOG_ROOT, WarPoller, createWarLogSettingsPanel } from '@picket/warlog';
import { createStatsPanel,DiskVoiceBuffer,PostgresStatsStore,STATS_ROOT,VoiceCollector,type DurableVoiceBuffer } from '@picket/stats';

/** Discord REST access: only the interaction server needs it. */
export interface DiscordPorts {
  readonly messaging: Messaging;
  readonly replies: InteractionReplies;
  readonly guildRoles?: GuildRoles;
  readonly guildChannels?: GuildChannels;
}

const unavailable = async (): Promise<never> => {
  throw new Error('Discord REST access is not available in this process');
};

/** For the CLI: build the registry without calling Discord; accidental calls fail loudly. */
export const offlineDiscordPorts: DiscordPorts = {
  messaging: { send: unavailable, fetch: unavailable, edit: unavailable, delete: unavailable },
  replies: { editOriginal: unavailable, deleteOriginal: unavailable, followUp: unavailable },
};

export interface CompositionOptions {
  readonly timeZone?: string;
  readonly statsAdminRefreshCron?: string;
  readonly clock: Clock;
  readonly guildRetentionDays: number;
  readonly supportGuildEventsChannelId?: ChannelId | null;
  readonly i18n: I18n;
  readonly discord?: DiscordPorts;
  readonly flushGuildLogs?: () => Promise<void>;
  readonly metrics?: OperationalMetrics;
  /** Locks hold SQL connections across REST calls; use a separate pool in the running bot. */
  readonly locks?: KeyedLock;
  readonly stats?: {readonly store:PostgresStatsStore;readonly buffer:DurableVoiceBuffer;readonly collector?:VoiceCollector;readonly dashboardUrl:string|null};
}

interface FeatureModule {
  readonly entries: readonly CommandEntry[];
  readonly families: readonly ComponentFamily[];
  readonly aliases: readonly CommandEntry[];
  readonly access: AccessPolicy;
  readonly gate: GuildGate;
  readonly language: GuildLanguage;
  readonly features: FeatureGate;
}

function guildModule(db: Db, options: CompositionOptions, logger: Logger): FeatureModule {
  const settings = new PostgresGuildSettingsRepository(db);
  const permissions = new PostgresPermissionRepository(db);
  const lifecycle = new PostgresGuildLifecycleRepository(db);
  const messaging = (options.discord ?? offlineDiscordPorts).messaging;
  const timers = timerServices(db, options, logger, settings);
  const access = createGuildAccessPolicy(new ResolveAccess(permissions));
  const gate = createGuildGate(new GetSuspension(lifecycle, options.guildRetentionDays));
  const features = createFeatureGate(settings);
  const warStore = new PostgresWarStore(db);
  const configureWarLog = new ConfigureWarLog(warStore, options.discord?.guildChannels ?? { inspect: unavailable }, options.clock);
  const warPanel = createWarLogSettingsPanel({ store: warStore,
    configure: configureWarLog,
    clock: options.clock, access, gate, settingsHome: context => settingsHomeButton(context, options.clock),
  });
  const timerPanel = createTimerSettingsPanel({
    getSettings: new GetBoardSettings(timers.store), updateSettings: new UpdateBoardSettings(timers.deps),
    access, gate, features, clock: options.clock,
    ...(options.discord?.guildRoles ? { guildRoles: options.discord.guildRoles } : {}),
  });
  const showPermissions = new ShowPermissions(permissions);
  const statsStore=options.stats?.store ?? new PostgresStatsStore(db,()=>options.clock.now());
  const statsBuffer=options.stats?.buffer ?? new DiskVoiceBuffer('./data/voice-buffer');
  const statsPanel=createStatsPanel({store:statsStore,buffer:statsBuffer,access,gate,clock:options.clock,dashboardUrl:options.stats?.dashboardUrl ?? null,settingsHome:context=>settingsHomeButton(context,options.clock)});
  const panel = createSettingsPanel({
    settings: new GetGuildSettings(settings), update: new UpdateGuildSettings(settings, options.i18n.locales),
    permissions: showPermissions, updatePermissions: new UpdatePermissions(permissions), access: new ResolveAccess(permissions),
    suspension: new GetSuspension(lifecycle, options.guildRetentionDays),
    request: new RequestGuildDeletion(lifecycle, options.clock, options.guildRetentionDays), cancel: new CancelGuildDeletion(lifecycle),
    exportData: new ExportGuildData(new PostgresGuildDataExportRepository(db, options.flushGuildLogs,
      options.stats?.buffer.exportGuild ? { pendingVoice: (guildId, maxBytes) => options.stats!.buffer.exportGuild!(guildId, maxBytes) } : {}), options.clock),
    clock: options.clock, i18n: options.i18n,
    guildRoles: options.discord?.guildRoles ?? { names: async () => ({}) },
    audit: buildAuditPublisher(db, logger, options),
    warlog: {
      open: context => warPanel.open(context, true),
      disable: async (guildId, actorId) => `warlog.results.${await configureWarLog.execute(guildId, actorId, { kind: 'disable' })}`,
    },
    stats:{open:context=>statsPanel.open(context,true),disable:async(guildId,actorId)=>{await statsStore.configure(guildId,actorId,{enabled:false});return 'panel.saved';}},
  });
  const status = statusCommand(new GetGuildStatus(settings), showPermissions);
  return {
    aliases: [...panel.aliases, { ...status, path: ['picket', 'permissions', 'show'] }],
    entries: [status, panel.command, timerPanel.command, warPanel.command,...statsPanel.entries,
      ...todolistCommands(),
      ...timersCommands({
        createBoard: new CreateBoard(timers.deps),
        strike: new StrikeAsset(timers.deps),
        cleanup: new CleanupBoard(timers.deps),
        repair: new RepairBoard(timers.deps),
        getSettings: new GetBoardSettings(timers.store),
        listActive: new ListActiveAssets(timers.store),
      }),
    ],
    families: [
      ...panel.families,
      ...statsPanel.families,
      warPanel.family,
      timerPanel.family,
      todolistFamily({ create: new CreateTodolist(messaging), tick: new TickTodolistItem(messaging, options.locks ?? new PostgresKeyedLock(db)),
        created: { record: (input) => new PostgresGuildAuditRepository(db).recordTodolist(input) },
      }),
      timersFamily({
        add: new AddAsset(timers.deps),
        refresh: new RefreshAsset(timers.deps),
        acknowledge: new AcknowledgeAlert(timers.deps),
      }),
    ],
    access,
    gate,
    language: createGuildLanguage(new GetGuildLocale(settings)),
    features,
  };
}

/** Shared timer services: persistence, board rendering and maintenance. */
function timerServices(db: Db, options: CompositionOptions, logger: Logger, settings: PostgresGuildSettingsRepository) {
  const store = new PostgresTimerStore(db);
  const messaging = (options.discord ?? offlineDiscordPorts).messaging;
  const guildLocale = new GetGuildLocale(settings);
  const localizer: Localizer = {
    // Forced guild locale, then the channel locale when the board was created, then English.
    localeFor: async (guildId, boardLocale) => options.i18n.resolve(await guildLocale.execute(guildId), boardLocale),
    translator: (locale) => options.i18n.translator(locale).t,
  };
  const maintenance = new BoardMaintenance({
    store,
    messaging,
    lock: options.locks ?? new PostgresKeyedLock(db),
    clock: options.clock,
    localizer,
    logger,
  });
  const deps: TimerUseCaseDeps = {
    store,
    maintenance,
    coalescer: new RenderCoalescer(maintenance),
    messaging,
    clock: options.clock,
    ids: new RandomAssetIds(),
  };
  const features = createFeatureGate(settings);
  return { store, maintenance, deps, features: { isEnabled: (guildId: Parameters<FeatureGate['isEnabled']>[0]) => features.isEnabled(guildId, TIMERS_FEATURE) } };
}

const ROOTS = [PICKET_ROOT, TODOLIST_ROOT, TIMERS_ROOT, WARLOG_ROOT,STATS_ROOT];

/** One fenced collector and one paced distributor. HTTP requests never hold database transactions. */
export function buildWarLogRunner(db: Db, logger: Logger, options: CompositionOptions & { readonly holder: string; readonly apiUrl: string; readonly pollIntervalMs: number; readonly version: string }): LeaderElector {
  const store = new PostgresWarStore(db);
  const guildLocale = new GetGuildLocale(new PostgresGuildSettingsRepository(db));
  const timers = new PostgresTimerStore(db);
  const publish = new PublishWarLog(store, (options.discord ?? offlineDiscordPorts).messaging, options.i18n, options.clock, logger,
    guildId => guildLocale.execute(guildId), (guildId, war, start) => timers.resetForNewWar(guildId, war, start, options.clock.now()));
  return new LeaderElector({ store: new PostgresLeaseStore(db), name: 'warlog-poller', holder: options.holder,
    ttlMs: 30_000, renewEveryMs: 5_000, retryEveryMs: 5_000, clock: options.clock, logger,
    ...(options.metrics ? { metrics: options.metrics, component: 'warlog-poller' as const } : {}),
    onAcquired: async lease => {
      if (!await store.recover(lease)) throw new Error('War-log lease unavailable');
      const poller = new WarPoller(new FoxholeApi(options.apiUrl, options.version), store, lease, options.clock, logger, options.pollIntervalMs, options.metrics);
      options.metrics?.set('war_last_success', options.clock.now().getTime() / 1000, 'warlog-poller');
      const stopPoll = startLeasedLoop({ tick: () => poller.tick(), intervalMs: options.pollIntervalMs, logger, component: 'warlog-poller', ...(options.metrics ? { metrics: options.metrics } : {}) });
      const stopPublish = startLeasedLoop({ tick: () => publish.tick(), intervalMs: 1_000, logger, component: 'war-publish', ...(options.metrics ? { metrics: options.metrics } : {}) });
      const stopHooks = startLeasedLoop({ tick: () => publish.hooks(), intervalMs: 10_000, logger, component: 'war-hooks', ...(options.metrics ? { metrics: options.metrics } : {}) });
      return async () => { poller.stop(); await Promise.all([stopPoll(), stopPublish(), stopHooks()]); };
    },
  });
}

/** The only place that knows every command: the server, CLI and tests share this registry. */
export function buildCommandRegistry(db: Db, options: CompositionOptions): CommandRegistry {
  const guild = guildModule(db, options, noopLogger);
  return new CommandRegistry(ROOTS, guild.entries, options.i18n, guild.aliases);
}

export function buildPipeline(db: Db, logger: Logger, options: CompositionOptions): InteractionPipeline {
  const guild = guildModule(db, options, logger);
  return new InteractionPipeline({
    registry: new CommandRegistry(ROOTS, guild.entries, options.i18n, guild.aliases),
    components: new ComponentRegistry(guild.families),
    receipts: new PostgresInteractionReceipts(db),
    access: guild.access,
    gate: guild.gate,
    language: guild.language,
    features: guild.features,
    logger,
    ...(options.metrics ? { metrics: options.metrics } : {}),
  });
}

const SWEEP_INTERVAL_MS = 15_000;
const AUDIT_INTERVAL_MS = 5_000;
const RETENTION_CHECK_INTERVAL_MS = 60_000;
const RETENTION_SCHEDULE_KEY = 'retention:last_successful_schedule';

/** The `job-runner` role: a single lease holder runs timer and retention passes. */
export function buildJobRunner(
  db: Db,
  logger: Logger,
  options: CompositionOptions & { readonly holder: string },
): LeaderElector {
  const timers = timerServices(db, options, logger, new PostgresGuildSettingsRepository(db));
  const sweep = new TimerSweep({ store: timers.store, maintenance: timers.maintenance, features: timers.features, clock: options.clock, logger });
  const retention = buildNightlyRetentionJob(db, logger, options);
  const audit = buildAuditPublisher(db, logger, options);
  const support = options.supportGuildEventsChannelId
    ? new PublishSupportGuildEvents(new PostgresSupportGuildEventsRepository(db), options.supportGuildEventsChannelId,
      (options.discord ?? offlineDiscordPorts).messaging, options.clock, logger)
    : null;
  return new LeaderElector({
    store: new PostgresLeaseStore(db),
    name: 'job-runner:timers',
    holder: options.holder,
    ttlMs: 15_000,
    renewEveryMs: 5_000,
    retryEveryMs: 5_000,
    clock: options.clock,
    logger,
    ...(options.metrics ? { metrics: options.metrics, component: 'job-runner' as const } : {}),
    onAcquired: async () => {
      const stopTimers = startLeasedLoop({ tick: () => sweep.tick(), intervalMs: SWEEP_INTERVAL_MS, logger, component: 'timers', ...(options.metrics ? { metrics: options.metrics } : {}) });
      const stopRetention = startLeasedLoop({ tick: () => retention.execute(), intervalMs: RETENTION_CHECK_INTERVAL_MS, logger, component: 'retention', ...(options.metrics ? { metrics: options.metrics } : {}) });
      const stopAudit = startLeasedLoop({ tick: () => audit.tick(), intervalMs: AUDIT_INTERVAL_MS, logger, component: 'audit', ...(options.metrics ? { metrics: options.metrics } : {}) });
      const stopSupport = support ? startLeasedLoop({ tick: () => support.tick(), intervalMs: 5_000, logger }) : async () => undefined;
      const stats=options.stats?.store ?? new PostgresStatsStore(db,()=>options.clock.now());
      const stopStats=startLeasedLoop({tick:async()=>{for(const guildId of await stats.allGuildIds()) await stats.maintenance(guildId);},intervalMs:120_000,logger, component: 'stats-maintenance', ...(options.metrics ? { metrics: options.metrics } : {}) });
      const refresh = buildStatsRefreshJob(stats, options.clock, logger, options.statsAdminRefreshCron, options.timeZone, options.metrics);
      const stopRefresh = options.stats?.dashboardUrl
        ? startLeasedLoop({ tick: () => refresh.execute(), intervalMs:60_000, logger, component: 'stats-refresh', ...(options.metrics ? { metrics: options.metrics } : {}) })
        : async () => undefined;
      return async () => { await Promise.all([stopTimers(), stopRetention(), stopAudit(), stopSupport(),stopStats(),stopRefresh()]); };
    },
  });
}

export function buildAuditPublisher(db: Db, logger: Logger, options: CompositionOptions): PublishGuildAudit {
  return new PublishGuildAudit(new PostgresGuildAuditRepository(db), options.discord?.guildChannels ?? { inspect: unavailable },
    (options.discord ?? offlineDiscordPorts).messaging, options.i18n, options.clock, logger);
}

/** The same cleanup for the CLI, catch-up and nightly pass. */
export function buildRetentionJob(db: Db, logger: Logger, options: CompositionOptions) {
  const purge = buildPurgeJob(db, logger, options);
  const receipts = new PostgresInteractionReceipts(db);
  return {
    async execute() {
      // Unavailable log storage must not prevent erasure of expired data.
      await options.flushGuildLogs?.().catch(() => logger.error({}, 'guild log flush failed'));
      const journals = await purgeExpiredJournals(db);
      const cutoff = new Date(options.clock.now().getTime() - INTERACTION_RECEIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const receiptsDeleted = await receipts.deleteOlderThan(cutoff);
      const report = await purge.execute();
      await (options.stats?.store ?? new PostgresStatsStore(db)).invalidateAdminSnapshot();
      return { ...report, ...journals, receiptsDeleted };
    },
  };
}

/** One pass at 03:00 in Paris; catch up a missed deadline after restart or lease handoff. */
export function buildNightlyRetentionJob(db: Db, logger: Logger, options: CompositionOptions) {
  const state = createAppState(db);
  const retention = buildRetentionJob(db, logger, options);
  return {
    async execute() {
      const scheduledAt = latestRetentionSchedule(options.clock.now(), options.timeZone);
      const last = await state.get(RETENTION_SCHEDULE_KEY);
      options.metrics?.set('task_schedule', scheduledAt.getTime() / 1000, 'retention');
      options.metrics?.set('task_success', last ? new Date(last).getTime() / 1000 : 0, 'retention');
      if (last !== null && new Date(last) >= scheduledAt) return null;
      const report = await retention.execute();
      // Retry a failure at the next check, without waiting until the following night.
      if (report.failed.length === 0) {
        await state.set(RETENTION_SCHEDULE_KEY, scheduledAt.toISOString());
        options.metrics?.set('task_success', scheduledAt.getTime() / 1000, 'retention');
      }
      return report;
    },
  };
}

export function buildPurgeJob(db: Db, logger: Logger, options: CompositionOptions): PurgeInactiveGuilds {
  const buffer = options.stats?.buffer;
  return new PurgeInactiveGuilds(
    new PostgresGuildLifecycleRepository(db, async (guildId) => {
      if (buffer?.eraseGuild) {
        const users = await withTenant(db, guildId, (trx) => trx.selectFrom('stats_privacy').select('user_id').execute());
        await buffer.eraseGuild(guildId, users.map((row) => row.user_id));
      }
    }),
    options.clock,
    options.guildRetentionDays,
    logger,
  );
}

export function buildGatewayHandler(db: Db, logger: Logger, options: CompositionOptions): GatewayEventHandler {
  const lifecycle = new PostgresGuildLifecycleRepository(db);
  const removed = new HandleGuildRemoved(lifecycle, options.clock);
  const support = new ObserveSupportGuildEvents(new PostgresSupportGuildEventsRepository(db),
    options.supportGuildEventsChannelId ?? null, options.guildRetentionDays);
  const guildHandler = createGuildEventHandler(
    {
      available: new HandleGuildAvailable(lifecycle),
      removed,
      reconcile: new ReconcileGuilds(lifecycle, removed),
      roleDeleted: new HandleRoleDeleted(new PostgresPermissionRepository(db)),
    },
    logger,
  );
  const store = new PostgresWarStore(db);
  return { handle: async (event,delivery) => {
    if (event.type === 'channel_unusable') { await store.channelChanged(event.guildId, event.channelId); await options.stats?.collector?.handle(event,delivery); return; }
    await guildHandler.handle(event);
    await support.handle(event);
    await options.stats?.collector?.handle(event,delivery);
  },connectionChanged:(shardId,connected,lease)=>options.stats?.collector?.connectionChanged(shardId,connected,lease) ?? Promise.resolve() };
}

export function buildShardRunner(
  db: Db,
  logger: Logger,
  options: CompositionOptions & { readonly botToken: Secret; readonly shardCount: number; readonly holder: string; readonly rest?: DiscordBotRestClient },
): ShardRunner {
  return new ShardRunner({
    shardCount: options.shardCount,
    holder: options.holder,
    leases: new PostgresLeaseStore(db),
    clock: options.clock,
    logger,
    ...(options.metrics ? { metrics: options.metrics } : {}),
    connect: createWsShardConnector({
      token: options.botToken,
      ...(options.rest ? { rest: options.rest } : {}),
      sessions: new PostgresGatewaySessionStore(db),
      handler: buildGatewayHandler(db, logger, options),
      logger,
      ...(options.metrics ? { metrics: options.metrics } : {}),
    }),
  });
}
