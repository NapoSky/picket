import {
  ACCESS_RANK, encodeCustomId, ephemeral,
  type AccessPolicy, type CommandContext, type CommandEntry, type ComponentContext, type ComponentFamily,
  type FeatureGate, type GuildGate, type GuildRoles, type PanelButton, type PanelContent, type Reply,
} from '@picket/discord';
import type { MessageKey } from '@picket/i18n';
import { RoleId, type Clock } from '@picket/kernel';
import type { GetBoardSettings, UpdateBoardSettings } from '../../application/timer-use-cases';
import type { SettingsError, SettingsPatch } from '../../domain/board-settings';
import { MAX_ACTIVE_PER_BOARD, MAX_ALERT_ROLES, MAX_ALERT_THRESHOLDS, MAX_PURGE_HOURS, MIN_THRESHOLD_MIN } from '../../domain/constants';
import { formatDuration, parseThresholds } from '../../domain/duration';

const NAMESPACE = 'ts';
const VERSION = 1;
const TTL_SECONDS = 15 * 60;
type Page = 'home' | 'alerts' | 'manage' | 'off' | 'all' | 'purge';
type Current = NonNullable<Awaited<ReturnType<GetBoardSettings['execute']>>>;

export interface TimerSettingsPanelDependencies {
  readonly getSettings: GetBoardSettings;
  readonly updateSettings: UpdateBoardSettings;
  readonly access: AccessPolicy;
  readonly gate: GuildGate;
  readonly features: FeatureGate;
  readonly clock: Clock;
  readonly guildRoles?: GuildRoles;
}

/** UUID en base 36 : lie les interactions au tableau, même si son canal est réutilisé après suppression. */
const boardKey = (id: string) => BigInt(`0x${id.replace(/-/gu, '')}`).toString(36);
const text = (value: string): PanelContent => ({ kind: 'text', text: value });

