import { purgeGuildData } from '@picket/persistence';
import { queryAsAdmin, type TestDatabase } from '@picket/testing';
import { DEFAULT_BOARD_SETTINGS, ackCustomId, refreshCustomId } from '@picket/timers';
import { HOUR_MS, NOW, makeAsset, unix } from './fixtures';
import { createProcess, openDatabase, resetTimerTables, timerHarness, type TimerHarness } from './harness';

const MINUTE_MS = 60_000;
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

const count = async (sql: string, params: unknown[] = []) => (await queryAsAdmin<{ n: string }>(database, sql, params))[0]?.n;
const edits = (h: TimerHarness) => h.messaging.calls.filter((call) => call.startsWith('edit')).length;
const sends = (h: TimerHarness) => h.messaging.calls.filter((call) => call === 'send').length;

describe('board creation', () => {
  it('posts one empty message, records it, and plans nothing', async () => {
    const h = timerHarness(database);
    const boardId = await h.boardWithMessage();

    const messages = h.boardMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.view.embeds[0]).toMatchObject({ title: '⏱️ Timers', description: 'No timer yet. Add one with /timers add.' });
    expect(messages[0]?.view.buttons).toEqual([]);

    const board = await h.store.boardByChannel(h.ids.guild, h.ids.channel);
    expect(board).toMatchObject({ id: boardId, needsSync: false, syncError: null, settings: DEFAULT_BOARD_SETTINGS, archivedAt: null });
    expect(await h.store.pages(h.ids.guild, boardId)).toEqual([{ page: 0, messageId: messages[0]?.id, contentHash: expect.any(String) }]);
    expect(await queryAsAdmin(database, 'SELECT action FROM timer_events')).toEqual([{ action: 'board_create' }]);
    expect(await count('SELECT count(*) AS n FROM timer_schedule')).toBe('0');
  });

  it('refuses a second board in the same channel without posting anything', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const before = sends(h);
    expect(await h.createBoard.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, locale: null })).toEqual({ kind: 'exists' });
    expect(sends(h)).toBe(before);
    expect(await count('SELECT count(*) AS n FROM timer_boards')).toBe('1');
  });

  it('TIM-RQ-13: caps the boards of a guild at ten, and refuses before posting anything', async () => {
    const h = timerHarness(database);
    for (let index = 0; index < 10; index += 1) {
      const channel = `61000000000${String(index).padStart(8, '0')}`;
      const created = await h.createBoard.execute({ guildId: h.ids.guild, channelId: channel as typeof h.ids.channel, actor: h.ids.user, locale: null });
      expect(created.kind).toBe('created');
    }
    const before = sends(h);
    expect(await h.createBoard.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, locale: null })).toEqual({ kind: 'quota', max: 10 });
    expect(sends(h)).toBe(before);
  });

  it('snapshots the language of the channel, used when the server imposes none', async () => {
    const h = timerHarness(database);
    await h.createBoard.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, locale: 'fr-FR' });
    expect(h.boardMessages()[0]?.view.embeds[0]?.description).toBe('Aucun timer pour le moment. Ajoutez-en un avec /timers add.');
  });
});

