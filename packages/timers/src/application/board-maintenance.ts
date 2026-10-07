import { LockTimeoutError, type KeyedLock } from '@picket/coordination';
import { DiscordApiError, type Messaging } from '@picket/discord';
import type { Translator } from '@picket/i18n';
import type { Clock, GuildId, Logger, MessageId } from '@picket/kernel';
import type { TimerAsset } from '../domain/asset';
import { DEFAULT_LOCATION_EMOJI, DEFAULT_REGION_EMOJI } from '../domain/constants';
import { isAbandoned, nextWake, planAlerts, purgeCandidates, staleAlerts } from '../domain/schedule';
import { renderBoard, type RenderedPage } from './board-view';
import type { BoardRecord, Localizer, PageRecord, TimerStore } from './ports';
import { boardTexts, buildAlertView } from './texts';

export type MaintenanceOutcome =
  | { readonly kind: 'ok' }
  /** Board inconnu ou déjà archivé. */
  | { readonly kind: 'gone' }
  /** Board vide et inactif depuis trop longtemps : supprimé avec ses données. */
  | { readonly kind: 'deleted' }
  /** Le canal a disparu : le board est désactivé, son historique est conservé. */
  | { readonly kind: 'disabled'; readonly reason: string }
  /** Discord a refusé : le rendu reste en attente et sera retenté. */
  | { readonly kind: 'retry'; readonly reason: string; readonly retryAt: Date }
  /** Un autre processus traite déjà ce board : il lira l'état le plus récent. */
  | { readonly kind: 'busy' };

export interface BoardMaintenanceDeps {
  readonly store: TimerStore;
  readonly messaging: Messaging;
  readonly lock: KeyedLock;
  readonly clock: Clock;
  readonly localizer: Localizer;
  readonly logger: Logger;
}

const MISSING_RIGHTS_RETRY_MS = 5 * 60_000;
const TRANSIENT_RETRY_MS = 30_000;
const RENDER_RETRY_MS = 10 * 60_000;
const ALERT_RETRY_MS = 60_000;

const isReason = (error: unknown, ...reasons: string[]): boolean => error instanceof DiscordApiError && reasons.includes(error.reason);
const isRangeError = (error: unknown): boolean => error instanceof RangeError || (error as { name?: unknown } | null)?.name === 'RangeError';

/**
 * Remet Discord d'accord avec la base : purge, messages du board, alertes, prochaine échéance. Tout se fait sous un
 * verrou par board et relit l'état à chaque fois, donc deux exécutions (deux répliques, un clic et le planificateur)
 * ne se marchent jamais dessus et une exécution interrompue se rattrape à la suivante.
 */
export class BoardMaintenance {
  readonly #deps: BoardMaintenanceDeps;

  constructor(deps: BoardMaintenanceDeps) {
    this.#deps = deps;
  }

  async run(guildId: GuildId, boardId: string, options: { readonly force?: boolean } = {}): Promise<MaintenanceOutcome> {
    try {
      return await this.#deps.lock.withLock(`timers:board:${boardId}`, () => this.#locked(guildId, boardId, options.force === true));
    } catch (error) {
      if (error instanceof LockTimeoutError) return { kind: 'busy' };
      throw error;
    }
  }

  async #locked(guildId: GuildId, boardId: string, force: boolean): Promise<MaintenanceOutcome> {
    const { store, clock, logger } = this.#deps;
    const now = clock.now();
    let state = await store.state(guildId, boardId);
    if (state === null || state.board.archivedAt !== null) {
      if (state !== null) await store.schedule(guildId, boardId, null);
      return { kind: 'gone' };
    }

    const doomed = purgeCandidates(state.assets, state.board.settings, now);
    if (doomed.length > 0) {
      await store.mutate(
        guildId,
        boardId,
        () => ({
          result: null,
          changes: doomed.map((asset) => ({ kind: 'delete' as const, assetId: asset.id })),
          events: [{ actor: 'system', action: 'auto_purge', detail: { count: doomed.length } }],
        }),
        now,
      );
      state = await store.state(guildId, boardId);
      if (state === null || state.board.archivedAt !== null) return { kind: 'gone' };
    }

    const { board, assets } = state;
    if (isAbandoned(assets, board.lastActivityAt, now)) return this.#abandon(board);
    const locale = await this.#deps.localizer.localeFor(guildId, board.locale);
    const t = this.#deps.localizer.translator(locale);

    try {
      const icons = {
        region: board.settings.regionEmoji ?? DEFAULT_REGION_EMOJI,
        location: board.settings.locationEmoji ?? DEFAULT_LOCATION_EMOJI,
      };
      const rendered = renderBoard({ assets, texts: boardTexts(t), now, icons });
      await this.#syncPages(board, rendered, await store.pages(guildId, boardId), force);
    } catch (error) {
      return this.#failed(board, error, now);
    }

