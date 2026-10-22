import { decodeCustomId, toWireResponse, type CommandContext, type IncomingInteraction, type Reply } from '@picket/discord';
import { createI18n } from '@picket/i18n';
import { GuildId, MessageId, RoleId, UserId, noopLogger } from '@picket/kernel';
import { decidePermissionChange, type UpdatePermissions } from '@picket/guild';
import { makeInteraction } from '@picket/testing';
import { createStatsPanel, type StatsPanelStore, type DurableVoiceBuffer } from '../src';

function setup(locale = 'en') {
  let now = new Date('2026-10-15T12:00:00Z');
  const clock = { now: () => now };
  const guildId = GuildId.assert('70000000000000000001');
  const store = {
    config: jest.fn().mockResolvedValue({ guildId, enabled: true, roles: ['400000000000000011'], excludedChannels: [], afkChannelId: null, changedAt: now }),
    configure: jest.fn<ReturnType<StatsPanelStore['configure']>, Parameters<StatsPanelStore['configure']>>().mockResolvedValue('saved'),
    observe: jest.fn(), privacy: jest.fn().mockResolvedValue(false), setPrivacy: jest.fn(), report: jest.fn(),
  } satisfies StatsPanelStore;
  const buffer = { append: jest.fn(), replay: jest.fn(), erase: jest.fn(), status: jest.fn() } satisfies DurableVoiceBuffer;
  const access = { levelOf: jest.fn().mockResolvedValue('admin') };
  const gate = { suspensionOf: jest.fn().mockResolvedValue(null) };
  const updatePermissions = {
    execute: jest.fn<ReturnType<UpdatePermissions['execute']>, Parameters<UpdatePermissions['execute']>>().mockImplementation(async command => {
      const current = await store.config();
      const decision = decidePermissionChange(guildId, { officer: [], member: current.roles.map(RoleId.assert) }, command.change);
      if (decision.kind === 'apply') store.config.mockResolvedValue({ ...current, roles: [...decision.next.member], enabled: current.enabled && decision.next.member.length > 0 && !decision.next.member.includes(RoleId.assert(guildId)) });
      return decision;
    }),
  };
  const guildRoles = { names: jest.fn().mockResolvedValue({ '400000000000000011': 'Members', '400000000000000012': 'Logistics' }) };
  const panel = createStatsPanel({ store, buffer, access, gate, clock, updatePermissions, guildRoles, settingsHome: () => ({ kind: 'button', customId: 'psnav:1:home', label: 'PICKET settings' }) });
  const context: CommandContext = { interaction: makeInteraction({ userId: UserId.assert('50000000000000000001') }), guildId, level: 'admin', logger: noopLogger, t: createI18n().translator(locale).t };
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
      interaction: makeInteraction({ kind: 'component', componentKind: 'button', userId: context.interaction.userId, message: { id: MessageId.assert('800000000000000001'), channelId: context.interaction.channelId! }, ...overrides }),
    });
  };
  const click = async (action: string, overrides: Partial<IncomingInteraction> = {}) => {
    const id = ids(previous).find(id => decodeCustomId(id)?.payload.split('.')[3] === action)!;
    previous = await settle(await invoke(id, overrides));
    return previous;
  };
  return { store, buffer, access, gate, updatePermissions, guildRoles, panel, context, open, click, invoke, advance: () => { now = new Date(now.getTime() + 900_000); } };
}

function ids(reply: Reply | null): string[] {
  if (reply?.kind !== 'panel') throw new Error('Expected panel');
  toWireResponse(reply);
  return reply.panel.components.flatMap(item => item.kind === 'buttons' ? item.buttons.map(button => button.customId) : 'customId' in item ? [item.customId] : []);
}
const hasHome = (reply: Reply | null) => ids(reply).some(id => decodeCustomId(id)?.namespace === 'psnav');
const panelText = (reply: Reply | null) => {
  if (reply?.kind !== 'panel') throw new Error('Expected panel');
  return reply.panel.components.flatMap(item => item.kind === 'text' ? [item.text] : []).join('\n');
};

