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
    expect(toWireResponse(reply)).toEqual({
      type: InteractionResponseType.Modal,
      data: {
        custom_id: 'td:1:create',
        title: 'New todolist',
        components: [
          {
            type: 1,
            components: [
              {
                type: 4,
                custom_id: 'content',
                label: 'Items',
                style: 2,
                required: true,
                placeholder: 'A・x',
                min_length: 1,
                max_length: 4000,
              },
            ],
          },
        ],
      },
    });
  });

  it('uses the short style by default semantics, and lets an input be optional', () => {
    const wire = toWireResponse({
      kind: 'modal',
      customId: 'x:1:a',
      title: 't',
      inputs: [{ customId: 'c', label: 'l', style: 'short', required: false }],
    });
    expect(wire).toMatchObject({ data: { components: [{ components: [{ style: 1, required: false }] }] } });
    expect(JSON.stringify(wire)).not.toContain('placeholder');
  });

  it('cuts texts longer than Discord accepts instead of failing the interaction (translations come from the community)', () => {
    const wire = toWireResponse({
      kind: 'modal',
      customId: 'x:1:a',
      title: 't'.repeat(80),
      inputs: [{ customId: 'c', label: 'l'.repeat(80), placeholder: 'p'.repeat(150), style: 'paragraph', maxLength: 9000, minLength: 9000 }],
    }) as unknown as { data: { title: string; components: { components: Record<string, unknown>[] }[] } };
    const input = wire.data.components[0]?.components[0] as { label: string; placeholder: string; max_length: number; min_length: number };
    expect(wire.data.title).toHaveLength(45);
    expect(input.label).toHaveLength(45);
    expect(input.placeholder).toHaveLength(100);
    expect(input.max_length).toBe(4000);
    expect(input.min_length).toBe(4000);
    expect(wire.data.title.endsWith('…')).toBe(true);
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
