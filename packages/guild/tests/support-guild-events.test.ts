import { DiscordApiError, type Messaging } from '@picket/discord';
import { ObserveSupportGuildEvents, PublishSupportGuildEvents, supportGuildMessage,
  type SupportDelivery, type SupportGuildChange, type SupportGuildEventsRepository } from '@picket/guild';
import { ChannelId, GuildId, MessageId } from '@picket/kernel';
import { recordingLogger } from '@picket/testing';

const guildId = GuildId.assert('700000000000000001');
const channelId = ChannelId.assert('600000000000000001');
const clock = { now: () => new Date('2026-10-14T12:00:00Z') };
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
    expect(supportGuildMessage(change, 30)).toBe('🟢 PICKET a rejoint **ABC**.');
    expect(supportGuildMessage({ ...change, kind: 'returned' }, 30)).toContain('Purge liée au retrait annulée.');
  });

  it('uses the stored departure date and configured retention, without promising an exact purge time', () => {
    const inactiveSince = new Date('2026-10-01T12:00:00Z');
    const expected = Math.floor(new Date('2026-10-08T12:00:00Z').getTime() / 1000);
    expect(supportGuildMessage({ ...change, kind: 'left', inactiveSince }, 7))
      .toBe(`🔴 PICKET a été retiré de **ABC**. Purge des données prévue à partir du <t:${expected}:D>, sauf retour avant cette échéance.`);
  });

  it('does not promise cancellation of an administrator-requested deletion', () => {
    const requested = { ...change, inactiveSince: clock.now(), deletionRequested: true };
    expect(supportGuildMessage({ ...requested, kind: 'returned' }, 30)).toContain('La suppression demandée reste prévue');
    expect(supportGuildMessage({ ...requested, kind: 'returned' }, 30)).not.toContain('annulée');
    expect(supportGuildMessage({ ...requested, kind: 'left' }, 30)).not.toContain('sauf retour');
  });

  it('identifies offline detection without inventing the actual departure time', () => {
    expect(supportGuildMessage({ ...change, kind: 'left', detectedOffline: true }, 30)).toContain('détecté après reconnexion');
  });

  it('renders missing names and neutralizes formatting and mentions', () => {
    expect(supportGuildMessage({ ...change, name: '' }, 30)).toContain('Serveur au nom inconnu');
    const message = supportGuildMessage({ ...change, name: '**ABC**\n<@123> @everyone' }, 30);
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
  it('reuses a stable nonce, retries failures and only logs the first repeated diagnostic', async () => {
    const store = repository();
    const logger = recordingLogger();
    const send = jest.fn().mockRejectedValue(new DiscordApiError('missing_access', 'Missing access'));
    const messaging = { send } as unknown as Messaging;
    let reason: string | null = null;
    let attempts = 0;
    store.deliver.mockImplementation(async (_channel, _now, publish) => {
      const delivery: SupportDelivery = { id: '42', content: '🟢 PICKET a rejoint **ABC**.', attempts, lastError: reason };
      reason = await publish(delivery);
      attempts += 1;
      return false;
    });
    const publisher = new PublishSupportGuildEvents(store, channelId, messaging, clock, logger);
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
