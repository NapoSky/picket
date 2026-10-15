import { decodeCustomId, toWireResponse, type CommandContext, type IncomingInteraction, type Reply } from '@picket/discord';
import { createI18n } from '@picket/i18n';
import { GuildId, MessageId, UserId, noopLogger } from '@picket/kernel';
import { makeInteraction } from '@picket/testing';
import { createStatsPanel, type StatsPanelStore, type DurableVoiceBuffer } from '../src';

function setup(locale = 'en') {
  let now = new Date('2026-10-15T12:00:00Z');
  const clock = { now: () => now };
  const guildId = GuildId.assert('700000000000000001');
  const store = {
    config: jest.fn().mockResolvedValue({ guildId, enabled: true, roles: ['400000000000000011'], excludedChannels: [], afkChannelId: null, changedAt: now }),
    configure: jest.fn<ReturnType<StatsPanelStore['configure']>, Parameters<StatsPanelStore['configure']>>().mockResolvedValue('saved'),
    observe: jest.fn(), privacy: jest.fn().mockResolvedValue(false), setPrivacy: jest.fn(), report: jest.fn(),
  } satisfies StatsPanelStore;
  const buffer = { append: jest.fn(), replay: jest.fn(), erase: jest.fn(), status: jest.fn() } satisfies DurableVoiceBuffer;
  const access = { levelOf: jest.fn().mockResolvedValue('admin') };
  const gate = { suspensionOf: jest.fn().mockResolvedValue(null) };
  const panel = createStatsPanel({ store, buffer, access, gate, clock, settingsHome: () => ({ kind: 'button', customId: 'psnav:1:home', label: 'PICKET settings' }) });
  const context: CommandContext = { interaction: makeInteraction(), guildId, level: 'admin', logger: noopLogger, t: createI18n().translator(locale).t };
  const settle = async (reply: Reply) => reply.kind === 'deferred' ? reply.run() : reply;
  let previous: Reply | null = null;
  const open = async (fromSettings = false) => {
    previous = await settle(fromSettings ? await panel.open(context, true) : await panel.command.handler(context));
    return previous;
  };
  const invoke = async (customId: string, overrides: Partial<IncomingInteraction> = {}) => {
    const decoded = decodeCustomId(customId)!;
    return panel.families.find(family => family.namespace === decoded.namespace)!.onComponent!({
      ...context, payload: decoded.payload,
      interaction: makeInteraction({ kind: 'component', componentKind: 'button', message: { id: MessageId.assert('800000000000000001'), channelId: context.interaction.channelId! }, ...overrides }),
    });
  };
  const click = async (action: string, overrides: Partial<IncomingInteraction> = {}) => {
    const id = ids(previous).find(id => decodeCustomId(id)?.payload.split('.')[3] === action)!;
    previous = await settle(await invoke(id, overrides));
    return previous;
  };
  return { store, buffer, access, gate, panel, context, open, click, invoke, advance: () => { now = new Date(now.getTime() + 900_000); } };
}

function ids(reply: Reply | null): string[] {
  if (reply?.kind !== 'panel') throw new Error('Expected panel');
  toWireResponse(reply);
  return reply.panel.components.flatMap(item => item.kind === 'buttons' ? item.buttons.map(button => button.customId) : 'customId' in item ? [item.customId] : []);
}
const hasHome = (reply: Reply | null) => ids(reply).some(id => decodeCustomId(id)?.namespace === 'psnav');

it.each(createI18n().locales)('preserves contextual navigation through all settings actions in %s', async locale => {
  for (const fromSettings of [false, true]) {
    const h = setup(locale);
    expect(hasHome(await h.open(fromSettings))).toBe(fromSettings);
    expect(hasHome(await h.click('refresh'))).toBe(fromSettings);
    expect(h.store.configure).not.toHaveBeenCalled();
    expect(hasHome(await h.click('exclude', { componentKind: 'channelSelect', selectedValues: ['invalid'] }))).toBe(fromSettings);
    expect(h.store.configure).not.toHaveBeenCalled();
    const role = '400000000000000012';
    expect(hasHome(await h.click('replace', { componentKind: 'roleSelect', selectedValues: [role], resolvedRoles: { [role]: { name: 'Members' } } }))).toBe(fromSettings);
    expect(h.store.configure).toHaveBeenLastCalledWith(h.context.guildId, h.context.interaction.userId, { memberRoles: [role] });
    expect(hasHome(await h.click('replace', { componentKind: 'roleSelect', selectedValues: [h.context.guildId] }))).toBe(fromSettings);
    expect(hasHome(await h.click('clear'))).toBe(fromSettings);
    expect(hasHome(await h.click('disable'))).toBe(fromSettings);
    h.store.configure.mockResolvedValue('invalid_roles');
    expect(hasHome(await h.click('disable'))).toBe(fromSettings);
  }
});

it.each(['invalid', 'picket.extra', ''])('rejects invalid origin %j without writes', async origin => {
  const h = setup();
  const id = ids(await h.open()).find(id => decodeCustomId(id)?.payload.endsWith('.disable'))!;
  expect(await h.invoke(`${id}.${origin}`)).toMatchObject({ kind: 'message', ephemeral: true });
  expect(h.store.configure).not.toHaveBeenCalled();
});

it('keeps owner, expiry, channel and fresh access guards on contextual controls', async () => {
  const h = setup();
  const id = ids(await h.open(true)).find(id => decodeCustomId(id)?.payload.includes('.disable.'))!;
  expect(await h.invoke(id, { userId: UserId.assert('500000000000000002') })).toMatchObject({ kind: 'message', ephemeral: true });
  expect(await h.invoke(id, { message: null })).toMatchObject({ kind: 'message', ephemeral: true });
  const pending = await h.invoke(id);
  h.access.levelOf.mockResolvedValue('member');
  if (pending.kind !== 'deferred') throw new Error('Expected deferred');
  expect(await pending.run()).toMatchObject({ kind: 'message', ephemeral: true });
  h.access.levelOf.mockResolvedValue('admin');
  const expired = await h.invoke(id);
  h.advance();
  if (expired.kind !== 'deferred') throw new Error('Expected deferred');
  expect(await expired.run()).toMatchObject({ kind: 'message', ephemeral: true });
  expect(h.store.configure).not.toHaveBeenCalled();
});

it('keeps personal privacy separate from officer settings navigation', async () => {
  const h = setup();
  const command = h.panel.entries.find(entry => entry.path[1] === 'privacy')!;
  const pending = await command.handler(h.context);
  if (pending.kind !== 'deferred') throw new Error('Expected deferred');
  const reply = await pending.run();
  expect(hasHome(reply)).toBe(false);
  expect(ids(reply).every(id => decodeCustomId(id)?.namespace === 'sspriv')).toBe(true);
});
