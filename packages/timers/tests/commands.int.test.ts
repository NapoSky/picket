import { InteractionPipeline, CommandRegistry, ComponentRegistry, deliverDeferred, toWireResponse, type AccessLevel, type InteractionReceipts, type PanelView, type Reply } from '@picket/discord';
import { InteractionId, MessageId, UserId, noopLogger } from '@picket/kernel';
import { InMemoryInteractionReplies, makeInteraction, testI18n, type TestDatabase } from '@picket/testing';
import { TIMERS_ROOT, ackCustomId, refreshCustomId, createTimerSettingsPanel, timersCommands, timersFamily } from '@picket/timers';
import { HOUR_MS, NOW, unix } from './fixtures';
import { openDatabase, resetTimerTables, timerHarness, type TimerHarness } from './harness';

const VIEW = 1n << 10n;
const SEND = 1n << 11n;
const EMBED = 1n << 14n;
const ALL = VIEW | SEND | EMBED;

let database: TestDatabase;
beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.drop();
});
beforeEach(async () => {
  await resetTimerTables(database);
});

class MemoryReceipts implements InteractionReceipts {
  readonly #seen = new Set<string>();
  async claim(id: InteractionId): Promise<boolean> {
    if (this.#seen.has(id)) return false;
    this.#seen.add(id);
    return true;
  }
}

type Overrides = Parameters<typeof makeInteraction>[0];

function app(h: TimerHarness) {
  const replies = new InMemoryInteractionReplies();
  const state: { level: AccessLevel | null; enabled: boolean; suspended: boolean } = { level: 'officer', enabled: true, suspended: false };
  const access = { levelOf: async () => state.level };
  const gate = { suspensionOf: async () => state.suspended ? { purgeAt: NOW } : null };
  const features = { isEnabled: async () => state.enabled };
  const settings = createTimerSettingsPanel({ getSettings: h.getSettings, updateSettings: h.updateSettings, access, gate, features, clock: h.clock, guildRoles: { names: async () => ({ [h.ids.guild]: '@everyone', '400000000000000011': 'Logistics' }) } });
  const pipeline = new InteractionPipeline({
    registry: new CommandRegistry(
      [TIMERS_ROOT],
      [settings.command, ...timersCommands({
        createBoard: h.createBoard,
        strike: h.strike,
        cleanup: h.cleanup,
        repair: h.repair,
        getSettings: h.getSettings,
        listActive: h.listActive,
      })],
      testI18n,
    ),
    components: new ComponentRegistry([settings.family, timersFamily({ add: h.addAsset, refresh: h.refresh, acknowledge: h.acknowledge })]),
    receipts: new MemoryReceipts(),
    access,
    gate,
    language: { localeOf: async () => null },
    features,
    logger: noopLogger,
  });

  let counter = 0;
  /** Comme le serveur HTTP : réponse immédiate, puis travail différé livré par l'adaptateur. */
  async function handle(overrides: Overrides): Promise<Reply> {
    counter += 1;
    const interaction = makeInteraction({
      id: InteractionId.assert(`94000000000${String(10_000 + counter)}`),
      guildId: h.ids.guild,
      channelId: h.ids.channel,
      userId: h.ids.user,
      appPermissions: ALL,
      locale: 'en-US',
      ...overrides,
    });
    const reply = await pipeline.handle(interaction);
    if (reply.kind === 'deferred') await deliverDeferred({ reply, interaction, replies, logger: noopLogger });
    return reply;
  }

  const command = (path: string[], options: Record<string, string | number | boolean> = {}, extra: Overrides = {}) =>
    handle({ kind: 'command', commandPath: ['timers', ...path], options, ...extra });
  const autocomplete = (path: string[], focusedOption: string, options: Record<string, string>, extra: Overrides = {}) =>
    handle({ kind: 'autocomplete', commandPath: ['timers', ...path], focusedOption, options, ...extra });
  const modal = (customId: string, fields: Record<string, string>, extra: Overrides = {}) => handle({ kind: 'modal', customId, fields, message: { id: MessageId.assert('900000000000000099'), channelId: h.ids.channel }, ...extra });
  const click = (customId: string, extra: Overrides = {}) =>
    handle({ kind: 'component', componentKind: 'button', customId, message: { id: MessageId.assert('900000000000000099'), channelId: h.ids.channel }, ...extra });
  const text = (reply: Reply) => (reply.kind === 'message' ? reply.content : '');
  /** Texte livré à l'utilisateur après le travail différé, ou le message immédiat. */
  const said = async (action: Promise<Reply>) => {
    const before = replies.contents.length;
    const reply = await action;
    return reply.kind === 'deferred' ? (replies.contents.slice(before).at(-1) ?? null) : text(reply);
  };
  const panel = (): PanelView => {
    const content = replies.contents.at(-1);
    if (content === null || content === undefined || typeof content === 'string' || 'file' in content) throw new Error('no panel delivered');
    toWireResponse({ kind: 'panel', update: true, panel: content });
    return content;
  };
  const control = (action: string, arg = '0', view = panel()) => {
    const ids = view.components.flatMap((item) => item.kind === 'buttons' ? item.buttons.map((button) => button.customId) : item.kind === 'section' ? [item.button.customId] : 'customId' in item ? [item.customId] : []);
    const id = ids.find((candidate) => candidate.endsWith(`.${action}.${arg}`));
    if (!id) throw new Error(`no ${action}.${arg} control`);
    return id;
  };
  const panelText = () => panel().components.flatMap((item) => 'text' in item ? [item.text] : []).join('\n');
  return { replies, state, command, autocomplete, modal, click, text, said, handle, panel, control, panelText };
}

const stockpileModal = (h: TimerHarness) => `tm:1:a:st:allodsbight:mercyswail:${h.ids.user}`;
const choicesOf = (reply: Reply) => (reply.kind === 'autocomplete' ? reply.choices : []);

describe('/timers create', () => {
  it('creates the board, answers privately, and reposts it rather than creating a second one', async () => {
    const h = timerHarness(database);
    const { command, said } = app(h);
    expect(await said(command(['create']))).toBe('Timer board created. Timers added with /timers add appear here.');
    expect(h.boardMessages()).toHaveLength(1);
    expect(await said(command(['create']))).toBe('This channel already had a timer board: it was reposted with its timers.');
    expect(h.boardMessages()).toHaveLength(1);
  });

  it('puts the board back when its message was deleted, instead of asking for a repair', async () => {
    const h = timerHarness(database);
    const { command, said } = app(h);
    await said(command(['create']));
    const gone = h.boardMessages()[0];
    if (gone === undefined) throw new Error('no board message');
    await h.messaging.delete(h.ids.channel, gone.id);
    expect(await said(command(['create']))).toBe('This channel already had a timer board: it was reposted with its timers.');
    expect(h.boardMessages()).toHaveLength(1);
  });

  it('draws the board in the language of whoever creates it, not in the one of the community', async () => {
    const h = timerHarness(database);
    const { command, said } = app(h);
    await said(command(['create'], {}, { locale: 'fr', guildLocale: 'en-US' }));
    expect(h.boardMessages()[0]?.view.embeds[0]?.title).toBe('⏱️ Gestion des timers et refreshs');
  });

  it('is an officer command, off when the feature is disabled, and checks the bot rights before anything', async () => {
    const h = timerHarness(database);
    const { command, state, text, said } = app(h);
    state.level = 'member';
    expect(text(await command(['create']))).toContain('required level: officer');
    state.level = 'officer';
    state.enabled = false;
    expect(text(await command(['create']))).toContain('disabled on this server');
    state.enabled = true;
    expect(text(await command(['create'], {}, { appPermissions: VIEW }))).toBe(
      'I cannot post here. Missing permissions in this channel: Send Messages, Embed Links.',
    );
    expect(await said(command(['create']))).toContain('Timer board created.');
  });

  it('tells the user when the board was saved but Discord refused the message', async () => {
    const h = timerHarness(database);
    const { command, said } = app(h);
    h.messaging.failNext('send', 'missing_permissions');
    expect(await said(command(['create']))).toContain('could not be updated yet (missing_permissions)');
  });
});

describe('/timers add', () => {
  it('opens a modal asking for the name, the stockpile code and the duration, prefilled, carrying the choices in its id', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const { command } = app(h);
    const reply = await command(['add'], { type: 'stockpile', place: 'allodsbight.mercyswail' });
    expect(reply).toMatchObject({
      kind: 'modal',
      customId: stockpileModal(h),
      title: 'New timer: Stockpile',
      inputs: [
        { customId: 'name', required: true, maxLength: 15 },
        { customId: 'code', required: true, maxLength: 6, placeholder: '6-digit stockpile code' },
        { customId: 'duration', required: true, value: '50' },
      ],
    });
  });

  it('asks only what the type needs: no code for a facility, no duration for a field, an optional code for a tank', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const { command } = app(h);
    const inputsOf = async (type: string) => {
      const reply = await command(['add'], { type, place: 'allodsbight.mercyswail' });
      return reply.kind === 'modal' ? reply.inputs.map((input) => `${input.customId}${input.required ? '*' : ''}:${input.value ?? ''}`) : [];
    };
    expect(await inputsOf('facility')).toEqual(['name*:', 'duration*:50']);
    expect(await inputsOf('field')).toEqual(['name*:']);
    expect(await inputsOf('tank')).toEqual(['name*:', 'code:', 'duration*:48']);
  });

