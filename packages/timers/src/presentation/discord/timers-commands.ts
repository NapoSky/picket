import {
  ephemeral,
  type CommandEntry,
  type ComponentFamily,
  type ComponentHandler,
  type ModalInput,
  type Reply,
  type RootDescriptor,
} from '@picket/discord';
import { findLocation, findRegion, placeLabel, placeValue, resolvePlace, searchPlaces } from '@picket/game-data';
import type { MessageKey, Translator } from '@picket/i18n';
import { UserId } from '@picket/kernel';
import { ASSET_TYPES, ASSET_TYPE_IDS, isAssetTypeId, type AssetTypeId } from '../../domain/asset-types';
import { displayedMoment, type TimerAsset } from '../../domain/asset';
import { escapeMarkdown } from '../../application/board-view';
import {
  CODE_FIELD_ID,
  DURATION_FIELD_ID,
  NAME_FIELD_ID,
  TIMERS_NAMESPACE,
  TIMERS_VERSION,
  addModalCustomId,
  parseTimersPayload,
} from '../../application/custom-ids';
import type {
  AcknowledgeAlert,
  AddAsset,
  ChangeAssetResult,
  CleanupBoard,
  CreateBoard,
  GetBoardSettings,
  ListActiveAssets,
  RefreshAsset,
  RepairBoard,
  StrikeAsset,
  SyncStatus,
} from '../../application/timer-use-cases';
import { missingBotPermissions, type BotPermission } from '../../domain/bot-permissions';
import { MAX_NAME_LENGTH, MAX_ACTIVE_PER_BOARD } from '../../domain/constants';
import { formatDuration } from '../../domain/duration';
import type { ValidationError } from '../../domain/validation';

export const TIMERS_ROOT: RootDescriptor = {
  name: 'timers',
  description: 'commands.timers.description',
};
export const TIMERS_FEATURE = 'timers';

type T = Translator['t'];

const PERMISSION_KEYS: Readonly<Record<BotPermission, MessageKey>> = {
  view_channel: 'discordPermissions.viewChannel',
  send_messages: 'discordPermissions.sendMessages',
  embed_links: 'discordPermissions.embedLinks',
};

const deferred = (run: () => Promise<Reply | null>): Reply => ({ kind: 'deferred', ephemeral: true, update: false, run });

function missingPermissionsReply(appPermissions: bigint | null, t: T): Reply | null {
  const missing = missingBotPermissions(appPermissions);
  if (missing.length === 0) return null;
  return ephemeral(t('timers.errors.missingPermissions', { missing: missing.map((permission) => t(PERMISSION_KEYS[permission])).join(', ') }));
}

function validationText(error: ValidationError, t: T): string {
  switch (error.code) {
    case 'unknown_type':
      return t('timers.errors.unknownType');
    case 'unknown_region':
      return t('timers.errors.unknownRegion');
    case 'unknown_location':
      return t('timers.errors.unknownLocation');
    case 'name_empty':
      return t('timers.errors.nameEmpty');
    case 'name_too_long':
      return t('timers.errors.nameTooLong', { max: error.max });
    case 'code_required':
      return t('timers.errors.codeRequired');
    case 'code_invalid':
      return t('timers.errors.codeInvalid');
    case 'duration_invalid':
      return t('timers.errors.durationInvalid');
    case 'duration_too_short':
      return t('timers.errors.durationTooShort', { min: formatDuration(error.minSeconds) });
    case 'duration_too_long':
      return t('timers.errors.durationTooLong', { max: formatDuration(error.maxSeconds) });
  }
}

/** Le rendu a pu échouer alors que l'état est enregistré : on le dit sans inquiéter, le rendu sera retenté. */
function syncNote(sync: SyncStatus, t: T): string {
  if (sync.synced) return '';
  return `\n${sync.reason === 'unknown_channel' ? t('timers.errors.boardDisabled') : t('timers.errors.syncPending', { reason: sync.reason })}`;
}

