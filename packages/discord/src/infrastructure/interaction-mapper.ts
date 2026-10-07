import {
  ApplicationCommandOptionType,
  InteractionType,
  type APIInteraction,
} from 'discord-api-types/v10';
import {
  ApplicationId,
  ChannelId,
  DomainError,
  GuildId,
  InteractionId,
  MessageId,
  RoleId,
  Secret,
  UserId,
  err,
  ok,
  type Result,
} from '@picket/kernel';
import type { IncomingInteraction, InteractionKind, MessageRef, OptionValue } from '../application/interaction';

export class InvalidInteractionError extends DomainError {
  readonly code = 'invalid_interaction';
}

interface OptionNode {
  readonly type: number;
  readonly name: string;
  readonly value?: string | number | boolean | undefined;
  readonly focused?: boolean | undefined;
  readonly options?: readonly OptionNode[] | undefined;
}

function parseCommand(
  name: string,
  options: readonly OptionNode[] | undefined,
): { path: string[]; values: Record<string, OptionValue>; focused: string | null } {
  const path = [name];
  let current = options;
  for (;;) {
    const next = current?.[0];
    const isContainer =
      next?.type === ApplicationCommandOptionType.SubcommandGroup ||
      next?.type === ApplicationCommandOptionType.Subcommand;
    if (!next || !isContainer) break;
    path.push(next.name);
    current = next.options;
  }
  const values: Record<string, OptionValue> = {};
  let focused: string | null = null;
  for (const option of current ?? []) {
    if (option.value !== undefined) values[option.name] = option.value;
    if (option.focused === true) focused = option.name;
  }
  return { path, values, focused };
}

/** Champs texte d'une modale, qu'ils soient dans une rangée d'actions ou dans un libellé. */
function parseModalFields(components: unknown): Record<string, string> {
  const fields: Record<string, string> = {};
  const visit = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;
    const candidate = node as { custom_id?: unknown; value?: unknown; components?: unknown; component?: unknown };
    if (typeof candidate.custom_id === 'string' && typeof candidate.value === 'string') {
      fields[candidate.custom_id] = candidate.value;
    }
    if (Array.isArray(candidate.components)) candidate.components.forEach(visit);
    visit(candidate.component);
  };
  if (Array.isArray(components)) components.forEach(visit);
  return fields;
}

function parseBigInt(value: string | undefined): bigint | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

export function toIncomingInteraction(
  payload: APIInteraction,
): Result<IncomingInteraction, InvalidInteractionError> {
  let kind: InteractionKind;
  let path: string[] = [];
  let values: Record<string, OptionValue> = {};
  let focusedOption: string | null = null;
  let customId: string | null = null;
  let message: MessageRef | null = null;
  let fields: Record<string, string> = {};
  let componentKind: IncomingInteraction['componentKind'] = null;
  let selectedValues: string[] = [];
  const resolvedRoles: Record<string, { name: string }> = {};
  const resolvedChannels: Record<string, { kind: 'text' | 'announcement' | 'other' }> = {};

  switch (payload.type) {
    case InteractionType.ApplicationCommand:
      kind = 'command';
      ({ path, values } = parseCommand(payload.data.name, 'options' in payload.data ? payload.data.options : undefined));
      break;
    case InteractionType.ApplicationCommandAutocomplete:
      kind = 'autocomplete';
      ({ path, values, focused: focusedOption } = parseCommand(payload.data.name, payload.data.options));
      break;
    case InteractionType.MessageComponent: {
      kind = 'component';
      customId = payload.data.custom_id;
      componentKind = ({ 2: 'button', 3: 'stringSelect', 6: 'roleSelect', 8: 'channelSelect' } as const)[payload.data.component_type as 2 | 3 | 6 | 8] ?? null;
      if ('values' in payload.data) selectedValues = payload.data.values.filter((value): value is string => typeof value === 'string');
      if ('resolved' in payload.data && payload.data.resolved) {
        const resolved = payload.data.resolved;
        for (const [id, role] of Object.entries('roles' in resolved ? resolved.roles ?? {} : {})) {
          if (RoleId.parse(id).ok && role.id === id) resolvedRoles[id] = { name: role.name };
        }
        for (const [id, channel] of Object.entries('channels' in resolved ? resolved.channels ?? {} : {})) {
          if (ChannelId.parse(id).ok && channel.id === id) resolvedChannels[id] = { kind: channel.type === 0 ? 'text' : channel.type === 5 ? 'announcement' : 'other' };
        }
      }
      const messageId = MessageId.parse(payload.message?.id);
      const messageChannelId = ChannelId.parse(payload.message?.channel_id);
      if (messageId.ok && messageChannelId.ok) message = { id: messageId.value, channelId: messageChannelId.value };
      break;
    }
    case InteractionType.ModalSubmit: {
      kind = 'modal';
      customId = payload.data.custom_id;
      fields = parseModalFields(payload.data.components);
      const messageId = MessageId.parse(payload.message?.id);
      const messageChannelId = ChannelId.parse(payload.message?.channel_id);
      if (messageId.ok && messageChannelId.ok) message = { id: messageId.value, channelId: messageChannelId.value };
      break;
    }
    default:
      return err(new InvalidInteractionError('Unsupported interaction type'));
  }

  const id = InteractionId.parse(payload.id);
  const applicationId = ApplicationId.parse(payload.application_id);
  const userId = UserId.parse(payload.member?.user.id ?? payload.user?.id);
  if (!id.ok || !applicationId.ok || !userId.ok) {
    return err(new InvalidInteractionError('Invalid interaction identifiers'));
  }

  let guildId: GuildId | null = null;
  if (payload.guild_id !== undefined) {
    const parsed = GuildId.parse(payload.guild_id);
    if (!parsed.ok) return err(new InvalidInteractionError('Invalid guild id'));
    guildId = parsed.value;
  }

  let channelId: ChannelId | null = null;
  const rawChannelId = payload.channel?.id ?? payload.channel_id;
  if (rawChannelId !== undefined) {
    const parsed = ChannelId.parse(rawChannelId);
    if (parsed.ok) channelId = parsed.value;
  }

  const roleIds: RoleId[] = [];
  for (const rawRole of payload.member?.roles ?? []) {
    const parsed = RoleId.parse(rawRole);
    if (parsed.ok) roleIds.push(parsed.value);
  }

  return ok({
    id: id.value,
    kind,
    applicationId: applicationId.value,
    token: new Secret(payload.token),
    guildId,
    channelId,
    userId: userId.value,
    locale: payload.locale ?? payload.guild_locale ?? 'en-US',
    guildLocale: payload.guild_locale ?? null,
    memberRoleIds: roleIds,
    memberPermissions: parseBigInt(payload.member?.permissions),
    appPermissions: parseBigInt(payload.app_permissions),
    attachmentSizeLimit: Number.isSafeInteger(payload.attachment_size_limit) && payload.attachment_size_limit > 0
      ? payload.attachment_size_limit : 10 * 1024 * 1024,
    commandPath: path,
    options: values,
    focusedOption,
    customId,
    message,
    fields,
    componentKind,
    selectedValues,
    resolvedRoles,
    resolvedChannels,
  });
}