  it('accepts a region and a location typed by name, and keeps the owner chosen', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const { command } = app(h);
    const reply = await command(['add'], { type: 'train', place: 'mercyswail', owner: h.ids.other });
    expect(reply).toMatchObject({ kind: 'modal', customId: `tm:1:a:tr:allodsbight:mercyswail:${h.ids.other}` });
  });

  it('refuses before opening the modal: no board, board full, unknown place or type', async () => {
    const h = timerHarness(database);
    const { command, text } = app(h);
    const options = { type: 'stockpile', place: 'allodsbight.mercyswail' };
    expect(text(await command(['add'], options))).toContain('has no timer board');

    await h.boardWithMessage();
    expect(text(await command(['add'], { ...options, place: 'atlantis' }))).toBe('Unknown place. Start typing the name of the town and pick one of the suggestions.');
    expect(text(await command(['add'], { ...options, type: 'castle' }))).toBe('Unknown timer type.');

    await Promise.all(Array.from({ length: 50 }, (_, n) => h.add({ name: `Depot ${n}` })));
    expect(text(await command(['add'], options))).toContain('already holds 50 active timers');
  });

  it('is open to a plain member', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const { command, state } = app(h);
    state.level = 'member';
    expect((await command(['add'], { type: 'stockpile', place: 'allodsbight.mercyswail' })).kind).toBe('modal');
  });
});

