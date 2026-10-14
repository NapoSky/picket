import type { Translator } from '@picket/i18n';
import type { ChannelId, GuildId, MessageId, UserId } from '@picket/kernel';
import type { TimerAsset } from '../domain/asset';
import type { BoardSettings } from '../domain/board-settings';
import type { AlertClaim, AlertRow } from '../domain/schedule';

export interface BoardRecord {
  readonly id: string;
  readonly guildId: GuildId;
  readonly channelId: ChannelId;
  /** Channel locale at creation; a forced guild locale takes precedence. */
  readonly locale: string | null;
  readonly settings: BoardSettings;
  readonly rev: number;
  /** True while published messages do not reflect the stored state. */
  readonly needsSync: boolean;
  readonly syncError: string | null;
  readonly createdBy: UserId;
  readonly createdAt: Date;
  /** Last board mutation: delete after `ABANDONED_AFTER_DAYS` without timers. */
  readonly lastActivityAt: Date;
  readonly archivedAt: Date | null;
}

export interface BoardState {
  readonly board: BoardRecord;
  readonly assets: readonly TimerAsset[];
}

export interface PageRecord {
  readonly page: number;
  readonly messageId: MessageId;
  readonly contentHash: string;
}

export interface AlertRecord extends AlertRow {
  readonly boardId: string;
}

export type TimerAction =
  | 'board_create'
  | 'board_disabled'
  | 'board_delete'
  | 'add'
  | 'reactivate'
  | 'refresh'
  | 'strike'
  | 'acknowledge'
  | 'cleanup'
  | 'auto_purge'
  | 'reset_war'
  | 'settings'
  | 'repair';

export interface TimerEvent {
  readonly assetId?: string;
  readonly actor: UserId | 'system';
  readonly action: TimerAction;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export type AssetChange =
  | { readonly kind: 'insert'; readonly asset: TimerAsset }
  | { readonly kind: 'update'; readonly asset: TimerAsset }
  | { readonly kind: 'delete'; readonly assetId: string };

/** Mutation decision: with no changes, settings or events, write nothing and leave the board unchanged. */
export interface Mutation<T> {
  readonly result: T;
  readonly changes?: readonly AssetChange[];
  readonly settings?: BoardSettings;
  readonly events?: readonly TimerEvent[];
}

export type CreateBoardOutcome =
  | { readonly kind: 'created'; readonly board: BoardRecord }
  | { readonly kind: 'exists'; readonly board: BoardRecord }
  | { readonly kind: 'quota'; readonly max: number };

export interface DueBoard {
  readonly guildId: GuildId;
  readonly boardId: string;
}

export interface SyncResult {
  /**
   * Board revision read before rendering; if it changes, another mutation arrived and rendering remains
   * pending.
   */
  readonly rev: number;
  readonly syncError: string | null;
}

/**
 * Timer persistence. Each method uses a tenant transaction; `mutate` locks the board row, serializing its
 * mutations and scheduling rendering in the same write (`needs_sync`).
 */
export interface TimerStore {
  createBoard(
    input: {
      readonly guildId: GuildId;
      readonly channelId: ChannelId;
      readonly createdBy: UserId;
      readonly locale: string | null;
      readonly settings: BoardSettings;
      readonly maxBoards: number;
    },
    now: Date,
  ): Promise<CreateBoardOutcome>;
  boardByChannel(guildId: GuildId, channelId: ChannelId): Promise<BoardRecord | null>;
  boardOfAsset(guildId: GuildId, assetId: string): Promise<BoardRecord | null>;
  boardsOfGuild(guildId: GuildId): Promise<readonly BoardRecord[]>;
  state(guildId: GuildId, boardId: string): Promise<BoardState | null>;
  /** `null`: unknown or archived board. */
  mutate<T>(guildId: GuildId, boardId: string, decide: (state: BoardState) => Mutation<T>, now: Date): Promise<T | null>;

  pages(guildId: GuildId, boardId: string): Promise<readonly PageRecord[]>;
  savePage(guildId: GuildId, boardId: string, page: PageRecord): Promise<void>;
  removePages(guildId: GuildId, boardId: string, pages: readonly number[]): Promise<void>;
  /**
   * Mark the board synchronized if no mutation followed `result.rev`; `false` means rendering remains pending.
   */
  markSynced(guildId: GuildId, boardId: string, result: SyncResult): Promise<boolean>;
  markSyncFailed(guildId: GuildId, boardId: string, syncError: string): Promise<void>;
  /** Delete the board and its dependencies (timers, messages, alerts); only the audit log remains. */
  deleteBoard(guildId: GuildId, boardId: string, reason: string): Promise<void>;
  /** Disable the board (channel gone): stop rendering and alerts while retaining history. */
  archive(guildId: GuildId, boardId: string, reason: string, now: Date): Promise<void>;

  alerts(guildId: GuildId, boardId: string): Promise<readonly AlertRecord[]>;
  /** Under the board lock: creates a reservation or resumes an unconfirmed send. */
  claimAlert(guildId: GuildId, boardId: string, claim: AlertClaim, now: Date): Promise<boolean>;
  setAlertMessage(guildId: GuildId, row: AlertRow, messageId: MessageId | null): Promise<void>;
  releaseAlert(guildId: GuildId, row: AlertRow): Promise<void>;
  acknowledgeAlert(guildId: GuildId, assetId: string, thresholdMin: number, actor: UserId, now: Date): Promise<AlertRecord | null>;

  /** `null`: nothing left to schedule. */
  schedule(guildId: GuildId, boardId: string, wakeAt: Date | null): Promise<void>;
  dueBoards(now: Date, limit: number): Promise<readonly DueBoard[]>;
}

/** Locale and translator for a board's public messages. */
export interface Localizer {
  /** Forced guild locale, otherwise the board locale, then English. */
  localeFor(guildId: GuildId, boardLocale: string | null): Promise<string>;
  translator(locale: string): Translator['t'];
}

export interface Features {
  isEnabled(guildId: GuildId): Promise<boolean>;
}
