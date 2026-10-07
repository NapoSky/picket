import { createHash } from 'node:crypto';
import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ApplicationIntegrationType,
  ChannelType,
  InteractionContextType,
  type APIApplicationCommandBasicOption,
  type APIApplicationCommandSubcommandGroupOption,
  type APIApplicationCommandSubcommandOption,
  type LocalizationMap,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord-api-types/v10';
import type { LocalizedText, MessageKey } from '@picket/i18n';
import type { CommandEntry, CommandRegistry, OptionDescriptor } from '../application/commands';

export type CommandsPayload = RESTPostAPIChatInputApplicationCommandsJSONBody[];

const byName = <T extends { readonly name: string }>(a: T, b: T): number => a.name.localeCompare(b.name);

/** Les noms de fichiers de langue sont des codes de langue Discord (contrôlé en CI). */
const localizationMap = (text: LocalizedText): LocalizationMap | undefined =>
  Object.keys(text.localizations).length > 0 ? (text.localizations as LocalizationMap) : undefined;

function describe(registry: CommandRegistry, key: MessageKey) {
  const text = registry.i18n.text(key);
  const localizations = localizationMap(text);
  return { description: text.default, ...(localizations ? { description_localizations: localizations } : {}) };
}

function toApiOption(registry: CommandRegistry, option: OptionDescriptor): APIApplicationCommandBasicOption {
  const required = option.required === true;
  const common = { name: option.name, required, ...describe(registry, option.description) };
  switch (option.type) {
    case 'string':
      // Discord interdit de combiner choix fermés et autocomplete.
      if (option.autocomplete === true) {
        return { type: ApplicationCommandOptionType.String, ...common, autocomplete: true };
      }
      return {
        type: ApplicationCommandOptionType.String,
        ...common,
        ...(option.choices
          ? {
              choices: option.choices.map((choice) => {
                if ('label' in choice) return { name: choice.label, value: choice.value };
                const translated = registry.i18n.text(choice.name);
                const prefix = choice.prefix ?? '';
                const text: LocalizedText = {
                  default: `${prefix}${translated.default}`,
                  localizations: Object.fromEntries(Object.entries(translated.localizations).map(([locale, name]) => [locale, `${prefix}${name}`])),
                };
                const localizations = localizationMap(text);
                return {
                  name: text.default,
                  ...(localizations ? { name_localizations: localizations } : {}),
                  value: choice.value,
                };
              }),
            }
          : {}),
      };
    case 'role':
      return { type: ApplicationCommandOptionType.Role, ...common };
    case 'user':
      return { type: ApplicationCommandOptionType.User, ...common };
    case 'integer':
      return {
        type: ApplicationCommandOptionType.Integer,
        ...common,
        ...(option.minValue !== undefined ? { min_value: option.minValue } : {}),
        ...(option.maxValue !== undefined ? { max_value: option.maxValue } : {}),
      };
    case 'channel':
      return {
        type: ApplicationCommandOptionType.Channel,
        ...common,
        channel_types: (option.channelKinds ?? ['text']).map((kind) =>
          kind === 'text' ? ChannelType.GuildText : ChannelType.GuildAnnouncement,
        ),
      };
    case 'boolean':
      return { type: ApplicationCommandOptionType.Boolean, ...common };
  }
}

function subcommand(registry: CommandRegistry, entry: CommandEntry): APIApplicationCommandSubcommandOption {
  const name = entry.path[entry.path.length - 1] as string;
  return {
    type: ApplicationCommandOptionType.Subcommand,
    name,
    ...describe(registry, entry.description),
    ...(entry.options && entry.options.length > 0
      ? { options: entry.options.map((option) => toApiOption(registry, option)) }
      : {}),
  };
}

/** Sortie déterministe : la même définition produit toujours le même JSON (et le même hash). */
export function buildCommandsPayload(registry: CommandRegistry): CommandsPayload {
  return [...registry.roots()].sort(byName).map((root) => {
    const entries = registry.entries().filter((entry) => entry.path[0] === root.name);
    const direct = entries
      .filter((entry) => entry.path.length === 2)
      .map((entry) => subcommand(registry, entry))
      .sort(byName);
    const groups = Object.entries(root.groups ?? {})
      .map(([name, key]): APIApplicationCommandSubcommandGroupOption => ({
        type: ApplicationCommandOptionType.SubcommandGroup,
        name,
        ...describe(registry, key),
        options: entries
          .filter((entry) => entry.path.length === 3 && entry.path[1] === name)
          .map((entry) => subcommand(registry, entry))
          .sort(byName),
      }))
      .sort(byName);

    return {
      type: ApplicationCommandType.ChatInput,
      name: root.name,
      ...describe(registry, root.description),
      contexts: [InteractionContextType.Guild],
      integration_types: [ApplicationIntegrationType.GuildInstall],
      options: [...direct, ...groups],
    };
  });
}

export function hashCommandsPayload(payload: CommandsPayload): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
