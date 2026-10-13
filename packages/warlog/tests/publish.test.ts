import { toRestMessage } from '@picket/discord';
import { createI18n } from '@picket/i18n';
import { ChannelId, GuildId } from '@picket/kernel';
import { WAR_LOG_COLORS, warMessage, type Delivery, type WarEvent, type WarObject } from '../src';

const i18n = createI18n(), at = Date.parse('2026-10-13T12:30:00Z');
const object: WarObject = { key: 'WestgateHex:4A:0.10000:0.20000', region: 'WestgateHex', code: '4A', x: .1, y: .2, location: 'Jade Cove', state: '0W', stateAt: at };
function delivery(type: WarEvent['type'] = 'launch_armed', faction: WarEvent['faction'] = 'WARDENS', perspective: Delivery['perspective'] = 'WARDENS'): Delivery {
  return { id: '42', guildId: GuildId.assert('700000000000000001'), channelId: ChannelId.assert('600000000000000001'), perspective, locale: 'en', generation: '1', revision: 1, attempts: 0,
    event: { type, war: 100, object: type === 'war_ended' ? null : object, faction, occurredAt: at, detectedAt: at } };
}
const gains = ['sc_built', 'launch_detected', 'launch_armed', 'rocket_targeting', 'rocket_hit'] as const;
const losses = ['sc_destroyed', 'launch_destroyed', 'launch_disarmed', 'rocket_no_target', 'scorched'] as const;
it.each(gains)('renders %s as favorable for allies and unfavorable for enemies', type => {
  const allied = warMessage(delivery(type), i18n, 'fr'), enemy = warMessage(delivery(type, 'WARDENS', 'COLONIALS'), i18n, 'fr');
  expect(allied.embeds).toHaveLength(1); expect(allied.embeds[0]).toMatchObject({ color: WAR_LOG_COLORS.favorable, timestamp: new Date(at).toISOString() });
  expect(enemy.embeds[0]).toMatchObject({ color: WAR_LOG_COLORS.unfavorable });
  expect(allied.embeds[0]!.footer).toContain('Allié · Favorable'); expect(enemy.embeds[0]!.footer).toContain('Ennemi · Défavorable');
  expect(allied.embeds[0]!.description).toContain('<:warden:1559384158999027812>');
});
it.each(losses)('renders %s as unfavorable for allies and favorable for enemies', type => {
  expect(warMessage(delivery(type), i18n, 'fr').embeds[0]!.color).toBe(WAR_LOG_COLORS.unfavorable);
  expect(warMessage(delivery(type, 'WARDENS', 'COLONIALS'), i18n, 'fr').embeds[0]!.color).toBe(WAR_LOG_COLORS.favorable);
  expect(warMessage(delivery(type, 'COLONIALS', 'COLONIALS'), i18n, 'fr').embeds[0]!.color).toBe(WAR_LOG_COLORS.unfavorable);
});
it.each([...gains, ...losses, 'rocket_forgotten'] as const)('renders %s neutrally when no perspective is selected or ownership is unknown', type => {
  const view = warMessage(delivery(type, 'WARDENS', 'NONE'), i18n, 'fr');
  expect(view.embeds[0]!.color).toBe(WAR_LOG_COLORS.neutral); expect(view.embeds[0]!.footer).toContain('Sans perspective · Neutre');
  expect(warMessage(delivery(type, 'NONE', 'WARDENS'), i18n, 'fr').embeds[0]!.color).toBe(WAR_LOG_COLORS.neutral);
});
it('keeps historical impact marker removal neutral even with a reference faction', () => {
  expect(warMessage(delivery('rocket_forgotten'), i18n, 'fr').embeds[0]!.color).toBe(WAR_LOG_COLORS.neutral);
});
it('sends a visible custom embed with notifications suppressed and mentions disabled', () => {
  const view = warMessage(delivery(), i18n, 'fr'), wire = toRestMessage(view);
  expect(view.suppressEmbeds).not.toBe(true);
  expect(wire.flags).toBe(4096); // SuppressNotifications; no SuppressEmbeds flag (4).
  expect(wire.allowed_mentions).toEqual({ parse: [] });
  expect(wire.embeds).toHaveLength(1); expect(wire.embeds![0]!.fields).toEqual([{ name: 'Région', value: 'Westgate', inline: true }, { name: 'Lieu', value: 'Jade Cove', inline: true }]);
  expect(view.nonce).toBe('pw42'); expect(view.content).toBeUndefined();
});
it.each(['claimed', 'lost', 'upgraded', 'ic_built', 'ws_destroyed', 'sc_dried', 'ic_dried', 'ws_dried'] as const)('keeps %s as a single-line message', type => {
  const view = warMessage(delivery(type, 'COLONIALS', 'WARDENS'), i18n, 'fr');
  expect(view.embeds).toEqual([]); expect(view.content).not.toContain('\n');
  expect(view.content).toContain('<:colonial:1559384173410525244> <t:');
  expect(view.suppressEmbeds).toBe(true);
});
it.each(i18n.locales)('translates every special event title and perspective label in %s', locale => {
  for (const type of [...gains, ...losses, 'rocket_forgotten', 'war_ended'] as const) {
    const embed = warMessage(delivery(type), i18n, locale).embeds[0]!;
    expect(JSON.stringify(embed)).not.toContain('warlog.'); expect(JSON.stringify(embed)).not.toContain('{{');
  }
});
it('escapes and bounds API-sourced labels in embeds', () => {
  const item = delivery();
  const event = item.event as WarEvent;
  const view = warMessage({ ...item, event: { ...event, object: { ...object, location: '<@everyone>\n**Place**'.repeat(200) } } }, i18n, 'fr');
  const field = view.embeds[0]!.fields![1]!;
  expect(field.value.length).toBeLessThanOrEqual(256); expect(field.value).not.toContain('\n');
  expect(field.value).toContain('\\<@everyone\\>'); expect(() => toRestMessage(view)).not.toThrow();
});
it('colors the war-end announcement by the winner and leaves renewal as text', () => {
  expect(warMessage(delivery('war_ended', 'COLONIALS'), i18n, 'fr').embeds[0]!.color).toBe(WAR_LOG_COLORS.COLONIALS);
  const item = delivery();
  expect(warMessage({ ...item, event: { type: 'renew', war: 101 } }, i18n, 'fr')).toMatchObject({ embeds: [], content: expect.stringContaining('/warlog settings') });
});
