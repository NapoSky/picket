import type { Messaging } from '@picket/discord';
import type { ChannelId, Clock, GuildId, IdGenerator, MessageId, UserId } from '@picket/kernel';
import { normalizeText } from '@picket/game-data';
import type { AccessLevel } from '@picket/discord';
import {
  compareAssets,
  activeAssets,
  reactivateAsset,
  refreshAsset,
  sameResource,
  strikeAsset,
  type TimerAsset,
} from '../domain/asset';
import { DEFAULT_BOARD_SETTINGS, applySettingsPatch, settingsEqual, type BoardSettings, type SettingsError, type SettingsPatch } from '../domain/board-settings';
import { MAX_ACTIVE_PER_BOARD, MAX_BOARDS_PER_GUILD } from '../domain/constants';
import { validateAssetInput, type AssetInput, type ValidationError } from '../domain/validation';
import type { BoardMaintenance, MaintenanceOutcome } from './board-maintenance';
import type { BoardRecord, Mutation, TimerStore } from './ports';
import type { RenderCoalescer } from './render-coalescer';

/** Ce que l'utilisateur doit savoir du rendu : l'état est enregistré dans tous les cas, Discord peut suivre plus tard. */
export type SyncStatus = { readonly synced: true } | { readonly synced: false; readonly reason: string };

export function syncStatusOf(outcome: MaintenanceOutcome): SyncStatus {
  switch (outcome.kind) {
    case 'ok':
    case 'busy':
      return { synced: true };
    case 'gone':
    case 'deleted':
      return { synced: false, reason: 'gone' };
    case 'disabled':
    case 'retry':
      return { synced: false, reason: outcome.reason };
  }
}

export interface TimerUseCaseDeps {
  readonly store: TimerStore;
  readonly coalescer: RenderCoalescer;
  readonly maintenance: BoardMaintenance;
  readonly messaging: Messaging;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** Une opération sur un asset est refusée à un simple membre quand le board réserve les changements. */
export function mayChange(board: BoardRecord, asset: TimerAsset, userId: UserId, level: AccessLevel): boolean {
  return !board.settings.restrictChanges || asset.ownerId === userId || level !== 'member';
}

// ---------------------------------------------------------------------------------------------------------------------

export type CreateBoardResult =
  | { readonly kind: 'created'; readonly boardId: string; readonly sync: SyncStatus }
  | { readonly kind: 'exists'; readonly sync: SyncStatus }
  | { readonly kind: 'quota'; readonly max: number };

export class CreateBoard {
  readonly #deps: TimerUseCaseDeps;

  constructor(deps: TimerUseCaseDeps) {
    this.#deps = deps;
  }

  async execute(input: { guildId: GuildId; channelId: ChannelId; actor: UserId; locale: string | null }): Promise<CreateBoardResult> {
    const { store, coalescer, maintenance, clock } = this.#deps;
    const created = await store.createBoard(
      { ...input, createdBy: input.actor, settings: DEFAULT_BOARD_SETTINGS, maxBoards: MAX_BOARDS_PER_GUILD },
      clock.now(),
    );
    // Le tableau existe en base : créer le republie, car ses messages ont pu être supprimés à la main.
    if (created.kind === 'exists') {
      // Compte comme une activité : un board qu'on vient de réclamer n'est pas un board abandonné.
      await store.mutate(input.guildId, created.board.id, () => ({ result: null, events: [{ actor: input.actor, action: 'repair' }] }), clock.now());
      return { kind: 'exists', sync: syncStatusOf(await maintenance.run(input.guildId, created.board.id, { force: true })) };
    }
    if (created.kind === 'quota') return { kind: 'quota', max: created.max };
    const outcome = await coalescer.request(input.guildId, created.board.id);
    return { kind: 'created', boardId: created.board.id, sync: syncStatusOf(outcome) };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export type AddAssetResult =
  | { readonly kind: 'no_board' }
  | { readonly kind: 'invalid'; readonly error: ValidationError }
  | { readonly kind: 'quota'; readonly max: number }
  | { readonly kind: 'duplicate' }
  | {
      readonly kind: 'added';
      readonly asset: TimerAsset;
      readonly reactivated: boolean;
      readonly sync: SyncStatus;
    };

type AddDecision =
  | { readonly kind: 'quota'; readonly max: number }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'added'; readonly asset: TimerAsset; readonly reactivated: boolean };

export class AddAsset {
  readonly #deps: TimerUseCaseDeps;

  constructor(deps: TimerUseCaseDeps) {
    this.#deps = deps;
  }