describe('adding timers', () => {
  it('stores the timer, records the event, and shows it with its button', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const asset = await h.add({ name: 'North depot' });

    expect(h.lines()).toEqual([`🇦・📦 **North depot** \`123456\`・<t:${unix(new Date(NOW.getTime() + 50 * HOUR_MS))}:R>・<@${h.ids.user}>`]);
    expect(h.boardMessages()[0]?.buttons).toEqual([{ customId: refreshCustomId(asset.id), emoji: '🇦' }]);
    expect(await queryAsAdmin(database, 'SELECT name, code, status, region_key, location_key FROM timer_assets')).toEqual([
      { name: 'North depot', code: '123456', status: 'active', region_key: 'allodsbight', location_key: 'mercyswail' },
    ]);
    expect(await queryAsAdmin(database, 'SELECT action FROM timer_events ORDER BY id')).toEqual([{ action: 'board_create' }, { action: 'add' }]);
    const board = await h.store.boardByChannel(h.ids.guild, h.ids.channel);
    expect(board).toMatchObject({ needsSync: false, rev: 1 });
  });

  it('plans the first alert for the moment the first threshold is reached', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    await h.add();
    const rows = await queryAsAdmin<{ wake_at: Date }>(database, 'SELECT wake_at FROM timer_schedule');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.wake_at).toEqual(new Date(NOW.getTime() + 48 * HOUR_MS));
  });

  it('TIM-EC-05: refuses beyond the quota before creating or editing any message', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    await h.updateSettings.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, patch: { maxActive: 2 } });
    await h.add({ name: 'A' });
    await h.add({ name: 'B' });
    const calls = [...h.messaging.calls];
    const result = await h.addAsset.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, ownerId: h.ids.user, asset: h.assetInput({ name: 'C' }) });
    expect(result).toEqual({ kind: 'quota', max: 2 });
    expect(h.messaging.calls).toEqual(calls);
    expect(await count("SELECT count(*) AS n FROM timer_assets WHERE status = 'active'")).toBe('2');
  });

  it('refuses an invalid timer without touching the database or Discord', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const calls = [...h.messaging.calls];
    const result = await h.addAsset.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, ownerId: h.ids.user, asset: h.assetInput({ code: '12' }) });
    expect(result).toEqual({ kind: 'invalid', error: { code: 'code_invalid' } });
    expect(h.messaging.calls).toEqual(calls);
    expect(await count('SELECT count(*) AS n FROM timer_assets')).toBe('0');
  });

  it('says so when the channel has no board', async () => {
    const h = timerHarness(database);
    expect(await h.addAsset.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, ownerId: h.ids.user, asset: h.assetInput() })).toEqual({ kind: 'no_board' });
  });

  it('TIM-RQ-08: warns about an identical active timer by default, and refuses it when the board says so', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    await h.add();
    const second = await h.addAsset.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, ownerId: h.ids.user, asset: h.assetInput({ name: 'DEPOT' }) });
    expect(second).toMatchObject({ kind: 'added', duplicateWarning: true, reactivated: false });
    expect(h.lines()).toHaveLength(2);

    await h.updateSettings.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, patch: { duplicates: 'refuse' } });
    const third = await h.addAsset.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, ownerId: h.ids.user, asset: h.assetInput() });
    expect(third).toEqual({ kind: 'duplicate' });
    expect(h.lines()).toHaveLength(2);
  });

  it('brings a struck timer back instead of duplicating it: same id, new duration, new owner', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const first = await h.add({ name: 'Depot' });
    await h.strike.execute({ guildId: h.ids.guild, channelId: h.ids.channel, userId: h.ids.user, level: 'member', assetId: first.id });
    const again = await h.addAsset.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, ownerId: h.ids.other, asset: h.assetInput({ name: 'depot', duration: '10' }) });
    expect(again).toMatchObject({ kind: 'added', reactivated: true, duplicateWarning: false });
    expect(await queryAsAdmin(database, 'SELECT id, status, duration_s, owner_user_id FROM timer_assets')).toEqual([
      { id: first.id, status: 'active', duration_s: 36_000, owner_user_id: h.ids.other },
    ]);
    expect(await queryAsAdmin(database, "SELECT action FROM timer_events WHERE action IN ('add', 'reactivate') ORDER BY id")).toEqual([{ action: 'add' }, { action: 'reactivate' }]);
  });
});

