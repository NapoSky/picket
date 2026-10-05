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
  /** Traducteur : langue du serveur si elle est imposée, sinon celle de l'utilisateur, puis l'anglais. */
  readonly t: Translator['t'];
}

export type CommandHandler = (context: CommandContext) => Promise<Reply>;

export type AccessLevel = 'member' | 'officer' | 'admin';

export const ACCESS_RANK: Readonly<Record<AccessLevel, number>> = { member: 1, officer: 2, admin: 3 };

export type ChannelKind = 'text' | 'announcement';

/** Libellé traduit (clé de catalogue) ou littéral (par exemple le nom d'une langue dans sa propre langue). */
export type ChoiceDescriptor =
  | { readonly name: MessageKey; readonly value: string }
  | { readonly label: string; readonly value: string };

export interface OptionDescriptor {
  readonly type: 'string' | 'role' | 'boolean' | 'channel';
  readonly name: string;
  readonly description: MessageKey;
  readonly required?: boolean;
  /** Uniquement pour `string` : liste fermée de valeurs proposées par Discord. */
  readonly choices?: readonly ChoiceDescriptor[];
  /** Uniquement pour `channel` : types de canaux proposés (tous les canaux de texte par défaut). */
  readonly channelKinds?: readonly ChannelKind[];
}

export interface RootDescriptor {
  readonly name: string;
  readonly description: MessageKey;
  /** Groupes de sous-commandes : nom -> clé de description. */
  readonly groups?: Readonly<Record<string, MessageKey>>;
}

export interface CommandEntry {
  /** `[racine, sous-commande]` ou `[racine, groupe, sous-commande]` (2 niveaux maximum côté Discord). */
  readonly path: readonly [string, string] | readonly [string, string, string];
  readonly description: MessageKey;
  /** Niveau minimal requis : explicite pour chaque commande, jamais de valeur par défaut permissive. */
  readonly level: AccessLevel;
  /** Par défaut une commande est refusée pendant la suspension d'une guilde (suppression programmée). */
  readonly availableWhenSuspended?: boolean;
  /** Fonctionnalité de la guilde qui doit être activée (par exemple `todolists`). */
  readonly feature?: string;
  readonly options?: readonly OptionDescriptor[];
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

/** Discord impose 1 à 100 caractères, dans chaque langue. */
function assertText(label: string, text: LocalizedText): void {
  for (const [locale, value] of [['default', text.default], ...Object.entries(text.localizations)] as [string, string][]) {
    if (value.length < 1 || value.length > TEXT_MAX) throw new RegistryError(`Invalid text for ${label} (${locale})`);
  }
}

/** Valide l'ensemble des commandes au démarrage : un conflit ne doit jamais atteindre la production. */
export class CommandRegistry {
  readonly #roots: readonly RootDescriptor[];
  readonly #entries: readonly CommandEntry[];
  readonly #i18n: I18n;
  readonly #byPath = new Map<string, CommandEntry>();

  constructor(roots: readonly RootDescriptor[], entries: readonly CommandEntry[], i18n: I18n) {
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
      // Discord rejette une commande dont une option requise suit une option facultative.
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
            assertText(`${label} option ${option.name} choice`, this.#i18n.text(choice.name));
          }
          if (choice.value.length < 1 || choice.value.length > TEXT_MAX) {
            throw new RegistryError(`Invalid choice value in ${label} option ${option.name}`);
          }
        }
      }
      if (option.channelKinds !== undefined && option.type !== 'channel') {
        throw new RegistryError(`Channel kinds are only allowed on channel options (${label})`);
      }
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
