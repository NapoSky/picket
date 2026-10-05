import { DEFAULT_BOARD_SETTINGS, nextWake, planAlerts, purgeCandidates, staleAlerts, strikeAsset, type AlertRow, type BoardSettings } from '@picket/timers';
import { HOUR_MS, NOW, makeAsset } from './fixtures';

const MINUTE_MS = 60_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const settings = (patch: Partial<BoardSettings> = {}): BoardSettings => ({ ...DEFAULT_BOARD_SETTINGS, alertThresholdsMin: [360, 120, 30], ...patch });
/** Un countdown de 10 h démarré à NOW : échéance à +10 h. */
const asset = makeAsset({ durationS: 10 * 3_600 });
const due = at(10 * HOUR_MS);
const row = (thresholdMin: number, extra: Partial<AlertRow> = {}): AlertRow => ({ assetId: asset.id, dueAt: due, thresholdMin, messageId: null, ackedAt: null, ...extra });
const remaining = (minutes: number) => at(10 * HOUR_MS - minutes * MINUTE_MS);

describe('planAlerts (TIM-RQ-09)', () => {
  it('says nothing before the first threshold, then one alert per threshold as each is reached', () => {
    expect(planAlerts([asset], [], settings(), remaining(361))).toEqual([]);
    expect(planAlerts([asset], [], settings(), remaining(360))).toEqual([{ assetId: asset.id, dueAt: due, thresholdMin: 360, send: true }]);
    expect(planAlerts([asset], [row(360, { messageId: '1' })], settings(), remaining(200))).toEqual([]);
    expect(planAlerts([asset], [row(360, { messageId: '1' })], settings(), remaining(120))).toEqual([{ assetId: asset.id, dueAt: due, thresholdMin: 120, send: true }]);
  });

  it('after an interruption, sends only the closest threshold and catches the others up silently', () => {
    const claims = planAlerts([asset], [], settings(), remaining(25));
    expect(claims).toEqual([
      { assetId: asset.id, dueAt: due, thresholdMin: 30, send: true },
      { assetId: asset.id, dueAt: due, thresholdMin: 120, send: false },
      { assetId: asset.id, dueAt: due, thresholdMin: 360, send: false },
    ]);
  });

  it('never claims a threshold twice, whether it was sent, caught up or acknowledged', () => {
    const existing = [row(360), row(120, { messageId: '2' }), row(30, { ackedAt: at(1) })];
    expect(planAlerts([asset], existing, settings(), remaining(25))).toEqual([]);
  });

  it('re-arms after a refresh: the new deadline has no alert yet', () => {
    const refreshed = { ...asset, startedAt: at(2 * HOUR_MS) };
    const existing = [row(360), row(120), row(30, { messageId: '3' })];
    // Échéance maintenant à +12 h : le seuil de 360 min est atteint à +6 h.
    expect(planAlerts([refreshed], existing, settings(), at(6 * HOUR_MS))).toEqual([
      { assetId: asset.id, dueAt: at(12 * HOUR_MS), thresholdMin: 360, send: true },
    ]);
  });

  it('ignores an expired countdown, an age, a struck asset, and a board with alerts off', () => {
    expect(planAlerts([asset], [], settings(), at(11 * HOUR_MS))).toEqual([]);
    expect(planAlerts([makeAsset({ type: 'field', direction: 'up' })], [], settings(), at(100 * HOUR_MS))).toEqual([]);
    expect(planAlerts([strikeAsset(asset, NOW)], [], settings(), remaining(10))).toEqual([]);
    expect(planAlerts([asset], [], settings({ alertsEnabled: false }), remaining(10))).toEqual([]);
  });
});

describe('staleAlerts', () => {
  it('retires the message of a struck, deleted, refreshed or expired asset', () => {
    const live = row(120, { messageId: '1' });
    expect(staleAlerts([asset], [live], remaining(100))).toEqual([]);
    expect(staleAlerts([strikeAsset(asset, NOW)], [live], remaining(100))).toEqual([live]);
    expect(staleAlerts([], [live], remaining(100))).toEqual([live]);
    expect(staleAlerts([{ ...asset, startedAt: at(HOUR_MS) }], [live], remaining(100))).toEqual([live]);
    expect(staleAlerts([asset], [live], at(10 * HOUR_MS))).toEqual([live]);
  });

  it('replaces an alert by a closer one, and ignores rows without a message', () => {
    const far = row(120, { messageId: '1' });
    const near = row(30, { messageId: '2' });
    expect(staleAlerts([asset], [far, near], remaining(20))).toEqual([far]);
    expect(staleAlerts([asset], [row(120), row(30)], remaining(20))).toEqual([]);
  });
});

describe('purgeCandidates', () => {
  it('is off by default, then removes struck and expired assets after the delay', () => {
    const struck = strikeAsset(makeAsset(), at(0));
    const expired = makeAsset({ durationS: 3_600 });
    const fresh = makeAsset();
    const all = [struck, expired, fresh];
    expect(purgeCandidates(all, settings(), at(1_000 * HOUR_MS))).toEqual([]);
    expect(purgeCandidates(all, settings({ purgeAfterHours: 24 }), at(10 * HOUR_MS))).toEqual([]);
    expect(purgeCandidates(all, settings({ purgeAfterHours: 24 }), at(24 * HOUR_MS))).toEqual([struck]);
    expect(purgeCandidates(all, settings({ purgeAfterHours: 24 }), at(25 * HOUR_MS))).toEqual([struck, expired]);
    expect(purgeCandidates(all, settings({ purgeAfterHours: 24 }), at(75 * HOUR_MS))).toEqual([struck, expired, fresh]);
  });
});

describe('nextWake', () => {
  const wake = (assets: Parameters<typeof nextWake>[0]['assets'], now: Date, patch: Partial<BoardSettings> = {}, needsSync = false) =>
    nextWake({ assets, settings: settings(patch), now, needsSync });

  it('wakes now while a render is pending', () => {
    expect(wake([], NOW, {}, true)).toEqual(NOW);
  });

  it('wakes at the next threshold, then at the deadline (to show it expired), then never', () => {
    expect(wake([asset], NOW)).toEqual(remaining(360));
    expect(wake([asset], remaining(359))).toEqual(remaining(120));
    expect(wake([asset], remaining(29))).toEqual(due);
    expect(wake([asset], at(10 * HOUR_MS + 1))).toBeNull();
  });

  it('skips thresholds when alerts are off, but still wakes at the deadline', () => {
    expect(wake([asset], NOW, { alertsEnabled: false })).toEqual(due);
  });

  it('plans the purge, immediately when it is already due', () => {
    expect(wake([strikeAsset(asset, NOW)], at(HOUR_MS), { purgeAfterHours: 24 })).toEqual(at(24 * HOUR_MS));
    expect(wake([strikeAsset(asset, NOW)], at(48 * HOUR_MS), { purgeAfterHours: 24 })).toEqual(at(48 * HOUR_MS));
  });

  it('has nothing to plan for an age, or an empty board', () => {
    expect(wake([makeAsset({ type: 'field', direction: 'up' })], NOW)).toBeNull();
    expect(wake([], NOW)).toBeNull();
  });
});
