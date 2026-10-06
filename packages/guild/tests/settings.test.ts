import { CommandRegistry, ComponentRegistry, InteractionPipeline, buildCommandsPayload, deliverDeferred, toWireResponse, type IncomingInteraction, type PanelView, type Reply } from '@picket/discord';
import { createI18n, loadCatalogs } from '@picket/i18n';
import { ChannelId, GuildId, MessageId, RoleId, UserId, noopLogger } from '@picket/kernel';
import {
  CancelGuildDeletion, GetGuildSettings, GetGuildStatus, GetSuspension, PICKET_ROOT, RequestGuildDeletion, ResolveAccess,
  ShowPermissions, UpdateGuildSettings, UpdatePermissions, createGuildAccessPolicy, createGuildGate, createSettingsPanel,
  defaultPermissionConfig, statusCommand, type GuildLifecycleRepository, type GuildSettings, type GuildSettingsWriter,
  type PermissionConfig, type PermissionRepository,
} from '@picket/guild';
import { InMemoryInteractionReplies, allFeaturesEnabled, makeInteraction, testI18n } from '@picket/testing';

const guildId = GuildId.assert('700000000000000001');
const roleId = RoleId.assert('400000000000000011');
const channelId = ChannelId.assert('600000000000000001');

function setup(i18n = testI18n) {
  let time = new Date('2026-10-05T12:00:00Z');
  const clock = { now: () => time };
  let settings: GuildSettings = { guildId, locale: null, timezone: 'UTC', auditChannelId: null, features: { timers: true, todolists: true, warlog: true }, installedAt: time };
  let config: PermissionConfig = defaultPermissionConfig(guildId);
  let inactive: Date | null = null;
  const audit: string[] = [];
  const store: GuildSettingsWriter = { modify: async (_guild, _actor, action, decide) => {
    const result = decide(settings); if (result.kind === 'apply') { settings = result.next; audit.push(action); } return result;
  } };
  const reader = { findOrCreate: async () => settings };
  const permissions: PermissionRepository = {
    load: async () => config,
    modify: async (_guild, _actor, action, decide) => {
      const before = config; const decision = decide(config);
      if (decision.kind === 'apply') { config = decision.next; audit.push(action); } return { before, decision };
    },
  };
  const lifecycle: GuildLifecycleRepository = {
    initialize: async () => undefined, inactiveSince: async () => inactive,
    markInactive: async (_guild, _actor, _action, date) => { const changed = inactive === null; inactive ??= date; return { changed, inactiveSince: inactive }; },
    reactivate: async () => { const changed = inactive !== null; inactive = null; return changed; },
    listActive: async () => [], findPurgeable: async () => [], purge: async () => undefined,
  };
  const suspension = new GetSuspension(lifecycle, 30);
  const show = new ShowPermissions(permissions);
  const panel = createSettingsPanel({ settings: new GetGuildSettings(reader), update: new UpdateGuildSettings(store, i18n.locales), permissions: show,
    updatePermissions: new UpdatePermissions(permissions), access: new ResolveAccess(permissions), suspension,
    request: new RequestGuildDeletion(lifecycle, clock, 30), cancel: new CancelGuildDeletion(lifecycle), clock, i18n });
  const status = statusCommand(new GetGuildStatus(reader), show);
  const registry = new CommandRegistry([PICKET_ROOT], [status, panel.command], i18n, [...panel.aliases, { ...status, path: ['picket', 'permissions', 'show'] }]);
  const pipeline = new InteractionPipeline({ registry, components: new ComponentRegistry(panel.families), receipts: { claim: async () => true }, access: createGuildAccessPolicy(new ResolveAccess(permissions)), gate: createGuildGate(suspension), language: { localeOf: async () => settings.locale }, features: allFeaturesEnabled, logger: noopLogger });
  async function call(interaction: IncomingInteraction) {
    const result = await pipeline.handle(interaction);
    return result.kind === 'deferred' ? await result.run() : result;
  }
  const open = (overrides: Partial<IncomingInteraction> = {}) => call(makeInteraction({ commandPath: ['picket', 'settings'], memberPermissions: 8n, ...overrides }));
  const click = (customId: string, overrides: Partial<IncomingInteraction> = {}) => call(makeInteraction({ kind: 'component', customId, componentKind: 'button', memberPermissions: 8n, message: { id: MessageId.assert('910000000000000001'), channelId }, ...overrides }));
  return { panel, registry, pipeline, open, click, audit, read: () => ({ settings, config, inactive }), advance: (ms: number) => { time = new Date(time.getTime() + ms); }, setConfig: (value: PermissionConfig) => { config = value; } };
}
function view(reply: Reply | null): PanelView {
  if (reply?.kind !== 'panel') throw new Error(`Expected panel: ${JSON.stringify(reply)}`);
  // Every screen must actually fit the Discord wire limits.
  toWireResponse(reply);
  return reply.panel;
}
function control(reply: Reply | null, action: string, arg?: string): string {
  const ids = view(reply).components.flatMap((item) => item.kind === 'section' ? [item.button.customId] : item.kind === 'buttons' ? item.buttons.map((button) => button.customId) : 'customId' in item ? [item.customId] : []);
  const found = ids.find((id) => id.split('.')[3] === action && (arg === undefined || id.split('.')[4] === arg));
  if (!found) throw new Error(`Missing control ${action}.${arg}: ${ids.join(', ')}`);
  return found;
}
const text = (reply: Reply | null) => reply?.kind === 'message' ? reply.content : JSON.stringify(reply?.kind === 'panel' ? reply.panel : reply);