describe('striking, refreshing and cleaning up', () => {
  it('refreshing restarts the countdown, updates the board, and is audited', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const asset = await h.add();
    h.clock.advance(5 * HOUR_MS);
    const result = await h.refresh.execute({ guildId: h.ids.guild, channelId: h.ids.channel, userId: h.ids.other, level: 'member', assetId: asset.id });
    expect(result).toMatchObject({ kind: 'done', sync: { synced: true } });
    expect(h.lines()[0]).toContain(`<t:${unix(new Date(NOW.getTime() + 55 * HOUR_MS))}:R>`);
    expect(await queryAsAdmin(database, "SELECT actor_id FROM timer_events WHERE action = 'refresh'")).toEqual([{ actor_id: h.ids.other }]);
  });

  it('TIM-RQ-12 / TIM-EC-15: a burst of refreshes loses none and edits Discord far less than once per click', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const assets = [];
    for (let index = 0; index < 12; index += 1) assets.push(await h.add({ name: `T${index}`, code: String(100_000 + index) }));
    h.clock.advance(HOUR_MS);
    h.messaging.latencyMs = 15;
    const before = edits(h);

    const clicks = [...assets, ...assets, ...assets].map((asset) =>
      h.refresh.execute({ guildId: h.ids.guild, channelId: h.ids.channel, userId: h.ids.user, level: 'member', assetId: asset.id }),
    );
    const results = await Promise.all(clicks);

    expect(results.every((result) => result.kind === 'done')).toBe(true);
    expect(edits(h) - before).toBeLessThan(12);
    const expected = `<t:${unix(new Date(NOW.getTime() + 51 * HOUR_MS))}:R>`;
    expect(h.lines()).toHaveLength(12);
    expect(h.lines().every((line) => line.includes(expected))).toBe(true);
    expect(await count("SELECT count(*) AS n FROM timer_events WHERE action = 'refresh'")).toBe('36');
    expect((await h.store.boardByChannel(h.ids.guild, h.ids.channel))?.needsSync).toBe(false);
  });

  it('TIM-RQ-11: a board can reserve strike and refresh to the owner and the officers', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const asset = await h.add({}, h.ids.channel, h.ids.user);
    await h.updateSettings.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, patch: { restrictChanges: true } });

    const stranger = { guildId: h.ids.guild, channelId: h.ids.channel, userId: h.ids.other, level: 'member' as const, assetId: asset.id };
    expect(await h.refresh.execute(stranger)).toEqual({ kind: 'forbidden' });
    expect(await h.strike.execute({ ...stranger, channelId: h.ids.channel })).toEqual({ kind: 'forbidden' });
    expect(await h.refresh.execute({ ...stranger, level: 'officer' })).toMatchObject({ kind: 'done' });
    expect(await h.refresh.execute({ ...stranger, userId: h.ids.user })).toMatchObject({ kind: 'done' });
  });

  it('TIM-EC-08: striking keeps the original duration and freezes what was displayed', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const asset = await h.add();
    h.clock.advance(HOUR_MS);
    const result = await h.strike.execute({ guildId: h.ids.guild, channelId: h.ids.channel, userId: h.ids.user, level: 'member', assetId: asset.id });
    expect(result).toMatchObject({ kind: 'done' });
    expect(await queryAsAdmin(database, 'SELECT status, duration_s, frozen_at, struck_at FROM timer_assets')).toEqual([
      { status: 'struck', duration_s: 180_000, frozen_at: new Date(NOW.getTime() + 50 * HOUR_MS), struck_at: new Date(NOW.getTime() + HOUR_MS) },
    ]);
    expect(h.boardMessages()[0]?.buttons).toEqual([]);
    expect(h.lines()[0]?.startsWith('~~❌・📦')).toBe(true);
    expect(await h.strike.execute({ guildId: h.ids.guild, channelId: h.ids.channel, userId: h.ids.user, level: 'member', assetId: asset.id })).toEqual({ kind: 'already_struck' });
    expect(await h.refresh.execute({ guildId: h.ids.guild, channelId: h.ids.channel, userId: h.ids.user, level: 'member', assetId: asset.id })).toEqual({ kind: 'already_struck' });
  });

  it('answers not_found for an unknown timer, or one of another board', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    await h.boardWithMessage(h.ids.otherChannel);
    const asset = await h.add({}, h.ids.otherChannel);
    expect(await h.strike.execute({ guildId: h.ids.guild, channelId: h.ids.channel, userId: h.ids.user, level: 'member', assetId: asset.id })).toEqual({ kind: 'not_found' });
    expect(await h.strike.execute({ guildId: h.ids.guild, channelId: h.ids.channel, userId: h.ids.user, level: 'member', assetId: 'doesnotexist' })).toEqual({ kind: 'not_found' });
    expect(await h.refresh.execute({ guildId: h.ids.guild, channelId: h.ids.channel, userId: h.ids.user, level: 'member', assetId: 'doesnotexist' })).toEqual({ kind: 'no_board' });
  });

  it('IDOR: a button forged from another channel cannot act on this board, whatever the level', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    await h.boardWithMessage(h.ids.otherChannel);
    const asset = await h.add({ duration: '10' });
    const forged = { guildId: h.ids.guild, channelId: h.ids.otherChannel, userId: h.ids.other, level: 'admin' as const, assetId: asset.id };
    expect(await h.refresh.execute(forged)).toEqual({ kind: 'no_board' });
    expect(await h.acknowledge.execute({ guildId: h.ids.guild, channelId: h.ids.otherChannel, assetId: asset.id, thresholdMin: 120, actor: h.ids.other })).toEqual({
      kind: 'unknown',
    });
    expect(await count("SELECT count(*) AS n FROM timer_events WHERE action = 'refresh'")).toBe('0');
  });

  it('cleanup removes the struck timers and says so when there are none', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const keep = await h.add({ name: 'Keep' });
    const drop = await h.add({ name: 'Drop', code: '654321' });
    expect(await h.cleanup.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user })).toEqual({ kind: 'nothing' });
    await h.strike.execute({ guildId: h.ids.guild, channelId: h.ids.channel, userId: h.ids.user, level: 'member', assetId: drop.id });
    expect(await h.cleanup.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user })).toMatchObject({ kind: 'cleaned', removed: 1 });
    expect(await queryAsAdmin(database, 'SELECT id FROM timer_assets')).toEqual([{ id: keep.id }]);
    expect(h.lines()).toHaveLength(1);
  });

  it('TIM-EC-21: cleaning a board of only struck timers leaves its message in place, now empty', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const asset = await h.add();
    await h.strike.execute({ guildId: h.ids.guild, channelId: h.ids.channel, userId: h.ids.user, level: 'member', assetId: asset.id });
    const [message] = h.boardMessages();
    await h.cleanup.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user });
    expect(h.boardMessages().map((entry) => entry.id)).toEqual([message?.id]);
    expect(h.boardMessages()[0]?.view.embeds[0]?.description).toBe('No timer yet. Add one with /timers add.');
  });
});