export function createTimerSettingsPanel(deps: TimerSettingsPanelDependencies): { command: CommandEntry; family: ComponentFamily } {
  const now = () => Math.floor(deps.clock.now().getTime() / 1000);

  async function guard(context: CommandContext): Promise<Reply | null> {
    const [level, enabled, suspension] = await Promise.all([
      deps.access.levelOf(context.interaction, context.guildId),
      deps.features.isEnabled(context.guildId, 'timers'),
      deps.gate.suspensionOf(context.guildId),
    ]);
    if (level === null || ACCESS_RANK[level] < ACCESS_RANK.officer) return ephemeral(context.t('errors.denied', { level: context.t('levels.officer') }));
    if (!enabled) return ephemeral(context.t('errors.featureDisabled'));
    if (suspension !== null) return ephemeral(context.t('errors.suspended', { date: suspension.purgeAt.toISOString().slice(0, 10) }));
    return null;
  }

  const currentFor = (context: CommandContext) => context.interaction.channelId === null
    ? Promise.resolve(null) : deps.getSettings.execute(context.guildId, context.interaction.channelId);

  async function render(context: CommandContext, current: Current, page: Page = 'home', notice?: string, argument = '0'): Promise<Reply> {
    const { t } = context;
    const { board, activeCount } = current;
    const settings = board.settings;
    const id = (action: string, arg = '0') => encodeCustomId(NAMESPACE, VERSION,
      `${context.interaction.userId}.${boardKey(board.id)}.${(now() + TTL_SECONDS).toString(36)}.${action}.${arg}`);
    const button = (label: MessageKey, action: string, arg = '0', style: PanelButton['style'] = 'secondary', emoji?: string): PanelButton => ({
      kind: 'button', customId: id(action, arg), label: t(label), style, ...(emoji ? { emoji } : {}),
    });
    const thresholds = settings.alertThresholdsMin.map((minutes) => formatDuration(minutes * 60)).join(', ');
    const purge = settings.purgeAfterHours === null ? t('timers.settings.never') : t('timers.settings.purgeAfter', { hours: settings.purgeAfterHours });
    const components: PanelContent[] = [text(`## ⏱️ ${t('timers.panel.title')}\n<#${board.channelId}> · **${activeCount}/${MAX_ACTIVE_PER_BOARD}** ${t('timers.panel.active')}`)];
    if (notice) components.push(text(notice));
    switch (page) {
      case 'home':
        components.push(text(t('timers.panel.help')),
          { kind: 'section', text: `### 🔔 ${t('timers.panel.alerts')}\n${settings.alertsEnabled ? '🟢' : '⚪'} **${t(settings.alertsEnabled ? 'timers.settings.on' : 'timers.settings.off')}** · ${thresholds}\n${t(settings.alertSilent ? 'timers.settings.silent' : 'timers.settings.notifying')}`, button: button('timers.panel.configure', 'jump', 'alerts', 'primary') },
          { kind: 'section', text: `### 🛡️ ${t('timers.panel.manage')}\n${t(settings.restrictChanges ? 'timers.settings.changesRestricted' : 'timers.settings.changesEveryone')}\n${t('timers.panel.purgeSummary', { purge })}`, button: button('timers.panel.configure', 'jump', 'manage', 'primary') },
          text(`🔄 ${t(board.needsSync || board.syncError !== null ? 'timers.panel.syncPending' : 'timers.settings.syncOk')}`));
        break;
      case 'alerts': {
        components.push(text(`### 🔔 ${t('timers.panel.alerts')}\n${t('timers.panel.alertsHelp')}`),
          { kind: 'section', text: `${settings.alertsEnabled ? '🟢' : '⚪'} **${t(settings.alertsEnabled ? 'timers.settings.on' : 'timers.settings.off')}**`, button: settings.alertsEnabled ? button('panel.disable', 'view', 'off') : button('panel.enable', 'alrt', '1', 'success') },
          { kind: 'section', text: `🕒 **${t('timers.panel.thresholds')}**\n${thresholds}`, button: button('timers.panel.edit', 'form', 'thres', 'primary') },
          { kind: 'section', text: `🔊 **${t('timers.panel.notifications')}**\n${t(settings.alertSilent ? 'timers.settings.silent' : 'timers.settings.notifying')}\n${t('timers.panel.notificationsHelp')}`, button: settings.alertSilent ? button('timers.panel.notify', 'quiet', '0') : button('timers.panel.makeSilent', 'quiet', '1') },
          text(`👥 **${t('timers.panel.roles')}**\n${settings.alertRoleIds.length ? settings.alertRoleIds.map((role) => `<@&${role}>`).join(', ') : t('timers.settings.none')}\n${t('timers.panel.rolesHelp', { max: MAX_ALERT_ROLES })}`),
          { kind: 'roleSelect', customId: id('add'), placeholder: t('panel.addRole') });
        if (settings.alertRoleIds.length) {
          let names: Readonly<Record<string, string>> = {};
          try { names = await deps.guildRoles?.names(context.guildId) ?? {}; }
          catch (error) { context.logger.warn({ err: error }, 'timer panel role names unavailable'); }
          components.push({ kind: 'stringSelect', customId: id('del'), placeholder: t('panel.removeRole'), options: settings.alertRoleIds.map((role) => ({ value: role, label: role === context.guildId.toString() ? '@everyone' : names[role] ?? t('panel.roleLabel', { id: role }) })) },
            { kind: 'buttons', buttons: [button('timers.panel.clearRoles', 'clear')] });
        }
        break;
      }
      case 'manage':
        components.push(text(`### 🛡️ ${t('timers.panel.manage')}`),
          { kind: 'section', text: `👤 **${t('timers.panel.changes')}**\n${t(settings.restrictChanges ? 'timers.settings.changesRestricted' : 'timers.settings.changesEveryone')}\n${t('timers.panel.changesHelp')}`, button: settings.restrictChanges ? button('timers.panel.allowEveryone', 'guard', '0') : button('timers.panel.ownersOnly', 'guard', '1') },
          { kind: 'section', text: `🧹 **${t('timers.panel.purge')}**\n${purge}\n${t('timers.panel.purgeHelp')}`, button: button('timers.panel.edit', 'form', 'purge', 'primary') },
          text(`🚧 **${t('timers.panel.war')}**\n${t('timers.panel.warHelp')}`));
        break;
      case 'off':
        components.push(text(`### ⏸️ ${t('timers.panel.disableTitle')}\n${t('timers.panel.disableHelp')}`), { kind: 'buttons', buttons: [button('panel.confirm', 'alrt', '0', 'danger'), button('panel.cancel', 'back', 'alerts')] });
        break;
      case 'all':
        components.push(text(`### 👥 @everyone\n${t('timers.panel.everyoneHelp')}`), { kind: 'buttons', buttons: [button('panel.confirm', 'every', '0', 'danger'), button('panel.cancel', 'back', 'alerts')] });
        break;
      case 'purge':
        components.push(text(`### 🧹 ${t('timers.panel.purge')}\n${t('timers.panel.purgeConfirm', { hours: Number(argument) })}`), { kind: 'buttons', buttons: [button('panel.confirm', 'purge', argument, 'danger'), button('panel.cancel', 'back', 'manage')] });
        break;
    }
    const activePage = page === 'off' || page === 'all' ? 'alerts' : page === 'purge' ? 'manage' : page;
    components.push({ kind: 'separator' }, { kind: 'buttons', buttons: [
      button('panel.home', 'view', 'home', activePage === 'home' ? 'primary' : 'secondary', '🏠'),
      button('timers.panel.alerts', 'view', 'alerts', activePage === 'alerts' ? 'primary' : 'secondary', '🔔'),
      button('timers.panel.manage', 'view', 'manage', activePage === 'manage' ? 'primary' : 'secondary', '🛡️'),
      button('panel.refresh', 'fresh', activePage, 'secondary', '🔄'),
    ] });
    return { kind: 'panel', update: context.interaction.message !== null, panel: { components, accentColor: ['off', 'all', 'purge'].includes(page) ? 0xf0b232 : page === 'alerts' ? 0x3498db : page === 'manage' ? 0x9b59b6 : 0x5865f2 } };
  }

  function errorText(error: SettingsError, context: CommandContext): string {
    switch (error) {
      case 'invalid_thresholds': return context.t('timers.settings.invalidThresholds', { max: MAX_ALERT_THRESHOLDS, min: MIN_THRESHOLD_MIN });
      case 'invalid_purge': return context.t('timers.settings.invalidPurge', { max: MAX_PURGE_HOURS });
      case 'too_many_roles': return context.t('timers.settings.tooManyRoles', { max: MAX_ALERT_ROLES });
      case 'invalid_role': return context.t('timers.settings.invalidRole');
    }
  }

  const command: CommandEntry = {
    path: ['timers', 'settings'], description: 'commands.timers.settings.description', level: 'officer', feature: 'timers',
    handler: async (context) => ({ kind: 'deferred', ephemeral: true, update: false, run: async () => {
      const denied = await guard(context);
      if (denied) return denied;
      const current = await currentFor(context);
      if (!current) return ephemeral(context.t('timers.errors.noBoard'));
      // Les options d'une ancienne définition Discord ouvrent le panneau sans exécuter leur modification.
      return render(context, current, 'home', Object.keys(context.interaction.options).length ? context.t('timers.panel.legacy') : undefined);
    } }),
  };

  async function handler(context: ComponentContext): Promise<Reply> {
    const { interaction, t } = context;
    const [owner, board, expiry, action, argument, extra] = context.payload.split('.');
    if (owner !== interaction.userId) return ephemeral(t('panel.owner'));
    const expires = /^[a-z0-9]+$/u.test(expiry ?? '') ? parseInt(expiry!, 36) : NaN;
    if (!board || !action || !argument || extra !== undefined || !Number.isSafeInteger(expires) || expires <= now() || expires > now() + TTL_SECONDS || interaction.message === null || interaction.channelId !== interaction.message.channelId) return ephemeral(t('timers.panel.expired'));

    const load = async (): Promise<Current | Reply> => {
      if (expires <= now()) return ephemeral(t('timers.panel.expired'));
      const denied = await guard(context);
      if (denied) return denied;
      const current = await currentFor(context);
      if (!current) return ephemeral(t('timers.errors.noBoard'));
      return boardKey(current.board.id) === board ? current : ephemeral(t('timers.panel.expired'));
    };
    if (action === 'form' && interaction.kind === 'component' && interaction.componentKind === 'button' && (argument === 'thres' || argument === 'purge')) {
      const current = await load();
      if ('kind' in current) return current;
      const thresholds = argument === 'thres';
      return { kind: 'modal', customId: encodeCustomId(NAMESPACE, VERSION, `${owner}.${board}.${expiry}.${argument}.0`), title: t(thresholds ? 'timers.panel.thresholds' : 'timers.panel.purge'), inputs: [{
        customId: 'value', label: t(thresholds ? 'timers.panel.thresholdInput' : 'timers.panel.purgeInput'), style: 'short', required: true, maxLength: thresholds ? 100 : 4,
        value: thresholds ? current.board.settings.alertThresholdsMin.map((minutes) => formatDuration(minutes * 60)).join(', ') : String(current.board.settings.purgeAfterHours ?? 0),
        placeholder: thresholds ? '6h, 2h, 30m' : '24',
      }] };
    }
    return { kind: 'deferred', ephemeral: true, update: true, run: async () => {
      const current = await load();
      if ('kind' in current) return current;
      const invalid = (page: Page = 'home') => render(context, current, page, `⚠️ ${t('settings.invalidOption')}`);
      if (['view', 'fresh', 'jump', 'back'].includes(action) && interaction.componentKind === 'button' && ['home', 'alerts', 'manage', 'off'].includes(argument)) return render(context, current, argument as Page);
      let patch: SettingsPatch | null = null;
      let page: Page = 'alerts';
      if (interaction.kind === 'component' && interaction.componentKind === 'button') {
        if ((action === 'alrt' || action === 'quiet' || action === 'guard') && (argument === '0' || argument === '1')) {
          if (action === 'alrt') patch = { alertsEnabled: argument === '1' };
          if (action === 'quiet') patch = { alertSilent: argument === '1' };
          if (action === 'guard') { patch = { restrictChanges: argument === '1' }; page = 'manage'; }
        } else if (action === 'clear') patch = { alertRole: { action: 'clear' } };
        else if (action === 'every') patch = { alertRole: { action: 'add', roleId: RoleId.assert(context.guildId.toString()) } };
        else if (action === 'purge' && /^\d{1,3}$/u.test(argument)) { patch = { purgeAfterHours: Number(argument) }; page = 'manage'; }
      } else if (interaction.kind === 'component' && interaction.selectedValues.length === 1) {
        const value = interaction.selectedValues[0]!;
        if ((action === 'add' && interaction.componentKind === 'roleSelect') || (action === 'del' && interaction.componentKind === 'stringSelect')) {
          const role = RoleId.parse(value);
          if (!role.ok || (action === 'add' && interaction.resolvedRoles[value] === undefined)) return invalid('alerts');
          if (action === 'add' && deps.guildRoles) {
            try { if ((await deps.guildRoles.names(context.guildId))[value] === undefined) return render(context, current, 'alerts', `⚠️ ${t('timers.settings.invalidRole')}`); }
            catch { return render(context, current, 'alerts', `⚠️ ${t('timers.panel.rolesUnavailable')}`); }
          }
          if (action === 'add' && value === context.guildId.toString()) return render(context, current, 'all');
          patch = { alertRole: { action: action === 'add' ? 'add' : 'remove', roleId: role.value } };
        }
      } else if (interaction.kind === 'modal' && typeof interaction.fields.value === 'string') {
        const value = interaction.fields.value.trim();
        if (action === 'thres') {
          const parsed = parseThresholds(value);
          if (!parsed.ok) return render(context, current, 'alerts', `⚠️ ${errorText('invalid_thresholds', context)}`);
          patch = { alertThresholdsMin: parsed.value };
        }
        if (action === 'purge') {
          if (!/^\d{1,4}$/u.test(value) || Number(value) > MAX_PURGE_HOURS) return render(context, current, 'manage', `⚠️ ${errorText('invalid_purge', context)}`);
          const hours = Number(value);
          if (hours > 0 && hours !== current.board.settings.purgeAfterHours) return render(context, current, 'purge', undefined, String(hours));
          patch = { purgeAfterHours: hours }; page = 'manage';
        }
      }
      if (patch === null) return invalid();
      const result = await deps.updateSettings.execute({ guildId: context.guildId, channelId: current.board.channelId, boardId: current.board.id, actor: interaction.userId, patch });
      if (result.kind === 'no_board') return ephemeral(t('timers.errors.noBoard'));
      const notice = result.kind === 'invalid' ? `⚠️ ${errorText(result.error, context)}` : `✅ ${t(result.kind === 'unchanged' ? 'timers.settings.unchanged' : 'timers.settings.updated')}${result.kind === 'updated' && !result.sync.synced ? `\n⚠️ ${t('timers.panel.syncPending')}` : ''}`;
      const latest = await currentFor(context);
      return latest && boardKey(latest.board.id) === board ? render(context, latest, page, notice) : ephemeral(t('timers.panel.expired'));
    } };
  }

  return { command, family: { namespace: NAMESPACE, version: VERSION, level: 'officer', feature: 'timers', onComponent: handler, onModal: handler } };
}
