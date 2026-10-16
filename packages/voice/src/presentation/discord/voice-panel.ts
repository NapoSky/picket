import {
  ACCESS_RANK,
  encodeCustomId,
  ephemeral,
  type AccessPolicy,
  type CommandContext,
  type CommandEntry,
  type ComponentContext,
  type ComponentFamily,
  type GuildGate,
  type PanelButton,
  type PanelContent,
  type Reply,
  type ModalInput,
  type RootDescriptor,
} from '@picket/discord';
import type { Clock } from '@picket/kernel';
import type { MessageKey } from '@picket/i18n';
import type { VoiceIdentity, VoiceService } from '../../application/ports';
import {
  DELAYS,
  MAX_CHANNELS,
  MAX_TEMPLATES,
  VoiceError,
  integer,
  queueSize,
  type VoiceSession,
  type VoiceTemplate,
} from '../../domain/model';
interface Dependencies {
  service: VoiceService;
  access: AccessPolicy;
  gate: GuildGate;
  clock: Clock;
  settingsHome: (context: CommandContext) => PanelButton;
}
export const VOICE_ROOT: RootDescriptor = {
  name: 'voice',
  description: 'voice.settingsTitle',
};
const text = (value: string): PanelContent => ({ kind: 'text', text: value });
const identity = (c: CommandContext): VoiceIdentity => ({
  guildId: c.guildId,
  userId: c.interaction.userId,
  roleIds: c.interaction.memberRoleIds,
});
export function createVoicePanel(deps: Dependencies) {
  const id = (s: VoiceSession, action: string, arg = '0') =>
    encodeCustomId(
      s.state.mode === 'member' ? 'voice' : 'vset',
      1,
      `${s.id}.${s.revision.toString(36)}.${action}.${arg}`,
    );
  const button = (
    c: CommandContext,
    s: VoiceSession,
    label: MessageKey,
    action: string,
    arg = '0',
    disabled = false,
    primary = false,
  ): PanelButton => ({
    kind: 'button',
    customId: id(s, action, arg),
    label: c.t(label),
    style: primary ? 'primary' : 'secondary',
    disabled,
  });
  async function guard(c: CommandContext, officer: boolean) {
    const [level, suspension] = await Promise.all([
      deps.access.levelOf(c.interaction, c.guildId),
      deps.gate.suspensionOf(c.guildId),
    ]);
    if (!level || ACCESS_RANK[level] < (officer ? 2 : 1))
      throw new VoiceError('access');
    if (suspension) throw new VoiceError('disabled');
  }
  async function render(
    c: CommandContext,
    s: VoiceSession,
    notice?: string,
  ): Promise<Reply> {
    const i = identity(c),
      settings = s.state.mode !== 'member';
    const [models, limit, channels] = await Promise.all([
      deps.service.templates(i, settings),
      deps.service.limit(c.guildId),
      deps.service.channels(c.guildId, s.state.batchId ?? undefined),
    ]);
    const selected = models.find((m) => m.id === s.state.selected);
    const components: PanelContent[] = [
      text(`## 🔊 ${c.t(settings ? 'voice.settingsTitle' : 'voice.title')}`),
    ];
    if (notice) components.push(text(notice));
    const details = (m: VoiceTemplate) =>
      `${m.name}\n<#${m.categoryId}> · ${c.t('voice.details', { capacity: m.capacity, minutes: m.idleMinutes })}`;
    if (s.state.mode === 'channels' || s.state.batchId) {
      components.push(
        text(c.t('voice.results')),
        ...channels
          .slice(0, 15)
          .map((ch) =>
            text(
              `${ch.channelId ? `<#${ch.channelId}>` : ch.name} · ${c.t(`voice.status.${ch.status}`)}${ch.status === 'active' ? ` · ${c.t('voice.occupants', { count: ch.occupants })}${ch.deleteAfter ? ` · <t:${Math.floor(ch.deleteAfter.getTime() / 1000)}:R>` : ''}` : ''}`,
            ),
          ),
      );
      if (
        settings &&
        channels.some(
          (ch) => ch.status === 'active' || ch.status === 'uncertain',
        )
      )
        components.push(
          {
            kind: 'stringSelect',
            customId: id(s, 'pickChannel'),
            placeholder: c.t('voice.pickChannel'),
            options: channels
              .filter(
                (ch) => ch.status === 'active' || ch.status === 'uncertain',
              )
              .map((ch) => ({
                label: ch.name,
                value: ch.id,
                selected: s.state.selected === ch.id,
              })),
          },
          {
            kind: 'buttons',
            buttons: [
              button(
                c,
                s,
                'voice.deleteEmpty',
                'deleteChannel',
                s.state.selected ?? '0',
                !channels.some(
                  (ch) => ch.id === s.state.selected && ch.status === 'active',
                ),
              ),
              button(
                c,
                s,
                'voice.resolve',
                'resolveChannel',
                s.state.selected ?? '0',
                !channels.some(
                  (ch) =>
                    ch.id === s.state.selected && ch.status === 'uncertain',
                ),
              ),
            ],
          },
        );
      components.push({
        kind: 'buttons',
        buttons: [
          button(c, s, 'panel.refresh', 'refresh'),
          button(c, s, settings ? 'panel.previous' : 'voice.new', 'back'),
        ],
      });
    } else {
      if (models.length)
        components.push({
          kind: 'stringSelect',
          customId: id(s, 'pick'),
          placeholder: c.t('voice.pick'),
          options: models.map((m) => ({
            label: m.name,
            value: m.id,
            selected: s.state.selected === m.id,
          })),
        });
      else components.push(text(c.t('voice.noModels')));
      if (selected) components.push(text(details(selected)));
      if (settings) {
        components.push(
          text(
            c.t('voice.settingsSummary', {
              count: models.length,
              max: MAX_TEMPLATES,
              limit,
              open: channels.length,
              channels: MAX_CHANNELS,
            }),
          ),
          {
            kind: 'buttons',
            buttons: [
              button(
                c,
                s,
                'voice.add',
                'addModel',
                '0',
                models.length >= MAX_TEMPLATES,
              ),
              button(
                c,
                s,
                'voice.edit',
                'editModel',
                selected?.id ?? '0',
                !selected,
              ),
              button(
                c,
                s,
                'voice.duplicate',
                'copyModel',
                selected?.id ?? '0',
                !selected || models.length >= MAX_TEMPLATES,
              ),
              button(
                c,
                s,
                'voice.remove',
                'removeModel',
                selected?.id ?? '0',
                !selected,
              ),
            ],
          },
        );
        if (s.state.mode === 'remove' && selected)
          components.push(
            text(c.t('voice.removeConfirm', { name: selected.name })),
            {
              kind: 'buttons',
              buttons: [
                button(
                  c,
                  s,
                  'panel.confirm',
                  'confirmRemove',
                  `${selected.id}-${selected.revision}`,
                ),
                button(c, s, 'panel.cancel', 'cancelRemove'),
              ],
            },
          );
        components.push({
          kind: 'buttons',
          buttons: [
            button(c, s, 'voice.limit', 'limit'),
            button(c, s, 'voice.channels', 'channels'),
          ],
        });
      } else {
        components.push(
          {
            kind: 'stringSelect',
            customId: id(s, 'quantity'),
            placeholder: c.t('voice.quantity'),
            options: [
              ...Array.from({ length: 10 }, (_, n) => ({
                label: String(n + 1),
                value: String(n + 1),
                selected: s.state.quantity === n + 1,
              })),
              { label: c.t('voice.other'), value: 'other' },
            ],
          },
          {
            kind: 'buttons',
            buttons: [
              {
                ...button(
                  c,
                  s,
                  'voice.addQueue',
                  'addQueue',
                  '0',
                  !selected,
                  true,
                ),
                label: c.t('voice.addQuantity', { quantity: s.state.quantity }),
              },
            ],
          },
          { kind: 'separator' },
          text(c.t('voice.queue', { count: queueSize(s.state.queue), limit })),
        );
        for (const [modelId, q] of Object.entries(s.state.queue)) {
          const model = models.find((m) => m.id === modelId);
          components.push(
            text(
              `${model?.name ?? c.t('voice.unavailableModel')} × ${q.quantity}${model ? ` → <#${model.categoryId}>` : ''}`,
            ),
          );
        }
        if (Object.keys(s.state.queue).length)
          components.push({
            kind: 'stringSelect',
            customId: id(s, 'editQueue'),
            placeholder: c.t('voice.editQueue'),
            options: Object.keys(s.state.queue).map((modelId) => ({
              label:
                models.find((m) => m.id === modelId)?.name ??
                c.t('voice.unavailableModel'),
              value: modelId,
            })),
          });
        components.push({
          kind: 'buttons',
          buttons: [
            {
              ...button(
                c,
                s,
                'voice.deploy',
                'deploy',
                '0',
                queueSize(s.state.queue) === 0,
                true,
              ),
              label: c.t('voice.deployCount', {
                count: queueSize(s.state.queue),
              }),
            },
            button(c, s, 'voice.clear', 'clear'),
            button(c, s, 'panel.cancel', 'cancel'),
          ],
        });
      }
    }
    if (settings)
      components.push({ kind: 'buttons', buttons: [deps.settingsHome(c)] });
    return {
      kind: 'panel',
      update: c.interaction.kind !== 'command',
      panel: { accentColor: 0x3498db, components },
    };
  }
  function modelModal(
    c: CommandContext,
    s: VoiceSession,
    action: string,
    model?: VoiceTemplate,
  ): Reply {
    const copySuffix = ` (${c.t('voice.copy')})`;
    const inputs: ModalInput[] = [
      {
        customId: 'category',
        label: c.t('voice.category'),
        kind: 'channelSelect',
        channelKinds: ['category'],
        ...(model ? { values: [model.categoryId] } : {}),
      },
      {
        customId: 'channelName',
        label: c.t('voice.channelName'),
        style: 'short',
        maxLength: 90,
        required: true,
        ...(model
          ? {
              value:
                action === 'copyModel'
                  ? `${model.channelName.slice(0, 90 - copySuffix.length)}${copySuffix}`
                  : model.channelName,
            }
          : {}),
      },
      {
        customId: 'capacity',
        label: c.t('voice.capacity'),
        style: 'short',
        required: true,
        maxLength: 2,
        value: String(model?.capacity ?? 99),
      },
      {
        customId: 'delay',
        label: c.t('voice.delay'),
        kind: 'stringSelect',
        options: DELAYS.map((n) => ({
          label: c.t('voice.minutes', { count: n }),
          value: String(n),
          selected: n === (model?.idleMinutes ?? 15),
        })),
      },
    ];
    return {
      kind: 'modal',
      customId: id(
        s,
        action === 'editModel' ? 'saveEdit' : 'saveNew',
        model ? `${model.id}-${model.revision}` : '0',
      ),
      title: c.t('voice.modelTitle'),
      inputs,
    };
  }
  async function handle(c: ComponentContext): Promise<Reply> {
    try {
      const [sid, revision, action, arg, extra] = c.payload.split('.');
      if (extra || !sid || !revision || !action || !arg)
        throw new VoiceError('expired');
      const i = identity(c),
        s = await deps.service.readSession(i, sid);
      if (s.revision !== parseInt(revision, 36))
        throw new VoiceError('expired');
      const officer = s.state.mode !== 'member';
      await guard(c, officer);
      const models = officer ? await deps.service.templates(i, true) : [],
        selected = models.find((m) => m.id === arg.split('-')[0]);
      const modal = (
        label: MessageKey,
        field: string,
        value: string,
        submit: string,
        arg = '0',
      ): Reply => ({
        kind: 'modal',
        customId: id(s, submit, arg),
        title: c.t(label),
        inputs: [
          {
            customId: field,
            label: c.t(label),
            style: 'short',
            required: true,
            value,
            maxLength: 80,
          },
        ],
      });
      const pick = c.interaction.selectedValues[0];
      const isButton =
        c.interaction.kind === 'component' &&
        c.interaction.componentKind === 'button';
      const isSelect =
        c.interaction.kind === 'component' &&
        c.interaction.componentKind === 'stringSelect';
      const isModal = c.interaction.kind === 'modal';
      if (
        officer &&
        isButton &&
        ['addModel', 'editModel', 'copyModel'].includes(action)
      ) {
        if (action !== 'addModel' && !selected) throw new VoiceError('changed');
        return modelModal(c, s, action, selected);
      }
      if (officer && isButton && action === 'limit')
        return modal(
          'voice.limit',
          'limit',
          String(await deps.service.limit(c.guildId)),
          'saveLimit',
        );
      if (!officer && isSelect && action === 'quantity' && pick === 'other')
        return modal(
          'voice.quantity',
          'quantity',
          String(s.state.quantity),
          'saveQuantity',
        );
      if (!officer && isSelect && action === 'editQueue') {
        if (!pick || !s.state.queue[pick]) throw new VoiceError('invalid');
        return modal(
          'voice.editQuantity',
          'quantity',
          String(s.state.queue[pick]!.quantity),
          'saveQueue',
          pick,
        );
      }
      return {
        kind: 'deferred',
        ephemeral: true,
        update: true,
        run: async () => {
          try {
            await guard(c, officer);
            const models = await deps.service.templates(i, officer),
              selected = models.find((m) => m.id === arg.split('-')[0]);
            let state = { ...s.state, queue: { ...s.state.queue } };
            let notice: string | undefined;
            if (isButton && action === 'cancel') {
              await deps.service.updateSession(i, s.id, s.revision, {
                ...state,
                queue: {},
                batchId: null,
              });
              return { kind: 'deleteOriginal' };
            } else if (isSelect && action === 'pick') {
              if (!models.some((m) => m.id === pick))
                throw new VoiceError('access');
              state.selected = pick!;
            } else if (!officer && isSelect && action === 'quantity')
              state.quantity = integer(pick ?? '', 1, 10);
            else if (!officer && isModal && action === 'saveQuantity')
              state.quantity = integer(
                c.interaction.fields.quantity ?? '',
                1,
                10,
              );
            else if (!officer && isButton && action === 'addQueue') {
              const m = models.find((m) => m.id === state.selected);
              if (!m) throw new VoiceError('access');
              const old = state.queue[m.id];
              if (old && old.revision !== m.revision)
                throw new VoiceError('changed');
              state.queue[m.id] = {
                quantity: (old?.quantity ?? 0) + state.quantity,
                revision: m.revision,
              };
              if (
                queueSize(state.queue) > (await deps.service.limit(c.guildId))
              )
                throw new VoiceError('limit');
              state.selected = null;
              state.quantity = 1;
            } else if (!officer && isModal && action === 'saveQueue') {
              if (!state.queue[arg]) throw new VoiceError('invalid');
              const n = integer(c.interaction.fields.quantity ?? '', 0, 10);
              if (n === 0) delete state.queue[arg];
              else state.queue[arg] = { ...state.queue[arg]!, quantity: n };
              if (
                queueSize(state.queue) > (await deps.service.limit(c.guildId))
              )
                throw new VoiceError('limit');
            } else if (!officer && isButton && action === 'clear')
              state.queue = {};
            else if (!officer && isButton && action === 'deploy')
              return render(c, await deps.service.deploy(i, s));
            else if (
              officer &&
              isModal &&
              (action === 'saveEdit' || action === 'saveNew')
            ) {
              const [modelId, rev] = arg.split('-');
              await deps.service.saveTemplate(
                i,
                {
                  name: c.interaction.fields.channelName ?? '',
                  categoryId: c.interaction.fields.category ?? '',
                  channelName: c.interaction.fields.channelName ?? '',
                  capacity: integer(c.interaction.fields.capacity ?? '', 1, 99),
                  idleMinutes: integer(c.interaction.fields.delay ?? '', 1, 30),
                },
                action === 'saveEdit' ? modelId : undefined,
                action === 'saveEdit' ? Number(rev) : undefined,
              );
              notice = c.t('panel.saved');
            } else if (officer && isModal && action === 'saveLimit') {
              await deps.service.limit(
                c.guildId,
                integer(c.interaction.fields.limit ?? '', 1, 10),
              );
              notice = c.t('panel.saved');
            } else if (officer && isButton && action === 'removeModel') {
              if (!selected) throw new VoiceError('changed');
              state.mode = 'remove';
              state.selected = selected.id;
            } else if (officer && isButton && action === 'confirmRemove') {
              if (
                state.mode !== 'remove' ||
                !selected ||
                Number(arg.split('-')[1]) !== selected.revision
              )
                throw new VoiceError('changed');
              await deps.service.removeTemplate(
                i,
                selected.id,
                selected.revision,
              );
              state.mode = 'settings';
              state.selected = null;
              notice = c.t('panel.saved');
            } else if (officer && isButton && action === 'cancelRemove')
              state.mode = 'settings';
            else if (officer && isButton && action === 'channels') {
              state.mode = 'channels';
              state.selected = null;
            } else if (officer && isSelect && action === 'pickChannel') {
              state.selected = pick ?? null;
            } else if (officer && isButton && action === 'resolveChannel') {
              if (state.mode !== 'channels' || state.selected !== arg)
                throw new VoiceError('invalid');
              return {
                kind: 'panel',
                update: true,
                panel: {
                  components: [
                    text(c.t('voice.resolveConfirm')),
                    {
                      kind: 'buttons',
                      buttons: [
                        button(c, s, 'panel.confirm', 'confirmResolve', arg),
                        button(c, s, 'panel.cancel', 'refresh'),
                      ],
                    },
                  ],
                },
              };
            } else if (officer && isButton && action === 'confirmResolve') {
              if (state.mode !== 'channels' || state.selected !== arg)
                throw new VoiceError('invalid');
              await deps.service.resolveChannel(c.guildId, arg);
              state.selected = null;
            } else if (officer && isButton && action === 'deleteChannel') {
              if (state.mode !== 'channels' || state.selected !== arg)
                throw new VoiceError('invalid');
              await deps.service.removeChannel(c.guildId, arg);
              state.selected = null;
            } else if (isButton && action === 'back') {
              state = {
                ...state,
                mode: officer ? 'settings' : 'member',
                batchId: null,
                queue: {},
                selected: null,
              };
            } else if (!(isButton && action === 'refresh'))
              throw new VoiceError('invalid');
            return render(
              c,
              await deps.service.updateSession(i, s.id, s.revision, state),
              notice,
            );
          } catch (e) {
            return failure(c, e);
          }
        },
      };
    } catch (e) {
      return failure(c, e);
    }
  }
  function failure(c: CommandContext, error: unknown): Reply {
    if (error instanceof VoiceError)
      return ephemeral(c.t(`voice.errors.${error.reason}`));
    c.logger.warn({ err: error }, 'voice panel failed');
    return ephemeral(c.t('voice.errors.unavailable'));
  }
  async function open(
    c: CommandContext,
    settings = false,
  ): Promise<Reply> {
    const run = async (): Promise<Reply> => {
      try {
        await guard(c, settings);
        return render(
          c,
          await deps.service.session(
            identity(c),
            settings ? 'settings' : 'member',
          ),
        );
      } catch (e) {
        return failure(c, e);
      }
    };
    return { kind: 'deferred', ephemeral: true, update: false, run };
  }

  const createCommand: CommandEntry = {
    path: ['voice', 'create'],
    description: 'voice.command',
    level: 'member',
    feature: 'voice',
    handler: (c) => open(c),
  };
  const settingsCommand: CommandEntry = {
    path: ['voice', 'settings'],
    description: 'voice.settingsCommand',
    level: 'officer',
    handler: (c) => open(c, true),
  };
  const families: ComponentFamily[] = [
    {
      namespace: 'voice',
      version: 1,
      level: 'member',
      feature: 'voice',
      onComponent: handle,
      onModal: handle,
    },
    {
      namespace: 'vset',
      version: 1,
      level: 'officer',
      onComponent: handle,
      onModal: handle,
    },
  ];
  return {
    createCommand,
    settingsCommand,
    entries: [createCommand, settingsCommand],
    families,
  };
}