const placeOf = (asset: Pick<TimerAsset, 'regionKey' | 'locationKey'>): string =>
  `${findLocation(asset.regionKey, asset.locationKey)?.name ?? asset.locationKey}, ${findRegion(asset.regionKey)?.name ?? asset.regionKey}`;

const momentOf = (asset: TimerAsset): string => `<t:${Math.floor(displayedMoment(asset).getTime() / 1000)}:R>`;

function changeReply(result: ChangeAssetResult, t: T, onDone: (asset: TimerAsset) => Reply | null): Reply | null {
  switch (result.kind) {
    case 'no_board':
    case 'not_found':
      return ephemeral(t('timers.errors.notFound'));
    case 'already_struck':
      return ephemeral(t('timers.errors.alreadyStruck'));
    case 'forbidden':
      return ephemeral(t('timers.errors.forbidden'));
    case 'done': {
      const reply = onDone(result.asset);
      if (result.sync.synced) return reply;
      const note = syncNote(result.sync, t).trim();
      return ephemeral(reply?.kind === 'message' ? `${reply.content}\n${note}` : note);
    }
  }
}

export interface TimersCommandDeps {
  readonly createBoard: CreateBoard;
  readonly strike: StrikeAsset;
  readonly cleanup: CleanupBoard;
  readonly repair: RepairBoard;
  readonly getSettings: GetBoardSettings;
  readonly listActive: ListActiveAssets;
}

const typeChoices = ASSET_TYPE_IDS.map((id) => ({ name: `timers.types.${id}` as const, value: id }));

