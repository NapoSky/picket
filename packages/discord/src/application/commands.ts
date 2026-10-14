import type { I18n, LocalizedText, MessageKey, Translator } from '@picket/i18n';
import { DomainError, type GuildId, type Logger } from '@picket/kernel';
import type { IncomingInteraction, Reply } from './interaction';

export class RegistryError extends DomainError {
  readonly code = 'invalid_command_registry';
}

export interface CommandContext {
  readonly interaction: IncomingInteraction;
  readonly guildId: GuildId;
  readonly logger: Logger;
  /** User access level, already checked by the pipeline (useful for feature-specific rules). */
  readonly level: AccessLevel;
  /** Translator: forced guild locale, otherwise the user's locale, then English. */
  readonly t: Translator['t'];
}

export type CommandHandler = (context: CommandContext) => Promise<Reply>;

export type AccessLevel = 'member' | 'officer' | 'admin';

export const ACCESS_RANK: Readonly<Record<AccessLevel, number>> = { member: 1, officer: 2, admin: 3 };

export interface AutocompleteChoice {
  readonly name: string;
  readonly value: string;
}

export interface AutocompleteContext extends CommandContext {
  /** Currently focused option and its partial text; other completed options are in `interaction.options`. */
  readonly focused: { readonly name: string; readonly value: string };
}

/** Discord displays at most 25 suggestions; respond within 3 s, without a deferred acknowledgement. */
export type AutocompleteHandler = (context: AutocompleteContext) => Promise<readonly AutocompleteChoice[]>;

export type ChannelKind = 'text' | 'announcement';

/** Translated label (catalog key) or literal text (for example, a language name in its own language). */
export type ChoiceDescriptor =
  | { readonly name: MessageKey; readonly prefix?: string; readonly value: string }
  | { readonly label: string; readonly value: string };

export interface OptionDescriptor {
  readonly type: 'string' | 'role' | 'boolean' | 'channel' | 'user' | 'integer';
  readonly name: string;
  readonly description: MessageKey;
  readonly required?: boolean;
  /** For `string` only: fixed choices offered by Discord. */
  readonly choices?: readonly ChoiceDescriptor[];
  /** For `string` only: suggestions computed while typing (see `CommandEntry.autocomplete`). */
  readonly autocomplete?: boolean;
  /** For `integer` only. */
  readonly minValue?: number;
  readonly maxValue?: number;
  /** For `channel` only: offered channel types (all text channels by default). */
  readonly channelKinds?: readonly ChannelKind[];
}

export interface RootDescriptor {
  readonly name: string;
  readonly description: MessageKey;
  /** Subcommand groups: name -> description key. */
  readonly groups?: Readonly<Record<string, MessageKey>>;
}

export interface CommandEntry {
  /** `[root, subcommand]` or `[root, group, subcommand]` (at most 2 levels in Discord). */
  readonly path: readonly [string, string] | readonly [string, string, string];
  readonly description: MessageKey;
  /** Minimum required access level: explicit for every command, never a permissive default. */
  readonly level: AccessLevel;
  /** By default, reject commands while the guild is suspended (deletion scheduled). */
  readonly availableWhenSuspended?: boolean;
  /** Guild feature that must be enabled (for example, `todolists`). */
  readonly feature?: string;
  readonly options?: readonly OptionDescriptor[];
  /**
   * Suggestions for `autocomplete: true` options, indexed by option name (same access and feature as the
   * command).
   */
  readonly autocomplete?: Readonly<Record<string, AutocompleteHandler>>;
  readonly handler: CommandHandler;
}

const NAME_PATTERN = /^[a-z0-9_-]{1,32}$/;
const MAX_ROOTS = 100;
const MAX_CHILDREN = 25;
const MAX_OPTIONS = 25;
const MAX_CHOICES = 25;
const TEXT_MAX = 100;

function assertName(kind: string, value: string): void {
  if (!NAME_PATTERN.test(value)) throw new RegistryError(`Invalid ${kind} name "${value}"`);
}

/** Discord requires 1 to 100 characters in each language. */
function assertText(label: string, text: LocalizedText, prefix = ''): void {
  for (const [locale, value] of [['default', text.default], ...Object.entries(text.localizations)] as [string, string][]) {
    const length = prefix.length + value.length;
    if (length < 1 || length > TEXT_MAX) throw new RegistryError(`Invalid text for ${label} (${locale})`);
  }
}

/** Validate all commands at startup: conflicts must never reach production. */
export class CommandRegistry {
  readonly #roots: readonly RootDescriptor[];
  readonly #entries: readonly CommandEntry[];
  readonly #i18n: I18n;
  readonly #byPath = new Map<string, CommandEntry>();

