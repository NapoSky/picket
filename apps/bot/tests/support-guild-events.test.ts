import { GetGuildLocale, PostgresSupportGuildEventsRepository, type SupportDelivery } from '@picket/guild';
import { ChannelId, GuildId, UserId, noopLogger } from '@picket/kernel';
import type { Db } from '@picket/persistence';
import { InMemoryInteractionReplies, InMemoryMessaging, testI18n } from '@picket/testing';
import { buildSupportGuildPublisher } from '../src/composition';

const channelId = ChannelId.assert('600000000000000061');
const supportId = GuildId.assert('700000000000000063');
const clock = { now: () => new Date('2026-10-23T12:00:00Z') };
const delivery: SupportDelivery = { id: '42', attempts: 0, lastError: null, content: null,
  event: { change: { kind: 'joined', name: 'ABC', inactiveSince: null, deletionRequested: false, detectedOffline: false }, retentionDays: 7 } };

describe('support notification composition', () => {
  it.each([
    ['en', 'fr', '🟢 PICKET joined **ABC**.'],
    [null, 'en-US', '🟢 PICKET joined **ABC**.'],
    [null, 'en-GB', '🟢 PICKET joined **ABC**.'],
    ['fr', 'en-US', '🟢 PICKET a rejoint **ABC**.'],
    [null, 'fr', '🟢 PICKET a rejoint **ABC**.'],
    [null, 'unsupported', '🟢 PICKET joined **ABC**.'],
  ])('uses support settings %s, then Discord language %s', async (forced, discordLocale, expected) => {
    const settings = jest.spyOn(GetGuildLocale.prototype, 'execute').mockResolvedValue(forced);
    const send = new InMemoryMessaging();
    const scope = jest.fn(async () => ({ guildId: supportId, channelId, ownerId: UserId.assert('500000000000000061'), ownerName: 'Owner' }));
    const guild = jest.fn(async () => ({ name: 'Support', locale: discordLocale }));
    jest.spyOn(PostgresSupportGuildEventsRepository.prototype, 'deliver').mockResolvedValue(false)
      .mockImplementationOnce(async (_channel, _now, publish) => {
        expect(await publish(delivery)).toBeNull();
        return true;
      });
    const publisher = buildSupportGuildPublisher({} as Db, noopLogger, { clock, guildRetentionDays: 7, i18n: testI18n,
      supportGuildEventsChannelId: channelId,
      discord: { messaging: send, replies: new InMemoryInteractionReplies(), operations: { scope, guild, leave: async () => undefined } } });
    await publisher!.tick();
    expect(send.list(channelId)[0]?.view.content).toBe(expected);
    expect(scope).toHaveBeenCalledWith(channelId);
    expect(settings).toHaveBeenCalledWith(supportId);
    if (forced) expect(guild).not.toHaveBeenCalled();
    else expect(guild).toHaveBeenCalledWith(supportId);
  });

  it('disables publication when no support channel is configured', () => {
    expect(buildSupportGuildPublisher({} as Db, noopLogger, { clock, guildRetentionDays: 7, i18n: testI18n })).toBeNull();
  });
});
