import { PostgresKeyedLock } from '@picket/coordination';
import { ChannelId, GuildId, UserId, noopLogger, type Clock } from '@picket/kernel';
import {
  InMemoryMessaging,
  createTestDatabase,
  queryAsAdmin,
  testI18n,
  type TestDatabase,
} from '@picket/testing';
import {
  AcknowledgeAlert,
  AddAsset,
  ArchiveBoardsOnNewWar,
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
  TimerSweep,
  UpdateBoardSettings,
  type AssetInput,
  type Localizer,
  type TimerUseCaseDeps,
} from '@picket/timers';
import { LOCATION, NOW, REGION } from './fixtures';

export const TIMER_TABLES = 'timer_alerts, timer_events, timer_board_messages, timer_assets, timer_schedule, timer_boards';

/** Horloge pilotable : les échéances, alertes et purges se testent sans attendre. */
export class TestClock implements Clock {
  #now = NOW;
  now(): Date {
    return this.#now;
  }
  advance(ms: number): void {
    this.#now = new Date(this.#now.getTime() + ms);
  }
  set(date: Date): void {
    this.#now = date;
  }
}

let counter = 0;

/** Une guilde, un canal et des utilisateurs neufs : les tests d'un même fichier ne se voient jamais. */
export function freshIds() {
  counter += 1;
  const n = String(counter).padStart(4, '0');
  return {
    guild: GuildId.assert(`7100000000000${n}`),
    channel: ChannelId.assert(`6100000000000${n}`),
    otherChannel: ChannelId.assert(`6200000000000${n}`),
    user: UserId.assert(`5100000000000${n}`),
    other: UserId.assert(`5200000000000${n}`),
  };
}

export async function resetTimerTables(database: TestDatabase): Promise<void> {
  await queryAsAdmin(database, `TRUNCATE ${TIMER_TABLES} RESTART IDENTITY CASCADE`);
}

const localizer: Localizer = {
  localeFor: async (_guildId, boardLocale) => testI18n.resolve(null, boardLocale),
  translator: (locale) => testI18n.translator(locale).t,
};

/** Un « processus » : ses propres objets, mais la même base et le même Discord (comme deux répliques). */
export function createProcess(database: TestDatabase, messaging: InMemoryMessaging, clock: Clock, options: { features?: () => boolean } = {}) {
  const store = new PostgresTimerStore(database.handle.db);
  const maintenance = new BoardMaintenance({
    store,
    messaging,
    lock: new PostgresKeyedLock(database.handle.db),
    clock,
    localizer,
    logger: noopLogger,
  });
  const deps: TimerUseCaseDeps = {
    store,
    maintenance,
    coalescer: new RenderCoalescer(maintenance),
    messaging,
    clock,
    ids: new RandomAssetIds(),
  };
  const sweep = new TimerSweep({
    store,
    maintenance,
    features: { isEnabled: async () => options.features?.() ?? true },
    clock,
    logger: noopLogger,
  });
  return {
    store,
    maintenance,
    deps,
    sweep,
    createBoard: new CreateBoard(deps),
    addAsset: new AddAsset(deps),
    strike: new StrikeAsset(deps),
    refresh: new RefreshAsset(deps),
    cleanup: new CleanupBoard(deps),
    repair: new RepairBoard(deps),
    updateSettings: new UpdateBoardSettings(deps),
    getSettings: new GetBoardSettings(store),
    acknowledge: new AcknowledgeAlert(deps),
    listActive: new ListActiveAssets(store),
    archiveOnNewWar: new ArchiveBoardsOnNewWar(deps),
  };
}

export type TimerProcess = ReturnType<typeof createProcess>;

export function timerHarness(database: TestDatabase, options: { features?: () => boolean } = {}) {
  const messaging = new InMemoryMessaging();
  const clock = new TestClock();
  const ids = freshIds();
  const processes = createProcess(database, messaging, clock, options);
  const assetInput = (overrides: Partial<AssetInput> = {}): AssetInput => ({
    type: 'stockpile',
    regionKey: REGION,
    locationKey: LOCATION,
    name: 'Depot',
    code: '123456',
    duration: '50',
    ...overrides,
  });

  /** Crée un board dans le canal et le retourne avec l'identifiant de son premier message. */
  async function boardWithMessage(channel = ids.channel) {
    const created = await processes.createBoard.execute({ guildId: ids.guild, channelId: channel, actor: ids.user, locale: null });
    if (created.kind !== 'created') throw new Error(`board not created: ${created.kind}`);
    return created.boardId;
  }

  async function add(overrides: Partial<AssetInput> = {}, channel = ids.channel, ownerId = ids.user) {
    const result = await processes.addAsset.execute({ guildId: ids.guild, channelId: channel, actor: ids.user, ownerId, asset: assetInput(overrides) });
    if (result.kind !== 'added') throw new Error(`asset not added: ${result.kind}`);
    return result.asset;
  }

  const lines = (channel = ids.channel) =>
    messaging
      .list(channel)
      .filter((message) => message.view.content === undefined)
      .flatMap((message) => message.view.embeds.flatMap((embed) => (embed.fields ?? []).flatMap((field) => field.value.split('\n'))));
  const boardMessages = (channel = ids.channel) => messaging.list(channel).filter((message) => message.view.content === undefined);
  const alertMessages = (channel = ids.channel) => messaging.list(channel).filter((message) => message.view.content !== undefined);

  return { messaging, clock, ids, ...processes, process: processes, assetInput, boardWithMessage, add, lines, boardMessages, alertMessages };
}

export type TimerHarness = ReturnType<typeof timerHarness>;

export async function openDatabase(): Promise<TestDatabase> {
  return createTestDatabase();
}
