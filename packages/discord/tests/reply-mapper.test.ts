import { InteractionResponseType, MessageFlags } from 'discord-api-types/v10';
import { toWireResponse, type Reply } from '@picket/discord';

describe('toWireResponse', () => {
  it('answers a message, never with a mention, privately when asked', () => {
    expect(toWireResponse({ kind: 'message', content: 'hi', ephemeral: true })).toEqual({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { content: 'hi', allowed_mentions: { parse: [] }, flags: MessageFlags.Ephemeral },
    });
    expect(toWireResponse({ kind: 'message', content: 'hi', ephemeral: false })).toEqual({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { content: 'hi', allowed_mentions: { parse: [] } },
    });
  });

  it('answers an autocomplete with its choices', () => {
    expect(toWireResponse({ kind: 'autocomplete', choices: [{ name: 'a', value: 'b' }] })).toEqual({
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: { choices: [{ name: 'a', value: 'b' }] },
    });
  });

  it('opens a modal with its text inputs', () => {
    const reply: Reply = {
      kind: 'modal',
      customId: 'td:1:create',
      title: 'New todolist',
      inputs: [{ customId: 'content', label: 'Items', placeholder: 'A・x', style: 'paragraph', minLength: 1, maxLength: 4000 }],
    };
    expect(toWireResponse(reply)).toMatchObject({
      type: InteractionResponseType.Modal,
      data: { custom_id: 'td:1:create', title: 'New todolist', components: [{ type: 18, label: 'Items', component: { type: 4, custom_id: 'content', style: 2, required: true, placeholder: 'A・x', min_length: 1, max_length: 4000 } }] },
    });
  });

  it('clips modal labels and input constraints to Discord limits', () => {
    const wire = toWireResponse({ kind: 'modal', customId: 'x:1:a', title: 't'.repeat(80), inputs: [{ customId: 'c', label: 'l'.repeat(80), placeholder: 'p'.repeat(150), style: 'short', required: false, maxLength: 9000 }] }) as unknown as { data: { title: string; components: { label: string; component: { placeholder: string; max_length: number; required: boolean; style: number } }[] } };
    expect(wire.data.title).toHaveLength(45); expect(wire.data.components[0]?.label).toHaveLength(45);
    expect(wire.data.components[0]?.component).toMatchObject({ max_length: 4000, required: false, style: 1 });
    expect(wire.data.components[0]?.component.placeholder).toHaveLength(100);
  });

  it('acknowledges a deferred command privately (type 5 with the ephemeral flag), or publicly without data', () => {
    const run = async () => null;
    expect(toWireResponse({ kind: 'deferred', ephemeral: true, update: false, run })).toEqual({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
      data: { flags: MessageFlags.Ephemeral },
    });
    expect(toWireResponse({ kind: 'deferred', ephemeral: false, update: false, run })).toEqual({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
    });
  });

  it('acknowledges a button click without changing the message (type 6)', () => {
    expect(toWireResponse({ kind: 'deferred', ephemeral: true, update: true, run: async () => null })).toEqual({
      type: InteractionResponseType.DeferredMessageUpdate,
    });
  });
});