describe('timer modal submission', () => {
  it('adds the timer, shows it on the board, and confirms privately', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const { modal, said } = app(h);
    const confirmation = await said(modal(stockpileModal(h), { name: ' Depot ', code: '123456', duration: '50' }));
    expect(confirmation).toBe(`Timer added: Depot (Mercy's Wail, Allod's Bight), <t:${unix(new Date(NOW.getTime() + 50 * HOUR_MS))}:R>.`);
    expect(h.lines()).toHaveLength(1);
    expect(await h.store.boardByChannel(h.ids.guild, h.ids.channel)).toMatchObject({ needsSync: false });
  });

  it('explains each rejected field, in the language of the user, without adding anything', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const { modal, said } = app(h);
    expect(await said(modal(stockpileModal(h), { name: 'Depot', code: '12', duration: '50' }))).toContain('Invalid code');
    expect(await said(modal(stockpileModal(h), { name: '', code: '123456', duration: '50' }))).toBe('The name is empty.');
    expect(await said(modal(stockpileModal(h), { name: 'x'.repeat(16), code: '123456', duration: '50' }))).toBe('The name is too long (maximum 15 characters).');
    expect(await said(modal(stockpileModal(h), { name: 'Depot', code: '123456', duration: 'soon' }))).toContain('Invalid duration');
    expect(await said(modal(stockpileModal(h), { name: 'Depot', code: '123456', duration: '999' }))).toBe('The duration is too long (maximum 30d).');
    expect(await said(modal(stockpileModal(h), { name: 'Depot', code: '12', duration: '50' }, { locale: 'fr' }))).toContain('Code invalide');
    expect(h.lines()).toHaveLength(0);
  });

  it('refuses a duplicate and relays a Discord failure without losing the saved timer', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const { modal, said } = app(h);
    await said(modal(stockpileModal(h), { name: 'Depot', code: '123456', duration: '50' }));
    expect(await said(modal(stockpileModal(h), { name: 'depot', code: '123456', duration: '50' }))).toContain('An identical active timer is already on this board');

    h.messaging.failNext('edit', 'missing_permissions');
    expect(await said(modal(stockpileModal(h), { name: 'Other', code: '654321', duration: '50' }))).toContain('could not be updated yet (missing_permissions)');
    expect(await h.listActive.execute(h.ids.guild, h.ids.channel, '')).toHaveLength(2);
  });

  it('refuses a forged or outdated id, and answers when the board is gone', async () => {
    const h = timerHarness(database);
    const { modal, said } = app(h);
    expect(await said(modal('tm:1:a:zz:x:y:1', { name: 'Depot' }))).toBe('This interaction is no longer available.');
    expect(await said(modal('tm:2:a:st:allodsbight:mercyswail:500000000000000001', { name: 'Depot' }))).toBe('This interaction is no longer available.');
    expect(await said(modal(stockpileModal(h), { name: 'Depot', code: '123456', duration: '50' }))).toContain('has no timer board');
  });
});

