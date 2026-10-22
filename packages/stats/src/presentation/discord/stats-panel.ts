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
  type GuildRoles,
  type PanelButton,
  type PanelContent,
  type Reply,
  type RootDescriptor,
} from '@picket/discord';
import { RoleId, type Clock } from '@picket/kernel';
import type { UpdatePermissions } from '@picket/guild';
import type { MessageKey } from '@picket/i18n';
import { exportActivity } from '../../application/activity-export';
import { validTargets } from '../../domain/model';
import type { DurableVoiceBuffer, StatsPanelStore } from '../../application/store';

export const STATS_ROOT: RootDescriptor = { name: 'stats', description: 'stats.commands.root' };
export interface StatsPanelDependencies {
  readonly store: StatsPanelStore;
  readonly buffer: DurableVoiceBuffer;
  readonly access: AccessPolicy;
  readonly gate: GuildGate;
  readonly clock: Clock;
  readonly updatePermissions: Pick<UpdatePermissions, 'execute'>;
  readonly guildRoles?: GuildRoles;
  readonly dashboardUrl?: string | null;
  readonly settingsHome?: (context: CommandContext) => PanelButton;
}

export function createStatsPanel(deps: StatsPanelDependencies) {
  const ttl = 900;
  const now = () => Math.floor(deps.clock.now().getTime() / 1000);
  const id = (context: CommandContext, namespace: string, action: string, fromSettings = false) =>
    encodeCustomId(
      namespace,
      1,
      `${context.interaction.userId}.${context.guildId}.${(now() + ttl).toString(36)}.${action}${fromSettings ? '.p' : ''}`,
    );
  const button = (
    context: CommandContext,
    label: MessageKey,
    namespace: string,
    action: string,
    style: PanelButton['style'] = 'secondary',
    fromSettings = false,
  ): PanelButton => ({
    kind: 'button',
    customId: id(context, namespace, action, fromSettings),
    label: context.t(label),
    style,
  });
  async function settings(context: CommandContext, notice?: MessageKey, fromSettings = false, rolePage = 0): Promise<Reply> {
    const config = await deps.store.config(context.guildId);
    const valid = validTargets(context.guildId, config.roles);
    const pages = Math.max(1, Math.ceil(config.roles.length / 25));
    const page = Math.min(rolePage, pages - 1);
    const visibleRoles = [...config.roles].sort().slice(page * 25, (page + 1) * 25);
    const components: PanelContent[] = [
      { kind: 'text', text: `## 📊 ${context.t('stats.title')}\n${context.t('stats.help')}` },
      {
        kind: 'text',
        text: `${config.enabled ? '🟢' : '⚪'} **${context.t(config.enabled ? 'panel.enabled' : 'panel.disabled')}**\n${context.t('stats.roles')}: ${visibleRoles.map((r) => (r === context.guildId ? '@everyone' : `<@&${r}>`)).join(', ') || context.t('panel.rolesEmpty')}`,
      },
    ];
    if (notice) components.push({ kind: 'text', text: context.t(notice) });
    if (!valid) components.push({ kind: 'text', text: context.t('stats.invalidRoles') });
    components.push({ kind: 'text', text: context.t('stats.sharedRoles') });
    if (context.level === 'admin') {
      components.push({ kind: 'text', text: context.t('stats.rolesHelp') });
      components.push({
        kind: 'roleSelect',
        customId: id(context, 'ssroles', 'add', fromSettings),
        placeholder: context.t('panel.addRole'),
      });
      if (visibleRoles.length) {
        let names: Readonly<Record<string, string>> = {};
        try { names = await deps.guildRoles?.names(context.guildId) ?? {}; }
        catch (error) { context.logger.warn({ err: error }, 'stats role names unavailable'); }
        components.push({
          kind: 'stringSelect',
          customId: id(context, 'ssroles', 'remove', fromSettings),
          placeholder: context.t('panel.removeRole'),
          options: visibleRoles.map((role, index) => ({
            label: role === context.guildId ? '@everyone' : names[role] || `${context.t('stats.unknownRole')} ${page * 25 + index + 1}`,
            value: role,
          })),
        });
      }
    } else components.push({ kind: 'text', text: context.t('stats.adminRoles') });
    if (pages > 1) {
      components.push({ kind: 'text', text: context.t('panel.page', { page: page + 1, total: pages }) });
      components.push({ kind: 'buttons', buttons: [
        { ...button(context, 'panel.previous', 'ssnav', `roles${Math.max(0, page - 1)}`, 'secondary', fromSettings), disabled: page === 0 },
        { ...button(context, 'panel.next', 'ssnav', `roles${Math.min(pages - 1, page + 1)}`, 'secondary', fromSettings), disabled: page === pages - 1 },
      ] });
    }
    components.push(
      {
        kind: 'text',
        text: `${context.t('stats.exclusions')}: ${config.excludedChannels.map((c) => `<#${c}>`).join(', ') || context.t('stats.none')}\n${context.t('stats.afk')}`,
      },
      {
        kind: 'channelSelect',
        customId: id(context, 'ssnav', 'exclude', fromSettings),
        placeholder: context.t('stats.chooseChannels'),
        channelKinds: ['voice', 'stage'],
        maxValues: 25,
      },
    );
    const toggle = button(
      context,
      config.enabled ? 'panel.disable' : 'panel.enable',
      'ssnav',
      config.enabled ? 'disable' : 'enable',
      config.enabled ? 'danger' : 'success',
      fromSettings,
    );
    components.push({
      kind: 'buttons',
      buttons: [
        { ...toggle, disabled: !valid && !config.enabled },
        button(context, 'stats.clearChannels', 'ssnav', 'clear', 'secondary', fromSettings),
        button(context, 'panel.refresh', 'ssnav', 'refresh', 'secondary', fromSettings),
        ...(fromSettings && deps.settingsHome ? [deps.settingsHome(context)] : []),
      ],
    });
    if (deps.dashboardUrl)
      components.push({ kind: 'text', text: `[${context.t('stats.dashboard')}](${deps.dashboardUrl})` });
    return {
      kind: 'panel',
      update: context.interaction.message !== null,
      panel: { components, accentColor: 0x6f9cc9 },
    };
  }
  async function privacy(context: CommandContext, confirm = false, notice?: MessageKey): Promise<Reply> {
    const optedOut =
      (await deps.store.privacy(context.guildId, context.interaction.userId)) ||
      ((await deps.buffer.isExcluded?.(context.guildId, context.interaction.userId)) ?? false);
    const components: PanelContent[] = [
      {
        kind: 'text',
        text: `## 🔒 ${context.t('stats.privacyTitle')}\n${context.t('stats.privacyHelp')}\n**${context.t(optedOut ? 'stats.optedOut' : 'stats.tracked')}**`,
      },
    ];
    if (notice) components.push({ kind: 'text', text: context.t(notice) });
    if (confirm)
      components.push(
        { kind: 'text', text: context.t('stats.eraseHelp') },
        {
          kind: 'buttons',
          buttons: [
            button(context, 'stats.erase', 'sspriv', 'eraseConfirm', 'danger'),
            button(context, 'panel.cancel', 'sspriv', 'view'),
          ],
        },
      );
    else
      components.push({
        kind: 'buttons',
        buttons: [
          button(context, optedOut ? 'stats.optIn' : 'stats.optOut', 'sspriv', optedOut ? 'optIn' : 'optOut'),
          button(context, 'stats.erase', 'sspriv', 'erase', 'danger'),
        ],
      });
    return {
      kind: 'panel',
      update: context.interaction.message !== null,
      panel: { components, accentColor: 0x8aa07a },
    };
  }
  const open = async (context: CommandContext, fromSettings = false): Promise<Reply> => settings(context, undefined, fromSettings);
  function handler(namespace: 'ssnav' | 'ssroles' | 'sspriv') {
    return async (context: ComponentContext): Promise<Reply> => {
      const [owner, guild, expiry, action, origin, extra] = context.payload.split('.');
      const fromSettings = origin === 'p';
      if (owner !== context.interaction.userId) return ephemeral(context.t('panel.owner'));
      const expires = parseInt(expiry ?? '', 36);
      if (
        guild !== context.guildId ||
        extra !== undefined ||
        (origin !== undefined && (!fromSettings || namespace === 'sspriv')) ||
        !/^[a-z0-9]+$/.test(expiry ?? '') ||
        !Number.isSafeInteger(expires) ||
        expires <= now() ||
        expires > now() + ttl ||
        !action ||
        context.interaction.message === null ||
        context.interaction.message.channelId !== context.interaction.channelId
      )
        return ephemeral(context.t('panel.expired'));
      return {
        kind: 'deferred',
        ephemeral: true,
        update: true,
        run: async () => {
          if (expires <= now()) return ephemeral(context.t('panel.expired'));
          const required = namespace === 'sspriv' ? 'member' : namespace === 'ssroles' ? 'admin' : 'officer';
          const level = await deps.access.levelOf(context.interaction, context.guildId);
          if (level === null || ACCESS_RANK[level] < ACCESS_RANK[required])
            return ephemeral(context.t('errors.denied', { level: context.t(`levels.${required}`) }));
          if (await deps.gate.suspensionOf(context.guildId))
            return ephemeral(context.t('errors.featureDisabled'));
          context = { ...context, level };
          if (namespace === 'sspriv') {
            if (action === 'erase') return privacy(context, true);
            if (action === 'eraseConfirm') {
              const optedOut =
                (await deps.store.privacy(context.guildId, owner)) ||
                ((await deps.buffer.isExcluded?.(context.guildId, owner)) ?? false);
              await deps.store.setPrivacy(context.guildId, owner, optedOut, true);
              await deps.buffer.erase(context.guildId, owner);
              return privacy(context, false, 'stats.erased');
            }
            if (action === 'optIn' || action === 'optOut') {
              if (action === 'optOut') await deps.buffer.setExcluded?.(context.guildId, owner, true);
              await deps.store.setPrivacy(context.guildId, owner, action === 'optOut', false);
              if (action === 'optIn') await deps.buffer.setExcluded?.(context.guildId, owner, false);
              return privacy(context, false, 'panel.saved');
            }
            return privacy(context);
          }
          if (namespace === 'ssroles') {
            const selected = context.interaction.selectedValues;
            const role = RoleId.parse(selected[0]);
            const adding = action === 'add' && context.interaction.componentKind === 'roleSelect';
            const removing = action === 'remove' && context.interaction.componentKind === 'stringSelect';
            if (selected.length !== 1 || !role.ok || (!adding && !removing))
              return settings(context, 'settings.invalidOption', fromSettings);
            if (adding && (String(role.value) === context.guildId || !context.interaction.resolvedRoles[role.value]))
              return settings(context, 'stats.invalidRoles', fromSettings);
            if (removing && !(await deps.store.config(context.guildId)).roles.includes(role.value))
              return settings(context, 'panel.unchanged', fromSettings);
            const result = await deps.updatePermissions.execute({
              guildId: context.guildId,
              actorId: context.interaction.userId,
              change: { level: 'member', roleId: role.value, action: adding ? 'add' : 'remove', confirmed: false },
            });
            return settings(context, result.kind === 'apply' ? 'panel.saved' : result.kind === 'unchanged' ? 'panel.unchanged' : 'stats.invalidRoles', fromSettings);
          }
          if (namespace === 'ssnav') {
            if (/^roles(0|[1-9]\d*)$/.test(action) && context.interaction.componentKind === 'button') {
              const page = Number(action.slice(5));
              if (Number.isSafeInteger(page)) return settings(context, undefined, fromSettings, page);
            }
            if (action === 'exclude' && context.interaction.componentKind === 'channelSelect') {
              const channels = context.interaction.selectedValues;
              if (
                channels.length > 25 ||
                channels.some(
                  (c) => !['voice', 'stage'].includes(context.interaction.resolvedChannels[c]?.kind ?? ''),
                )
              )
                return settings(context, 'settings.invalidOption', fromSettings);
              await deps.store.configure(context.guildId, owner, { excludedChannels: channels });
              return settings(context, 'panel.saved', fromSettings);
            }
            if (action === 'clear') {
              await deps.store.configure(context.guildId, owner, { excludedChannels: [] });
              return settings(context, 'panel.saved', fromSettings);
            }
            if (action === 'enable' || action === 'disable') {
              const result = await deps.store.configure(context.guildId, owner, {
                enabled: action === 'enable',
              });
              return settings(context, result === 'invalid_roles' ? 'stats.invalidRoles' : 'panel.saved', fromSettings);
            }
            if (action === 'refresh') return settings(context, undefined, fromSettings);
          }
          return ephemeral(context.t('settings.invalidOption'));
        },
      };
    };
  }
  const command: CommandEntry = {
    path: ['stats', 'settings'],
    description: 'stats.commands.settings',
    level: 'officer',
    handler: async (context) => ({
      kind: 'deferred',
      ephemeral: true,
      update: false,
      run: () => open(context),
    }),
  };
  const entries: CommandEntry[] = [
    command,
    {
      path: ['stats', 'link'],
      description: 'stats.commands.link',
      level: 'member',
      handler: async (context) =>
        ephemeral(
          deps.dashboardUrl
            ? `[${context.t('stats.dashboard')}](${deps.dashboardUrl})`
            : context.t('stats.noDashboard'),
        ),
    },
    {
      path: ['stats', 'privacy'],
      description: 'stats.commands.privacy',
      level: 'member',
      handler: async (context) => ({
        kind: 'deferred',
        ephemeral: true,
        update: false,
        run: () => privacy(context),
      }),
    },
    {
      path: ['stats', 'status'],
      description: 'stats.commands.status',
      level: 'officer',
      handler: async (context) => ({
        kind: 'deferred',
        ephemeral: true,
        update: false,
        run: async () => {
          const config = await deps.store.config(context.guildId);
          return ephemeral(
            `${context.t('stats.title')} · ${context.t(config.enabled ? 'panel.enabled' : 'panel.disabled')}\n${context.t('stats.retention')}\n${context.t('stats.roles')}: ${config.roles.map((r) => `<@&${r}>`).join(', ') || context.t('stats.none')}`,
          );
        },
      }),
    },
    {
      path: ['stats', 'export'],
      description: 'stats.commands.export',
      level: 'officer',
      options: [
        { type: 'integer', name: 'days', description: 'stats.commands.days', minValue: 1, maxValue: 60 },
        {
          type: 'string',
          name: 'format',
          description: 'stats.commands.format',
          choices: [
            { label: 'CSV', value: 'csv' },
            { label: 'JSON', value: 'json' },
          ],
        },
      ],
      handler: async (context) => ({
        kind: 'deferred',
        ephemeral: true,
        update: false,
        run: async () => {
          const level = await deps.access.levelOf(context.interaction, context.guildId);
          if (level === null || ACCESS_RANK[level] < ACCESS_RANK.officer)
            return ephemeral(context.t('errors.denied', { level: context.t('levels.officer') }));
          const days = context.interaction.options.days ?? 7;
          const format = context.interaction.options.format ?? 'csv';
          if (
            typeof days !== 'number' ||
            days < 1 ||
            days > 60 ||
            !Number.isInteger(days) ||
            !['csv', 'json'].includes(String(format))
          )
            return ephemeral(context.t('settings.invalidOption'));
          const to = deps.clock.now();
          const data = await deps.store.report(
            { kind: 'guild', guildId: context.guildId, userId: context.interaction.userId },
            { from: new Date(to.getTime() - days * 86_400_000), to },
          );
          if (data.truncated) return ephemeral(context.t('stats.exportTooLarge'));
          const content = exportActivity(data.users, format as 'json' | 'csv');
          return {
            kind: 'file',
            ephemeral: true,
            content: context.t('stats.exportReady'),
            file: {
              filename: `picket-voice-${context.guildId}.${format}`,
              bytes: new TextEncoder().encode(content),
            },
          };
        },
      }),
    },
  ];
  const families: ComponentFamily[] = [
    { namespace: 'ssnav', version: 1, level: 'officer', onComponent: handler('ssnav') },
    { namespace: 'ssroles', version: 1, level: 'admin', onComponent: handler('ssroles') },
    { namespace: 'sspriv', version: 1, level: 'member', onComponent: handler('sspriv') },
  ];
  return { command, entries, families, open };
}
