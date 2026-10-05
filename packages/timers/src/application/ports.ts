import type { Translator } from '@picket/i18n';
import type { ChannelId, GuildId, MessageId, UserId } from '@picket/kernel';
import type { TimerAsset } from '../domain/asset';
import type { BoardSettings } from '../domain/board-settings';
import type { AlertClaim, AlertRow } from '../domain/schedule';

export interface BoardRecord {
  readonly id: string;
  readonly guildId: GuildId;
  readonly channelId: ChannelId;
  /** Langue du canal à la création ; la langue imposée au serveur, si elle existe, prime. */
  readonly locale: string | null;
  readonly settings: BoardSettings;
  readonly rev: number;
  /** Vrai tant que les messages publiés ne reflètent pas l'état. */
  readonly needsSync: boolean;
  readonly syncError: string | null;
  readonly createdBy: UserId;
  readonly createdAt: Date;
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
  | 'add'
  | 'reactivate'
  | 'refresh'
  | 'strike'
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

/** Décision d'une mutation : sans changement, réglage ni événement, rien n'est écrit et le board reste tel quel. */
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
  /** Rév du board lue avant le rendu : si elle a changé depuis, une mutation est arrivée et le rendu reste à faire. */
  readonly rev: number;
  readonly syncError: string | null;
}

/**
 * Persistance des timers. Chaque méthode est une transaction du tenant ; `mutate` verrouille la ligne du board, ce
 * qui sérialise toutes les mutations d'un board, et déclenche le rendu en même temps qu'elle écrit (`needs_sync`).
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
  /** `null` : board inconnu ou archivé. */
  mutate<T>(guildId: GuildId, boardId: string, decide: (state: BoardState) => Mutation<T>, now: Date): Promise<T | null>;

  pages(guildId: GuildId, boardId: string): Promise<readonly PageRecord[]>;
  savePage(guildId: GuildId, boardId: string, page: PageRecord): Promise<void>;
  removePages(guildId: GuildId, boardId: string, pages: readonly number[]): Promise<void>;
  /** Marque le board à jour si aucune mutation n'est arrivée depuis `result.rev` ; `false` : un rendu reste à faire. */
  markSynced(guildId: GuildId, boardId: string, result: SyncResult): Promise<boolean>;
  markSyncFailed(guildId: GuildId, boardId: string, syncError: string): Promise<void>;
  /** Désactive le board (canal disparu) : plus de rendu ni d'alerte, historique conservé. */
  archive(guildId: GuildId, boardId: string, reason: string, now: Date): Promise<void>;

  alerts(guildId: GuildId, boardId: string): Promise<readonly AlertRecord[]>;
  /** `true` si la ligne vient d'être créée : un seul processus envoie une alerte donnée. */
  claimAlert(guildId: GuildId, boardId: string, claim: AlertClaim, now: Date): Promise<boolean>;
  setAlertMessage(guildId: GuildId, row: AlertRow, messageId: MessageId | null): Promise<void>;
  releaseAlert(guildId: GuildId, row: AlertRow): Promise<void>;
  acknowledgeAlert(guildId: GuildId, assetId: string, thresholdMin: number, actor: UserId, now: Date): Promise<AlertRecord | null>;

  /** `null` : plus rien à planifier. */
  schedule(guildId: GuildId, boardId: string, wakeAt: Date | null): Promise<void>;
  dueBoards(now: Date, limit: number): Promise<readonly DueBoard[]>;
}

/** Langue et traducteur des messages publics d'un board. */
export interface Localizer {
  /** Langue imposée au serveur, sinon celle du board, sinon l'anglais. */
  localeFor(guildId: GuildId, boardLocale: string | null): Promise<string>;
  translator(locale: string): Translator['t'];
}

export interface Features {
  isEnabled(guildId: GuildId): Promise<boolean>;
}
