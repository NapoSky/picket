import {
  CommandRegistry,
  ComponentRegistry,
  InteractionPipeline,
  PostgresInteractionReceipts,
  ShardRunner,
  createWsShardConnector,
  type AccessPolicy,
  type CommandEntry,
  type ComponentFamily,
  type FeatureGate,
  type GatewayEventHandler,
  type GuildGate,
  type GuildLanguage,
  type GuildRoles,
  type InteractionReplies,
  type Messaging,
} from '@picket/discord';
import { PostgresGatewaySessionStore, PostgresKeyedLock, PostgresLeaseStore, LeaderElector, startLeasedLoop } from '@picket/coordination';
import {
  CancelGuildDeletion,
  GetGuildLocale,
  GetGuildSettings,
  GetGuildStatus,
  GetSuspension,
  HandleGuildAvailable,
  HandleGuildRemoved,
  HandleRoleDeleted,
  PICKET_ROOT,
  PostgresGuildLifecycleRepository,
  PostgresGuildSettingsRepository,
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
  statusCommand,
} from '@picket/guild';
import type { I18n } from '@picket/i18n';
import { noopLogger, type Clock, type Logger, type Secret } from '@picket/kernel';
import type { Db } from '@picket/persistence';
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
  timersCommands,
  timersFamily,
  type Localizer,
  type TimerUseCaseDeps,
} from '@picket/timers';

/** Accès à l'API REST de Discord : seul le serveur d'interactions en a besoin. */
export interface DiscordPorts {
  readonly messaging: Messaging;
  readonly replies: InteractionReplies;
  readonly guildRoles?: GuildRoles;
}

const unavailable = async (): Promise<never> => {
  throw new Error('Discord REST access is not available in this process');
};

/** Pour le CLI : le registre est construit sans jamais appeler Discord, et un appel accidentel échoue bruyamment. */
export const offlineDiscordPorts: DiscordPorts = {
  messaging: { send: unavailable, fetch: unavailable, edit: unavailable, delete: unavailable },
  replies: { editOriginal: unavailable, deleteOriginal: unavailable, followUp: unavailable },
};

export interface CompositionOptions {
  readonly clock: Clock;
  readonly guildRetentionDays: number;
  readonly i18n: I18n;
  readonly discord?: DiscordPorts;
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
  const showPermissions = new ShowPermissions(permissions);
  const panel = createSettingsPanel({
    settings: new GetGuildSettings(settings), update: new UpdateGuildSettings(settings, options.i18n.locales),
    permissions: showPermissions, updatePermissions: new UpdatePermissions(permissions), access: new ResolveAccess(permissions),
    suspension: new GetSuspension(lifecycle, options.guildRetentionDays),
    request: new RequestGuildDeletion(lifecycle, options.clock, options.guildRetentionDays), cancel: new CancelGuildDeletion(lifecycle),
    clock: options.clock, i18n: options.i18n,
    guildRoles: options.discord?.guildRoles ?? { names: async () => ({}) },
  });
  const status = statusCommand(new GetGuildStatus(settings), showPermissions);
  return {
    aliases: [...panel.aliases, { ...status, path: ['picket', 'permissions', 'show'] }],
    entries: [status, panel.command,
      ...todolistCommands(),
      ...timersCommands({
        createBoard: new CreateBoard(timers.deps),
        strike: new StrikeAsset(timers.deps),
        cleanup: new CleanupBoard(timers.deps),
        repair: new RepairBoard(timers.deps),
        updateSettings: new UpdateBoardSettings(timers.deps),
        getSettings: new GetBoardSettings(timers.store),
        listActive: new ListActiveAssets(timers.store),
      }),
    ],
    families: [
      ...panel.families,
      todolistFamily({ create: new CreateTodolist(messaging), tick: new TickTodolistItem(messaging, new PostgresKeyedLock(db)) }),
      timersFamily({
        add: new AddAsset(timers.deps),
        refresh: new RefreshAsset(timers.deps),
        acknowledge: new AcknowledgeAlert(timers.deps),
      }),
    ],
    access: createGuildAccessPolicy(new ResolveAccess(permissions)),
    gate: createGuildGate(new GetSuspension(lifecycle, options.guildRetentionDays)),
    language: createGuildLanguage(new GetGuildLocale(settings)),
    features: createFeatureGate(settings),
  };
}