  async execute(input: { guildId: GuildId; channelId: ChannelId; actor: UserId; ownerId: UserId; asset: AssetInput }): Promise<AddAssetResult> {
    const { store, coalescer, clock, ids } = this.#deps;
    const board = await store.boardByChannel(input.guildId, input.channelId);
    if (board === null) return { kind: 'no_board' };
    const valid = validateAssetInput(input.asset);
    if (!valid.ok) return { kind: 'invalid', error: valid.error };
    const candidate = valid.value;
    const now = clock.now();

    const decision = await store.mutate<AddDecision>(
      input.guildId,
      board.id,
      (state): Mutation<AddDecision> => {
        // Vérifier l'identité et le quota sous le verrou : deux ajouts simultanés ne créent pas de doublon.
        const active = activeAssets(state.assets);
        const identical = active.find((asset) => sameResource(asset, candidate));
        if (identical !== undefined) return { result: { kind: 'duplicate' } };
        if (active.length >= MAX_ACTIVE_PER_BOARD) return { result: { kind: 'quota', max: MAX_ACTIVE_PER_BOARD } };

        const struck = state.assets.find((asset) => asset.status === 'struck' && sameResource(asset, candidate));
        const base = { type: candidate.type, name: candidate.name, code: candidate.code, region: candidate.regionKey, location: candidate.locationKey };
        if (struck !== undefined) {
          const asset = reactivateAsset(struck, { ownerId: input.ownerId, durationS: candidate.durationS, now });
          return {
            result: { kind: 'added', asset, reactivated: true },
            changes: [{ kind: 'update', asset }],
            events: [{ assetId: asset.id, actor: input.actor, action: 'reactivate', detail: { ...base, durationS: candidate.durationS, owner: input.ownerId } }],
          };
        }
        const asset: TimerAsset = {
          id: ids.next(),
          boardId: state.board.id,
          type: candidate.type,
          name: candidate.name,
          code: candidate.code,
          regionKey: candidate.regionKey,
          locationKey: candidate.locationKey,
          ownerId: input.ownerId,
          direction: candidate.direction,
          durationS: candidate.durationS,
          startedAt: now,
          status: 'active',
          struckAt: null,
          frozenAt: null,
          rev: 0,
        };
        return {
          result: { kind: 'added', asset, reactivated: false },
          changes: [{ kind: 'insert', asset }],
          events: [{ assetId: asset.id, actor: input.actor, action: 'add', detail: { ...base, durationS: candidate.durationS, owner: input.ownerId } }],
        };
      },
      now,
    );
    if (decision === null) return { kind: 'no_board' };
    if (decision.kind !== 'added') return decision;
    const sync = syncStatusOf(await coalescer.request(input.guildId, board.id));
    return { ...decision, sync };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export type ChangeAssetResult =
  | { readonly kind: 'no_board' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'already_struck' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'done'; readonly asset: TimerAsset; readonly sync: SyncStatus };

type ChangeDecision =
  | { readonly kind: 'not_found' }
  | { readonly kind: 'already_struck' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'done'; readonly asset: TimerAsset };

async function changeAsset(
  deps: TimerUseCaseDeps,
  board: BoardRecord,
  assetId: string,
  user: { readonly userId: UserId; readonly level: AccessLevel },
  action: 'strike' | 'refresh',
): Promise<ChangeAssetResult> {
  const now = deps.clock.now();
  const decision = await deps.store.mutate<ChangeDecision>(
    board.guildId,
    board.id,
    (state): Mutation<ChangeDecision> => {
      const asset = state.assets.find((candidate) => candidate.id === assetId);
      if (asset === undefined) return { result: { kind: 'not_found' } };
      if (asset.status === 'struck') return { result: { kind: 'already_struck' } };
      if (!mayChange(state.board, asset, user.userId, user.level)) return { result: { kind: 'forbidden' } };
      const next = action === 'strike' ? strikeAsset(asset, now) : refreshAsset(asset, now);
      return {
        result: { kind: 'done', asset: next },
        changes: [{ kind: 'update', asset: next }],
        events: [{ assetId, actor: user.userId, action, ...(action === 'strike' ? { detail: { name: asset.name, type: asset.type, code: asset.code, region: asset.regionKey, location: asset.locationKey } } : {}) }],
      };
    },
    now,
  );
  if (decision === null) return { kind: 'no_board' };
  if (decision.kind !== 'done') return decision;
  return { kind: 'done', asset: decision.asset, sync: syncStatusOf(await deps.coalescer.request(board.guildId, board.id)) };
}

export class StrikeAsset {
  readonly #deps: TimerUseCaseDeps;

  constructor(deps: TimerUseCaseDeps) {
    this.#deps = deps;
  }

  async execute(input: { guildId: GuildId; channelId: ChannelId; userId: UserId; level: AccessLevel; assetId: string }): Promise<ChangeAssetResult> {
    const board = await this.#deps.store.boardByChannel(input.guildId, input.channelId);
    if (board === null) return { kind: 'no_board' };
    return changeAsset(this.#deps, board, input.assetId, input, 'strike');
  }
}

/**
 * Le bouton d'un asset : l'asset suffit à retrouver son board (et la RLS borne la recherche à la guilde). Le message
 * cliqué doit être dans le canal du board : un identifiant forgé ne permet pas d'agir sur un autre board.
 */
export class RefreshAsset {
  readonly #deps: TimerUseCaseDeps;

  constructor(deps: TimerUseCaseDeps) {
    this.#deps = deps;
  }

  async execute(input: { guildId: GuildId; channelId: ChannelId; userId: UserId; level: AccessLevel; assetId: string }): Promise<ChangeAssetResult> {
    const board = await this.#deps.store.boardOfAsset(input.guildId, input.assetId);
    if (board === null || board.channelId !== input.channelId) return { kind: 'no_board' };
    return changeAsset(this.#deps, board, input.assetId, input, 'refresh');
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export type CleanupResult =
  | { readonly kind: 'no_board' }
  | { readonly kind: 'nothing' }
  | { readonly kind: 'cleaned'; readonly removed: number; readonly sync: SyncStatus };

/** Supprime les assets barrés. Le board garde toujours au moins un message : rien n'est jamais « recréé » après coup. */
export class CleanupBoard {
  readonly #deps: TimerUseCaseDeps;

  constructor(deps: TimerUseCaseDeps) {
    this.#deps = deps;
  }

  async execute(input: { guildId: GuildId; channelId: ChannelId; actor: UserId }): Promise<CleanupResult> {
    const { store, coalescer, clock } = this.#deps;
    const board = await store.boardByChannel(input.guildId, input.channelId);
    if (board === null) return { kind: 'no_board' };
    const removed = await store.mutate<number>(
      input.guildId,
      board.id,
      (state): Mutation<number> => {
        const struck = state.assets.filter((asset) => asset.status === 'struck');
        if (struck.length === 0) return { result: 0 };
        return {
          result: struck.length,
          changes: struck.map((asset) => ({ kind: 'delete' as const, assetId: asset.id })),
          events: [{ actor: input.actor, action: 'cleanup', detail: { count: struck.length } }],
        };
      },
      clock.now(),
    );
    if (removed === null) return { kind: 'no_board' };
    if (removed === 0) return { kind: 'nothing' };
    return { kind: 'cleaned', removed, sync: syncStatusOf(await coalescer.request(input.guildId, board.id)) };
  }
}

export type RepairResult = { readonly kind: 'no_board' } | { readonly kind: 'repaired'; readonly sync: SyncStatus };

/** Republie tous les messages du board depuis la base : message supprimé, pages incohérentes, rendu resté en attente. */
export class RepairBoard {
  readonly #deps: TimerUseCaseDeps;

  constructor(deps: TimerUseCaseDeps) {
    this.#deps = deps;
  }

  async execute(input: { guildId: GuildId; channelId: ChannelId; actor: UserId }): Promise<RepairResult> {
    const { store, maintenance, clock } = this.#deps;
    const board = await store.boardByChannel(input.guildId, input.channelId);
    if (board === null) return { kind: 'no_board' };
    await store.mutate(
      input.guildId,
      board.id,
      () => ({ result: null, events: [{ actor: input.actor, action: 'repair' }] }),
      clock.now(),
    );
    return { kind: 'repaired', sync: syncStatusOf(await maintenance.run(input.guildId, board.id, { force: true })) };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export type SettingsResult =
  | { readonly kind: 'no_board' }
  | { readonly kind: 'invalid'; readonly error: SettingsError }
  | { readonly kind: 'unchanged'; readonly settings: BoardSettings }
  | { readonly kind: 'updated'; readonly settings: BoardSettings; readonly sync: SyncStatus };

type SettingsDecision =
  | { readonly kind: 'invalid'; readonly error: SettingsError }
  | { readonly kind: 'unchanged'; readonly settings: BoardSettings }
  | { readonly kind: 'updated'; readonly settings: BoardSettings };

export class GetBoardSettings {
  readonly #store: TimerStore;

  constructor(store: TimerStore) {
    this.#store = store;
  }

  async execute(guildId: GuildId, channelId: ChannelId): Promise<{ readonly board: BoardRecord; readonly activeCount: number } | null> {
    const board = await this.#store.boardByChannel(guildId, channelId);
    if (board === null) return null;
    const state = await this.#store.state(guildId, board.id);
    return state === null ? null : { board: state.board, activeCount: activeAssets(state.assets).length };
  }
}

export class UpdateBoardSettings {
  readonly #deps: TimerUseCaseDeps;

  constructor(deps: TimerUseCaseDeps) {
    this.#deps = deps;
  }

  async execute(input: { guildId: GuildId; channelId: ChannelId; boardId?: string; actor: UserId; patch: SettingsPatch }): Promise<SettingsResult> {
    const { store, coalescer, clock } = this.#deps;
    const board = await store.boardByChannel(input.guildId, input.channelId);
    if (board === null || (input.boardId !== undefined && board.id !== input.boardId)) return { kind: 'no_board' };
    const decision = await store.mutate<SettingsDecision>(
      input.guildId,
      board.id,
      (state): Mutation<SettingsDecision> => {
        const next = applySettingsPatch(state.board.settings, input.patch);
        if (!next.ok) return { result: { kind: 'invalid', error: next.error } };
        if (settingsEqual(next.value, state.board.settings)) return { result: { kind: 'unchanged', settings: next.value } };
        return {
          result: { kind: 'updated', settings: next.value },
          settings: next.value,
          events: [{ actor: input.actor, action: 'settings', detail: { before: state.board.settings, after: next.value } }],
        };
      },
      clock.now(),
    );
    if (decision === null) return { kind: 'no_board' };
    if (decision.kind !== 'updated') return decision;
    return { kind: 'updated', settings: decision.settings, sync: syncStatusOf(await coalescer.request(input.guildId, board.id)) };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/** Acquitte une alerte : son message disparaît, et le même seuil ne se redéclenchera pas pour cette échéance. */
export class AcknowledgeAlert {
  readonly #deps: TimerUseCaseDeps;

  constructor(deps: TimerUseCaseDeps) {
    this.#deps = deps;
  }

  async execute(input: { guildId: GuildId; channelId: ChannelId; assetId: string; thresholdMin: number; actor: UserId }): Promise<{ readonly kind: 'acked' | 'unknown' }> {
    const { store, messaging, clock } = this.#deps;
    // Le message cliqué doit être dans le canal du board de l'asset.
    const board = await store.boardOfAsset(input.guildId, input.assetId);
    if (board === null || board.channelId !== input.channelId) return { kind: 'unknown' };
    const row = await store.acknowledgeAlert(input.guildId, input.assetId, input.thresholdMin, input.actor, clock.now());
    if (row === null) return { kind: 'unknown' };
    if (row.messageId !== null) {
      try {
        await messaging.delete(board.channelId, row.messageId as MessageId);
      } catch {
        // Déjà supprimé, ou plus de droits : l'acquittement est enregistré dans tous les cas.
      }
      await store.setAlertMessage(input.guildId, row, null);
    }
    return { kind: 'acked' };
  }
}

/**
 * Contrat exposé au journal de guerre : à chaque nouvelle guerre, les boards de la guilde qui l'ont demandé repartent
 * à vide. Les assets disparaissent, l'historique (`timer_events`) est conservé.
 */
export class ArchiveBoardsOnNewWar {
  readonly #deps: TimerUseCaseDeps;

  constructor(deps: TimerUseCaseDeps) {
    this.#deps = deps;
  }

  async execute(guildId: GuildId): Promise<{ readonly reset: number; readonly failed: number }> {
    const { store, coalescer, clock } = this.#deps;
    let reset = 0;
    let failed = 0;
    for (const board of await store.boardsOfGuild(guildId)) {
      if (board.archivedAt !== null || !board.settings.resetOnNewWar) continue;
      try {
        await store.mutate(
          guildId,
          board.id,
          (state) => ({
            result: null,
            changes: state.assets.map((asset) => ({ kind: 'delete' as const, assetId: asset.id })),
            events: [{ actor: 'system' as const, action: 'reset_war' as const, detail: { count: state.assets.length } }],
          }),
          clock.now(),
        );
        await coalescer.request(guildId, board.id);
        reset += 1;
      } catch {
        failed += 1;
      }
    }
    return { reset, failed };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

const AUTOCOMPLETE_LIMIT = 25;

/** Assets actifs du board du canal, filtrés par ce que l'utilisateur tape (nom, code ou lieu). */
export class ListActiveAssets {
  readonly #store: TimerStore;

  constructor(store: TimerStore) {
    this.#store = store;
  }

  async execute(guildId: GuildId, channelId: ChannelId, query: string): Promise<readonly TimerAsset[]> {
    const board = await this.#store.boardByChannel(guildId, channelId);
    if (board === null) return [];
    const state = await this.#store.state(guildId, board.id);
    if (state === null) return [];
    const needle = normalizeText(query);
    return activeAssets(state.assets)
      .filter((asset) => needle === '' || normalizeText(`${asset.name}${asset.code ?? ''}${asset.locationKey}${asset.regionKey}`).includes(needle))
      .sort(compareAssets)
      .slice(0, AUTOCOMPLETE_LIMIT);
  }
}
