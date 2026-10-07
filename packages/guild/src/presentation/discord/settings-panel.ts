import {
  ACCESS_RANK, encodeCustomId, ephemeral,
  type CommandContext, type CommandEntry, type ComponentContext, type ComponentFamily,
  type PanelButton, type PanelContent, type PanelView, type Reply,
  type GuildRoles,
} from '@picket/discord';
import type { I18n, MessageKey } from '@picket/i18n';
import { ChannelId, RoleId, type Clock } from '@picket/kernel';
import type { GetGuildSettings, UpdateGuildSettings } from '../../application/settings-use-cases';
import type { ResolveAccess, ShowPermissions, UpdatePermissions } from '../../application/permissions-use-cases';
import type { CancelGuildDeletion, GetSuspension, RequestGuildDeletion } from '../../application/guild-lifecycle-use-cases';
import type { SettingsChange } from '../../domain/guild-settings';
import type { ExportGuildData } from '../../application/export-guild-data';
import type { AuditControl } from '../../application/publish-guild-audit';
import { everyoneRoleId, type ConfigurableLevel } from '../../domain/permissions';

const TTL_SECONDS = 15 * 60;
const VERSION = 1;
const PAGES = ['home', 'language', 'advanced', 'permissions', 'member', 'officer', 'data', 'delete', 'disable', 'everyone'] as const;
type Page = typeof PAGES[number];
type Namespace = 'psnav' | 'psedit' | 'psperm' | 'psdata' | 'psback' | 'psexport';

const PAGE_COLORS: Readonly<Record<Page, number>> = {
  home: 0x5865f2, language: 0x3498db, advanced: 0x607d8b,
  permissions: 0x9b59b6, member: 0x9b59b6, officer: 0x9b59b6,
  data: 0xf0b232, delete: 0xed4245, disable: 0xf0b232, everyone: 0xf0b232,
};
const BUTTON_ICONS: Readonly<Partial<Record<MessageKey, string>>> = {
  'panel.home': '🏠', 'panel.permissions': '🛡️', 'panel.advanced': '🛠️', 'panel.data': '🗃️',
  'panel.refresh': '🔄', 'panel.previous': '⬅️', 'panel.next': '➡️', 'panel.language': '🌐',
  'panel.enable': '▶️', 'panel.disable': '⏸️', 'panel.confirm': '✅', 'panel.cancel': '↩️',
  'panel.changeTimezone': '🕒', 'panel.clearChannel': '🧹', 'panel.member': '👥', 'panel.officer': '🛡️',
  'panel.everyone': '🌍', 'panel.restrict': '🔒', 'panel.schedule': '🗓️',
  'panel.deleteConfirm': '🗑️', 'panel.cancelDeletion': '↩️',
  'data.export': '📥',
};

export interface SettingsPanelDependencies {
  readonly settings: GetGuildSettings;
  readonly update: UpdateGuildSettings;
  readonly permissions: ShowPermissions;
  readonly updatePermissions: UpdatePermissions;
  readonly access: ResolveAccess;
  readonly suspension: GetSuspension;
  readonly request: RequestGuildDeletion;
  readonly cancel: CancelGuildDeletion;
  readonly exportData: ExportGuildData;
  readonly clock: Clock;
  readonly i18n: I18n;
  readonly guildRoles?: GuildRoles;
  readonly audit?: AuditControl;
}

function nativeName(locale: string): string {
  const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale;
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}