describe('private server settings panel', () => {
  it('publishes exactly status and settings, while resolving old commands without publishing them', () => {
    const { registry } = setup();
    const payload = buildCommandsPayload(registry)[0];
    expect(payload?.options?.map((option) => option.name)).toEqual(['settings', 'status']);
    expect(registry.resolve(['picket', 'settings', 'language'])).toBeDefined();
    expect(registry.resolve(['picket', 'data', 'cancel-deletion'])).toBeDefined();
  });
  it('opens a private V2 message, with useful modules and no war-log activation', async () => {
    const result = await setup().open();
    expect(toWireResponse(result!)).toMatchObject({ type: 4, data: { flags: 32832 } });
    expect(text(result)).toContain('Timers'); expect(text(result)).not.toContain('War log enabled');
    expect(control(result, 'disable', 'timers').length).toBeLessThanOrEqual(100);
  });
  it('keeps members out of settings', async () => {
    expect(text(await setup().open({ memberPermissions: 0n }))).toContain('required level: officer');
  });
  it.each(['home', 'language', 'advanced', 'permissions', 'data'])('refreshes %s with unique controls and no writes', async (page) => {
    const env = setup();
    const screen = await env.click(control(await env.open(), 'view', page));
    const refreshed = await env.click(control(screen, 'refresh', page));
    expect(view(refreshed)).toEqual(view(screen));
    expect(env.audit).toEqual([]);
  });
  it('cancels confirmations without changing modules, permissions or deletion state', async () => {
    const env = setup();
    const home = await env.open();
    const disable = await env.click(control(home, 'disable', 'timers'));
    expect(view(await env.click(control(disable, 'cancel', 'home')))).toEqual(view(home));
    const data = await env.click(control(home, 'view', 'data'));
    const deletion = await env.click(control(data, 'view', 'delete'));
    expect(view(await env.click(control(deletion, 'cancel', 'data')))).toEqual(view(data));
    env.setConfig({ member: [roleId], officer: [] });
    const permissions = await env.click(control(home, 'view', 'permissions'));
    const members = await env.click(control(permissions, 'view', 'member'));
    const everyone = await env.click(control(members, 'view', 'everyone'));
    expect(view(await env.click(control(everyone, 'cancel', 'member')))).toEqual(view(members));
    expect(env.read().settings.features.timers).toBe(true);
    expect(env.read().config.member).toEqual([roleId]);
    expect(env.read().inactive).toBeNull();
    expect(env.audit).toEqual([]);
  });
  it('refreshes a disable confirmation without losing its target module', async () => {
    const env = setup();
    const confirmation = await env.click(control(await env.open(), 'disable', 'timers'));
    const refresh = view(confirmation).components.flatMap((item) => item.kind === 'buttons' ? item.buttons : []).find((button) => button.label === 'Refresh');
    expect(refresh).toBeDefined();
    expect(view(await env.click(refresh!.customId))).toEqual(view(confirmation));
    expect(env.audit).toEqual([]);
  });
  it('shows permissions without edit controls or Data to an officer', async () => {
    const env = setup(); env.setConfig({ member: [], officer: [roleId] });
    const caller = { memberPermissions: 0n, memberRoleIds: [roleId] };
    const home = await env.open(caller); expect(text(home)).not.toContain('psdata'); expect(text(home)).not.toContain('"label":"Data"');
    const overview = await env.click(control(home, 'view', 'permissions'), caller);
    const members = await env.click(control(overview, 'view', 'member'), caller);
    expect(text(members)).toContain('Only administrators'); expect(text(members)).not.toContain('psperm');
  });
  it('requires confirmation to disable, retains data, and repeated confirmation is a no-op', async () => {
    const env = setup(); const home = await env.open();
    const confirm = await env.click(control(home, 'disable', 'timers'));
    expect(env.audit).toEqual([]); expect(text(confirm)).toContain('Existing data is retained');
    const id = control(confirm, 'disable', 'timers'); await env.click(id); await env.click(id);
    expect(env.read().settings.features).toEqual({ timers: false, todolists: true, warlog: true }); expect(env.audit).toEqual(['settings.feature']);
  });
  it('changes language immediately, falls back to user language in automatic mode and rejects unknown choices', async () => {
    const env = setup(); const langs = await env.click(control(await env.open(), 'view', 'language'));
    const id = control(langs, 'language');
    const french = await env.click(id, { componentKind: 'stringSelect', selectedValues: ['fr'] });
    expect(text(french)).toContain('Modification enregistrée'); expect(env.read().settings.locale).toBe('fr');
    const automatic = await env.click(control(french, 'language'), { componentKind: 'stringSelect', selectedValues: ['auto'] });
    expect(text(automatic)).toContain('Saved'); expect(env.read().settings.locale).toBeNull();
    const unknown = await env.click(id, { componentKind: 'stringSelect', selectedValues: ['xx'] });
    expect(text(unknown)).toContain('not available'); expect(env.audit).toHaveLength(2);
  });
  it('opens a prefilled timezone modal and returns invalid input to the same panel without a write', async () => {
    const env = setup(); const advanced = await env.click(control(await env.open(), 'view', 'advanced'));
    expect(text(advanced)).toContain('no operational effect'); expect(text(advanced)).toContain('Coming soon');
    const modal = await env.click(control(advanced, 'timezone'));
    expect(modal).toMatchObject({ kind: 'modal', inputs: [{ value: 'UTC', maxLength: 64 }] });
    if (modal?.kind !== 'modal') throw new Error('modal expected');
    const invalid = await env.click(modal.customId, { kind: 'modal', componentKind: null, fields: { timezone: 'Mars/Olympus' } });
    expect(text(invalid)).toContain('IANA'); expect(env.audit).toHaveLength(0);
    const saved = await env.click(modal.customId, { kind: 'modal', componentKind: null, fields: { timezone: 'europe/paris' } });
    expect(saved).toMatchObject({ kind: 'panel', update: true }); expect(env.read().settings.timezone).toBe('Europe/Paris');
  });
  it('only accepts resolved text or announcement channels, and clears explicitly', async () => {
    const env = setup(); const advanced = await env.click(control(await env.open(), 'view', 'advanced')); const id = control(advanced, 'channel');
    await env.click(id, { componentKind: 'channelSelect', selectedValues: [channelId] }); expect(env.audit).toEqual([]);
    await env.click(id, { componentKind: 'channelSelect', selectedValues: [channelId], resolvedChannels: { [channelId]: { kind: 'other' } } }); expect(env.audit).toEqual([]);
    await env.click(id, { componentKind: 'channelSelect', selectedValues: [channelId], resolvedChannels: { [channelId]: { kind: 'announcement' } } }); expect(env.read().settings.auditChannelId).toBe(channelId);
    await env.click(control(advanced, 'clearChannel')); expect(env.read().settings.auditChannelId).toBeNull(); expect(env.audit).toHaveLength(2);
  });
  it('requires resolved roles, audits additions, and refuses everyone as officer', async () => {
    const env = setup(); const permissions = await env.click(control(await env.open(), 'view', 'permissions')); const officers = await env.click(control(permissions, 'view', 'officer')); const id = control(officers, 'add', 'officer');
    await env.click(id, { componentKind: 'roleSelect', selectedValues: [roleId] }); expect(env.audit).toEqual([]);
    await env.click(id, { componentKind: 'roleSelect', selectedValues: [roleId], resolvedRoles: { [roleId]: { name: 'Officers' } } }); expect(env.read().config.officer).toEqual([roleId]);
    const rejected = await env.click(id, { componentKind: 'roleSelect', selectedValues: [guildId], resolvedRoles: { [guildId]: { name: '@everyone' } } }); expect(text(rejected)).toContain('cannot be an officer'); expect(env.audit).toHaveLength(1);
  });
  it('confirms reopening to everyone and never replaces another configured role', async () => {
    const env = setup(); env.setConfig({ officer: [], member: [roleId] });
    const permissions = await env.click(control(await env.open(), 'view', 'permissions')); const members = await env.click(control(permissions, 'view', 'member'));
    const confirm = await env.click(control(members, 'view', 'everyone')); expect(env.audit).toEqual([]);
    await env.click(control(confirm, 'everyone')); expect(env.read().config.member).toEqual([roleId, guildId].sort());
    await env.click(control(members, 'remove', 'member'), { componentKind: 'stringSelect', selectedValues: [roleId] }); expect(env.read().config.member).toEqual([guildId]);
  });
  it('denies a privileged action to an officer and rechecks access before deferred work', async () => {
    const env = setup(); const permissions = await env.click(control(await env.open(), 'view', 'permissions')); const officers = await env.click(control(permissions, 'view', 'officer'));
    env.setConfig({ member: [], officer: [roleId] });
    expect(text(await env.click(control(officers, 'add'), { memberPermissions: 0n, memberRoleIds: [roleId] }))).toContain('required level: admin');
    const interaction = makeInteraction({ kind: 'component', componentKind: 'button', customId: control(await env.open(), 'view', 'home'), memberRoleIds: [roleId], message: { id: MessageId.assert('910000000000000001'), channelId } });
    const pending = await env.pipeline.handle(interaction); expect(pending.kind).toBe('deferred'); env.setConfig({ member: [], officer: [] });
    expect(text(pending.kind === 'deferred' ? await pending.run() : pending)).toContain('required level: officer');
  });
  it('previews deletion without mutation, suspends after confirmation, and recovers from a new panel', async () => {
    const env = setup(); const home = await env.open(); const data = await env.click(control(home, 'view', 'data')); const confirm = await env.click(control(data, 'view', 'delete'));
    expect(env.read().inactive).toBeNull(); expect(text(confirm)).toContain('not automatically deleted');
    const suspended = await env.click(control(confirm, 'delete')); expect(env.read().inactive).not.toBeNull(); expect(text(suspended)).toContain('suspended');
    await env.click(control(home, 'disable', 'timers')); expect(env.read().settings.features.timers).toBe(true);
    env.advance(16 * 60 * 1000);
    const recovery = await env.open(); expect(text(recovery)).toContain('suspended');
    await env.click(control(recovery, 'cancel')); expect(env.read().inactive).toBeNull();
    expect(text(await env.open())).toContain('Overview');
  });
  it('validates owner, guild, expiry and source message', async () => {
    const env = setup(); const id = control(await env.open(), 'view', 'advanced');
    expect(text(await env.click(id, { userId: UserId.assert('500000000000000002') }))).toContain('another user');
    expect(text(await env.click(id.replace(guildId, '700000000000000002')))).toContain('expired');
    expect(text(await env.click(id, { message: null }))).toContain('expired');
    env.advance(15 * 60 * 1000); expect(text(await env.click(id))).toContain('expired'); expect(env.audit).toEqual([]);
  });
  it('redirects old commands without applying arguments', async () => {
    const env = setup(); const reply = await env.open({ commandPath: ['picket', 'settings', 'feature'], options: { feature: 'warlog', enabled: false } });
    expect(text(reply)).toContain('No old command arguments'); expect(env.read().settings.features.warlog).toBe(true); expect(env.audit).toEqual([]);
  });
  it('delivers an initial panel by editing the private deferred response', async () => {
    const env = setup(); const interaction = makeInteraction({ commandPath: ['picket', 'settings'], memberPermissions: 8n });
    const pending = await env.pipeline.handle(interaction); if (pending.kind !== 'deferred') throw new Error('deferred expected');
    const replies = new InMemoryInteractionReplies(); await deliverDeferred({ reply: pending, interaction, replies, logger: noopLogger });
    expect(replies.replies).toMatchObject([{ action: 'editOriginal', content: { components: expect.any(Array) } }]);
  });

  it('keeps deletion and cancellation actions away from officers, even with an old administrator control', async () => {
    const env = setup(); const data = await env.click(control(await env.open(), 'view', 'data')); const confirm = await env.click(control(data, 'view', 'delete'));
    env.setConfig({ officer: [roleId], member: [guildId as string as RoleId] });
    const caller = { memberRoleIds: [roleId], memberPermissions: 0n };
    expect(text(await env.click(control(confirm, 'delete'), caller))).toContain('required level: admin'); expect(env.read().inactive).toBeNull();
    const suspended = await env.click(control(confirm, 'delete'));
    expect(text(await env.click(control(suspended, 'cancel'), caller))).toContain('required level: admin');
    const readOnly = await env.open(caller); expect(text(readOnly)).toContain('Only a server administrator'); expect(text(readOnly)).not.toContain('psback');
  });

  it('delivers rich updates using the current component token without a follow-up', async () => {
    const env = setup(); const home = await env.open(); const interaction = makeInteraction({ kind: 'component', componentKind: 'button', customId: control(home, 'view', 'advanced'), memberPermissions: 8n, message: { id: MessageId.assert('910000000000000001'), channelId } });
    const pending = await env.pipeline.handle(interaction); if (pending.kind !== 'deferred') throw new Error('deferred expected');
    const replies = new InMemoryInteractionReplies(); await deliverDeferred({ reply: pending, interaction, replies, logger: noopLogger });
    expect(replies.replies).toMatchObject([{ action: 'editOriginal', target: { token: interaction.token }, content: { components: expect.any(Array) } }]);
  });
  it('paginates all languages while retaining Automatic on every page', async () => {
    const catalogs = loadCatalogs();
    const locales = ['en', 'fr', 'de', 'es-ES', 'es-419', 'it', 'pt-BR', 'pl', 'ru', 'uk', 'ja', 'ko', 'zh-CN', 'zh-TW', 'da', 'fi', 'sv-SE', 'nb', 'nl', 'cs', 'sk', 'hu', 'ro', 'bg', 'el', 'tr', 'vi', 'th', 'hi'];
    const env = setup(createI18n(Object.fromEntries(locales.map((locale) => [locale, catalogs.en]))));
    const language = await env.click(control(await env.open(), 'view', 'language'));
    const first = view(language).components.find((item) => item.kind === 'stringSelect');
    expect(first?.kind === 'stringSelect' && first.options).toHaveLength(25);
    const next = await env.click(control(language, 'language', '1'));
    const menu = view(next).components.find((item) => item.kind === 'stringSelect');
    expect(menu?.kind === 'stringSelect' && menu.options.map((item) => item.value)).toEqual(['auto', ...locales.slice(24)]);
    await env.click(control(next, 'language', '1'), { componentKind: 'stringSelect', selectedValues: ['hi'] });
    expect(env.read().settings.locale).toBe('hi');
  });

  it('paginates configured roles instead of dropping entries beyond 25', async () => {
    const env = setup(); const roles = Array.from({ length: 31 }, (_, n) => RoleId.assert(String(400000000000000000n + BigInt(n)))); env.setConfig({ member: roles, officer: [] });
    const permissions = await env.click(control(await env.open(), 'view', 'permissions')); const members = await env.click(control(permissions, 'view', 'member'));
    expect(text(members)).toContain('Page 1 / 2'); const next = await env.click(control(members, 'member', '1')); expect(text(next)).toContain(roles[30]); expect(text(next)).toContain('Page 2 / 2');
  });
});