describe('autocomplete', () => {
  it('suggests places by town name, then by region, with the region in the label', async () => {
    const h = timerHarness(database);
    const { autocomplete } = app(h);
    const byTown = await autocomplete(['add'], 'place', { place: 'mercy' });
    expect(choicesOf(byTown)[0]).toEqual({ name: "Mercy's Wail (Allod's Bight)", value: 'allodsbight.mercyswail' });
    const byRegion = await autocomplete(['add'], 'place', { place: 'dead' });
    expect(choicesOf(byRegion).length).toBeGreaterThan(1);
    expect(await autocomplete(['add'], 'place', { place: 'zzzzzzzz' })).toEqual({ kind: 'autocomplete', choices: [] });
    expect(choicesOf(await autocomplete(['add'], 'place', { place: '' })).length).toBeLessThanOrEqual(25);
  });

  it('lists the active timers of this channel to strike, and nothing for someone without access', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const north = await h.add({ name: 'North' });
    await h.add({ name: 'South', code: '654321' });
    const { autocomplete, state } = app(h);

    const all = await autocomplete(['strike'], 'timer', { timer: '' });
    expect(all).toMatchObject({ kind: 'autocomplete', choices: [{ name: "📦 North 123456 · Mercy's Wail", value: north.id }, { value: expect.any(String) }] });
    expect(choicesOf(await autocomplete(['strike'], 'timer', { timer: 'sou' }))).toHaveLength(1);
    expect(await autocomplete(['strike'], 'timer', { timer: '' }, { channelId: h.ids.otherChannel })).toEqual({ kind: 'autocomplete', choices: [] });
    state.level = null;
    expect(await autocomplete(['strike'], 'timer', { timer: '' })).toEqual({ kind: 'autocomplete', choices: [] });
  });
});