it('adds roles cumulatively, removes only the chosen role and treats duplicates as unchanged', async () => {
  const h = setup();
  const initial = await h.open();
  if (initial?.kind !== 'panel') throw new Error('Expected panel');
  const add = initial.panel.components.find(item => item.kind === 'roleSelect');
  expect(add?.kind === 'roleSelect' && (add.maxValues ?? 1)).toBe(1);
  for (const role of ['400000000000000012', '400000000000000013', '400000000000000012']) {
    const reply = await h.click('add', { componentKind: 'roleSelect', selectedValues: [role], resolvedRoles: { [role]: { name: 'Role' } } });
    if (h.updatePermissions.execute.mock.calls.length === 3) expect(panelText(reply)).toContain('Nothing to change.');
  }
  expect((await h.store.config()).roles).toEqual(['400000000000000011', '400000000000000012', '400000000000000013']);
  const refreshed = await h.click('refresh');
  expect(panelText(refreshed)).toContain('<@&400000000000000013>');
  const removed = await h.click('remove', { componentKind: 'stringSelect', selectedValues: ['400000000000000012'] });
  expect(panelText(removed)).toContain('<@&400000000000000011>');
  expect(panelText(removed)).toContain('<@&400000000000000013>');
  expect(panelText(removed)).not.toContain('<@&400000000000000012>');
  expect(h.store.configure).not.toHaveBeenCalled();
});

it('allows removing the last role and removing an existing @everyone role to repair an invalid configuration', async () => {
  const h = setup();
  await h.open();
  const empty = await h.click('remove', { componentKind: 'stringSelect', selectedValues: ['400000000000000011'] });
  expect((await h.store.config()).roles).toEqual([]);
  expect(panelText(empty)).toContain('Disabled');
  expect(ids(empty).some(id => decodeCustomId(id)?.payload.split('.')[3] === 'remove')).toBe(false);
  h.store.config.mockResolvedValue({ ...(await h.store.config()), roles: [h.context.guildId, '400000000000000011'] });
  await h.click('refresh');
  await h.click('remove', { componentKind: 'stringSelect', selectedValues: [h.context.guildId] });
  expect((await h.store.config()).roles).toEqual(['400000000000000011']);
});

it.each([
  ['add', 'roleSelect', []],
  ['add', 'roleSelect', ['400000000000000012', '400000000000000013']],
  ['add', 'roleSelect', ['invalid']],
  ['add', 'roleSelect', ['400000000000000012']],
  ['add', 'stringSelect', ['400000000000000011']],
  ['remove', 'roleSelect', ['400000000000000011']],
  ['remove', 'stringSelect', ['400000000000000012']],
] as const)('rejects invalid or stale %s selections (%s, %j) without writes', async (action, kind, selectedValues) => {
  const h = setup();
  await h.open();
  await h.click(action, { componentKind: kind, selectedValues: [...selectedValues] });
  expect(h.updatePermissions.execute).not.toHaveBeenCalled();
  expect(h.store.configure).not.toHaveBeenCalled();
});

it('does not apply the former replace action from an old panel', async () => {
  const h = setup();
  const add = ids(await h.open()).find(id => decodeCustomId(id)?.payload.endsWith('.add'))!;
  const pending = await h.invoke(add.replace(/\.add$/, '.replace'), { componentKind: 'roleSelect', selectedValues: ['400000000000000012'], resolvedRoles: { '400000000000000012': { name: 'Logistics' } } });
  if (pending.kind !== 'deferred') throw new Error('Expected deferred');
  await pending.run();
  expect(h.updatePermissions.execute).not.toHaveBeenCalled();
  expect(h.store.configure).not.toHaveBeenCalled();
});