describe('pagination on Discord', () => {
  it('opens a second message past 25 active timers, and removes it when the timers go, never the last one', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const assets = [];
    for (let index = 0; index < 27; index += 1) assets.push(await h.add({ name: `T${String(index).padStart(2, '0')}`, code: String(100_000 + index) }));
    expect(h.boardMessages()).toHaveLength(2);
    expect(h.boardMessages().map((message) => message.buttons.length)).toEqual([25, 2]);
    expect(h.boardMessages()[0]?.view.embeds.at(-1)?.footer).toBe('⏱️ 1/2');
    const [first, second] = h.boardMessages();
    expect(await h.store.pages(h.ids.guild, (await h.store.boardByChannel(h.ids.guild, h.ids.channel))?.id ?? '')).toHaveLength(2);

    for (const asset of assets.slice(0, 5)) await h.strike.execute({ guildId: h.ids.guild, channelId: h.ids.channel, userId: h.ids.user, level: 'member', assetId: asset.id });
    await h.cleanup.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user });

    expect(h.boardMessages().map((message) => message.id)).toEqual([first?.id]);
    expect(h.messaging.calls).toContain(`delete:${second?.id}`);
    expect(await h.store.pages(h.ids.guild, (await h.store.boardByChannel(h.ids.guild, h.ids.channel))?.id ?? '')).toHaveLength(1);
  });
});

describe('resilience (TIM-RQ-15)', () => {
  it('TIM-EC-01: a message deleted by a moderator is reposted from the database at the next change', async () => {
    const h = timerHarness(database);
    const boardId = await h.boardWithMessage();
    await h.add({ name: 'Survivor' });
    const [page] = await h.store.pages(h.ids.guild, boardId);
    h.messaging.remove(h.ids.channel, page?.messageId as NonNullable<typeof page>['messageId']);
    expect(h.boardMessages()).toHaveLength(0);

    await h.add({ name: 'Second', code: '654321' });

    expect(h.boardMessages()).toHaveLength(1);
    expect(h.lines()).toHaveLength(2);
    const [after] = await h.store.pages(h.ids.guild, boardId);
    expect(after?.messageId).not.toBe(page?.messageId);
    expect(after?.messageId).toBe(h.boardMessages()[0]?.id);
  });

  it('repair republishes every page even when nothing changed', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    await h.add();
    const [message] = h.boardMessages();
    const before = edits(h);
    expect(await h.repair.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user })).toEqual({ kind: 'repaired', sync: { synced: true } });
    expect(edits(h)).toBe(before + 1);
    expect(h.messaging.calls).toContain(`edit:${message?.id}`);
    expect(await h.repair.execute({ guildId: h.ids.guild, channelId: h.ids.otherChannel, actor: h.ids.user })).toEqual({ kind: 'no_board' });
  });

  it('keeps the timer when Discord refuses, says so, and the planner catches up later', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    h.messaging.failNext('edit', 'missing_permissions');
    const result = await h.addAsset.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, ownerId: h.ids.user, asset: h.assetInput() });
    expect(result).toMatchObject({ kind: 'added', sync: { synced: false, reason: 'missing_permissions' } });
    expect(h.lines()).toEqual([]);
    expect(await h.store.boardByChannel(h.ids.guild, h.ids.channel)).toMatchObject({ needsSync: true, syncError: 'missing_permissions' });

    // Pas avant l'heure de nouvelle tentative : on n'insiste pas auprès de Discord.
    expect(await h.sweep.tick()).toBe(0);
    h.clock.advance(5 * MINUTE_MS);
    expect(await h.sweep.tick()).toBe(1);
    expect(h.lines()).toHaveLength(1);
    expect(await h.store.boardByChannel(h.ids.guild, h.ids.channel)).toMatchObject({ needsSync: false, syncError: null });
  });

  it('a crash between the change and the render is repaired by the planner (the change is its own outbox)', async () => {
    const h = timerHarness(database);
    const boardId = await h.boardWithMessage();
    await h.store.mutate(
      h.ids.guild,
      boardId,
      () => ({ result: null, changes: [{ kind: 'insert', asset: makeAsset({ boardId, id: 'crashedasset' }) }], events: [{ actor: h.ids.user, action: 'add' }] }),
      h.clock.now(),
    );
    expect(h.lines()).toEqual([]);
    expect(await h.sweep.tick()).toBe(1);
    expect(h.lines()).toHaveLength(1);
  });

  it('a change arriving during a render is not lost: the board stays pending until it is rendered', async () => {
    const h = timerHarness(database);
    const boardId = await h.boardWithMessage();
    const board = await h.store.state(h.ids.guild, boardId);
    await h.store.mutate(h.ids.guild, boardId, () => ({ result: null, events: [{ actor: h.ids.user, action: 'repair' }] }), h.clock.now());
    // Un rendu qui avait lu l'ancienne révision ne peut pas déclarer le board à jour.
    expect(await h.store.markSynced(h.ids.guild, boardId, { rev: board?.board.rev ?? 0, syncError: null })).toBe(false);
    expect((await h.store.boardByChannel(h.ids.guild, h.ids.channel))?.needsSync).toBe(true);
  });

  it('disables the board when its channel is gone, keeps its history, and lets a new board take the channel', async () => {
    const h = timerHarness(database);
    const boardId = await h.boardWithMessage();
    h.messaging.failNext('edit', 'unknown_channel');
    const result = await h.addAsset.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, ownerId: h.ids.user, asset: h.assetInput() });
    expect(result).toMatchObject({ kind: 'added', sync: { synced: false, reason: 'unknown_channel' } });

    expect(await h.store.boardByChannel(h.ids.guild, h.ids.channel)).toBeNull();
    expect(await queryAsAdmin(database, 'SELECT sync_error, archived_at IS NOT NULL AS archived FROM timer_boards WHERE id = $1', [boardId])).toEqual([
      { sync_error: 'unknown_channel', archived: true },
    ]);
    expect(await queryAsAdmin(database, "SELECT action FROM timer_events WHERE action = 'board_disabled'")).toHaveLength(1);
    expect(await count('SELECT count(*) AS n FROM timer_schedule')).toBe('0');
    expect(await count('SELECT count(*) AS n FROM timer_assets')).toBe('1');

    const again = await h.createBoard.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, locale: null });
    expect(again.kind).toBe('created');
  });
});

