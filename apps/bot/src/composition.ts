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
  type InteractionReplies,
  type Messaging,
} from '@picket/discord';
import { PostgresGatewaySessionStore, PostgresKeyedLock, PostgresLeaseStore } from '@picket/coordination';
import {
  CancelGuildDeletion,
  GetGuildLocale,
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
  dataCommands,
  permissionsCommands,
  settingsCommands,
  statusCommand,
} from '@picket/guild';
import type { I18n } from '@picket/i18n';
import type { Clock, Logger, Secret } from '@picket/kernel';
import type { Db } from '@picket/persistence';
import {
  CreateTodolist,
  TODOLIST_ROOT,
  TickTodolistItem,
  todolistCommands,
  todolistFamily,
} from '@picket/todolist';

/** Accès à l'API REST de Discord : seul le serveur d'interactions en a besoin. */
export interface DiscordPorts {
  readonly messaging: Messaging;
  readonly replies: InteractionReplies;
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
  readonly access: AccessPolicy;
  readonly gate: GuildGate;
  readonly language: GuildLanguage;
  readonly features: FeatureGate;
}

function guildModule(db: Db, options: CompositionOptions): FeatureModule {
  const settings = new PostgresGuildSettingsRepository(db);
  const permissions = new PostgresPermissionRepository(db);
  const lifecycle = new PostgresGuildLifecycleRepository(db);
  const messaging = (options.discord ?? offlineDiscordPorts).messaging;
  return {
    entries: [
      statusCommand(new GetGuildStatus(settings)),
      ...permissionsCommands({ show: new ShowPermissions(permissions), update: new UpdatePermissions(permissions) }),
      ...settingsCommands({ update: new UpdateGuildSettings(settings, options.i18n.locales), locales: options.i18n.locales }),
      ...dataCommands({
        request: new RequestGuildDeletion(lifecycle, options.clock, options.guildRetentionDays),
        cancel: new CancelGuildDeletion(lifecycle),
      }),
      ...todolistCommands(),
    ],
    families: [
      todolistFamily({ create: new CreateTodolist(messaging), tick: new TickTodolistItem(messaging, new PostgresKeyedLock(db)) }),
    ],
    access: createGuildAccessPolicy(new ResolveAccess(permissions)),
    gate: createGuildGate(new GetSuspension(lifecycle, options.guildRetentionDays)),
    language: createGuildLanguage(new GetGuildLocale(settings)),
    features: createFeatureGate(settings),
  };
}

const ROOTS = [PICKET_ROOT, TODOLIST_ROOT];

/** Seul endroit qui connaît toutes les commandes : le serveur, le CLI et les tests partagent ce registre. */
export function buildCommandRegistry(db: Db, options: CompositionOptions): CommandRegistry {
  return new CommandRegistry(ROOTS, [...guildModule(db, options).entries], options.i18n);
}

export function buildPipeline(db: Db, logger: Logger, options: CompositionOptions): InteractionPipeline {
  const guild = guildModule(db, options);
  return new InteractionPipeline({
    registry: new CommandRegistry(ROOTS, [...guild.entries], options.i18n),
    components: new ComponentRegistry(guild.families),
    receipts: new PostgresInteractionReceipts(db),
    access: guild.access,
    gate: guild.gate,
    language: guild.language,
    features: guild.features,
    logger,
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
