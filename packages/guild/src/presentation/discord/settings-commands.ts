import { ephemeral, type ChoiceDescriptor, type CommandEntry } from '@picket/discord';
import { ChannelId } from '@picket/kernel';
import type { UpdateGuildSettings } from '../../application/settings-use-cases';
import { FEATURES, type SettingsChange, type SettingsRejection } from '../../domain/guild-settings';

export const AUTO_LANGUAGE = 'auto';

/** Nom de la langue dans sa propre langue, avec une majuscule initiale. */
function nativeName(locale: string): string {
  const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale;
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}

const REJECTION_KEYS = {
  unsupported_language: 'settings.rejected.unsupportedLanguage',
  invalid_timezone: 'settings.rejected.invalidTimezone',
} as const satisfies Record<SettingsRejection, string>;

export function settingsCommands(deps: { update: UpdateGuildSettings; locales: readonly string[] }): CommandEntry[] {
  const languageChoices: ChoiceDescriptor[] = [
    { name: 'settings.language.auto', value: AUTO_LANGUAGE },
    ...deps.locales.map((locale) => ({ label: nativeName(locale), value: locale })),
  ];

  const language: CommandEntry = {
    path: ['picket', 'settings', 'language'],
    description: 'commands.picket.settings.language.description',
    level: 'officer',
    options: [
      {
        type: 'string',
        name: 'language',
        description: 'commands.picket.settings.language.options.language.description',
        required: true,
        choices: languageChoices,
      },
    ],
    handler: async ({ interaction, guildId, t }) => {
      const value = interaction.options.language;
      if (typeof value !== 'string') return ephemeral(t('settings.invalidOption'));
      const locale = value === AUTO_LANGUAGE ? null : value;
      const decision = await deps.update.execute({
        guildId,
        actorId: interaction.userId,
        change: { kind: 'language', locale },
      });
      const shown = locale === null ? t('settings.language.auto') : nativeName(locale);
      if (decision.kind === 'rejected') return ephemeral(t(REJECTION_KEYS[decision.reason]));
      return ephemeral(t(decision.kind === 'apply' ? 'settings.language.changed' : 'settings.unchanged', { value: shown }));
    },
  };

  const timezone: CommandEntry = {
    path: ['picket', 'settings', 'timezone'],
    description: 'commands.picket.settings.timezone.description',
    level: 'officer',
    options: [
      {
        type: 'string',
        name: 'timezone',
        description: 'commands.picket.settings.timezone.options.timezone.description',
        required: true,
      },
    ],
    handler: async ({ interaction, guildId, t }) => {
      const value = interaction.options.timezone;
      if (typeof value !== 'string') return ephemeral(t('settings.invalidOption'));
      const decision = await deps.update.execute({
        guildId,
        actorId: interaction.userId,
        change: { kind: 'timezone', timezone: value },
      });
      if (decision.kind === 'rejected') return ephemeral(t(REJECTION_KEYS[decision.reason]));
      if (decision.kind === 'unchanged') return ephemeral(t('settings.unchanged', { value: value.trim() }));
      return ephemeral(t('settings.timezone.changed', { value: decision.next.timezone }));
    },
  };

  const auditChannel: CommandEntry = {
    path: ['picket', 'settings', 'audit-channel'],
    description: 'commands.picket.settings.auditChannel.description',
    level: 'officer',
    options: [
      {
        type: 'channel',
        name: 'channel',
        description: 'commands.picket.settings.auditChannel.options.channel.description',
        channelKinds: ['text', 'announcement'],
      },
    ],
    handler: async ({ interaction, guildId, t }) => {
      const raw = interaction.options.channel;
      let channelId: ChannelId | null = null;
      if (raw !== undefined) {
        const parsed = ChannelId.parse(raw);
        if (!parsed.ok) return ephemeral(t('settings.invalidOption'));
        channelId = parsed.value;
      }
      const decision = await deps.update.execute({
        guildId,
        actorId: interaction.userId,
        change: { kind: 'audit_channel', channelId },
      });
      if (decision.kind === 'rejected') return ephemeral(t(REJECTION_KEYS[decision.reason]));
      const shown = channelId === null ? t('status.auditMissing') : `<#${channelId}>`;
      return ephemeral(t(decision.kind === 'apply' ? 'settings.auditChannel.changed' : 'settings.unchanged', { value: shown }));
    },
  };

  const feature: CommandEntry = {
    path: ['picket', 'settings', 'feature'],
    description: 'commands.picket.settings.feature.description',
    level: 'officer',
    options: [
      {
        type: 'string',
        name: 'feature',
        description: 'commands.picket.settings.feature.options.feature.description',
        required: true,
        choices: [
          { name: 'features.timers', value: 'timers' },
          { name: 'features.todolists', value: 'todolists' },
          { name: 'features.warlog', value: 'warlog' },
        ],
      },
      {
        type: 'boolean',
        name: 'enabled',
        description: 'commands.picket.settings.feature.options.enabled.description',
        required: true,
      },
    ],
    handler: async ({ interaction, guildId, t }) => {
      const { feature: name, enabled } = interaction.options;
      const known = FEATURES.find((candidate) => candidate === name);
      if (known === undefined || typeof enabled !== 'boolean') return ephemeral(t('settings.invalidOption'));
      const change: SettingsChange = { kind: 'feature', feature: known, enabled };
      const decision = await deps.update.execute({ guildId, actorId: interaction.userId, change });
      if (decision.kind === 'rejected') return ephemeral(t(REJECTION_KEYS[decision.reason]));
      const feature = t(`features.${known}`);
      if (decision.kind === 'unchanged') {
        return ephemeral(t(enabled ? 'settings.feature.alreadyEnabled' : 'settings.feature.alreadyDisabled', { feature }));
      }
      return ephemeral(t(enabled ? 'settings.feature.enabled' : 'settings.feature.disabled', { feature }));
    },
  };

  return [language, timezone, auditChannel, feature];
}