export function timersCommands(deps: TimersCommandDeps): CommandEntry[] {
  const create: CommandEntry = {
    path: ['timers', 'create'],
    description: 'commands.timers.create.description',
    level: 'officer',
    feature: TIMERS_FEATURE,
    handler: async ({ interaction, guildId, t }) => {
      const channelId = interaction.channelId;
      if (channelId === null) return ephemeral(t('timers.errors.noChannel'));
      const missing = missingPermissionsReply(interaction.appPermissions, t);
      if (missing) return missing;
      return deferred(async () => {
        const result = await deps.createBoard.execute({ guildId, channelId, actor: interaction.userId, locale: interaction.locale });
        switch (result.kind) {
          case 'exists':
            return ephemeral(`${t('timers.restored')}${syncNote(result.sync, t)}`);
          case 'quota':
            return ephemeral(t('timers.errors.boardQuota', { max: result.max }));
          case 'created':
            return ephemeral(`${t('timers.created')}${syncNote(result.sync, t)}`);
        }
      });
    },
  };

  const add: CommandEntry = {
    path: ['timers', 'add'],
    description: 'commands.timers.add.description',
    level: 'member',
    feature: TIMERS_FEATURE,
    options: [
      { type: 'string', name: 'type', description: 'commands.timers.add.options.type.description', required: true, choices: typeChoices },
      { type: 'string', name: 'place', description: 'commands.timers.add.options.place.description', required: true, autocomplete: true },
      { type: 'user', name: 'owner', description: 'commands.timers.add.options.owner.description' },
    ],
    autocomplete: {
      place: async ({ focused }) => searchPlaces(focused.value).map((place) => ({ name: placeLabel(place), value: placeValue(place) })),
    },
    handler: async ({ interaction, guildId, t }) => {
      const channelId = interaction.channelId;
      if (channelId === null) return ephemeral(t('timers.errors.noChannel'));
      const { type, place: placeInput, owner } = interaction.options;
      if (typeof type !== 'string' || !isAssetTypeId(type)) return ephemeral(t('timers.errors.unknownType'));
      const place = resolvePlace(String(placeInput ?? ''));
      if (place === undefined) return ephemeral(t('timers.errors.unknownPlace'));
      const { region, location } = place;
      const parsedOwner = owner === undefined ? null : UserId.parse(owner);
      if (parsedOwner !== null && !parsedOwner.ok) return ephemeral(t('timers.errors.unknownType'));
      const ownerId = parsedOwner === null ? interaction.userId : (parsedOwner as { value: UserId }).value;

      // Refus avant d'ouvrir la modale : inutile de faire saisir un timer qui ne pourra pas être ajouté.
      const current = await deps.getSettings.execute(guildId, channelId);
      if (current === null) return ephemeral(t('timers.errors.noBoard'));
      if (current.activeCount >= MAX_ACTIVE_PER_BOARD) {
        return ephemeral(t('timers.errors.quota', { max: MAX_ACTIVE_PER_BOARD }));
      }

      const spec = ASSET_TYPES[type];
      const inputs: ModalInput[] = [
        {
          customId: NAME_FIELD_ID,
          label: t('timers.modal.name'),
          placeholder: t('timers.modal.namePlaceholder'),
          style: 'short',
          required: true,
          minLength: 1,
          maxLength: MAX_NAME_LENGTH,
        },
      ];
      if (spec.code.mode !== 'none') {
        inputs.push({
          customId: CODE_FIELD_ID,
          label: t('timers.modal.code'),
          placeholder: t(spec.code.mode === 'required' ? 'timers.modal.codeStockpile' : 'timers.modal.codeShort'),
          style: 'short',
          required: spec.code.mode === 'required',
          maxLength: spec.code.maxLength,
        });
      }
      if (spec.direction === 'down') {
        inputs.push({
          customId: DURATION_FIELD_ID,
          label: t('timers.modal.duration'),
          placeholder: t('timers.modal.durationPlaceholder'),
          style: 'short',
          required: true,
          value: String(spec.defaultDurationS / 3600),
          maxLength: 12,
        });
      }
      return {
        kind: 'modal',
        customId: addModalCustomId(type, region.key, location.key, ownerId),
        title: t('timers.modal.title', { type: t(`timers.types.${type}`) }),
        inputs,
      };
    },
  };

  const strike: CommandEntry = {
    path: ['timers', 'strike'],
    description: 'commands.timers.strike.description',
    level: 'member',
    feature: TIMERS_FEATURE,
    options: [{ type: 'string', name: 'timer', description: 'commands.timers.strike.options.timer.description', required: true, autocomplete: true }],
    autocomplete: {
      timer: async ({ interaction, guildId, focused }) => {
        if (interaction.channelId === null) return [];
        const assets = await deps.listActive.execute(guildId, interaction.channelId, focused.value);
        return assets.map((asset) => ({
          name: `${ASSET_TYPES[asset.type].icon} ${asset.name}${asset.code === null ? '' : ` ${asset.code}`} · ${findLocation(asset.regionKey, asset.locationKey)?.name ?? asset.locationKey}`,
          value: asset.id,
        }));
      },
    },
    handler: async ({ interaction, guildId, level, t }) => {
      const channelId = interaction.channelId;
      const assetId = interaction.options.timer;
      if (channelId === null || typeof assetId !== 'string') return ephemeral(t('timers.errors.notFound'));
      return deferred(async () => {
        const result = await deps.strike.execute({ guildId, channelId, userId: interaction.userId, level, assetId });
        return changeReply(result, t, (asset) => ephemeral(t('timers.struck', { name: escapeMarkdown(asset.name) })));
      });
    },
  };

  const cleanup: CommandEntry = {
    path: ['timers', 'cleanup'],
    description: 'commands.timers.cleanup.description',
    level: 'officer',
    feature: TIMERS_FEATURE,
    handler: async ({ interaction, guildId, t }) => {
      const channelId = interaction.channelId;
      if (channelId === null) return ephemeral(t('timers.errors.noBoard'));
      return deferred(async () => {
        const result = await deps.cleanup.execute({ guildId, channelId, actor: interaction.userId });
        switch (result.kind) {
          case 'no_board':
            return ephemeral(t('timers.errors.noBoard'));
          case 'nothing':
            return ephemeral(t('timers.nothingToClean'));
          case 'cleaned':
            return ephemeral(
              `${result.removed === 1 ? t('timers.cleaned.one') : t('timers.cleaned.many', { count: result.removed })}${syncNote(result.sync, t)}`,
            );
        }
      });
    },
  };

  const repair: CommandEntry = {
    path: ['timers', 'repair'],
    description: 'commands.timers.repair.description',
    level: 'officer',
    feature: TIMERS_FEATURE,
    handler: async ({ interaction, guildId, t }) => {
      const channelId = interaction.channelId;
      if (channelId === null) return ephemeral(t('timers.errors.noBoard'));
      const missing = missingPermissionsReply(interaction.appPermissions, t);
      if (missing) return missing;
      return deferred(async () => {
        const result = await deps.repair.execute({ guildId, channelId, actor: interaction.userId });
        if (result.kind === 'no_board') return ephemeral(t('timers.errors.noBoard'));
        return ephemeral(result.sync.synced ? t('timers.repaired') : syncNote(result.sync, t).trim());
      });
    },
  };

  return [create, add, strike, cleanup, repair];
}