  constructor(roots: readonly RootDescriptor[], entries: readonly CommandEntry[], i18n: I18n, aliases: readonly CommandEntry[] = []) {
    this.#i18n = i18n;
    if (roots.length > MAX_ROOTS) throw new RegistryError('Too many root commands');

    const rootsByName = new Map<string, RootDescriptor>();
    for (const root of roots) {
      assertName('root command', root.name);
      assertText(root.name, i18n.text(root.description));
      if (rootsByName.has(root.name)) throw new RegistryError(`Duplicate root command "${root.name}"`);
      for (const [group, key] of Object.entries(root.groups ?? {})) {
        assertName('group', group);
        assertText(`${root.name} ${group}`, i18n.text(key));
      }
      rootsByName.set(root.name, root);
    }

    const children = new Map<string, number>();
    for (const entry of entries) {
      const [rootName, ...rest] = entry.path;
      const root = rootsByName.get(rootName);
      if (!root) throw new RegistryError(`Unknown root command "${rootName}"`);
      for (const segment of rest) assertName('command', segment);
      const label = entry.path.join(' ');
      assertText(label, i18n.text(entry.description));
      this.#assertOptions(label, entry.options ?? []);
      this.#assertAutocomplete(label, entry);

      if (this.#byPath.has(label)) throw new RegistryError(`Duplicate command "${label}"`);

      if (entry.path.length === 3) {
        if (!(entry.path[1] in (root.groups ?? {}))) {
          throw new RegistryError(`Unknown group "${entry.path[1]}" in "${rootName}"`);
        }
      } else if (entry.path[1] in (root.groups ?? {})) {
        throw new RegistryError(`"${label}" collides with a group of the same name`);
      }

      const parent = entry.path.slice(0, -1).join(' ');
      const count = (children.get(parent) ?? 0) + 1;
      if (count > MAX_CHILDREN) throw new RegistryError(`Too many commands under "${parent}"`);
      children.set(parent, count);
      this.#byPath.set(label, entry);
    }

    this.#roots = roots;
    this.#entries = entries;
    // Transition routing only: these paths never appear in the published payload.
    for (const entry of aliases) {
      const label = entry.path.join(' ');
      if (!rootsByName.has(entry.path[0]) || this.#byPath.has(label)) throw new RegistryError(`Invalid command alias "${label}"`);
      for (const segment of entry.path) assertName('alias', segment);
      this.#byPath.set(label, entry);
    }
  }

  #assertOptions(label: string, options: readonly OptionDescriptor[]): void {
    if (options.length > MAX_OPTIONS) throw new RegistryError(`Too many options for ${label}`);
    const seen = new Set<string>();
    let optionalSeen = false;
    for (const option of options) {
      assertName('option', option.name);
      assertText(`${label} option ${option.name}`, this.#i18n.text(option.description));
      if (seen.has(option.name)) throw new RegistryError(`Duplicate option "${option.name}" for ${label}`);
      seen.add(option.name);
      // Discord rejects commands with a required option after an optional option.
      if (option.required === true && optionalSeen) {
        throw new RegistryError(`Required option "${option.name}" must precede optional ones in ${label}`);
      }
      if (option.required !== true) optionalSeen = true;
      if (option.choices !== undefined) {
        if (option.type !== 'string') throw new RegistryError(`Choices are only allowed on string options (${label})`);
        if (option.choices.length < 1 || option.choices.length > MAX_CHOICES) {
          throw new RegistryError(`Invalid number of choices for ${label} option ${option.name}`);
        }
        for (const choice of option.choices) {
          if ('label' in choice) {
            if (choice.label.length < 1 || choice.label.length > TEXT_MAX) {
              throw new RegistryError(`Invalid choice label in ${label} option ${option.name}`);
            }
          } else {
            assertText(`${label} option ${option.name} choice`, this.#i18n.text(choice.name), choice.prefix);
          }
          if (choice.value.length < 1 || choice.value.length > TEXT_MAX) {
            throw new RegistryError(`Invalid choice value in ${label} option ${option.name}`);
          }
        }
      }
      if (option.channelKinds !== undefined && option.type !== 'channel') {
        throw new RegistryError(`Channel kinds are only allowed on channel options (${label})`);
      }
      if (option.autocomplete === true) {
        if (option.type !== 'string') throw new RegistryError(`Autocomplete is only allowed on string options (${label})`);
        if (option.choices !== undefined) {
          throw new RegistryError(`Option "${option.name}" of ${label} cannot have both choices and autocomplete`);
        }
      }
      if (option.minValue !== undefined || option.maxValue !== undefined) {
        if (option.type !== 'integer') throw new RegistryError(`Value bounds are only allowed on integer options (${label})`);
        if (option.minValue !== undefined && option.maxValue !== undefined && option.minValue > option.maxValue) {
          throw new RegistryError(`Invalid value bounds for ${label} option ${option.name}`);
        }
      }
    }
  }

  /** Every `autocomplete` option needs a handler and vice versa: omissions must never reach production. */
  #assertAutocomplete(label: string, entry: CommandEntry): void {
    const declared = new Set((entry.options ?? []).filter((option) => option.autocomplete === true).map((option) => option.name));
    const handled = new Set(Object.keys(entry.autocomplete ?? {}));
    for (const name of declared) {
      if (!handled.has(name)) throw new RegistryError(`Missing autocomplete handler for option "${name}" of ${label}`);
    }
    for (const name of handled) {
      if (!declared.has(name)) throw new RegistryError(`Autocomplete handler "${name}" of ${label} has no autocomplete option`);
    }
  }

  get i18n(): I18n {
    return this.#i18n;
  }

  roots(): readonly RootDescriptor[] {
    return this.#roots;
  }

  entries(): readonly CommandEntry[] {
    return this.#entries;
  }

  resolve(path: readonly string[]): CommandEntry | undefined {
    return this.#byPath.get(path.join(' '));
  }
}
