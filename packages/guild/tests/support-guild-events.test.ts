import { DiscordApiError, type Messaging } from '@picket/discord';
import { ObserveSupportGuildEvents, PublishSupportGuildEvents, supportGuildMessage,
  type SupportDelivery, type SupportGuildChange, type SupportGuildEventsRepository } from '@picket/guild';
import { ChannelId, GuildId, MessageId } from '@picket/kernel';
import { recordingLogger, testI18n } from '@picket/testing';

const guildId = GuildId.assert('700000000000000001');
const channelId = ChannelId.assert('600000000000000001');
const clock = { now: () => new Date('2026-10-14T12:00:00Z') };
const frenchT = testI18n.translator('fr').t;
const englishT = testI18n.translator('en').t;
const frenchMessage = (change: SupportGuildChange, days: number) => supportGuildMessage(change, days, frenchT);
const change: SupportGuildChange = { kind: 'joined', name: 'ABC', inactiveSince: null, deletionRequested: false, detectedOffline: false };

function repository() {
  return {
    seed: jest.fn<Promise<void>, [GuildId]>(async () => undefined),
    presentGuildIds: jest.fn(async () => [guildId]),
    rename: jest.fn<Promise<void>, [GuildId, string]>(async () => undefined),
    observe: jest.fn<ReturnType<SupportGuildEventsRepository['observe']>, Parameters<SupportGuildEventsRepository['observe']>>(async () => undefined),
    deliver: jest.fn<ReturnType<SupportGuildEventsRepository['deliver']>, Parameters<SupportGuildEventsRepository['deliver']>>(async () => false),
  };
}

describe('supportGuildMessage', () => {
  it('contains only a name and lifecycle information', () => {
    expect(frenchMessage(change, 30)).toBe('🟢 PICKET a rejoint **ABC**.');
    expect(frenchMessage({ ...change, kind: 'returned' }, 30)).toContain('Purge liée au retrait annulée.');
  });

  it('renders every lifecycle path in English, including operator departures', () => {
    expect(supportGuildMessage(change, 30, englishT)).toBe('🟢 PICKET joined **ABC**.');
    expect(supportGuildMessage({ ...change, kind: 'returned' }, 30, englishT)).toContain('Removal-related data purge cancelled.');
    expect(supportGuildMessage({ ...change, kind: 'left', detectedOffline: true }, 30, englishT)).toContain('detected after reconnecting');
    expect(supportGuildMessage({ ...change, kind: 'left', operator: { name: 'Admin', reason: 'Test server' } }, 30, englishT))
      .toBe('🔴 PICKET left **ABC** at the request of **Admin**. Reason: Test server.');
    const requested = { ...change, deletionRequested: true, inactiveSince: clock.now() };
    expect(supportGuildMessage({ ...requested, kind: 'returned' }, 30, englishT)).toContain('requested deletion remains scheduled');
    expect(supportGuildMessage({ ...requested, kind: 'left' }, 30, englishT)).not.toContain('unless');
    expect(supportGuildMessage({ ...change, name: '' }, 30, englishT)).toContain('Server name unavailable');
  });

  it.each(testI18n.locales)('translates notifications and keeps user text safe in %s', locale => {
    const t = testI18n.translator(locale).t;
    const message = supportGuildMessage({ ...change, kind: 'left', operator: { name: '**Admin** @everyone', reason: '<@123>\nReason' } }, 30, t);
    expect(message).not.toContain('@everyone');
    expect(message).not.toContain('<@123>');
    expect(message).not.toContain('\n');
    expect(message).not.toContain('{{');
    expect(supportGuildMessage(change, 30, t)).toBe(t('supportGuild.joined', { name: '**ABC**' }));
  });

  it('uses the stored departure date and configured retention, without promising an exact purge time', () => {
    const inactiveSince = new Date('2026-10-01T12:00:00Z');
    const expected = Math.floor(new Date('2026-10-08T12:00:00Z').getTime() / 1000);
    expect(frenchMessage({ ...change, kind: 'left', inactiveSince }, 7))
      .toBe(`🔴 PICKET a été retiré de **ABC**. Purge des données prévue à partir du <t:${expected}:D>, sauf retour avant cette échéance.`);
  });

  it('does not promise cancellation of an administrator-requested deletion', () => {
    const requested = { ...change, inactiveSince: clock.now(), deletionRequested: true };
    expect(frenchMessage({ ...requested, kind: 'returned' }, 30)).toContain('La suppression demandée reste prévue');
    expect(frenchMessage({ ...requested, kind: 'returned' }, 30)).not.toContain('annulée');
    expect(frenchMessage({ ...requested, kind: 'left' }, 30)).not.toContain('sauf retour');
  });

  it('identifies offline detection without inventing the actual departure time', () => {
    expect(frenchMessage({ ...change, kind: 'left', detectedOffline: true }, 30)).toContain('détecté après reconnexion');
  });

  it('renders missing names and neutralizes formatting and mentions', () => {
    expect(frenchMessage({ ...change, name: '' }, 30)).toContain('Serveur au nom inconnu');
    const message = frenchMessage({ ...change, name: '**ABC**\n<@123> @everyone' }, 30);
    expect(message).not.toContain('\n');
    expect(message).not.toContain('@everyone');
    expect(message).toContain('\\*\\*ABC\\*\\*');
    expect(message).toContain('\\<@\u200b123\\>');
  });
});