/** Tout ce que les timers partagent : la persistance, le rendu des boards et leur entretien. */
function timerServices(db: Db, options: CompositionOptions, logger: Logger, settings: PostgresGuildSettingsRepository) {
  const store = new PostgresTimerStore(db);
  const messaging = (options.discord ?? offlineDiscordPorts).messaging;
  const guildLocale = new GetGuildLocale(settings);
  const localizer: Localizer = {
    // Langue imposée au serveur, puis celle du canal à la création du board, puis l'anglais.
    localeFor: async (guildId, boardLocale) => options.i18n.resolve(await guildLocale.execute(guildId), boardLocale),
    translator: (locale) => options.i18n.translator(locale).t,
  };
  const maintenance = new BoardMaintenance({
    store,
    messaging,
    lock: new PostgresKeyedLock(db),
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

const ROOTS = [PICKET_ROOT, TODOLIST_ROOT, TIMERS_ROOT];

/** Seul endroit qui connaît toutes les commandes : le serveur, le CLI et les tests partagent ce registre. */
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
  });
}

const SWEEP_INTERVAL_MS = 15_000;

/** Rôle `job-runner` : un seul détenteur du bail à la fois exécute les passes périodiques (timers). */
export function buildJobRunner(
  db: Db,
  logger: Logger,
  options: CompositionOptions & { readonly holder: string },
): LeaderElector {
  const timers = timerServices(db, options, logger, new PostgresGuildSettingsRepository(db));
  const sweep = new TimerSweep({ store: timers.store, maintenance: timers.maintenance, features: timers.features, clock: options.clock, logger });
  return new LeaderElector({
    store: new PostgresLeaseStore(db),
    name: 'job-runner:timers',
    holder: options.holder,
    ttlMs: 15_000,
    renewEveryMs: 5_000,
    retryEveryMs: 5_000,
    clock: options.clock,
    logger,
    onAcquired: async () => startLeasedLoop({ tick: () => sweep.tick(), intervalMs: SWEEP_INTERVAL_MS, logger }),
  });
}

export function buildPurgeJob(db: Db, logger: Logger, options: CompositionOptions): PurgeInactiveGuilds {
  return new PurgeInactiveGuilds(
    new PostgresGuildLifecycleRepository(db),
    options.clock,
    options.guildRetentionDays,
    logger,
  );
}

export function buildGatewayHandler(db: Db, logger: Logger, options: CompositionOptions): GatewayEventHandler {
  const lifecycle = new PostgresGuildLifecycleRepository(db);
  const removed = new HandleGuildRemoved(lifecycle, options.clock);
  return createGuildEventHandler(
    {
      available: new HandleGuildAvailable(lifecycle),
      removed,
      reconcile: new ReconcileGuilds(lifecycle, removed),
      roleDeleted: new HandleRoleDeleted(new PostgresPermissionRepository(db)),
    },
    logger,
  );
}

export function buildShardRunner(
  db: Db,
  logger: Logger,
  options: CompositionOptions & { readonly botToken: Secret; readonly shardCount: number; readonly holder: string },
): ShardRunner {
  return new ShardRunner({
    shardCount: options.shardCount,
    holder: options.holder,
    leases: new PostgresLeaseStore(db),
    clock: options.clock,
    logger,
    connect: createWsShardConnector({
      token: options.botToken,
      sessions: new PostgresGatewaySessionStore(db),
      handler: buildGatewayHandler(db, logger, options),
      logger,
    }),
  });
}
