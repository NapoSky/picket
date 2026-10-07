import {
  ephemeral,
  type CommandEntry,
  type ComponentFamily,
  type ComponentHandler,
  type Reply,
  type RootDescriptor,
} from '@picket/discord';
import type { MessageKey, Translator } from '@picket/i18n';
import type { CreateTodolist, PageTexts, PrepareError } from '../../application/create-todolist';
import type { TodolistCreationObserver } from '../../application/todolist-creation-observer';
import {
  CONTENT_FIELD_ID,
  CREATE_MODAL_PAYLOAD,
  TODOLIST_NAMESPACE,
  TODOLIST_VERSION,
  createModalCustomId,
  parseItemPayload,
} from '../../application/custom-ids';
import type { TickResult, TickTodolistItem } from '../../application/tick-todolist-item';
import { missingBotPermissions, type BotPermission } from '../../domain/bot-permissions';
import { MAX_INPUT_LENGTH } from '../../domain/constants';

export const TODOLIST_ROOT: RootDescriptor = { name: 'todolist', description: 'commands.todolist.description' };
export const TODOLIST_FEATURE = 'todolists';

type T = Translator['t'];

const PERMISSION_KEYS: Readonly<Record<BotPermission, MessageKey>> = {
  view_channel: 'discordPermissions.viewChannel',
  send_messages: 'discordPermissions.sendMessages',
  embed_links: 'discordPermissions.embedLinks',
};

/** Limite d'un message Discord. */
const MESSAGE_LIMIT = 2000;

const pageTexts = (t: T): PageTexts => ({
  title: t('todolist.title'),
  footer: (page, total) => t('todolist.footer', { page, total }),
});

function missingPermissionsReply(appPermissions: bigint | null, t: T): Reply | null {
  const missing = missingBotPermissions(appPermissions);
  if (missing.length === 0) return null;
  return ephemeral(t('todolist.errors.missingPermissions', { missing: missing.map((permission) => t(PERMISSION_KEYS[permission])).join(', ') }));
}

function prepareErrorText(error: PrepareError, t: T): string {
  switch (error.code) {
    case 'empty':
      return t('todolist.errors.empty');
    case 'input_too_long':
      return t('todolist.errors.inputTooLong', { max: error.max });
    case 'no_items':
      return t('todolist.errors.noItems');
    case 'too_many_items':
      return t('todolist.errors.tooManyItems', { max: error.max });
    case 'item_too_long':
      return t('todolist.errors.itemTooLong', { line: error.line, max: error.max });
    case 'too_long_to_render':
      return t('todolist.errors.tooLongToRender');
  }
}