describe('ObserveSupportGuildEvents', () => {
  it('silently seeds READY memberships and preserves temporarily unavailable servers', async () => {
    const store = repository();
    await new ObserveSupportGuildEvents(store, channelId, 30).handle({ type: 'ready', shardId: 0, shardCount: 1, guildIds: [guildId] });
    expect(store.seed).toHaveBeenCalledWith(guildId);
    expect(store.observe).not.toHaveBeenCalled();
  });

  it('reconciles only missing memberships on the current shard', async () => {
    const onShard0 = GuildId.assert(String(1_000_000_000_000_000_000n + 4_194_304n));
    const onShard1 = GuildId.assert('1000000000000000000');
    const store = repository();
    store.presentGuildIds.mockResolvedValue([onShard0, onShard1]);
    await new ObserveSupportGuildEvents(store, channelId, 30).handle({ type: 'ready', shardId: 0, shardCount: 2, guildIds: [] });
    expect(store.observe).toHaveBeenCalledTimes(1);
    expect(store.observe).toHaveBeenCalledWith(onShard0, false, undefined, true, expect.objectContaining({ channelId }));
  });

  it('tracks membership without enqueuing notifications when disabled', async () => {
    const store = repository();
    await new ObserveSupportGuildEvents(store, null, 30).handle({ type: 'guild_available', guildId, name: 'ABC' });
    expect(store.observe).toHaveBeenCalledWith(guildId, true, 'ABC', false, null);
  });

  it('updates names silently and ignores a temporary outage', async () => {
    const store = repository();
    const observer = new ObserveSupportGuildEvents(store, channelId, 30);
    await observer.handle({ type: 'guild_voice_metadata', guildId, name: 'Renamed', afkChannelId: null });
    await observer.handle({ type: 'guild_voice_unavailable', guildId });
    expect(store.rename).toHaveBeenCalledWith(guildId, 'Renamed');
    expect(store.observe).not.toHaveBeenCalled();
  });
});

describe('PublishSupportGuildEvents', () => {
  it.each(['en-US', 'en-GB', 'fr', null, 'unsupported'])('localizes queued events using destination locale %s', async locale => {
    const store = repository();
    const send = jest.fn<ReturnType<Messaging['send']>, Parameters<Messaging['send']>>(async () => MessageId.assert('900000000000000001'));
    const resolveLocale = jest.fn(async () => locale);
    store.deliver.mockImplementationOnce(async (_channel, _now, publish) => {
      await publish({ id: '42', content: null, event: { change, retentionDays: 30 }, attempts: 0, lastError: null });
      return true;
    });
    await new PublishSupportGuildEvents(store, channelId, { send } as unknown as Messaging, clock, recordingLogger(), testI18n, resolveLocale).tick();
    expect(send.mock.calls[0]).toEqual([channelId, expect.objectContaining({ content: locale === 'fr' ? '🟢 PICKET a rejoint **ABC**.' : '🟢 PICKET joined **ABC**.' })]);
    expect(resolveLocale).toHaveBeenCalledTimes(1);
  });

  it('does not look up a locale for an empty queue', async () => {
    const locale = jest.fn(async () => 'en');
    await new PublishSupportGuildEvents(repository(), channelId, {} as Messaging, clock, recordingLogger(), testI18n, locale).tick();
    expect(locale).not.toHaveBeenCalled();
  });

  it('retries locale lookup failures without sending in the wrong language', async () => {
    const store = repository();
    const send = jest.fn();
    store.deliver.mockImplementation(async (_channel, _now, publish) => {
      expect(await publish({ id: '42', content: null, event: { change, retentionDays: 30 }, attempts: 0, lastError: null })).toBe('unavailable');
      return false;
    });
    await new PublishSupportGuildEvents(store, channelId, { send } as unknown as Messaging, clock, recordingLogger(), testI18n,
      async () => { throw new Error('Discord unavailable'); }).tick();
    expect(send).not.toHaveBeenCalled();
  });

  it('reuses a stable nonce, retries failures and only logs the first repeated diagnostic', async () => {
    const store = repository();
    const logger = recordingLogger();
    const send = jest.fn().mockRejectedValue(new DiscordApiError('missing_access', 'Missing access'));
    const messaging = { send } as unknown as Messaging;
    let reason: string | null = null;
    let attempts = 0;
    store.deliver.mockImplementation(async (_channel, _now, publish) => {
      const delivery: SupportDelivery = { id: '42', content: '🟢 PICKET a rejoint **ABC**.', event: null, attempts, lastError: reason };
      reason = await publish(delivery);
      attempts += 1;
      return false;
    });
    const publisher = new PublishSupportGuildEvents(store, channelId, messaging, clock, logger, testI18n, async () => 'fr');
    await publisher.tick();
    await publisher.tick();
    expect(reason).toBe('missing_access');
    expect(logger.records.filter(record => record.level === 'warn')).toHaveLength(1);
    send.mockResolvedValueOnce(MessageId.assert('900000000000000001'));
    await publisher.tick();
    expect(reason).toBeNull();
    expect(send).toHaveBeenCalledTimes(3);
    for (const [destination, message] of send.mock.calls) {
      expect(destination).toBe(channelId);
      expect(message).toMatchObject({ nonce: 'support:16', embeds: [], buttons: [], suppressEmbeds: true });
      expect(message.mentionRoleIds).toBeUndefined();
    }
  });
});
