import { ChannelId, GuildId, MessageId, UserId } from '@picket/kernel';
import { sql, withTenant, type Db, type Selectable, type Tx, type TimerAssetsTable, type TimerBoardsTable } from '@picket/persistence';
import type { TimerAsset } from '../domain/asset';
import type { AssetTypeId } from '../domain/asset-types';
import { parseBoardSettings } from '../domain/board-settings';
import type { AlertClaim, AlertRow } from '../domain/schedule';
import type {
  AlertRecord,
  BoardRecord,
  BoardState,
  CreateBoardOutcome,
  DueBoard,
  Mutation,
  PageRecord,
  SyncResult,
  TimerEvent,
  TimerStore,
} from '../application/ports';

const FOREIGN_KEY_VIOLATION = '23503';

const isForeignKeyViolation = (error: unknown): boolean => (error as { code?: unknown } | null)?.code === FOREIGN_KEY_VIOLATION;

type BoardRow = Selectable<TimerBoardsTable>;
type AssetRow = Selectable<TimerAssetsTable>;

const toBoard = (row: BoardRow): BoardRecord => ({
  id: row.id,
  guildId: GuildId.assert(row.guild_id),
  channelId: ChannelId.assert(row.channel_id),
  locale: row.locale,
  settings: parseBoardSettings(row.settings),
  rev: row.rev,
  needsSync: row.needs_sync,
  syncError: row.sync_error,
  createdBy: UserId.assert(row.created_by),
  createdAt: new Date(row.created_at),
  archivedAt: row.archived_at === null ? null : new Date(row.archived_at),
});

const toAsset = (row: AssetRow): TimerAsset => ({
  id: row.id,
  boardId: row.board_id,
  type: row.type as AssetTypeId,
  name: row.name,
  code: row.code,
  regionKey: row.region_key,
  locationKey: row.location_key,
  ownerId: UserId.assert(row.owner_user_id),
  direction: row.direction,
  durationS: row.duration_s,
  startedAt: new Date(row.started_at),
  status: row.status,
  struckAt: row.struck_at === null ? null : new Date(row.struck_at),
  frozenAt: row.frozen_at === null ? null : new Date(row.frozen_at),
  rev: row.rev,
});

const toAlert = (row: { asset_id: string; board_id: string; due_at: Date | string; threshold_min: number; message_id: string | null; acked_at: Date | null }): AlertRecord => ({
  assetId: row.asset_id,
  boardId: row.board_id,
  dueAt: new Date(row.due_at),
  thresholdMin: row.threshold_min,
  messageId: row.message_id,
  ackedAt: row.acked_at === null ? null : new Date(row.acked_at),
});

const assetValues = (asset: TimerAsset, guildId: GuildId) => ({
  id: asset.id,
  board_id: asset.boardId,
  guild_id: guildId,
  type: asset.type,
  name: asset.name,
  code: asset.code,
  region_key: asset.regionKey,
  location_key: asset.locationKey,
  owner_user_id: asset.ownerId,
  direction: asset.direction,
  duration_s: asset.durationS,
  started_at: asset.startedAt,
  status: asset.status,
  struck_at: asset.struckAt,
  frozen_at: asset.frozenAt,
  rev: asset.rev,
});

async function recordEvents(trx: Tx, guildId: GuildId, boardId: string, events: readonly TimerEvent[]): Promise<void> {
  for (const event of events) {
    await trx
      .insertInto('timer_events')
      .values({
        guild_id: guildId,
        board_id: boardId,
        asset_id: event.assetId ?? null,
        actor_id: event.actor,
        action: event.action,
        detail: event.detail === undefined ? null : JSON.stringify(event.detail),
      })
      .execute();
  }
}

/** `LEAST` : une mutation ne repousse jamais un réveil déjà en retard, elle l'avance seulement. */
async function wakeNow(trx: Tx, guildId: GuildId, boardId: string, now: Date): Promise<void> {
  await trx
    .insertInto('timer_schedule')
    .values({ board_id: boardId, guild_id: guildId, wake_at: now })
    .onConflict((conflict) => conflict.column('board_id').doUpdateSet({ wake_at: sql<Date>`LEAST(timer_schedule.wake_at, excluded.wake_at)` }))
    .execute();
}

