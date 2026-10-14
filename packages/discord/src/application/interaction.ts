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
import type { PanelView } from './panel';
import type { ReplyFile } from './messaging';

export type InteractionKind = 'command' | 'component' | 'modal' | 'autocomplete';

export type OptionValue = string | number | boolean;

/** Message containing the clicked component. */
export interface MessageRef {
  readonly id: MessageId;
  readonly channelId: ChannelId;
}

/** Normalized interaction: no `discord-api-types` types escape this boundary. */
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
  /** Discord attachment size limit for the response. */
  readonly attachmentSizeLimit: number;
  /** `[root, group?, subcommand?]` for commands or autocomplete, otherwise empty. */
  readonly commandPath: readonly string[];
  /** Command option values (excluding subcommands and groups). */
  readonly options: Readonly<Record<string, OptionValue>>;
  /** For autocomplete: focused option name (its partial value is in `options`). */
  readonly focusedOption: string | null;
  readonly customId: string | null;
  /** Clicked message, or source message for a modal opened from a component. */
  readonly message: MessageRef | null;
  /** For a modal: entered value per field (field `custom_id`). */
  readonly fields: Readonly<Record<string, string>>;
  readonly componentKind: 'button' | 'stringSelect' | 'roleSelect' | 'channelSelect' | null;
  readonly selectedValues: readonly string[];
  readonly resolvedRoles: Readonly<Record<string, { readonly name: string }>>;
  readonly resolvedChannels: Readonly<Record<string, { readonly kind: 'text' | 'announcement' | 'voice' | 'stage' | 'other' }>>;
}

export interface ModalInput {
  readonly customId: string;
  readonly label: string;
  readonly placeholder?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly required?: boolean;
  /** Prefilled field value. */
  readonly value?: string;
  /** `paragraph` : saisie multiligne. */
  readonly style: 'short' | 'paragraph';
}

export type Reply =
  | { readonly kind: 'message'; readonly content: string; readonly ephemeral: boolean }
  | { readonly kind: 'panel'; readonly panel: PanelView; readonly update: boolean }
  | { readonly kind: 'file'; readonly content: string; readonly file: ReplyFile; readonly ephemeral: true }
  | { readonly kind: 'autocomplete'; readonly choices: readonly { readonly name: string; readonly value: string }[] }
  | { readonly kind: 'modal'; readonly customId: string; readonly title: string; readonly inputs: readonly ModalInput[] }
  | {
      /**
       * Immediate acknowledgement (3 s), then background work. With `update`, acknowledge a component click
       * without changing its message. A `panel` result with `update` updates that same message; text results use
       * an ephemeral follow-up. For a command, replace the loading response with the result. `null` means there is
       * nothing to say.
       */
      readonly kind: 'deferred';
      readonly ephemeral: boolean;
      readonly update: boolean;
      readonly run: () => Promise<Reply | null>;
    };

export const ephemeral = (content: string): Reply => ({ kind: 'message', content, ephemeral: true });
