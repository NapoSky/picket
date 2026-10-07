import {
  CommandRegistry, buildCommandsPayload, toWireResponse,
  type AccessLevel, type CommandContext, type ComponentContext, type PanelView, type Reply,
} from '@picket/discord';
import { ChannelId, GuildId, MessageId, RoleId, UserId, noopLogger } from '@picket/kernel';
import { makeInteraction, testI18n } from '@picket/testing';
import { DEFAULT_BOARD_SETTINGS, TIMERS_ROOT, createTimerSettingsPanel, type BoardRecord, type GetBoardSettings, type UpdateBoardSettings } from '@picket/timers';

function setup(locale = 'en') {
  let time = new Date('2026-10-07T12:00:00Z');
  const state: { level: AccessLevel | null; enabled: boolean; suspended: boolean } = { level: 'officer', enabled: true, suspended: false };
  const roleIds = Array.from({ length: 5 }, (_, i) => RoleId.assert(`40000000000000001${i}`));
  const board: BoardRecord = {
    id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', guildId: GuildId.assert('700000000000000001'),
    channelId: ChannelId.assert('600000000000000001'), createdBy: UserId.assert('18446744073709551615'),
    locale, settings: { ...DEFAULT_BOARD_SETTINGS, alertRoleIds: roleIds }, rev: 0,
    needsSync: false, syncError: null, createdAt: time, lastActivityAt: time, archivedAt: null,
  };
  const update = jest.fn(async () => ({ kind: 'unchanged' as const, settings: board.settings }));
  const panel = createTimerSettingsPanel({
    getSettings: { execute: async () => ({ board, activeCount: 50 }) } as unknown as GetBoardSettings,
    updateSettings: { execute: update } as unknown as UpdateBoardSettings,
    access: { levelOf: async () => state.level }, features: { isEnabled: async () => state.enabled },
    gate: { suspensionOf: async () => state.suspended ? { purgeAt: time } : null }, clock: { now: () => time },
    guildRoles: { names: async () => Object.fromEntries(roleIds.map((id) => [id, 'Role '.repeat(30)])) },
  });
  const interaction = makeInteraction({ guildId: board.guildId, channelId: board.channelId, userId: board.createdBy, locale, commandPath: ['timers', 'settings'] });
  const context: CommandContext = { interaction, guildId: board.guildId, level: 'officer', logger: noopLogger, t: testI18n.translator(locale).t };
  async function finish(reply: Reply): Promise<Reply | null> { return reply.kind === 'deferred' ? reply.run() : reply; }
  const open = async () => finish(await panel.command.handler(context));
  const clickContext = (customId: string, overrides: Partial<typeof interaction> = {}): ComponentContext => ({
    ...context, payload: customId.split(':').slice(2).join(':'), interaction: {
      ...interaction, kind: 'component', componentKind: 'button', customId,
      message: { id: MessageId.assert('900000000000000001'), channelId: board.channelId }, ...overrides,
    },
  });
  const click = async (customId: string, overrides: Partial<typeof interaction> = {}) => finish(await panel.family.onComponent!(clickContext(customId, overrides)));
  return { panel, state, update, open, click, clickContext, advance: (ms: number) => { time = new Date(time.getTime() + ms); } };
}

function view(reply: Reply | null): PanelView {
  if (reply?.kind !== 'panel') throw new Error('expected panel');
  // Checks the actual Discord component, text and custom ID limits, as well as uniqueness.
  toWireResponse(reply);
  return reply.panel;
}
function control(reply: Reply | null, action: string, arg = '0') {
  const ids = view(reply).components.flatMap((item) => item.kind === 'section' ? [item.button.customId] : item.kind === 'buttons' ? item.buttons.map((button) => button.customId) : 'customId' in item ? [item.customId] : []);
  const found = ids.find((id) => id.endsWith(`.${action}.${arg}`));
  if (!found) throw new Error('control not found');
  return found;
}

describe('timer settings panel', () => {
  it('publishes /timers settings with no arguments', () => {
    const { panel } = setup();
    const payload = buildCommandsPayload(new CommandRegistry([TIMERS_ROOT], [panel.command], testI18n));
    expect(payload[0]?.options?.[0]).toMatchObject({ name: 'settings', type: 1 });
    expect(payload[0]?.options?.[0]).not.toHaveProperty('options');
  });

  it.each(testI18n.locales)('renders all screens within Discord limits in %s, including five roles', async (locale) => {
    const ui = setup(locale);
    const home = await ui.open();
    expect(view(home).accentColor).toBe(0x5865f2);
    const alerts = await ui.click(control(home, 'view', 'alerts'));
    const manage = await ui.click(control(alerts, 'view', 'manage'));
    expect(view(alerts).accentColor).toBe(0x3498db);
    expect(view(manage).accentColor).toBe(0x9b59b6);
    view(await ui.click(control(alerts, 'view', 'off')));
    const form = await ui.click(control(manage, 'form', 'purge'));
    if (form?.kind !== 'modal') throw new Error('expected modal');
    expect(form.inputs[0]?.value).toBe('24');
    expect(toWireResponse(form)).toMatchObject({ type: 9, data: { components: [{ type: 18, component: { type: 4 } }] } });
    const result = await ui.panel.family.onModal!(ui.clickContext(form.customId, { kind: 'modal', componentKind: null, fields: { value: '48' } }));
    view(result.kind === 'deferred' ? await result.run() : result);
    expect(ui.update).not.toHaveBeenCalled();
  });

  it('rechecks access while deferred work waits, before writing', async () => {
    const ui = setup();
    const alerts = await ui.click(control(await ui.open(), 'view', 'alerts'));
    const reply = await ui.panel.family.onComponent!(ui.clickContext(control(alerts, 'quiet', '0')));
    ui.state.level = 'member';
    expect(reply.kind === 'deferred' ? await reply.run() : reply).toMatchObject({ kind: 'message', content: expect.stringContaining('required level: officer') });
    expect(ui.update).not.toHaveBeenCalled();
  });

  it.each(['enabled', 'suspended'] as const)('rechecks %s while deferred work waits', async (key) => {
    const ui = setup();
    const alerts = await ui.click(control(await ui.open(), 'view', 'alerts'));
    const reply = await ui.panel.family.onComponent!(ui.clickContext(control(alerts, 'quiet', '0')));
    ui.state[key] = key === 'suspended';
    expect(reply.kind === 'deferred' ? await reply.run() : reply).toMatchObject({ kind: 'message', ephemeral: true });
    expect(ui.update).not.toHaveBeenCalled();
  });

  it('refuses stale modals and forged component types or multiple select values', async () => {
    const ui = setup();
    const home = await ui.open();
    const manage = await ui.click(control(home, 'view', 'manage'));
    view(await ui.click(control(manage, 'guard', '1'), { componentKind: 'stringSelect', selectedValues: ['1'] }));
    const oldPolicy = control(manage, 'guard', '1').replace('.guard.1', '.dups.0');
    view(await ui.click(oldPolicy, { componentKind: 'stringSelect', selectedValues: ['warn', 'refuse'] }));
    expect(ui.update).not.toHaveBeenCalled();
    const form = await ui.click(control(manage, 'form', 'purge'));
    if (form?.kind !== 'modal') throw new Error('expected modal');
    ui.advance(16 * 60_000);
    expect(await ui.panel.family.onModal!(ui.clickContext(form.customId, { kind: 'modal', fields: { value: '0' } }))).toMatchObject({ kind: 'message', content: expect.stringContaining('Run /timers settings again') });
    expect(ui.update).not.toHaveBeenCalled();
  });
});