it.each(createI18n().locales)('paginates more than 25 roles with named removal choices and valid controls in %s', async locale => {
  const h = setup(locale);
  const roles = Array.from({ length: 26 }, (_, i) => String(400000000000000001n + BigInt(i)));
  h.store.config.mockResolvedValue({ ...(await h.store.config()), roles });
  h.guildRoles.names.mockResolvedValue(Object.fromEntries(roles.map((id, i) => [id, `Role ${i + 1}`])));
  const first = await h.open(true);
  if (first?.kind !== 'panel') throw new Error('Expected panel');
  expect(first.panel.components.find(item => item.kind === 'stringSelect')).toMatchObject({ options: expect.arrayContaining([{ value: roles[0], label: 'Role 1' }]) });
  const last = await h.click('roles1');
  expect(hasHome(last)).toBe(true);
  expect(panelText(last)).toContain(`<@&${roles[25]}>`);
  expect(panelText(last)).not.toContain(`<@&${roles[0]}>`);
  if (last?.kind !== 'panel') throw new Error('Expected panel');
  expect(last.panel.components.find(item => item.kind === 'stringSelect')).toMatchObject({ options: [{ value: roles[25], label: 'Role 26' }] });
  await h.click('remove', { componentKind: 'stringSelect', selectedValues: [roles[25]!] });
  expect((await h.store.config()).roles).toHaveLength(25);
});

it('keeps removal available with localized names when Discord role names are unavailable', async () => {
  const h = setup('fr');
  h.guildRoles.names.mockRejectedValue(new Error('Discord unavailable'));
  const reply = await h.open();
  if (reply?.kind !== 'panel') throw new Error('Expected panel');
  const select = reply.panel.components.find(item => item.kind === 'stringSelect');
  expect(select).toMatchObject({ options: [{ value: '400000000000000011', label: 'Rôle indisponible 1' }] });
  ids(reply);
});

it.each(['add', 'remove'])('rechecks admin access before %s and hides mutation controls from officers', async action => {
  const h = setup();
  const id = ids(await h.open()).find(id => decodeCustomId(id)?.payload.endsWith(`.${action}`))!;
  const pending = await h.invoke(id, { componentKind: action === 'add' ? 'roleSelect' : 'stringSelect', selectedValues: ['400000000000000011'], resolvedRoles: { '400000000000000011': { name: 'Members' } } });
  h.access.levelOf.mockResolvedValue('officer');
  if (pending.kind !== 'deferred') throw new Error('Expected deferred');
  expect(await pending.run()).toMatchObject({ kind: 'message', ephemeral: true });
  expect(h.updatePermissions.execute).not.toHaveBeenCalled();
  const officer = await h.click('refresh');
  expect(ids(officer).some(id => decodeCustomId(id)?.namespace === 'ssroles')).toBe(false);
});

it.each(createI18n().locales)('preserves contextual navigation through all settings actions in %s', async locale => {
  for (const fromSettings of [false, true]) {
    const h = setup(locale);
    expect(hasHome(await h.open(fromSettings))).toBe(fromSettings);
    expect(hasHome(await h.click('refresh'))).toBe(fromSettings);
    expect(h.store.configure).not.toHaveBeenCalled();
    expect(hasHome(await h.click('exclude', { componentKind: 'channelSelect', selectedValues: ['invalid'] }))).toBe(fromSettings);
    expect(h.store.configure).not.toHaveBeenCalled();
    const role = '400000000000000012';
    expect(hasHome(await h.click('add', { componentKind: 'roleSelect', selectedValues: [role], resolvedRoles: { [role]: { name: 'Logistics' } } }))).toBe(fromSettings);
    expect(h.updatePermissions.execute).toHaveBeenLastCalledWith({ guildId: h.context.guildId, actorId: h.context.interaction.userId, change: { level: 'member', roleId: role, action: 'add', confirmed: false } });
    expect(hasHome(await h.click('add', { componentKind: 'roleSelect', selectedValues: [h.context.guildId], resolvedRoles: { [h.context.guildId]: { name: '@everyone' } } }))).toBe(fromSettings);
    expect(h.updatePermissions.execute).toHaveBeenCalledTimes(1);
    expect(hasHome(await h.click('remove', { componentKind: 'stringSelect', selectedValues: [role] }))).toBe(fromSettings);
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
