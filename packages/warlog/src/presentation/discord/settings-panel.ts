import { ACCESS_RANK, encodeCustomId, ephemeral, type AccessPolicy, type CommandContext, type CommandEntry, type ComponentContext, type ComponentFamily, type GuildGate, type PanelButton, type PanelContent, type Reply, type RootDescriptor } from '@picket/discord';
import { WAR_REGION_NAMES, WAR_ZONES, WAR_ZONE_KEYS, type WarZone } from '@picket/game-data';
import { ChannelId, type Clock } from '@picket/kernel';
import type { ConfigureWarLog } from '../../application/settings';
import type { SettingsChange, WarStore } from '../../application/ports';

export const WARLOG_ROOT: RootDescriptor = { name: 'warlog', description: 'commands.warlog.description' };
const TTL = 15 * 60;
export function createWarLogSettingsPanel(deps: { store: WarStore; configure: ConfigureWarLog; clock: Clock; access: AccessPolicy; gate: GuildGate; settingsHome?: (context: CommandContext) => PanelButton }) {
  const now = () => Math.floor(deps.clock.now().getTime() / 1000);
  async function guard(context: CommandContext): Promise<Reply | null> {
    const [level, suspended] = await Promise.all([deps.access.levelOf(context.interaction, context.guildId), deps.gate.suspensionOf(context.guildId)]);
    if (level === null || ACCESS_RANK[level] < ACCESS_RANK.officer) return ephemeral(context.t('errors.denied', { level: context.t('levels.officer') }));
    if (suspended) return ephemeral(context.t('errors.suspended', { date: suspended.purgeAt.toISOString().slice(0, 10) }));
    return null;
  }
  async function render(context: CommandContext, notice?: string, fromSettings = false): Promise<Reply> {
    const [sub, state] = await Promise.all([deps.store.subscription(context.guildId), deps.store.state()]);
    const war = state.snapshot?.war.number ?? 0;
    const enabled = !sub.paused && sub.confirmedWar === war;
    const id = (action: string, arg = '0') => encodeCustomId('wl', 1, `${context.interaction.userId}.${context.guildId}.${(now() + TTL).toString(36)}.${action}.${arg}.${war}${fromSettings ? '.p' : ''}`);
    const t = context.t;
    const components: PanelContent[] = [
      { kind: 'text', text: `## 📡 ${t('warlog.title')}\n${t('warlog.help')}` },
      ...(notice ? [{ kind: 'text' as const, text: notice }] : []),
      { kind: 'text', text: `${enabled ? '🟢' : '⚪'} **${t(enabled ? 'panel.enabled' : 'panel.disabled')}**\n${t('warlog.channel')}: ${sub.channelId ? `<#${sub.channelId}>` : t('levels.none')}` },
      { kind: 'channelSelect', customId: id('channel'), placeholder: t('warlog.chooseChannel'), channelKinds: ['text'] },
      { kind: 'text', text: t('warlog.perspectiveHelp') },
      { kind: 'buttons', buttons: (['NONE', 'COLONIALS', 'WARDENS'] as const).map(perspective => ({ kind: 'button', customId: id('perspective', perspective), label: t(perspective === 'NONE' ? 'warlog.neutralPerspective' : `warlog.factions.${perspective}`), style: sub.perspective === perspective ? perspective === 'WARDENS' ? 'primary' : 'success' : 'secondary' })) },
      { kind: 'text', text: t('warlog.chooseZones', { selected: sub.zones.length }) },
      { kind: 'buttons', buttons: WAR_ZONE_KEYS.map((zone, index) => ({ kind: 'button', customId: id('zone', String(index)), label: t(`warlog.zones.${zone}`), style: sub.zones.includes(zone) ? 'success' : 'secondary', disabled: !sub.zones.includes(zone) && sub.zones.length >= 3 })) },
      { kind: 'buttons', buttons: [{ kind: 'button', customId: id('coverage'), label: t('warlog.zoneContents'), style: 'secondary' }] },
      { kind: 'text', text: t('warlog.renewHelp') },
      ...(sub.failureReason ? [{ kind: 'text' as const, text: t('warlog.deliveryBlocked') }] : []),
      { kind: 'buttons', buttons: [
        { kind: 'button', customId: id(enabled ? 'disable' : 'enable'), label: t(enabled ? 'panel.disable' : 'warlog.confirm'), style: enabled ? 'secondary' : 'success' },
        { kind: 'button', customId: id('refresh'), label: t('panel.refresh'), style: 'secondary' },
        ...(fromSettings && deps.settingsHome ? [deps.settingsHome(context)] : []),
      ] },
    ];
    return { kind: 'panel', update: context.interaction.message !== null, panel: { components, accentColor: 0x435768 } };
  }
  const open = async (context: CommandContext, fromSettings = false): Promise<Reply> => await guard(context) ?? render(context, undefined, fromSettings);
  const command: CommandEntry = { path: ['warlog', 'settings'], level: 'officer', description: 'commands.warlog.settings.description', handler: async context => ({
    kind: 'deferred', ephemeral: true, update: false, run: () => open(context),
  }) };
  const handler = async (context: ComponentContext): Promise<Reply> => {
    const [owner, guild, expires, action, arg, expectedWar, origin, extra] = context.payload.split('.');
    const fromSettings = origin === 'p';
    if (owner !== context.interaction.userId) return ephemeral(context.t('panel.owner'));
    const expiry = parseInt(expires ?? '', 36);
    if (guild !== context.guildId || !/^[a-z0-9]+$/.test(expires ?? '') || !Number.isSafeInteger(expiry) || expiry <= now() || expiry > now() + TTL || extra !== undefined || (origin !== undefined && !fromSettings) || !action || !arg || !/^\d+$/.test(expectedWar ?? '') || context.interaction.message === null || context.interaction.message.channelId !== context.interaction.channelId) return ephemeral(context.t('panel.expired'));
    return { kind: 'deferred', ephemeral: true, update: true, run: async () => {
      if (expiry <= now()) return ephemeral(context.t('panel.expired'));
      const denied = await guard(context); if (denied) return denied;
      const interaction = context.interaction;
      if (action === 'refresh' && interaction.componentKind === 'button') return render(context, undefined, fromSettings);
      if (action === 'coverage' && interaction.componentKind === 'button') return {
        kind: 'panel', update: true, panel: { accentColor: 0x435768, components: [
          { kind: 'text', text: `## 🗺️ ${context.t('warlog.zoneContents')}` },
          ...WAR_ZONE_KEYS.map((zone): PanelContent => ({ kind: 'text', text: `### ${context.t(`warlog.zones.${zone}`)}\n${WAR_ZONES[zone].map(region => WAR_REGION_NAMES[region] ?? region).join(' · ')}` })),
          { kind: 'buttons', buttons: [
            { kind: 'button', customId: encodeCustomId('wl', 1, `${owner}.${guild}.${expires}.refresh.0.${expectedWar}${fromSettings ? '.p' : ''}`), label: context.t('warlog.backToSettings'), style: 'secondary' },
            ...(fromSettings && deps.settingsHome ? [deps.settingsHome(context)] : []),
          ] },
        ] },
      };
      let change: SettingsChange | null = null;
      if (action === 'channel' && interaction.componentKind === 'channelSelect' && interaction.selectedValues.length === 1) {
        const value = interaction.selectedValues[0]!;
        const parsed = ChannelId.parse(value);
        if (parsed.ok && interaction.resolvedChannels[value]?.kind === 'text') change = { kind: 'channel', channelId: parsed.value, locale: interaction.guildLocale ?? interaction.locale };
      }
      if (interaction.componentKind === 'button') {
        if (action === 'disable') change = { kind: 'disable' };
        if (action === 'enable') change = { kind: 'enable', war: Number(expectedWar) };
        if (action === 'perspective' && (arg === 'NONE' || arg === 'COLONIALS' || arg === 'WARDENS')) change = { kind: 'perspective', perspective: arg };
        if (action === 'zone' && /^[0-4]$/.test(arg)) {
          const zone = WAR_ZONE_KEYS[Number(arg)]!;
          const current = await deps.store.subscription(context.guildId);
          const zones: WarZone[] = current.zones.includes(zone) ? current.zones.filter(value => value !== zone) : [...current.zones, zone];
          change = { kind: 'zones', zones };
        }
      }
      if (!change) return render(context, context.t('settings.invalidOption'), fromSettings);
      const result = await deps.configure.execute(context.guildId, interaction.userId, change);
      return render(context, context.t(`warlog.results.${result}`), fromSettings);
    } };
  };
  const family: ComponentFamily = { namespace: 'wl', version: 1, level: 'officer', onComponent: handler };
  return { command, family, open };
}