export interface TimersFamilyDeps {
  readonly add: AddAsset;
  readonly refresh: RefreshAsset;
  readonly acknowledge: AcknowledgeAlert;
}

export function timersFamily(deps: TimersFamilyDeps): ComponentFamily {
  const onComponent: ComponentHandler = async ({ interaction, guildId, level, logger, payload, t }) => {
    const parsed = parseTimersPayload(payload);
    const message = interaction.message;
    if (parsed === null || message === null || (parsed.kind !== 'refresh' && parsed.kind !== 'ack')) return ephemeral(t('errors.expired'));
    if (parsed.kind === 'ack') {
      return {
        kind: 'deferred',
        ephemeral: true,
        update: true,
        run: async () => {
          await deps.acknowledge.execute({
            guildId,
            channelId: message.channelId,
            assetId: parsed.assetId,
            thresholdMin: parsed.thresholdMin,
            actor: interaction.userId,
          });
          return null;
        },
      };
    }
    return {
      kind: 'deferred',
      ephemeral: true,
      update: true,
      run: async () => {
        const result = await deps.refresh.execute({ guildId, channelId: message.channelId, userId: interaction.userId, level, assetId: parsed.assetId });
        logger.info({ user_id: interaction.userId, asset_id: parsed.assetId, outcome: result.kind }, 'timer refresh');
        // Succès : le board se met à jour sous les yeux de l'utilisateur, aucun message de plus.
        return changeReply(result, t, () => null);
      },
    };
  };

  const onModal: ComponentHandler = async ({ interaction, guildId, logger, payload, t }) => {
    const parsed = parseTimersPayload(payload);
    if (parsed === null || parsed.kind !== 'add') return ephemeral(t('errors.expired'));
    const channelId = interaction.channelId;
    if (channelId === null) return ephemeral(t('timers.errors.noChannel'));
    const asset = {
      type: parsed.type as AssetTypeId,
      regionKey: parsed.regionKey,
      locationKey: parsed.locationKey,
      name: interaction.fields[NAME_FIELD_ID] ?? '',
      code: interaction.fields[CODE_FIELD_ID] ?? '',
      duration: interaction.fields[DURATION_FIELD_ID] ?? '',
    };
    return deferred(async () => {
      const result = await deps.add.execute({ guildId, channelId, actor: interaction.userId, ownerId: parsed.ownerId, asset });
      logger.info({ user_id: interaction.userId, outcome: result.kind }, 'timer add');
      switch (result.kind) {
        case 'no_board':
          return ephemeral(t('timers.errors.noBoard'));
        case 'invalid':
          return ephemeral(validationText(result.error, t));
        case 'quota':
          return ephemeral(t('timers.errors.quota', { max: result.max }));
        case 'duplicate':
          return ephemeral(t('timers.errors.duplicate'));
        case 'added': {
          const text = t(result.reactivated ? 'timers.reactivated' : 'timers.added', {
            name: escapeMarkdown(result.asset.name),
            place: placeOf(result.asset),
            time: momentOf(result.asset),
          });
          return ephemeral(`${text}${syncNote(result.sync, t)}`);
        }
      }
    });
  };

  return { namespace: TIMERS_NAMESPACE, version: TIMERS_VERSION, level: 'member', feature: TIMERS_FEATURE, onComponent, onModal };
}
