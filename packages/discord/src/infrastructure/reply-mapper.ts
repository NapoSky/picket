import {
  InteractionResponseType,
  SelectMenuDefaultValueType, ChannelType,
  MessageFlags,
  TextInputStyle,
  type APIInteractionResponse,
} from 'discord-api-types/v10';
import type { ModalInput, Reply } from '../application/interaction';
import { toWirePanel } from './panel-mapper';

// Discord modal limits: truncate overly long translations instead of failing the interaction.
const MODAL_TITLE_MAX = 45;
const MODAL_LABEL_MAX = 45;
const PLACEHOLDER_MAX = 100;
const TEXT_INPUT_MAX = 4000;
const AUTOCOMPLETE_MAX_CHOICES = 25;
const AUTOCOMPLETE_TEXT_MAX = 100;

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}\u2026`);

function toTextInput(input: ModalInput) {
  if(input.kind === 'channelSelect') return {type:18 as const,label:clip(input.label,45),component:{type:8 as const,custom_id:input.customId,channel_types:[ChannelType.GuildCategory],min_values:1,max_values:1,...(input.values?.length?{default_values:input.values.map(id=>({id,type:SelectMenuDefaultValueType.Channel as const}))}:{})}};
  if(input.kind === 'stringSelect') return {type:18 as const,label:clip(input.label,45),component:{type:3 as const,custom_id:input.customId,min_values:1,max_values:1,options:input.options.map(o=>({label:clip(o.label,100),value:o.value,default:o.selected??false}))}};
  return {
    type: 18 as const,
    label: clip(input.label, MODAL_LABEL_MAX),
    component: {
        type: 4 as const,
        custom_id: input.customId,
        style: input.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short,
        required: input.required ?? true,
        ...(input.value !== undefined ? { value: clip(input.value, TEXT_INPUT_MAX) } : {}),
        ...(input.placeholder !== undefined ? { placeholder: clip(input.placeholder, PLACEHOLDER_MAX) } : {}),
        ...(input.minLength !== undefined ? { min_length: Math.max(0, Math.min(input.minLength, TEXT_INPUT_MAX)) } : {}),
        ...(input.maxLength !== undefined ? { max_length: Math.max(1, Math.min(input.maxLength, TEXT_INPUT_MAX)) } : {}),
    },
  };
}

/** Immediate HTTP response to an interaction. */
export function toWireResponse(reply: Reply): APIInteractionResponse {
  switch (reply.kind) {
    case 'file':
      throw new Error('File replies must be delivered after a deferred acknowledgement');
    case 'panel': {
      const data = toWirePanel(reply.panel);
      return reply.update
        ? { type: InteractionResponseType.UpdateMessage, data }
        : { type: InteractionResponseType.ChannelMessageWithSource, data: { ...data, flags: data.flags | MessageFlags.Ephemeral } };
    }
    case 'autocomplete':
      return {
        type: InteractionResponseType.ApplicationCommandAutocompleteResult,
        data: {
          choices: reply.choices
            .filter((choice) => choice.value.length <= AUTOCOMPLETE_TEXT_MAX)
            .slice(0, AUTOCOMPLETE_MAX_CHOICES)
            .map((choice) => ({ name: clip(choice.name, AUTOCOMPLETE_TEXT_MAX), value: choice.value })),
        },
      };
    case 'modal':
      return {
        type: InteractionResponseType.Modal,
        data: {
          custom_id: reply.customId,
          title: clip(reply.title, MODAL_TITLE_MAX),
          components: [
            ...(reply.description ? [{ type: 10 as const, content: clip(reply.description, 4000) }] : []),
            ...reply.inputs.map(toTextInput),
          ],
        },
      };
    case 'deferred':
      return reply.update
        ? { type: InteractionResponseType.DeferredMessageUpdate }
        : {
            type: InteractionResponseType.DeferredChannelMessageWithSource,
            ...(reply.ephemeral ? { data: { flags: MessageFlags.Ephemeral } } : {}),
          };
    case 'message':
      return {
        type: InteractionResponseType.ChannelMessageWithSource,
        data: {
          content: reply.content,
          allowed_mentions: { parse: [] },
          ...(reply.ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
        },
      };
  }
}