export class PostgresTimerStore implements TimerStore {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  createBoard(
    input: Parameters<TimerStore['createBoard']>[0],
    now: Date,
  ): Promise<CreateBoardOutcome> {
    return withTenant(this.#db, input.guildId, async (trx) => {
      const { n } = await trx
        .selectFrom('timer_boards')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('archived_at', 'is', null)
        .executeTakeFirstOrThrow();
      if (n >= input.maxBoards) return { kind: 'quota', max: input.maxBoards };

      const inserted = await trx
        .insertInto('timer_boards')
        .values({
          guild_id: input.guildId,
          channel_id: input.channelId,
          locale: input.locale,
          settings: JSON.stringify(input.settings),
          created_by: input.createdBy,
          created_at: now,
        })
        .onConflict((conflict) => conflict.columns(['guild_id', 'channel_id']).where('archived_at', 'is', null).doNothing())
        .returningAll()
        .executeTakeFirst();
      if (inserted === undefined) {
        const existing = await trx
          .selectFrom('timer_boards')
          .selectAll()
          .where('channel_id', '=', input.channelId)
          .where('archived_at', 'is', null)
          .executeTakeFirstOrThrow();
        return { kind: 'exists', board: toBoard(existing) };
      }
      await recordEvents(trx, input.guildId, inserted.id, [
        { actor: input.createdBy, action: 'board_create', detail: { channel_id: input.channelId } },
      ]);
      await wakeNow(trx, input.guildId, inserted.id, now);
      return { kind: 'created', board: toBoard(inserted) };
    });
  }

  boardByChannel(guildId: GuildId, channelId: ChannelId): Promise<BoardRecord | null> {
    return withTenant(this.#db, guildId, async (trx) => {
      const row = await trx
        .selectFrom('timer_boards')
        .selectAll()
        .where('channel_id', '=', channelId)
        .where('archived_at', 'is', null)
        .executeTakeFirst();
      return row === undefined ? null : toBoard(row);
    });
  }

  boardOfAsset(guildId: GuildId, assetId: string): Promise<BoardRecord | null> {
    return withTenant(this.#db, guildId, async (trx) => {
      const row = await trx
        .selectFrom('timer_assets as asset')
        .innerJoin('timer_boards as board', 'board.id', 'asset.board_id')
        .selectAll('board')
        .where('asset.id', '=', assetId)
        .where('board.archived_at', 'is', null)
        .executeTakeFirst();
      return row === undefined ? null : toBoard(row);
    });
  }

  boardsOfGuild(guildId: GuildId): Promise<readonly BoardRecord[]> {
    return withTenant(this.#db, guildId, async (trx) => {
      const rows = await trx.selectFrom('timer_boards').selectAll().orderBy('created_at').execute();
      return rows.map(toBoard);
    });
  }

  state(guildId: GuildId, boardId: string): Promise<BoardState | null> {
    return withTenant(this.#db, guildId, async (trx) => {
      const board = await trx.selectFrom('timer_boards').selectAll().where('id', '=', boardId).executeTakeFirst();
      if (board === undefined) return null;
      const assets = await trx.selectFrom('timer_assets').selectAll().where('board_id', '=', boardId).execute();
      return { board: toBoard(board), assets: assets.map(toAsset) };
    });
  }

  mutate<T>(guildId: GuildId, boardId: string, decide: (state: BoardState) => Mutation<T>, now: Date): Promise<T | null> {
    return withTenant(this.#db, guildId, async (trx) => {
      // La ligne du board est verrouillée : toutes les mutations d'un même board passent l'une après l'autre.
      const row = await trx.selectFrom('timer_boards').selectAll().where('id', '=', boardId).forUpdate().executeTakeFirst();
      if (row === undefined || row.archived_at !== null) return null;
      const assets = await trx.selectFrom('timer_assets').selectAll().where('board_id', '=', boardId).execute();

      const mutation = decide({ board: toBoard(row), assets: assets.map(toAsset) });
      const changes = mutation.changes ?? [];
      const events = mutation.events ?? [];
      if (changes.length === 0 && events.length === 0 && mutation.settings === undefined) return mutation.result;

      for (const change of changes) {
        if (change.kind === 'insert') {
          await trx.insertInto('timer_assets').values(assetValues(change.asset, guildId)).execute();
        } else if (change.kind === 'update') {
          const { id: _id, board_id: _board, guild_id: _guild, ...values } = assetValues(change.asset, guildId);
          await trx
            .updateTable('timer_assets')
            .set({ ...values, updated_at: now })
            .where('id', '=', change.asset.id)
            .where('board_id', '=', boardId)
            .execute();
        } else {
          await trx.deleteFrom('timer_assets').where('id', '=', change.assetId).where('board_id', '=', boardId).execute();
        }
      }
      await recordEvents(trx, guildId, boardId, events);
      await trx
        .updateTable('timer_boards')
        .set({
          rev: sql<number>`rev + 1`,
          needs_sync: true,
          ...(mutation.settings !== undefined ? { settings: JSON.stringify(mutation.settings) } : {}),
        })
        .where('id', '=', boardId)
        .execute();
      await wakeNow(trx, guildId, boardId, now);
      return mutation.result;
    });
  }

  pages(guildId: GuildId, boardId: string): Promise<readonly PageRecord[]> {
    return withTenant(this.#db, guildId, async (trx) => {
      const rows = await trx.selectFrom('timer_board_messages').selectAll().where('board_id', '=', boardId).orderBy('page').execute();
      return rows.map((row) => ({ page: row.page, messageId: MessageId.assert(row.message_id), contentHash: row.content_hash }));
    });
  }

  savePage(guildId: GuildId, boardId: string, page: PageRecord): Promise<void> {
    return withTenant(this.#db, guildId, async (trx) => {
      await trx
        .insertInto('timer_board_messages')
        .values({ board_id: boardId, guild_id: guildId, page: page.page, message_id: page.messageId, content_hash: page.contentHash })
        .onConflict((conflict) => conflict.columns(['board_id', 'page']).doUpdateSet({ message_id: page.messageId, content_hash: page.contentHash }))
        .execute();
    });
  }

  removePages(guildId: GuildId, boardId: string, pages: readonly number[]): Promise<void> {
    if (pages.length === 0) return Promise.resolve();
    return withTenant(this.#db, guildId, async (trx) => {
      await trx.deleteFrom('timer_board_messages').where('board_id', '=', boardId).where('page', 'in', [...pages]).execute();
    });
  }

  markSynced(guildId: GuildId, boardId: string, result: SyncResult): Promise<boolean> {
    return withTenant(this.#db, guildId, async (trx) => {
      // `needs_sync` ne retombe que si aucune mutation n'est arrivée pendant le rendu.
      const row = await trx
        .updateTable('timer_boards')
        .set({ sync_error: result.syncError, needs_sync: sql<boolean>`rev <> ${result.rev}` })
        .where('id', '=', boardId)
        .returning('rev')
        .executeTakeFirst();
      return row !== undefined && row.rev === result.rev;
    });
  }

  markSyncFailed(guildId: GuildId, boardId: string, syncError: string): Promise<void> {
    return withTenant(this.#db, guildId, async (trx) => {
      await trx.updateTable('timer_boards').set({ sync_error: syncError, needs_sync: true }).where('id', '=', boardId).execute();
    });
  }

  archive(guildId: GuildId, boardId: string, reason: string, now: Date): Promise<void> {
    return withTenant(this.#db, guildId, async (trx) => {
      await trx
        .updateTable('timer_boards')
        .set({ archived_at: now, sync_error: reason, needs_sync: false })
        .where('id', '=', boardId)
        .where('archived_at', 'is', null)
        .execute();
      await recordEvents(trx, guildId, boardId, [{ actor: 'system', action: 'board_disabled', detail: { reason } }]);
      await trx.deleteFrom('timer_schedule').where('board_id', '=', boardId).execute();
    });
  }

  alerts(guildId: GuildId, boardId: string): Promise<readonly AlertRecord[]> {
    return withTenant(this.#db, guildId, async (trx) => {
      const rows = await trx.selectFrom('timer_alerts').selectAll().where('board_id', '=', boardId).execute();
      return rows.map(toAlert);
    });
  }

  claimAlert(guildId: GuildId, boardId: string, claim: AlertClaim, now: Date): Promise<boolean> {
    return withTenant(this.#db, guildId, async (trx) => {
      try {
        const inserted = await trx
          .insertInto('timer_alerts')
          .values({
            asset_id: claim.assetId,
            guild_id: guildId,
            board_id: boardId,
            due_at: claim.dueAt,
            threshold_min: claim.thresholdMin,
            sent_at: now,
          })
          .onConflict((conflict) => conflict.doNothing())
          .returning('asset_id')
          .executeTakeFirst();
        return inserted !== undefined;
      } catch (error) {
        // L'asset a été supprimé entre la lecture et la réclamation : il n'y a plus rien à signaler.
        if (isForeignKeyViolation(error)) return false;
        throw error;
      }
    });
  }

  setAlertMessage(guildId: GuildId, row: AlertRow, messageId: MessageId | null): Promise<void> {
    return withTenant(this.#db, guildId, async (trx) => {
      await trx
        .updateTable('timer_alerts')
        .set({ message_id: messageId })
        .where('asset_id', '=', row.assetId)
        .where('due_at', '=', row.dueAt)
        .where('threshold_min', '=', row.thresholdMin)
        .execute();
    });
  }

  releaseAlert(guildId: GuildId, row: AlertRow): Promise<void> {
    return withTenant(this.#db, guildId, async (trx) => {
      await trx
        .deleteFrom('timer_alerts')
        .where('asset_id', '=', row.assetId)
        .where('due_at', '=', row.dueAt)
        .where('threshold_min', '=', row.thresholdMin)
        .execute();
    });
  }

  acknowledgeAlert(guildId: GuildId, assetId: string, thresholdMin: number, actor: UserId, now: Date): Promise<AlertRecord | null> {
    return withTenant(this.#db, guildId, async (trx) => {
      const rows = await trx
        .updateTable('timer_alerts')
        .set({ acked_by: actor, acked_at: now })
        .where('asset_id', '=', assetId)
        .where('threshold_min', '=', thresholdMin)
        .where('message_id', 'is not', null)
        .where('acked_at', 'is', null)
        .returningAll()
        .execute();
      const latest = rows.map(toAlert).sort((a, b) => b.dueAt.getTime() - a.dueAt.getTime())[0];
      return latest ?? null;
    });
  }

  async schedule(guildId: GuildId, boardId: string, wakeAt: Date | null): Promise<void> {
    if (wakeAt === null) {
      await this.#db.deleteFrom('timer_schedule').where('board_id', '=', boardId).execute();
      return;
    }
    try {
      await this.#db
        .insertInto('timer_schedule')
        .values({ board_id: boardId, guild_id: guildId, wake_at: wakeAt })
        .onConflict((conflict) => conflict.column('board_id').doUpdateSet({ wake_at: wakeAt }))
        .execute();
    } catch (error) {
      // Board supprimé (purge de la guilde) pendant le traitement : rien à planifier.
      if (!isForeignKeyViolation(error)) throw error;
    }
  }

  async dueBoards(now: Date, limit: number): Promise<readonly DueBoard[]> {
    const rows = await this.#db
      .selectFrom('timer_schedule as schedule')
      .select(['schedule.guild_id', 'schedule.board_id'])
      .where('schedule.wake_at', '<=', now)
      // Une guilde qui a retiré le bot n'est plus servie ; son retard sera rattrapé si le bot revient.
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('guild_registry')
              .select('guild_registry.guild_id')
              .whereRef('guild_registry.guild_id', '=', 'schedule.guild_id')
              .where('guild_registry.inactive_since', 'is not', null),
          ),
        ),
      )
      .orderBy('schedule.wake_at')
      .limit(limit)
      .execute();
    return rows.map((row) => ({ guildId: GuildId.assert(row.guild_id), boardId: row.board_id }));
  }
}
