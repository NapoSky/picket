import type {
  ApplicationId,
  ChannelId,
  GuildId,
  InteractionId,
  MessageId,
  RoleId,
  Secret,
  UserId,
} from '@picket/kernel';

export type InteractionKind = 'command' | 'component' | 'modal' | 'autocomplete';

export type OptionValue = string | number | boolean;

/** Message qui porte le composant cliqué. */
export interface MessageRef {
  readonly id: MessageId;
  readonly channelId: ChannelId;
}

/** Interaction normalisée : aucun type `discord-api-types` n'en sort. */
export interface IncomingInteraction {
  readonly id: InteractionId;
  readonly kind: InteractionKind;
  readonly applicationId: ApplicationId;
  readonly token: Secret;
  readonly guildId: GuildId | null;
  readonly channelId: ChannelId | null;
  readonly userId: UserId;
  readonly locale: string;
  readonly guildLocale: string | null;
  readonly memberRoleIds: readonly RoleId[];
  readonly memberPermissions: bigint | null;
  readonly appPermissions: bigint | null;
  /** `[racine, groupe?, sous-commande?]` pour une commande ou un autocomplete, sinon vide. */
  readonly commandPath: readonly string[];
  /** Valeurs des options de la commande (hors sous-commandes et groupes). */
  readonly options: Readonly<Record<string, OptionValue>>;
  /** Pour un autocomplete : nom de l'option en cours de saisie (sa valeur partielle est dans `options`). */
  readonly focusedOption: string | null;
  readonly customId: string | null;
  /** Pour un composant : le message cliqué. */
  readonly message: MessageRef | null;
  /** Pour une modale : valeur saisie par champ (`custom_id` du champ). */
  readonly fields: Readonly<Record<string, string>>;
}

export interface ModalInput {
  readonly customId: string;
  readonly label: string;
  readonly placeholder?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly required?: boolean;
  /** Valeur préremplie du champ. */
  readonly value?: string;
  /** `paragraph` : saisie multiligne. */
  readonly style: 'short' | 'paragraph';
}

export type Reply =
  | { readonly kind: 'message'; readonly content: string; readonly ephemeral: boolean }
  | { readonly kind: 'autocomplete'; readonly choices: readonly { readonly name: string; readonly value: string }[] }
  | { readonly kind: 'modal'; readonly customId: string; readonly title: string; readonly inputs: readonly ModalInput[] }
  | {
      /**
       * Accusé immédiat (3 s) puis travail en tâche de fond. `update` : le clic d'un composant est acquitté
       * sans changer le message (le travail le modifie lui-même). Le résultat est livré en suivi éphémère
       * (`update`) ou remplace la réponse d'attente ; `null` : rien à dire.
       */
      readonly kind: 'deferred';
      readonly ephemeral: boolean;
      readonly update: boolean;
      readonly run: () => Promise<Reply | null>;
    };

export const ephemeral = (content: string): Reply => ({ kind: 'message', content, ephemeral: true });