    const current = await store.markSynced(guildId, boardId, { rev: board.rev, syncError: null });
    const alertRetry = await this.#alerts(board, state.assets, t, now);
    const wake = current ? nextWake({ assets, settings: board.settings, now, needsSync: false, lastActivityAt: board.lastActivityAt }) : now;
    const retryAt = alertRetry ? new Date(now.getTime() + ALERT_RETRY_MS) : null;
    await store.schedule(guildId, boardId, wake === null ? retryAt : retryAt !== null && retryAt < wake ? retryAt : wake);
    logger.debug({ guild_id: guildId, board_id: boardId, assets: assets.length }, 'board maintained');
    return { kind: 'ok' };
  }

  async #syncPages(board: BoardRecord, rendered: readonly RenderedPage[], stored: readonly PageRecord[], force: boolean): Promise<void> {
    const { store, messaging } = this.#deps;
    for (const [index, page] of rendered.entries()) {
      const existing = stored.find((candidate) => candidate.page === index);
      if (existing !== undefined && existing.contentHash === page.hash && !force) continue;
      let messageId: MessageId;
      if (existing === undefined) {
        messageId = await messaging.send(board.channelId, page.view);
      } else {
        try {
          await messaging.edit(board.channelId, existing.messageId, page.view);
          messageId = existing.messageId;
        } catch (error) {
          // Message supprimé par un humain : on le republie, l'état n'a jamais dépendu de lui.
          if (!isReason(error, 'unknown_message')) throw error;
          messageId = await messaging.send(board.channelId, page.view);
        }
      }
      await store.savePage(board.guildId, board.id, { page: index, messageId, contentHash: page.hash });
    }

    // Jamais plus de messages que de pages, mais toujours au moins une page : le dernier message n'est jamais supprimé.
    const extra = stored.filter((candidate) => candidate.page >= rendered.length);
    for (const page of extra) {
      try {
        await messaging.delete(board.channelId, page.messageId);
      } catch (error) {
        if (!isReason(error, 'unknown_message')) throw error;
      }
    }
    if (extra.length > 0) await store.removePages(board.guildId, board.id, extra.map((page) => page.page));
  }

  async #abandon(board: BoardRecord): Promise<MaintenanceOutcome> {
    const { store, messaging, logger } = this.#deps;
    // Le ménage du canal est facultatif : un message déjà supprimé ou un droit retiré ne doit pas garder le board.
    for (const page of await store.pages(board.guildId, board.id)) {
      await messaging.delete(board.channelId, page.messageId).catch(() => undefined);
    }
    await store.deleteBoard(board.guildId, board.id, 'inactive');
    logger.info({ board_id: board.id, guild_id: board.guildId }, 'inactive empty board deleted');
    return { kind: 'deleted' };
  }

  async #failed(board: BoardRecord, error: unknown, now: Date): Promise<MaintenanceOutcome> {
    const { store, logger } = this.#deps;
    if (error instanceof DiscordApiError) {
      if (error.reason === 'unknown_channel') {
        await store.archive(board.guildId, board.id, error.reason, now);
        logger.warn({ board_id: board.id, guild_id: board.guildId }, 'board channel is gone, board disabled');
        return { kind: 'disabled', reason: error.reason };
      }
      const delay = error.reason === 'missing_access' || error.reason === 'missing_permissions' ? MISSING_RIGHTS_RETRY_MS : TRANSIENT_RETRY_MS;
      const retryAt = new Date(now.getTime() + delay);
      await store.markSyncFailed(board.guildId, board.id, error.reason);
      await store.schedule(board.guildId, board.id, retryAt);
      logger.warn({ guild_id: board.guildId, board_id: board.id, reason: error.reason }, 'board sync failed, will retry');
      return { kind: 'retry', reason: error.reason, retryAt };
    }
    if (isRangeError(error)) {
      // Une page que Discord ne peut pas accepter ne s'arrangera pas toute seule : on le dit et on espace les essais.
      const retryAt = new Date(now.getTime() + RENDER_RETRY_MS);
      await store.markSyncFailed(board.guildId, board.id, 'render');
      await store.schedule(board.guildId, board.id, retryAt);
      logger.error({ err: error, guild_id: board.guildId, board_id: board.id }, 'board page cannot be rendered');
      return { kind: 'retry', reason: 'render', retryAt };
    }
    throw error;
  }

  /** `true` si une alerte doit être retentée bientôt. */
  async #alerts(board: BoardRecord, assets: readonly TimerAsset[], t: Translator['t'], now: Date): Promise<boolean> {
    const { store, messaging, logger } = this.#deps;
    let retry = false;
    const guildId = board.guildId;

    let rows = await store.alerts(guildId, board.id);
    if (board.settings.alertsEnabled) {
      for (const claim of planAlerts(assets, rows, board.settings, now)) {
        if (!(await store.claimAlert(guildId, board.id, claim, now)) || !claim.send) continue;
        const asset = assets.find((candidate) => candidate.id === claim.assetId);
        if (asset === undefined) continue;
        try {
          const messageId = await messaging.send(board.channelId, buildAlertView(asset, claim.thresholdMin, board.settings, t));
          await store.setAlertMessage(guildId, { ...claim, messageId: null, ackedAt: null }, messageId);
        } catch (error) {
          // Réclamation rendue : un autre passage réessaiera, sans jamais avoir envoyé deux fois.
          await store.releaseAlert(guildId, { ...claim, messageId: null, ackedAt: null });
          retry = true;
          logger.warn({ err: error, guild_id: guildId, board_id: board.id, asset_id: claim.assetId }, 'alert could not be sent');
        }
      }
      rows = await store.alerts(guildId, board.id);
    }

    for (const row of staleAlerts(assets, rows, now)) {
      try {
        await messaging.delete(board.channelId, row.messageId as MessageId);
      } catch (error) {
        if (!isReason(error, 'unknown_message', 'unknown_channel')) {
          retry = true;
          logger.warn({ err: error, guild_id: guildId, board_id: board.id, asset_id: row.assetId }, 'stale alert could not be removed');
          continue;
        }
      }
      await store.setAlertMessage(guildId, row, null);
    }
    return retry;
  }
}
