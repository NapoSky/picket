import { InteractionPipeline, CommandRegistry, ComponentRegistry, deliverDeferred, type AccessLevel, type InteractionReceipts, type Reply } from '@picket/discord';
import { InteractionId, MessageId, UserId, noopLogger } from '@picket/kernel';
import { InMemoryInteractionReplies, makeInteraction, testI18n, type TestDatabase } from '@picket/testing';
import { TIMERS_ROOT, ackCustomId, refreshCustomId, timersCommands, timersFamily } from '@picket/timers';
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
  const state: { level: AccessLevel | null; enabled: boolean } = { level: 'officer', enabled: true };
  const pipeline = new InteractionPipeline({
    registry: new CommandRegistry(
      [TIMERS_ROOT],
      timersCommands({
        createBoard: h.createBoard,
        strike: h.strike,
        cleanup: h.cleanup,
        repair: h.repair,
        updateSettings: h.updateSettings,
        getSettings: h.getSettings,
        listActive: h.listActive,
      }),
      testI18n,
    ),
    components: new ComponentRegistry([timersFamily({ add: h.addAsset, refresh: h.refresh, acknowledge: h.acknowledge })]),
    receipts: new MemoryReceipts(),
    access: { levelOf: async () => state.level },
    gate: { suspensionOf: async () => null },
    language: { localeOf: async () => null },
    features: { isEnabled: async () => state.enabled },
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
  const modal = (customId: string, fields: Record<string, string>, extra: Overrides = {}) => handle({ kind: 'modal', customId, fields, ...extra });
  const click = (customId: string, extra: Overrides = {}) =>
    handle({ kind: 'component', customId, message: { id: MessageId.assert('900000000000000099'), channelId: h.ids.channel }, ...extra });
  const text = (reply: Reply) => (reply.kind === 'message' ? reply.content : '');
  /** Texte livré à l'utilisateur après le travail différé, ou le message immédiat. */
  const said = async (action: Promise<Reply>) => {
    const before = replies.contents.length;
    const reply = await action;
    return reply.kind === 'deferred' ? (replies.contents.slice(before).at(-1) ?? null) : text(reply);
  };
  return { replies, state, command, autocomplete, modal, click, text, said, handle };
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

    await h.updateSettings.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, patch: { maxActive: 1 } });
    await h.add();
    expect(text(await command(['add'], options))).toContain('already holds 1 active timers');
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

  it('warns about a duplicate and relays a Discord failure without losing the timer', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const { modal, said } = app(h);
    await said(modal(stockpileModal(h), { name: 'Depot', code: '123456', duration: '50' }));
    expect(await said(modal(stockpileModal(h), { name: 'depot', code: '123456', duration: '50' }))).toContain('an identical active timer was already on the board');

    h.messaging.failNext('edit', 'missing_permissions');
    expect(await said(modal(stockpileModal(h), { name: 'Other', code: '654321', duration: '50' }))).toContain('could not be updated yet (missing_permissions)');
    expect(await h.listActive.execute(h.ids.guild, h.ids.channel, '')).toHaveLength(3);
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

describe('/timers settings', () => {
  it('shows the settings, then applies the options given and shows the result', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    await h.add();
    const { command, said } = app(h);

    const shown = await said(command(['settings']));
    expect(shown).toContain('Alerts: on');
    expect(shown).toContain('Alert thresholds: 2h');
    expect(shown).toContain('Active timers: 1/50');
    expect(shown).toContain('Auto-purge: after 24 h');
    expect(shown).toContain('Board messages: up to date');

    const changed = await said(
      command(['settings'], { thresholds: '6h, 2h, 30m', 'alert-role': '400000000000000011', silent: false, duplicates: 'refuse', 'restrict-changes': true, 'max-active': 20, 'purge-after': 48 }),
    );
    expect(changed).toContain('Board settings updated.');
    expect(changed).toContain('Alert thresholds: 6h, 2h, 30m');
    expect(changed).toContain('Notified roles: <@&400000000000000011>');
    expect(changed).toContain('Alert mode: with push notification');
    expect(changed).toContain('Identical timers: refused');
    expect(changed).toContain('Strike and refresh: owner and officers only');
    expect(changed).toContain('Active timers: 1/20');
    expect(changed).toContain('Auto-purge: after 48 h');

    expect(await said(command(['settings'], { silent: false }))).toContain('Nothing to change.');
    expect(await said(command(['settings'], { 'alert-role-action': 'clear' }))).toContain('Notified roles: none');
  });

  it('explains each refusal', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    await h.add();
    await h.add({ name: 'Two', code: '654321' });
    const { command, said } = app(h);
    expect(await said(command(['settings'], { thresholds: 'soon' }))).toBe('Invalid thresholds. Example: 6h, 2h, 30m (at most 4, each between 5 minutes and 7 days).');
    expect(await said(command(['settings'], { 'alert-role-action': 'add' }))).toBe('Give a role to add or remove.');
    expect(await said(command(['settings'], { 'max-active': 1 }))).toBe('The board already holds more active timers than that limit.');
    expect(await said(command(['settings'], { thresholds: '1m' }))).toContain('Invalid thresholds');
  });

  it('says the channel has no board', async () => {
    const h = timerHarness(database);
    const { command, said } = app(h);
    expect(await said(command(['settings']))).toContain('has no timer board');
    expect(await said(command(['settings'], { silent: true }))).toContain('has no timer board');
  });
});