describe('buttons', () => {
  it('a refresh click updates the board in place and says nothing', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const asset = await h.add();
    const { click, said, replies } = app(h);
    h.clock.advance(HOUR_MS);
    expect(await said(click(refreshCustomId(asset.id)))).toBeNull();
    expect(replies.replies).toHaveLength(0);
    expect(h.lines()[0]).toContain(`<t:${unix(new Date(NOW.getTime() + 51 * HOUR_MS))}:R>`);
  });

  it('tells who may not change a restricted board, a struck timer, a timer that is gone, or a forged id', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const asset = await h.add();
    await h.updateSettings.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, patch: { restrictChanges: true } });
    const { click, said, state } = app(h);
    state.level = 'member';
    const stranger: Overrides = { userId: UserId.assert('500000000000000777') };
    expect(await said(click(refreshCustomId(asset.id), stranger))).toBe('On this board only the owner of a timer and officers can change it.');
    expect(await said(click(refreshCustomId(asset.id)))).toBeNull();

    await h.strike.execute({ guildId: h.ids.guild, channelId: h.ids.channel, userId: h.ids.user, level: 'officer', assetId: asset.id });
    expect(await said(click(refreshCustomId(asset.id)))).toBe('This timer is already struck.');
    expect(await said(click(refreshCustomId('doesnotexist')))).toBe('This timer no longer exists.');
    expect(await said(click('tm:1:r:NOPE'))).toBe('This interaction is no longer available.');
    expect(await said(click('tm:9:r:abcdefgh12'))).toBe('This interaction is no longer available.');
  });

  it('acknowledging an alert removes its message', async () => {
    const h = timerHarness(database);
    const boardId = await h.boardWithMessage();
    const asset = await h.add({ duration: '10' });
    h.clock.set(new Date(NOW.getTime() + 8 * HOUR_MS));
    await h.maintenance.run(h.ids.guild, boardId);
    expect(h.alertMessages()).toHaveLength(1);
    const { click, said } = app(h);
    expect(await said(click(ackCustomId(asset.id, 120)))).toBeNull();
    expect(h.alertMessages()).toHaveLength(0);
  });
});

describe('/timers strike, cleanup and repair', () => {
  it('strikes a suggested timer, refuses a second strike, and cleans up', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const asset = await h.add({ name: 'North' });
    const { command, said } = app(h);

    expect(await said(command(['strike'], { timer: asset.id }))).toBe('Timer struck: North.');
    expect(h.lines()[0]?.startsWith('~~📦\u2009❌')).toBe(true);
    expect(await said(command(['strike'], { timer: asset.id }))).toBe('This timer is already struck.');
    expect(await said(command(['strike'], { timer: 'forged value' }))).toBe('This timer no longer exists.');

    expect(await said(command(['cleanup']))).toBe('Removed 1 struck timer.');
    expect(await said(command(['cleanup']))).toBe('Nothing to clean up: no timer is struck.');
    expect(await said(command(['repair']))).toBe('The board messages were reposted.');
  });

  it('keeps cleanup and repair for officers, and tells when the channel has no board', async () => {
    const h = timerHarness(database);
    const { command, state, text, said } = app(h);
    expect(await said(command(['cleanup']))).toContain('has no timer board');
    expect(await said(command(['repair']))).toContain('has no timer board');
    state.level = 'member';
    expect(text(await command(['cleanup']))).toContain('required level: officer');
    expect(text(await command(['repair']))).toContain('required level: officer');
  });
});

