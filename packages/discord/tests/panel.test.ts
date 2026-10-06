import { toWireResponse, type PanelView, type Reply } from '@picket/discord';
import { toWireReplyContent } from '../src/infrastructure/panel-mapper';

const panel: PanelView = { components: [
  { kind: 'text', text: '## Settings' },
  { kind: 'section', text: 'Timers enabled', button: { kind: 'button', customId: 'psedit:1:x', label: 'Disable', emoji: '⏸️', style: 'danger' } },
  { kind: 'separator' },
  { kind: 'stringSelect', customId: 'psedit:1:l', placeholder: 'Language', options: [{ label: 'Automatic', value: 'auto', selected: true }] },
  { kind: 'roleSelect', customId: 'psperm:1:r', placeholder: 'Add a role' },
  { kind: 'channelSelect', customId: 'psedit:1:c', placeholder: 'Audit channel' },
  { kind: 'buttons', buttons: [{ kind: 'button', customId: 'psnav:1:b', label: 'Back' }] },
] };

describe('Components V2 replies', () => {
  it('creates private panels without legacy content or embeds, and updates without changing visibility', () => {
    const initial = toWireResponse({ kind: 'panel', panel, update: false });
    expect(initial).toMatchObject({ type: 4, data: { flags: 32832, allowed_mentions: { parse: [] }, components: [{ type: 17, accent_color: 0x435768, components: [
      { type: 10, content: '## Settings' },
      { type: 9, components: [{ type: 10 }], accessory: { type: 2, style: 4, label: 'Disable', emoji: { name: '⏸️' } } },
      { type: 14 },
      { type: 1, components: [{ type: 3, options: [{ default: true }], min_values: 1, max_values: 1 }] },
      { type: 1, components: [{ type: 6, max_values: 1 }] },
      { type: 1, components: [{ type: 8, channel_types: [0, 5], max_values: 1 }] },
      { type: 1, components: [{ type: 2 }] },
    ] }] } });
    expect(JSON.stringify(initial)).not.toContain('"embeds"'); expect(JSON.stringify(initial)).not.toContain('"content":""');
    expect(toWireResponse({ kind: 'panel', panel, update: true })).toMatchObject({ type: 7, data: { flags: 32768 } });
    expect(toWireReplyContent(panel)).toMatchObject({ flags: 32768 });
  });
  it('does not put V2 flags on deferred acknowledgements', () => {
    const deferred: Reply = { kind: 'deferred', ephemeral: true, update: false, run: async () => ({ kind: 'panel', panel, update: false }) };
    expect(toWireResponse(deferred)).toEqual({ type: 5, data: { flags: 64 } });
  });
  it.each([
    { kind: 'buttons' as const, buttons: [{ kind: 'button' as const, customId: 'shared', label: 'Refresh' }] },
    { kind: 'section' as const, text: 'Settings', button: { kind: 'button' as const, customId: 'shared', label: 'Change' } },
    { kind: 'roleSelect' as const, customId: 'shared', placeholder: 'Add role' },
    { kind: 'channelSelect' as const, customId: 'shared', placeholder: 'Choose channel' },
    { kind: 'stringSelect' as const, customId: 'shared', placeholder: 'Language', options: [{ label: 'English', value: 'en' }] },
  ])('rejects duplicate custom IDs across sections, rows and selects ($kind)', (duplicate) => {
    expect(() => toWireReplyContent({ components: [
      { kind: 'buttons', buttons: [{ kind: 'button', customId: 'shared', label: 'Home' }] }, duplicate,
    ] })).toThrow('Duplicate panel component custom ID');
  });
  it.each(['', 'x'.repeat(101)])('rejects custom IDs outside Discord length limits', (customId) => {
    expect(() => toWireReplyContent({ components: [{ kind: 'roleSelect', customId, placeholder: 'Role' }] })).toThrow('Invalid panel component custom ID');
  });
  it('refuses exceeding total components, select choices and message text', () => {
    const reply = (components: PanelView['components']): Reply => ({ kind: 'panel', update: false, panel: { components } });
    expect(() => toWireResponse(reply(Array.from({ length: 40 }, () => ({ kind: 'separator' }))))).toThrow('component limit');
    expect(() => toWireResponse(reply([{ kind: 'stringSelect', customId: 'x', placeholder: 'x', options: Array.from({ length: 26 }, () => ({ label: 'x', value: 'x' })) }]))).toThrow('select choices');
    expect(() => toWireResponse(reply([{ kind: 'text', text: 'x'.repeat(3000) }, { kind: 'text', text: 'x'.repeat(2000) }]))).toThrow('text limit');
  });
});
