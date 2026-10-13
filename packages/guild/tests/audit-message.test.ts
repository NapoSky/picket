import { MAX_MESSAGE_CONTENT, toRestMessage } from '@picket/discord';
import { auditMessage, type AuditEvent } from '@picket/guild';
import { ChannelId, GuildId } from '@picket/kernel';
import { testI18n } from '@picket/testing';

const event: AuditEvent = { id: '123', guildId: GuildId.assert('700000000000000001'), channelId: ChannelId.assert('600000000000000001'), locale: 'fr', actor: '500000000000000001', action: 'settings.language', before: { language: null }, after: { language: 'fr' }, detail: null, assetId: null, sourceChannelId: null, at: new Date('2026-10-07T12:00:00Z') };
describe('audit messages', () => {
  it('localizes the change, attributes it, and never notifies mentions', () => {
    const view = auditMessage(event, testI18n.translator('fr').t);
    expect(view.embeds).toEqual([]);
    expect(view.content).toBe(`⚙️ **Langue modifiée** · Langue : automatique → fr · Par <@${event.actor}> · <t:1791374400:f>`);
    expect(toRestMessage(view).allowed_mentions).toEqual({ parse: [] });
    expect(view.nonce).toBe('pa123');
  });
  it('keeps long role changes within Discord limits', () => {
    const roles = Array.from({ length: 100 }, (_v, i) => String(400000000000000000n + BigInt(i)));
    const view = auditMessage({ ...event, action: 'permissions.add', before: { member: roles, officer: roles }, after: { member: [...roles, '400000000000001000'], officer: [] } }, testI18n.translator('en').t);
    expect(view.content?.length).toBeLessThanOrEqual(MAX_MESSAGE_CONTENT);
    expect(view.content).toContain('<@&400000000000001000>');
    expect(view.content).toContain('(+94)');
    expect(view.content).toContain(`<@${event.actor}>`);
    expect(view.content).not.toMatch(/[\r\n\u0085\u2028\u2029]/);
    expect(() => toRestMessage(view)).not.toThrow();
  });
  it('links todolist messages and excludes any content present in a log', () => {
    const view = auditMessage({ ...event, action: 'todolist.created', before: null, after: null, detail: { channel_id: event.channelId, message_ids: ['900000000000000001'], messages: 1, content: 'DO NOT PUBLISH THIS' } }, testI18n.translator('en').t);
    expect(JSON.stringify(view)).toContain(`https://discord.com/channels/${event.guildId}/${event.channelId}/900000000000000001`);
    expect(JSON.stringify(view)).not.toContain('DO NOT PUBLISH');
  });
  it('renders alert acknowledgement with threshold and the timer name', () => {
    const view = auditMessage({ ...event, action: 'acknowledge', before: null, after: null, assetId: 'asset123', detail: { name: 'Bunker', thresholdMin: 120 } }, testI18n.translator('fr').t);
    expect(view.content).toContain('⏱️ **Alerte acquittée** · Bunker · 120 min');
  });
  it.each([
    ['settings.language', '⚙️'], ['settings.timezone', '⚙️'], ['settings.audit_channel', '⚙️'], ['settings.feature', '⚙️'],
    ['permissions.add', '⚙️'], ['permissions.remove', '⚙️'], ['permissions.role_deleted', '⚙️'],
    ['guild.deletion_requested', '⚙️'], ['guild.deletion_cancelled', '⚙️'], ['guild.left', '⚙️'], ['guild.left_while_offline', '⚙️'], ['guild.rejoined', '⚙️'], ['audit.test', '⚙️'],
    ['add', '⏱️'], ['reactivate', '⏱️'], ['strike', '⏱️'], ['cleanup', '⏱️'], ['auto_purge', '⏱️'], ['reset_war', '⏱️'], ['acknowledge', '⏱️'],
    ['todolist.created', '📋'],
  ])('renders %s on one line with a stable domain icon', (action, icon) => {
    const view = auditMessage({ ...event, action }, testI18n.translator('fr').t);
    expect(view.content).toMatch(new RegExp(`^${icon} \\*\\*`));
    expect(view.content).not.toMatch(/[\r\n\u0085\u2028\u2029]/);
    expect(view.embeds).toEqual([]);
    expect(view.buttons).toEqual([]);
    expect(toRestMessage(view).allowed_mentions).toEqual({ parse: [] });
  });
  it('normalizes multiline user input without allowing it to inject formatting or mentions', () => {
    const view = auditMessage({ ...event, action: 'add', assetId: 'asset123', before: null, after: null,
      detail: { name: '**Bunker**\n@everyone\u2028next line', code: '12\r\n34' },
    }, testI18n.translator('fr').t);
    expect(view.content).toContain('\\*\\*Bunker\\*\\* @everyone next line (12 34)');
    expect(view.content).not.toMatch(/[\r\n\u2028]/);
    expect(toRestMessage(view).allowed_mentions).toEqual({ parse: [] });
  });
  it('summarizes only the changed module', () => {
    const view = auditMessage({ ...event, action: 'settings.feature', before: { features: { timers: true, todolists: true } }, after: { features: { timers: false, todolists: true } } }, testI18n.translator('fr').t);
    expect(view.content).toContain('Timers : Activé → Désactivé');
    expect(view.content).not.toContain('Todolists');
  });
  it.each([
    ['fr', 'Journal de guerre activé', 'État : Désactivé → Activé', 'Guerre confirmée : Non confirmée → Guerre 141'],
    ['en', 'War log enabled', 'Status : Disabled → Enabled', 'Confirmed war : Unconfirmed → War 141'],
  ])('explains war log activation in %s without exposing the inverted pause flag', (locale, title, status, war) => {
    const unchanged = { channelId: event.channelId, zones: ['center'], perspective: 'WARDENS' };
    const view = auditMessage({ ...event, action: 'settings.warlog.enable',
      before: { ...unchanged, paused: true, confirmedWar: null, revision: 1 },
      after: { ...unchanged, paused: false, confirmedWar: 141, revision: 2 },
    }, testI18n.translator(locale).t);
    expect(view.content).toContain(`⚙️ **${title}** · ${status} · ${war}`);
    expect(view.content).not.toMatch(/true|false|revision|\[object Object\]/);
    expect(view.content).not.toContain(event.channelId);
    expect(toRestMessage(view).allowed_mentions).toEqual({ parse: [] });
  });
  it.each([
    ['fr', 'Canal', 'Zones : aucun → Îles Ouest, Centre', 'Faction de référence : Neutres → Coloniaux'],
    ['en', 'Channel', 'Zones : none → West Islands, Centre', 'Reference faction : Neutral → Colonials'],
  ])('labels and formats war log channels, zones and factions in %s', (locale, channel, zones, faction) => {
    const view = auditMessage({ ...event, action: 'settings.warlog.channel',
      before: { channelId: null, zones: [], perspective: 'NONE' },
      after: { channelId: event.channelId, zones: ['west_islands', 'center'], perspective: 'COLONIALS' },
    }, testI18n.translator(locale).t);
    expect(view.content).toContain(`${channel} : ${locale === 'fr' ? 'aucun' : 'none'} → <#${event.channelId}>`);
    expect(view.content).toContain(zones);
    expect(view.content).toContain(faction);
    expect(view.content).not.toContain('west_islands');
  });
  it.each([
    ['settings.warlog.disable', 'Journal de guerre désactivé', 'War log disabled'],
    ['settings.warlog.renew', 'Journal de guerre en pause · nouvelle guerre', 'War log paused · new war'],
    ['settings.warlog.blocked', 'Journal de guerre en pause · salon inaccessible', 'War log paused · channel inaccessible'],
  ])('identifies %s and translates the disabled state', (action, frenchTitle, englishTitle) => {
    for (const [locale, title, status] of [
      ['fr', frenchTitle, 'État : Activé → Désactivé'],
      ['en', englishTitle, 'Status : Enabled → Disabled'],
    ] as const) {
      const view = auditMessage({ ...event, action, before: { paused: false }, after: { paused: true } }, testI18n.translator(locale).t);
      expect(view.content).toContain(`**${title}** · ${status}`);
    }
  });
  it.each(['settings.warlog.zones', 'settings.warlog.perspective'])('names the war log for %s', (action) => {
    const view = auditMessage({ ...event, action, before: null, after: null }, testI18n.translator('fr').t);
    expect(view.content).toContain('**Configuration du journal de guerre modifiée**');
  });
  it('labels simultaneous changes to general settings', () => {
    const view = auditMessage({ ...event, action: 'settings.timezone',
      before: { language: 'en', timezone: 'UTC', auditChannelId: null },
      after: { language: 'fr', timezone: 'Europe/Paris', auditChannelId: event.channelId },
    }, testI18n.translator('fr').t);
    expect(view.content).toContain('Langue : en → fr');
    expect(view.content).toContain('Fuseau horaire : UTC → Europe/Paris');
    expect(view.content).toContain(`Canal d’audit : aucun → <#${event.channelId}>`);
  });
  it('keeps one link for a multipage todolist', () => {
    const view = auditMessage({ ...event, action: 'todolist.created', before: null, after: null, detail: { channel_id: event.channelId, messages: 2, message_ids: ['900000000000000001', '900000000000000002'] } }, testI18n.translator('fr').t);
    expect(view.content).toContain('2 pages · [Ouvrir](');
    expect(view.content).not.toContain('900000000000000002');
    expect(view.content).not.toContain('\n');
    expect(toRestMessage(view).flags).toBe(4096 | 4);
  });
});
