import { decodeCustomId, toWireResponse, type CommandContext, type ComponentContext, type PanelView, type Reply } from '@picket/discord';
import { createI18n } from '@picket/i18n';
import { GuildId, MessageId, UserId, noopLogger } from '@picket/kernel';
import { makeInteraction } from '@picket/testing';
import { ConfigureWarLog, createWarLogSettingsPanel, type WarStore } from '../src';

const now = new Date('2026-10-05T12:00:00Z');
function setup() {
  const store = {
    state: jest.fn().mockResolvedValue({ generation: '1', available: true, highestWar: 100, snapshot: { war: { number: 100, id: 'war100', startedAt: 1, endedAt: null, winner: 'NONE' }, regions: {}, objects: {} } }),
    subscription: jest.fn().mockResolvedValue({ perspective: 'NONE', channelId: '600000000000000001', zones: ['center'], locale: 'en', paused: true, confirmedWar: null, revision: 0, failureReason: null }),
    configure: jest.fn().mockResolvedValue('saved'), objects: jest.fn(), recover: jest.fn(), commit: jest.fn(), guilds: jest.fn(), hookGuilds: jest.fn(), claim: jest.fn(), valid: jest.fn(), finish: jest.fn(), channelChanged: jest.fn(), runHook: jest.fn(),
  } satisfies WarStore;
  const channels = { inspect: jest.fn().mockResolvedValue({ kind: 'ready', locale: 'en' }) };
  const access = { levelOf: jest.fn().mockResolvedValue('officer') }, gate = { suspensionOf: jest.fn().mockResolvedValue(null) };
  const panel = createWarLogSettingsPanel({ store, configure: new ConfigureWarLog(store, channels, { now: () => now }), clock: { now: () => now }, access, gate });
  const context: CommandContext = { interaction: makeInteraction(), guildId: GuildId.assert('700000000000000001'), logger: noopLogger, level: 'officer', t: createI18n().translator('en').t };
  const settle = async (reply: Reply): Promise<Reply | null> => reply.kind === 'deferred' ? reply.run() : reply;
  let previous: Reply | null = null;
  const open = async () => { previous = await settle(await panel.command.handler(context)); return previous; };
  async function click(action: string, overrides: Partial<ComponentContext['interaction']> = {}, argument?: string) {
    const reply = previous ?? await open(); if (reply?.kind !== 'panel') throw new Error('panel expected');
    const ids = reply.panel.components.flatMap(item => item.kind === 'buttons' ? item.buttons.map(button => button.customId) : 'customId' in item ? [item.customId] : []);
    const id = ids.find(value => decodeCustomId(value)?.payload.split('.')[3] === action && (argument === undefined || decodeCustomId(value)?.payload.split('.')[4] === argument))!;
    return settle(await panel.family.onComponent!({ ...context, payload: decodeCustomId(id)!.payload, interaction: makeInteraction({ kind: 'component', componentKind: 'button', message: { id: MessageId.assert('800000000000000001'), channelId: context.interaction.channelId! }, ...overrides }) }));
  }
  return { store, channels, access, gate, panel, context, open, click };
}
it('opens a private configuration panel without REST diagnostics or a status command', async () => {
  const h = setup(), reply = await h.open(); expect(reply?.kind).toBe('panel');
  expect(h.channels.inspect).not.toHaveBeenCalled(); expect(h.panel.command.path).toEqual(['warlog','settings']);
  expect(h.panel.command.feature).toBeUndefined();
  if (reply?.kind !== 'panel') throw new Error('panel expected');
  expect(JSON.stringify(reply.panel)).not.toContain('latency'); expect(JSON.stringify(reply.panel)).not.toContain('status');
  const select = reply.panel.components.find(item => item.kind === 'channelSelect');
  expect(select).toMatchObject({ channelKinds: ['text'] });
  expect(() => toWireResponse({ kind: 'panel', panel: reply.panel, update: false })).not.toThrow();
});
it('rejects an announcement channel supplied outside the text-only picker', async () => {
  const h = setup(); await h.click('channel', { componentKind: 'channelSelect', selectedValues: ['600000000000000001'], resolvedChannels: { '600000000000000001': { kind: 'announcement' } } });
  expect(h.channels.inspect).not.toHaveBeenCalled(); expect(h.store.configure).not.toHaveBeenCalled();
});
it('validates the channel in settings and forwards the displayed war to confirmation', async () => {
  const h = setup(); await h.click('enable');
  expect(h.channels.inspect).toHaveBeenCalledWith(h.context.guildId, '600000000000000001', { textOnly: true });
  expect(h.store.configure).toHaveBeenCalledWith(h.context.guildId, h.context.interaction.userId, { kind: 'enable', war: 100 }, now);
});
it('checks permissions again before deferred mutation', async () => {
  const h = setup(); const opened = await h.open(); if (opened?.kind !== 'panel') throw new Error('panel expected');
  h.access.levelOf.mockResolvedValue('member');
  const reply = await h.click('enable'); expect(reply).toMatchObject({ kind: 'message', ephemeral: true }); expect(h.store.configure).not.toHaveBeenCalled();
});
it('binds controls to their owner and guild', async () => {
  const h = setup(); const reply = await h.click('enable', { userId: UserId.assert('500000000000000002') });
  expect(reply).toMatchObject({ kind: 'message', ephemeral: true }); expect(h.store.configure).not.toHaveBeenCalled();
});
it('blocks writes while a server is suspended', async () => {
  const h = setup(); h.gate.suspensionOf.mockResolvedValue({ purgeAt: now });
  expect(await h.open()).toMatchObject({ kind: 'message', ephemeral: true }); expect(h.store.configure).not.toHaveBeenCalled();
});
it.each(['NONE', 'COLONIALS', 'WARDENS'])('sets the %s perspective without inspecting Discord channels', async perspective => {
  const h = setup(); await h.click('perspective', {}, perspective);
  expect(h.store.configure).toHaveBeenCalledWith(h.context.guildId, h.context.interaction.userId, { kind: 'perspective', perspective }, now);
  expect(h.channels.inspect).not.toHaveBeenCalled();
});
it('shows the saved perspective as selected, independently of activation', async () => {
  const h = setup(); h.store.subscription.mockResolvedValue({ perspective: 'WARDENS', channelId: null, zones: [], locale: 'en', paused: true, confirmedWar: null, revision: 0, failureReason: null });
  const reply = await h.open(); if (reply?.kind !== 'panel') throw new Error('panel expected');
  const buttons = reply.panel.components.flatMap(item => item.kind === 'buttons' ? item.buttons : []);
  expect(buttons.find(button => decodeCustomId(button.customId)?.payload.split('.')[4] === 'WARDENS')?.style).toBe('success');
  expect(() => toWireResponse({ kind: 'panel', panel: reply.panel, update: false })).not.toThrow();
});