/** Tout l'état de navigation est dans Discord ; les écritures relisent leur état dans les use cases. */
export function createSettingsPanel(deps: SettingsPanelDependencies) {
  const now = () => Math.floor(deps.clock.now().getTime() / 1000);
  const accessRequest = (context: CommandContext) => ({ guildId: context.guildId, roleIds: context.interaction.memberRoleIds, permissions: context.interaction.memberPermissions });

  async function render(context: CommandContext, page: Page, argument = '0', notice?: MessageKey): Promise<Reply> {
    const [settings, permissions, purgeAt] = await Promise.all([
      deps.settings.execute(context.guildId), deps.permissions.execute(accessRequest(context)), deps.suspension.execute(context.guildId),
    ]);
    const { t } = deps.i18n.translator(deps.i18n.resolve(settings.locale, context.interaction.locale, context.interaction.guildLocale));
    const expires = now() + TTL_SECONDS;
    const id = (namespace: Namespace, action: string, arg = '0') => encodeCustomId(namespace, VERSION, `${context.interaction.userId}.${context.guildId}.${expires.toString(36)}.${action}.${arg}`);
    const button = (label: MessageKey, namespace: Namespace, action: string, arg = '0', style: PanelButton['style'] = 'secondary'): PanelButton => {
      const emoji = BUTTON_ICONS[label];
      return { kind: 'button', customId: id(namespace, action, arg), label: t(label), style, ...(emoji ? { emoji } : {}) };
    };
    const text = (value: string): PanelContent => ({ kind: 'text', text: value });
    const components: PanelContent[] = [text(`## ⚙️ ${t('panel.title')}`)];
    if (notice) {
      const icon = notice === 'panel.saved' ? '✅' : notice === 'panel.unchanged' || notice === 'panel.legacy' ? 'ℹ️' : '⚠️';
      components.push(text(`**${icon} ${t(notice)}**`));
    }
    if (purgeAt !== null) {
      components.push(text(`### ⏸️ ${t('panel.suspendedTitle')}\n${t('panel.suspended', { timestamp: Math.floor(purgeAt.getTime() / 1000) })}`), text(t('panel.recovery')));
      if (context.level === 'admin') {
        components.push(text(t('data.exportHelp')), text(t('panel.deletionHelp')), { kind: 'buttons', buttons: [
          button('data.export', 'psexport', 'export', '0', 'primary'),
          button('panel.cancelDeletion', 'psback', 'cancel', '0', 'success'),
        ] });
      }
      components.push({ kind: 'buttons', buttons: [button('panel.refresh', 'psnav', 'refresh', 'data')] });
      return { kind: 'panel', update: context.interaction.message !== null, panel: { components, accentColor: PAGE_COLORS.delete } };
    }
    if ((page === 'data' || page === 'delete') && context.level !== 'admin') page = 'home';
    const pagination = (current: number, total: number, target: Page) => {
      components.push(text(t('panel.page', { page: current + 1, total })));
      const buttons: PanelButton[] = [];
      if (current > 0) buttons.push(button('panel.previous', 'psnav', target, String(current - 1)));
      if (current + 1 < total) buttons.push(button('panel.next', 'psnav', target, String(current + 1)));
      if (buttons.length) components.push({ kind: 'buttons', buttons });
    };
    switch (page) {
      case 'home':
        components.push(
          text(t('panel.homeHelp')),
          { kind: 'section', text: `### 🌐 ${t('panel.language')}\n**${settings.locale === null ? t('panel.auto') : nativeName(settings.locale)}**`, button: button('panel.language', 'psnav', 'view', 'language', 'primary') },
          ...(['timers', 'todolists'] as const).map((feature): PanelContent => ({
            kind: 'section', text: `### ${feature === 'timers' ? '⏱️' : '📋'} ${t(`features.${feature}`)}\n${settings.features[feature] ? '🟢' : '⚪'} **${t(settings.features[feature] ? 'panel.enabled' : 'panel.disabled')}**\n${t(feature === 'timers' ? 'panel.timersHelp' : 'panel.todolistsHelp')}`,
            button: settings.features[feature] ? button('panel.disable', 'psnav', 'disable', feature) : button('panel.enable', 'psedit', 'enable', feature, 'success'),
          })),
          text(`🔑 ${t('panel.access', { level: t(`levels.${context.level}`) })}`),
        );
        break;
      case 'language': {
        const total = Math.max(1, Math.ceil(deps.i18n.locales.length / 24));
        const current = Math.min(Number(argument) || 0, total - 1);
        components.push(text(`### 🌐 ${t('panel.language')}\n${t('panel.languageHelp')}`), {
          kind: 'stringSelect', customId: id('psedit', 'language', String(current)), placeholder: t('panel.chooseLanguage'),
          options: [{ label: t('panel.auto'), value: 'auto', selected: settings.locale === null }, ...deps.i18n.locales.slice(current * 24, (current + 1) * 24).map((locale) => ({ label: nativeName(locale), value: locale, selected: settings.locale === locale }))],
        });
        if (total > 1) pagination(current, total, 'language');
        break;
      }
      case 'advanced':
        components.push(text(`### 🛠️ ${t('panel.advanced')}\nℹ️ ${t('panel.reserved')}`),
          { kind: 'section', text: `🕒 **${t('panel.timezone')}**\n${settings.timezone}`, button: button('panel.changeTimezone', 'psedit', 'timezone') },
          text(`📨 ${t('panel.audit', { channel: settings.auditChannelId === null ? t('status.auditMissing') : `<#${settings.auditChannelId}>` })}`), text(t('panel.auditHelp')),
          { kind: 'channelSelect', customId: id('psedit', 'channel'), placeholder: t('panel.chooseChannel') },
          ...(settings.auditFailure ? [text(t('audit.paused'))] : []),
          { kind: 'buttons', buttons: [button('panel.clearChannel', 'psedit', 'clearChannel'), ...(deps.audit && settings.auditChannelId ? [button('audit.testButton', 'psedit', 'auditTest', '0', 'primary')] : [])] }, text(`🚧 **${t('panel.soon')}**`),
        );
        break;
      case 'permissions':
        components.push(text(`### 🛡️ ${t('panel.permissions')}\n${t('panel.adminImplicit')}`));
        if (context.level !== 'admin') components.push(text(`🔒 ${t('panel.readOnly')}`));
        for (const level of ['member', 'officer'] as const) {
          components.push({ kind: 'section', text: `${level === 'member' ? '👥' : '🛡️'} **${t(`panel.${level}`)}**\n${t('panel.roleCount', { count: permissions.config[level].length })}`, button: button(`panel.${level}`, 'psnav', 'view', level, 'primary') });
        }
        break;
      case 'member':
      case 'officer': {
        const roles = permissions.config[page];
        const total = Math.max(1, Math.ceil(roles.length / 25));
        const current = Math.min(Number(argument) || 0, total - 1);
        const visible = roles.slice(current * 25, (current + 1) * 25);
        let names: Readonly<Record<string, string>> = {};
        try { names = await deps.guildRoles?.names(context.guildId) ?? {}; }
        catch (error) { context.logger.warn({ err: error }, 'panel role names unavailable'); }
        const roleName = (role: RoleId) => role === everyoneRoleId(context.guildId) ? '@everyone' : `<@&${role}>`;
        components.push(text(`### ${page === 'member' ? '👥' : '🛡️'} ${t(`panel.${page}`)}\n${visible.length ? visible.map(roleName).join(', ') : t('panel.rolesEmpty')}\n${t('panel.adminImplicit')}`));
        if (page === 'officer' && roles.length === 0) components.push(text(`ℹ️ ${t('permissions.warnings.no_officer_role')}`));
        if (context.level === 'admin') {
          components.push({ kind: 'roleSelect', customId: id('psperm', 'add', page), placeholder: t('panel.addRole') });
          if (visible.length) components.push({ kind: 'stringSelect', customId: id('psperm', 'remove', page), placeholder: t('panel.removeRole'), options: visible.map((role) => ({ label: role === everyoneRoleId(context.guildId) ? '@everyone' : names[role] ?? t('panel.roleLabel', { id: role }), value: role })) });
          if (page === 'member') {
            const open = roles.includes(everyoneRoleId(context.guildId));
            components.push(text(`ℹ️ ${t('panel.restrictHelp')}`), { kind: 'buttons', buttons: [open ? button('panel.restrict', 'psperm', 'restrict') : button('panel.everyone', 'psnav', 'view', 'everyone')] });
          }
        } else components.push(text(`🔒 ${t('panel.readOnly')}`));
        if (total > 1) pagination(current, total, page);
        break;
      }
      case 'everyone':
        components.push(text(`### 🌍 ${t('panel.everyoneTitle')}\n${t('panel.everyoneHelp')}`));
        if (context.level === 'admin') components.push({ kind: 'buttons', buttons: [button('panel.confirm', 'psperm', 'everyone', '0', 'danger'), button('panel.cancel', 'psnav', 'cancel', 'member')] });
        break;
      case 'disable': {
        if (argument !== 'timers' && argument !== 'todolists') return ephemeral(t('settings.invalidOption'));
        components.push(text(`### ⏸️ ${t('panel.disableTitle', { feature: t(`features.${argument}`) })}\n${t('panel.disableHelp')}`), { kind: 'buttons', buttons: [button('panel.confirm', 'psedit', 'disable', argument, 'danger'), button('panel.cancel', 'psnav', 'cancel', 'home')] });
        break;
      }
      case 'data':
      case 'delete':
        if (page === 'data') components.push(text(`### 🗃️ ${t('panel.data')}`), text(t('data.exportHelp')), {
          kind: 'buttons', buttons: [button('data.export', 'psexport', 'export', '0', 'primary')],
        }, { kind: 'separator' });
        components.push(text(`### 🗑️ ${t(page === 'delete' ? 'panel.deleteTitle' : 'panel.schedule')}\n${t('panel.deletionHelp')}`), text(`🗓️ ${t('panel.deletionDate', { timestamp: Math.floor(deps.request.previewPurgeAt().getTime() / 1000) })}`), {
          kind: 'buttons', buttons: page === 'delete'
            ? [button('panel.deleteConfirm', 'psdata', 'delete', '0', 'danger'), button('panel.cancel', 'psnav', 'cancel', 'data')]
            : [button('panel.schedule', 'psnav', 'view', 'delete', 'danger')],
        });
        break;
    }
    const activeTab = page === 'language' || page === 'disable' ? 'home'
      : page === 'member' || page === 'officer' || page === 'everyone' ? 'permissions'
      : page === 'delete' ? 'data' : page;
    const tab = (target: 'home' | 'permissions' | 'advanced' | 'data') => button(`panel.${target}`, 'psnav', 'view', target, activeTab === target ? 'primary' : 'secondary');
    components.push({ kind: 'separator' }, { kind: 'buttons', buttons: [
      tab('home'), tab('permissions'), tab('advanced'),
      ...(context.level === 'admin' ? [tab('data')] : []),
      button('panel.refresh', 'psnav', page === 'disable' ? 'disable' : 'refresh', page === 'disable' ? argument : page),
    ] });
    return { kind: 'panel', update: context.interaction.message !== null, panel: { components, accentColor: PAGE_COLORS[page] } satisfies PanelView };
  }

  const open = (page: Page = 'home', legacy = false) => async (context: CommandContext): Promise<Reply> => ({
    kind: 'deferred', ephemeral: true, update: false, run: () => render(context, page, '0', legacy ? 'panel.legacy' : undefined),
  });

  function handler(namespace: Namespace) {
    return async (context: ComponentContext): Promise<Reply> => {
      const [owner, guild, expiry, action, argument, extra] = context.payload.split('.');
      if (owner !== context.interaction.userId) return ephemeral(context.t('panel.owner'));
      const expires = parseInt(expiry ?? '', 36);
      if (guild !== context.guildId || !Number.isSafeInteger(expires) || expires <= now() || expires > now() + TTL_SECONDS || extra !== undefined || !action || !argument || context.interaction.message === null) return ephemeral(context.t('panel.expired'));
      if (namespace === 'psedit' && action === 'timezone') {
        if (context.interaction.kind !== 'component' || context.interaction.componentKind !== 'button') return ephemeral(context.t('settings.invalidOption'));
        const settings = await deps.settings.execute(context.guildId);
        return { kind: 'modal', customId: encodeCustomId('psedit', VERSION, `${owner}.${guild}.${expiry}.timezoneSubmit.0`), title: context.t('panel.changeTimezone'), inputs: [{ customId: 'timezone', label: context.t('panel.timezone'), style: 'short', required: true, maxLength: 64, value: settings.timezone, placeholder: 'Europe/Paris' }] };
      }
      return {
        kind: 'deferred', ephemeral: true, update: true,
        run: async () => {
          // Le travail différé ne conserve pas une autorisation devenue obsolète entre-temps.
          const required = namespace === 'psnav' || namespace === 'psedit' ? 'officer' : 'admin';
          const level = await deps.access.execute(accessRequest(context));
          if (level === null || ACCESS_RANK[level] < ACCESS_RANK[required]) return ephemeral(context.t('errors.denied', { level: context.t(`levels.${required}`) }));
          context = { ...context, level };
          if (namespace === 'psexport' && action === 'export' && context.interaction.componentKind === 'button') {
            const result = await deps.exportData.execute(context.guildId, context.interaction.attachmentSizeLimit);
            if (result.kind === 'too_large') return ephemeral(context.t('data.exportTooLarge', { limitMb: Math.round(result.maxBytes / (1024 * 1024) * 10) / 10 }));
            return { kind: 'file', ephemeral: true, content: context.t('data.exportReady'), file: { filename: result.filename, bytes: result.bytes } };
          }
          if (namespace !== 'psnav' && namespace !== 'psback' && await deps.suspension.execute(context.guildId) !== null) return render(context, 'data');
          if (namespace === 'psnav') {
            if (context.interaction.componentKind !== 'button') return ephemeral(context.t('settings.invalidOption'));
            if (['view', 'refresh', 'cancel'].includes(action) && PAGES.includes(argument as Page)) return render(context, argument as Page);
            if (action === 'disable' && (argument === 'timers' || argument === 'todolists')) return render(context, 'disable', argument);
            if (['language', 'member', 'officer'].includes(action) && /^\d{1,6}$/.test(argument)) return render(context, action as Page, argument);
          }
          if (namespace === 'psedit') {
            if (action === 'auditTest' && context.interaction.componentKind === 'button' && deps.audit) {
              const result = await deps.audit.test(context.guildId, context.interaction.userId);
              const notice = { queued: 'audit.queued', no_channel: 'audit.noChannel', blocked: 'audit.blocked', unavailable: 'audit.unavailable' } as const;
              return render(context, 'advanced', '0', notice[result]);
            }
            let change: SettingsChange | null = null;
            let page: Page = 'advanced';
            const selected = context.interaction.selectedValues;
            if (action === 'language' && context.interaction.componentKind === 'stringSelect' && selected.length === 1) {
              change = { kind: 'language', locale: selected[0] === 'auto' ? null : selected[0]! }; page = 'language';
            } else if (action === 'timezoneSubmit' && context.interaction.kind === 'modal') {
              const value = context.interaction.fields.timezone;
              if (typeof value === 'string') change = { kind: 'timezone', timezone: value };
            } else if (action === 'channel' && context.interaction.componentKind === 'channelSelect' && selected.length === 1) {
              const value = selected[0]!;
              const channel = ChannelId.parse(value);
              const resolved = context.interaction.resolvedChannels[value];
              if (channel.ok && (resolved?.kind === 'text' || resolved?.kind === 'announcement')) change = { kind: 'audit_channel', channelId: channel.value };
            } else if (action === 'clearChannel' && context.interaction.componentKind === 'button') change = { kind: 'audit_channel', channelId: null };
            else if ((action === 'enable' || action === 'disable') && (argument === 'timers' || argument === 'todolists') && context.interaction.componentKind === 'button') {
              change = { kind: 'feature', feature: argument, enabled: action === 'enable' }; page = 'home';
            }
            if (change === null) return render(context, page, '0', 'settings.invalidOption');
            if (change.kind === 'audit_channel' && change.channelId !== null && deps.audit) {
              try {
                if ((await deps.audit.inspect(context.guildId, change.channelId)).kind === 'blocked') return render(context, page, '0', 'audit.blocked');
              } catch { return render(context, page, '0', 'audit.unavailable'); }
            }
            const result = await deps.update.execute({ guildId: context.guildId, actorId: context.interaction.userId, change });
            const notice: MessageKey = result.kind === 'rejected' ? result.reason === 'invalid_timezone' ? 'settings.rejected.invalidTimezone' : 'settings.rejected.unsupportedLanguage' : result.kind === 'unchanged' ? 'panel.unchanged' : 'panel.saved';
            return render(context, page, page === 'language' ? argument : '0', notice);
          }
          if (namespace === 'psperm') {
            let target: ConfigurableLevel = argument === 'officer' ? 'officer' : 'member';
            let role: RoleId | null = null;
            const permissionAction: 'add' | 'remove' = action === 'remove' || action === 'restrict' ? 'remove' : 'add';
            if ((action === 'add' || action === 'remove') && (argument === 'member' || argument === 'officer') && context.interaction.selectedValues.length === 1) {
              const value = context.interaction.selectedValues[0]!;
              const parsed = RoleId.parse(value);
              const kindValid = action === 'add' ? context.interaction.componentKind === 'roleSelect' && context.interaction.resolvedRoles[value] !== undefined : context.interaction.componentKind === 'stringSelect';
              if (parsed.ok && kindValid) role = parsed.value;
            } else if ((action === 'everyone' || action === 'restrict') && context.interaction.componentKind === 'button') {
              role = everyoneRoleId(context.guildId); target = 'member';
            }
            if (role === null) return render(context, 'permissions', '0', 'settings.invalidOption');
            const result = await deps.updatePermissions.execute({ guildId: context.guildId, actorId: context.interaction.userId, change: { level: target, roleId: role, action: permissionAction, confirmed: action === 'everyone' } });
            if (result.kind === 'confirmation_required') return render(context, 'everyone');
            return render(context, target, '0', result.kind === 'rejected' ? 'permissions.set.everyoneNotOfficer' : result.kind === 'unchanged' ? 'panel.unchanged' : 'panel.saved');
          }
          if (namespace === 'psdata' && action === 'delete' && context.interaction.componentKind === 'button') {
            await deps.request.execute(context.guildId, context.interaction.userId);
            return render(context, 'data', '0', 'panel.saved');
          }
          if (namespace === 'psback' && action === 'cancel' && context.interaction.componentKind === 'button') {
            const changed = await deps.cancel.execute(context.guildId, context.interaction.userId);
            return render(context, 'data', '0', changed ? 'data.cancelled' : 'data.nothingScheduled');
          }
          return ephemeral(context.t('settings.invalidOption'));
        },
      };
    };
  }
  const command: CommandEntry = { path: ['picket', 'settings'], description: 'commands.picket.settings.description', level: 'officer', availableWhenSuspended: true, handler: open() };
  const families: ComponentFamily[] = [
    { namespace: 'psnav', version: VERSION, level: 'officer', availableWhenSuspended: true, onComponent: handler('psnav') },
    { namespace: 'psedit', version: VERSION, level: 'officer', onComponent: handler('psedit'), onModal: handler('psedit') },
    { namespace: 'psperm', version: VERSION, level: 'admin', onComponent: handler('psperm') },
    { namespace: 'psdata', version: VERSION, level: 'admin', onComponent: handler('psdata') },
    { namespace: 'psback', version: VERSION, level: 'admin', availableWhenSuspended: true, onComponent: handler('psback') },
    { namespace: 'psexport', version: VERSION, level: 'admin', availableWhenSuspended: true, onComponent: handler('psexport') },
  ];
  const aliases: CommandEntry[] = [
    ...['language', 'timezone', 'audit-channel', 'feature'].map((name): CommandEntry => ({ path: ['picket', 'settings', name], description: command.description, level: 'officer', availableWhenSuspended: true, handler: open(name === 'language' ? 'language' : name === 'feature' ? 'home' : 'advanced', true) })),
    { path: ['picket', 'permissions', 'set'], description: command.description, level: 'admin', availableWhenSuspended: true, handler: open('permissions', true) },
    ...['delete', 'cancel-deletion'].map((name): CommandEntry => ({ path: ['picket', 'data', name], description: command.description, level: 'admin', availableWhenSuspended: true, handler: open('data', true) })),
  ];
  return { command, families, aliases };
}