describe('alerts (TIM-RQ-09)', () => {
  const alertSetup = async (duration = '10') => {
    const h = timerHarness(database);
    const boardId = await h.boardWithMessage();
    const asset = await h.add({ duration });
    return { h, boardId, asset };
  };
  const toRemaining = (h: TimerHarness, minutes: number, hours = 10) => h.clock.set(new Date(NOW.getTime() + hours * HOUR_MS - minutes * MINUTE_MS));

  it('sends one alert when the threshold is reached: silent, with an acknowledge button, never twice', async () => {
    const { h, boardId, asset } = await alertSetup();
    toRemaining(h, 121);
    expect(await h.sweep.tick()).toBe(0);

    toRemaining(h, 120);
    expect(await h.sweep.tick()).toBe(1);
    const [alert] = h.alertMessages();
    expect(h.alertMessages()).toHaveLength(1);
    expect(alert?.view).toMatchObject({
      embeds: [],
      buttons: [{ customId: ackCustomId(asset.id, 120), emoji: '✅' }],
      silent: true,
      mentionRoleIds: [],
    });
    expect(alert?.view.content).toContain('**Depot**');
    expect(alert?.view.content).toContain("Mercy's Wail, Allod's Bight");
    expect(alert?.view.content).toContain(`<t:${unix(new Date(NOW.getTime() + 10 * HOUR_MS))}:R>`);

    await h.maintenance.run(h.ids.guild, boardId);
    await h.maintenance.run(h.ids.guild, boardId);
    expect(h.alertMessages()).toHaveLength(1);
  });

  it('two replicas working on the same board at the same moment send one alert', async () => {
    const { h, boardId } = await alertSetup();
    const second = createProcess(database, h.messaging, h.clock);
    toRemaining(h, 100);
    await Promise.all([h.maintenance.run(h.ids.guild, boardId), second.maintenance.run(h.ids.guild, boardId), h.maintenance.run(h.ids.guild, boardId)]);
    expect(h.alertMessages()).toHaveLength(1);
    expect(await count('SELECT count(*) AS n FROM timer_alerts')).toBe('1');
  });

  it('after an interruption, sends only the closest threshold and records the others as caught up', async () => {
    const { h, boardId } = await alertSetup();
    await h.updateSettings.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, patch: { alertThresholdsMin: [360, 120, 30] } });
    toRemaining(h, 25);
    await h.maintenance.run(h.ids.guild, boardId);

    expect(h.alertMessages()).toHaveLength(1);
    expect(h.alertMessages()[0]?.buttons[0]?.customId.endsWith(':30')).toBe(true);
    expect(await queryAsAdmin(database, 'SELECT threshold_min, message_id IS NOT NULL AS sent FROM timer_alerts ORDER BY threshold_min')).toEqual([
      { threshold_min: 30, sent: true },
      { threshold_min: 120, sent: false },
      { threshold_min: 360, sent: false },
    ]);
  });

  it('replaces an alert by the next one, so only the closest stays visible', async () => {
    const { h, boardId } = await alertSetup();
    await h.updateSettings.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, patch: { alertThresholdsMin: [120, 30] } });
    toRemaining(h, 100);
    await h.maintenance.run(h.ids.guild, boardId);
    expect(h.alertMessages()).toHaveLength(1);
    const [first] = h.alertMessages();

    toRemaining(h, 20);
    await h.maintenance.run(h.ids.guild, boardId);
    expect(h.alertMessages()).toHaveLength(1);
    expect(h.alertMessages()[0]?.id).not.toBe(first?.id);
    expect(h.alertMessages()[0]?.buttons[0]?.customId.endsWith(':30')).toBe(true);
  });

  it('acknowledging removes the message and remembers it: the same threshold does not come back', async () => {
    const { h, boardId, asset } = await alertSetup();
    toRemaining(h, 100);
    await h.maintenance.run(h.ids.guild, boardId);
    expect(await h.acknowledge.execute({ guildId: h.ids.guild, channelId: h.ids.channel, assetId: asset.id, thresholdMin: 120, actor: h.ids.other })).toEqual({ kind: 'acked' });

    expect(h.alertMessages()).toHaveLength(0);
    expect(await queryAsAdmin(database, 'SELECT acked_by, message_id FROM timer_alerts')).toEqual([{ acked_by: h.ids.other, message_id: null }]);
    await h.maintenance.run(h.ids.guild, boardId);
    expect(h.alertMessages()).toHaveLength(0);
    expect(await h.acknowledge.execute({ guildId: h.ids.guild, channelId: h.ids.channel, assetId: asset.id, thresholdMin: 120, actor: h.ids.other })).toEqual({ kind: 'unknown' });
  });

  it('TIM-EC-11: a refresh withdraws the alert and re-arms it for the new deadline', async () => {
    const { h, asset } = await alertSetup();
    toRemaining(h, 100);
    await h.sweep.tick();
    expect(h.alertMessages()).toHaveLength(1);

    await h.refresh.execute({ guildId: h.ids.guild, channelId: h.ids.channel, userId: h.ids.user, level: 'member', assetId: asset.id });
    expect(h.alertMessages()).toHaveLength(0);

    // Nouvelle échéance : 10 h après le refresh, donc le seuil se rejoue 8 h après lui.
    h.clock.advance(8 * HOUR_MS);
    await h.sweep.tick();
    expect(h.alertMessages()).toHaveLength(1);
    expect(await count('SELECT count(*) AS n FROM timer_alerts')).toBe('2');
  });

  it('a strike withdraws the alert', async () => {
    const { h, asset } = await alertSetup();
    toRemaining(h, 100);
    await h.sweep.tick();
    await h.strike.execute({ guildId: h.ids.guild, channelId: h.ids.channel, userId: h.ids.user, level: 'member', assetId: asset.id });
    expect(h.alertMessages()).toHaveLength(0);
  });

  it('TIM-EC-10: at the deadline the alert goes away and the board shows the timer expired, without removing it', async () => {
    const { h } = await alertSetup();
    toRemaining(h, 100);
    await h.sweep.tick();
    expect(h.alertMessages()).toHaveLength(1);
    expect(h.lines()[0]).not.toContain('⌛');

    h.clock.set(new Date(NOW.getTime() + 10 * HOUR_MS));
    expect(await h.sweep.tick()).toBe(1);
    expect(h.alertMessages()).toHaveLength(0);
    expect(h.lines()[0]).toContain('⌛');
    expect(await count("SELECT count(*) AS n FROM timer_assets WHERE status = 'active'")).toBe('1');
    expect(await count('SELECT count(*) AS n FROM timer_schedule')).toBe('0');
  });

  it('notifies the roles of the board and can use a push notification', async () => {
    const { h, boardId } = await alertSetup();
    await h.updateSettings.execute({
      guildId: h.ids.guild,
      channelId: h.ids.channel,
      actor: h.ids.user,
      patch: { alertRole: { action: 'add', roleId: '400000000000000011' as never }, alertSilent: false },
    });
    toRemaining(h, 100);
    await h.maintenance.run(h.ids.guild, boardId);
    const [alert] = h.alertMessages();
    expect(alert?.view.mentionRoleIds).toEqual(['400000000000000011']);
    expect(alert?.view.silent).toBe(false);
    expect(alert?.view.content?.startsWith('<@&400000000000000011> ')).toBe(true);
  });

  it('sends nothing when the board turned alerts off', async () => {
    const { h, boardId } = await alertSetup();
    await h.updateSettings.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, patch: { alertsEnabled: false } });
    toRemaining(h, 100);
    await h.maintenance.run(h.ids.guild, boardId);
    expect(h.alertMessages()).toHaveLength(0);
  });

  it('gives the claim back when Discord refuses, so the retry sends exactly one alert', async () => {
    const { h, boardId } = await alertSetup();
    toRemaining(h, 100);
    h.messaging.failNext('send', 'rate_limited');
    await h.maintenance.run(h.ids.guild, boardId);
    expect(h.alertMessages()).toHaveLength(0);
    expect(await count('SELECT count(*) AS n FROM timer_alerts')).toBe('0');

    expect(await h.sweep.tick()).toBe(0);
    h.clock.advance(61 * 1000);
    expect(await h.sweep.tick()).toBe(1);
    expect(h.alertMessages()).toHaveLength(1);
  });

  it('XCT-RQ-04: a guild that turned timers off gets no Discord request from the planner, only a later re-check', async () => {
    let enabled = true;
    const h = timerHarness(database, { features: () => enabled });
    await h.boardWithMessage();
    await h.add({ duration: '10' });
    enabled = false;
    toRemaining(h, 100);
    const calls = [...h.messaging.calls];
    expect(await h.sweep.tick()).toBe(0);
    expect(h.messaging.calls).toEqual(calls);
    const rows = await queryAsAdmin<{ wake_at: Date }>(database, 'SELECT wake_at FROM timer_schedule');
    expect(rows[0]?.wake_at).toEqual(new Date(h.clock.now().getTime() + 60 * MINUTE_MS));

    enabled = true;
    h.clock.advance(61 * MINUTE_MS);
    expect(await h.sweep.tick()).toBe(1);
    expect(h.alertMessages()).toHaveLength(1);
  });

  it('does not serve a guild that removed the bot, and catches up when it comes back', async () => {
    const { h } = await alertSetup();
    await queryAsAdmin(database, "INSERT INTO guild_registry (guild_id, inactive_since, inactive_reason) VALUES ($1, now(), 'left')", [h.ids.guild]);
    toRemaining(h, 100);
    expect(await h.sweep.tick()).toBe(0);
    expect(h.alertMessages()).toHaveLength(0);

    await queryAsAdmin(database, 'UPDATE guild_registry SET inactive_since = NULL, inactive_reason = NULL WHERE guild_id = $1', [h.ids.guild]);
    expect(await h.sweep.tick()).toBe(1);
    expect(h.alertMessages()).toHaveLength(1);
  });
});