/** Une modale refusée se ferme : on rend la saisie pour qu'elle puisse être recopiée, au plus ce que Discord accepte. */
function withEcho(message: string, text: string, t: T): string {
  const header = `${message}\n\n${t('todolist.errors.yourText')}\n\`\`\`\n`;
  const footer = '\n```';
  const room = MESSAGE_LIMIT - header.length - footer.length;
  // Une suite de trois accents graves fermerait le bloc : on les sépare par un caractère de largeur nulle.
  const safe = text.replace(/```/gu, '`\u200b``').slice(0, Math.max(0, room));
  return room > 0 ? `${header}${safe}${footer}` : message;
}

function tickReply(result: TickResult, t: T): Reply | null {
  switch (result.kind) {
    case 'updated':
    case 'gone':
      // Rien à dire : le message a changé sous les yeux, ou n'existe plus.
      return null;
    case 'completed':
      return ephemeral(
        result.total > 1 ? t('todolist.completedPage', { page: result.page, total: result.total }) : t('todolist.completed'),
      );
    case 'already_done':
      return ephemeral(t('todolist.alreadyDone'));
    case 'unreadable':
      return ephemeral(t('todolist.errors.unreadable'));
    case 'busy':
      return ephemeral(t('todolist.errors.busy'));
    case 'discord_error':
      return ephemeral(
        result.reason === 'missing_permissions' || result.reason === 'missing_access'
          ? t('todolist.errors.cannotEdit')
          : t('errors.failure'),
      );
  }
}

export function todolistCommands(): CommandEntry[] {
  const create: CommandEntry = {
    path: ['todolist', 'create'],
    description: 'commands.todolist.create.description',
    level: 'member',
    feature: TODOLIST_FEATURE,
    handler: async ({ interaction, t }) => {
      const missing = missingPermissionsReply(interaction.appPermissions, t);
      if (missing) return missing;
      return {
        kind: 'modal',
        customId: createModalCustomId(),
        title: t('todolist.modal.title'),
        inputs: [
          {
            customId: CONTENT_FIELD_ID,
            label: t('todolist.modal.label'),
            placeholder: t('todolist.modal.placeholder'),
            style: 'paragraph',
            required: true,
            maxLength: MAX_INPUT_LENGTH,
          },
        ],
      };
    },
  };
  return [create];
}

export function todolistFamily(deps: { create: CreateTodolist; tick: TickTodolistItem; created?: TodolistCreationObserver }): ComponentFamily {
  const onModal: ComponentHandler = async ({ guildId, interaction, logger, payload, t }) => {
    if (payload !== CREATE_MODAL_PAYLOAD) return ephemeral(t('errors.expired'));
    const channelId = interaction.channelId;
    if (channelId === null) return ephemeral(t('todolist.errors.noChannel'));
    // Les droits ont pu changer depuis l'ouverture de la modale.
    const missing = missingPermissionsReply(interaction.appPermissions, t);
    if (missing) return missing;

    const text = interaction.fields[CONTENT_FIELD_ID] ?? '';
    const prepared = deps.create.prepare(text, pageTexts(t));
    // Refus immédiat : pas d'attente différée pour une saisie invalide.
    if (!prepared.ok) return ephemeral(prepared.error.code === 'empty' ? prepareErrorText(prepared.error, t) : withEcho(prepareErrorText(prepared.error, t), text, t));

    return {
      kind: 'deferred',
      ephemeral: true,
      update: false,
      run: async () => {
        const published = await deps.create.publish(channelId, prepared.value);
        if (!published.ok) {
          logger.warn({ user_id: interaction.userId, channel_id: channelId, reason: published.error.reason }, 'todolist publication failed');
          const blocked = ['missing_permissions', 'missing_access', 'unknown_channel'].includes(published.error.reason);
          return ephemeral(blocked ? t('todolist.errors.cannotPost') : t('errors.failure'));
        }
        try { await deps.created?.record({ guildId, actor: interaction.userId, channelId, messageIds: published.value }); }
        catch (error) { logger.error({ err: error, user_id: interaction.userId, channel_id: channelId }, 'todolist audit persistence failed'); }
        logger.info({ user_id: interaction.userId, channel_id: channelId, messages: published.value.length, message_ids: [...published.value] }, 'todolist created');
        return ephemeral(
          published.value.length === 1 ? t('todolist.created.one') : t('todolist.created.many', { count: published.value.length }),
        );
      },
    };
  };

  const onComponent: ComponentHandler = async ({ interaction, logger, payload, t }) => {
    const index = parseItemPayload(payload);
    const message = interaction.message;
    if (index === null || message === null) return ephemeral(t('errors.expired'));
    return {
      kind: 'deferred',
      ephemeral: true,
      update: true,
      run: async () => {
        const result = await deps.tick.execute(message.channelId, message.id, index);
        logger.info({ user_id: interaction.userId, message_id: message.id, item: index, outcome: result.kind }, 'todolist tick');
        return tickReply(result, t);
      },
    };
  };

  return {
    namespace: TODOLIST_NAMESPACE,
    version: TODOLIST_VERSION,
    level: 'member',
    feature: TODOLIST_FEATURE,
    onComponent,
    onModal,
  };
}