describe('/timers settings panel', () => {
  it('opens a private panel with no published arguments and updates it on navigation', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    await h.add();
    const ui = app(h);
    expect(await ui.command(['settings'])).toMatchObject({ kind: 'deferred', ephemeral: true, update: false });
    expect(ui.panelText()).toContain('1/50');
    expect(ui.panelText()).toContain('This private panel');
    expect(await ui.click(ui.control('view', 'alerts'))).toMatchObject({ kind: 'deferred', update: true });
    expect(ui.panelText()).toContain('2h');
    expect(ui.panelText()).toContain('Roles to notify');
    expect(ui.replies.replies.every((reply) => reply.action === 'editOriginal')).toBe(true);
    await ui.click(ui.control('view', 'manage'));
    expect(ui.panelText()).toContain('Coming soon');
    expect(ui.panelText()).not.toContain('max-active');
  });

  it('ignores stale command arguments instead of applying hidden changes', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const ui = app(h);
    await ui.command(['settings'], { alerts: false, 'max-active': 100, 'region-emoji': '🌍' });
    expect(ui.panelText()).toContain('No settings were changed');
    expect((await h.getSettings.execute(h.ids.guild, h.ids.channel))?.board.settings.alertsEnabled).toBe(true);
  });

  it('prefills threshold modals, validates them and applies the result to the same panel', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const ui = app(h);
    await ui.command(['settings']);
    await ui.click(ui.control('view', 'alerts'));
    const form = await ui.click(ui.control('form', 'thres'));
    if (form.kind !== 'modal') throw new Error('no modal');
    expect(form.inputs[0]?.value).toBe('2h');
    await ui.modal(form.customId, { value: '6h, 2h, 30m' });
    expect(ui.panelText()).toContain('Board settings updated');
    expect((await h.getSettings.execute(h.ids.guild, h.ids.channel))?.board.settings.alertThresholdsMin).toEqual([360, 120, 30]);
    await ui.modal(form.customId, { value: '1m' });
    expect(ui.panelText()).toContain('Invalid thresholds');
    expect((await h.getSettings.execute(h.ids.guild, h.ids.channel))?.board.settings.alertThresholdsMin).toEqual([360, 120, 30]);
  });

  it('uses desired states for double clicks and confirms disabling alerts', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const ui = app(h);
    await ui.command(['settings']);
    await ui.click(ui.control('view', 'alerts'));
    await ui.click(ui.control('view', 'off'));
    expect((await h.getSettings.execute(h.ids.guild, h.ids.channel))?.board.settings.alertsEnabled).toBe(true);
    const disable = ui.control('alrt', '0');
    await ui.click(disable);
    await ui.click(disable);
    expect(ui.panelText()).toContain('Nothing to change');
    expect((await h.getSettings.execute(h.ids.guild, h.ids.channel))?.board.settings.alertsEnabled).toBe(false);
    const notify = ui.control('quiet', '0');
    await ui.click(notify);
    await ui.click(notify);
    expect((await h.getSettings.execute(h.ids.guild, h.ids.channel))?.board.settings.alertSilent).toBe(false);
  });

  it('adds and removes roles one at a time, and refuses a missing resolved or deleted role', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const ui = app(h);
    await ui.command(['settings']);
    await ui.click(ui.control('view', 'alerts'));
    const role = '400000000000000011';
    await ui.click(ui.control('add'), { componentKind: 'roleSelect', selectedValues: [role] });
    expect(ui.panelText()).toContain('Invalid value');
    await ui.click(ui.control('add'), { componentKind: 'roleSelect', selectedValues: [role], resolvedRoles: { [role]: { name: 'Logistics' } } });
    expect((await h.getSettings.execute(h.ids.guild, h.ids.channel))?.board.settings.alertRoleIds).toEqual([role]);
    const gone = '400000000000000012';
    await ui.click(ui.control('add'), { componentKind: 'roleSelect', selectedValues: [gone], resolvedRoles: { [gone]: { name: 'Deleted' } } });
    expect(ui.panelText()).toContain('Invalid role');
    await ui.click(ui.control('del'), { componentKind: 'stringSelect', selectedValues: [role] });
    expect((await h.getSettings.execute(h.ids.guild, h.ids.channel))?.board.settings.alertRoleIds).toEqual([]);
  });

  it('confirms adding everyone and allows clearing the configured roles', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const ui = app(h);
    await ui.command(['settings']);
    await ui.click(ui.control('view', 'alerts'));
    await ui.click(ui.control('add'), { componentKind: 'roleSelect', selectedValues: [h.ids.guild], resolvedRoles: { [h.ids.guild]: { name: '@everyone' } } });
    expect((await h.getSettings.execute(h.ids.guild, h.ids.channel))?.board.settings.alertRoleIds).toEqual([]);
    await ui.click(ui.control('every'));
    expect((await h.getSettings.execute(h.ids.guild, h.ids.channel))?.board.settings.alertRoleIds).toEqual([h.ids.guild]);
    await ui.click(ui.control('clear'));
    expect((await h.getSettings.execute(h.ids.guild, h.ids.channel))?.board.settings.alertRoleIds).toEqual([]);
  });

  it('sets ownership restrictions without exposing a duplicate policy', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const ui = app(h);
    await ui.command(['settings']);
    await ui.click(ui.control('view', 'manage'));
    expect(ui.panel().components.some((item) => item.kind === 'stringSelect')).toBe(false);
    await ui.click(ui.control('guard', '1'));
    expect((await h.getSettings.execute(h.ids.guild, h.ids.channel))?.board.settings).toMatchObject({ restrictChanges: true });
  });

  it('confirms an automatic cleanup delay before deleting already due timers, and accepts zero', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    await h.updateSettings.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, patch: { purgeAfterHours: 0 } });
    const asset = await h.add();
    await h.strike.execute({ guildId: h.ids.guild, channelId: h.ids.channel, userId: h.ids.user, level: 'officer', assetId: asset.id });
    h.clock.advance(2 * HOUR_MS);
    const ui = app(h);
    await ui.command(['settings']);
    await ui.click(ui.control('view', 'manage'));
    const form = await ui.click(ui.control('form', 'purge'));
    if (form.kind !== 'modal') throw new Error('no modal');
    expect(form.inputs[0]?.value).toBe('0');
    await ui.modal(form.customId, { value: '1' });
    expect(ui.panelText()).toContain('This deletion is permanent');
    expect((await h.store.state(h.ids.guild, asset.boardId))?.assets).toHaveLength(1);
    await ui.click(ui.control('purge', '1'));
    expect((await h.store.state(h.ids.guild, asset.boardId))?.assets).toHaveLength(0);
    await ui.modal(form.customId, { value: '0' });
    expect((await h.getSettings.execute(h.ids.guild, h.ids.channel))?.board.settings.purgeAfterHours).toBeNull();
    await ui.modal(form.customId, { value: '721' });
    expect(ui.panelText()).toContain('between 0 (never) and 720 hours');
  });

  it('rejects a different owner, expired panels and a panel whose board was replaced', async () => {
    const h = timerHarness(database);
    const boardId = await h.boardWithMessage();
    const ui = app(h);
    await ui.command(['settings']);
    const alerts = ui.control('view', 'alerts');
    expect(await ui.said(ui.click(alerts, { userId: h.ids.other }))).toContain('another user');
    h.clock.advance(16 * 60_000);
    expect(await ui.said(ui.click(alerts))).toContain('Run /timers settings again');
    await ui.command(['settings']);
    const old = ui.control('view', 'alerts');
    await h.store.archive(h.ids.guild, boardId, 'unknown_channel', h.clock.now());
    await h.boardWithMessage();
    expect(await ui.said(ui.click(old))).toContain('its board has changed');
  });

  it('rechecks officer access, feature activation and suspension on every interaction', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const ui = app(h);
    await ui.command(['settings']);
    const button = ui.control('view', 'alerts');
    ui.state.level = 'member';
    expect(await ui.said(ui.click(button))).toContain('required level: officer');
    ui.state.level = 'admin';
    ui.state.enabled = false;
    expect(await ui.said(ui.click(button))).toContain('disabled on this server');
    ui.state.enabled = true;
    ui.state.suspended = true;
    expect(await ui.said(ui.click(button))).toContain('scheduled for deletion');
    ui.state.suspended = false;
    await ui.click(button);
    expect(ui.panelText()).toContain('Roles to notify');
  });

  it('keeps working through another process and preserves concurrent targeted changes', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const first = app(h);
    await first.command(['settings']);
    await first.click(first.control('view', 'alerts'));
    const notify = first.control('quiet', '0');
    const second = app(h);
    await second.command(['settings']);
    await second.click(second.control('view', 'manage'));
    const guard = second.control('guard', '1');
    // New pipeline instance handles a control created by the first one; no collector or session is needed.
    await Promise.all([second.click(notify), first.click(guard)]);
    expect((await h.getSettings.execute(h.ids.guild, h.ids.channel))?.board.settings).toMatchObject({ alertSilent: false, restrictChanges: true });
  });

  it('says the channel has no board', async () => {
    const h = timerHarness(database);
    const ui = app(h);
    expect(await ui.said(ui.command(['settings']))).toContain('has no timer board');
  });
});