describe('automatic purge (TIM-RQ-07)', () => {
  it('deletes struck timers after the delay, keeps the history, and refreshes the board', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const asset = await h.add();
    await h.updateSettings.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, patch: { purgeAfterHours: 1 } });
    await h.strike.execute({ guildId: h.ids.guild, channelId: h.ids.channel, userId: h.ids.user, level: 'member', assetId: asset.id });

    h.clock.advance(30 * MINUTE_MS);
    expect(await h.sweep.tick()).toBe(0);
    expect(h.lines()).toHaveLength(1);

    h.clock.advance(31 * MINUTE_MS);
    expect(await h.sweep.tick()).toBe(1);
    expect(await count('SELECT count(*) AS n FROM timer_assets')).toBe('0');
    expect(h.lines()).toHaveLength(0);
    expect(await queryAsAdmin(database, "SELECT actor_id, detail FROM timer_events WHERE action = 'auto_purge'")).toEqual([{ actor_id: 'system', detail: { count: 1 } }]);
    expect(await count("SELECT count(*) AS n FROM timer_events WHERE action = 'add'")).toBe('1');
  });
});

describe('board settings', () => {
  it('shows nothing to change, applies a change, refuses an invalid one', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    await h.add();
    const settings = (patch: Parameters<typeof h.updateSettings.execute>[0]['patch']) =>
      h.updateSettings.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, patch });

    expect(await settings({ alertSilent: true })).toMatchObject({ kind: 'unchanged' });
    expect(await settings({ alertSilent: false, maxActive: 60 })).toMatchObject({ kind: 'updated', settings: { alertSilent: false, maxActive: 60 }, sync: { synced: true } });
    expect(await settings({ maxActive: 0 })).toEqual({ kind: 'invalid', error: 'invalid_max_active' });
    expect(await h.updateSettings.execute({ guildId: h.ids.guild, channelId: h.ids.otherChannel, actor: h.ids.user, patch: {} })).toEqual({ kind: 'no_board' });

    const current = await h.getSettings.execute(h.ids.guild, h.ids.channel);
    expect(current?.activeCount).toBe(1);
    expect(current?.board.settings).toMatchObject({ alertSilent: false, maxActive: 60 });
    expect(await queryAsAdmin(database, "SELECT detail FROM timer_events WHERE action = 'settings'")).toHaveLength(1);
  });

  it('lists the active timers of the channel board for the strike suggestions', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    const keep = await h.add({ name: 'North' });
    const gone = await h.add({ name: 'South', code: '654321' });
    await h.strike.execute({ guildId: h.ids.guild, channelId: h.ids.channel, userId: h.ids.user, level: 'member', assetId: gone.id });

    expect((await h.listActive.execute(h.ids.guild, h.ids.channel, '')).map((asset) => asset.id)).toEqual([keep.id]);
    expect(await h.listActive.execute(h.ids.guild, h.ids.channel, 'nor')).toHaveLength(1);
    expect(await h.listActive.execute(h.ids.guild, h.ids.channel, 'zzz')).toEqual([]);
    expect(await h.listActive.execute(h.ids.guild, h.ids.otherChannel, '')).toEqual([]);
  });
});

describe('new war (TIM-RQ-14)', () => {
  it('empties only the boards that asked for it, and keeps the history', async () => {
    const h = timerHarness(database);
    await h.boardWithMessage();
    await h.boardWithMessage(h.ids.otherChannel);
    await h.add({}, h.ids.channel);
    await h.add({}, h.ids.otherChannel);
    await h.updateSettings.execute({ guildId: h.ids.guild, channelId: h.ids.channel, actor: h.ids.user, patch: { resetOnNewWar: true } });

    expect(await h.archiveOnNewWar.execute(h.ids.guild)).toEqual({ reset: 1, failed: 0 });
    expect(h.lines(h.ids.channel)).toEqual([]);
    expect(h.lines(h.ids.otherChannel)).toHaveLength(1);
    expect(await queryAsAdmin(database, "SELECT detail FROM timer_events WHERE action = 'reset_war'")).toEqual([{ detail: { count: 1 } }]);
    expect(await count("SELECT count(*) AS n FROM timer_events WHERE action = 'add'")).toBe('2');
  });
});

describe('isolation between servers', () => {
  it('shows nothing of a board to another guild, even with the right identifiers', async () => {
    const h = timerHarness(database);
    const boardId = await h.boardWithMessage();
    const asset = await h.add();
    const intruder = timerHarness(database);
    const { guild } = intruder.ids;

    expect(await h.store.state(guild, boardId)).toBeNull();
    expect(await h.store.boardByChannel(guild, h.ids.channel)).toBeNull();
    expect(await h.store.boardOfAsset(guild, asset.id)).toBeNull();
    expect(await h.store.mutate(guild, boardId, () => ({ result: 'changed', events: [{ actor: h.ids.user, action: 'repair' }] }), h.clock.now())).toBeNull();
    expect(await intruder.refresh.execute({ guildId: guild, channelId: h.ids.channel, userId: h.ids.user, level: 'admin', assetId: asset.id })).toEqual({ kind: 'no_board' });
    expect(await intruder.acknowledge.execute({ guildId: guild, channelId: h.ids.channel, assetId: asset.id, thresholdMin: 120, actor: h.ids.user })).toEqual({ kind: 'unknown' });
    expect(await h.getSettings.execute(guild, h.ids.channel)).toBeNull();
  });

  it('erases every timer row of a guild with the rest of its data, and only that guild', async () => {
    const h = timerHarness(database);
    const other = timerHarness(database);
    await h.boardWithMessage();
    await h.add({ duration: '10' });
    await other.boardWithMessage();
    await other.add();
    h.clock.set(new Date(NOW.getTime() + 9 * HOUR_MS));
    await h.sweep.tick();

    await purgeGuildData(database.handle.db, h.ids.guild);

    for (const table of ['timer_boards', 'timer_assets', 'timer_events', 'timer_board_messages', 'timer_alerts', 'timer_schedule']) {
      expect(await count(`SELECT count(*) AS n FROM ${table} WHERE guild_id = $1`, [h.ids.guild])).toBe('0');
    }
    expect(await count('SELECT count(*) AS n FROM timer_assets WHERE guild_id = $1', [other.ids.guild])).toBe('1');
  });
});
