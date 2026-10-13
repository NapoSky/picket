import { DiscordApiError, type MessageView, type Messaging } from '@picket/discord';
import { WAR_REGION_NAMES, WAR_STRUCTURES } from '@picket/game-data';
import type { I18n } from '@picket/i18n';
import type { Clock, GuildId, Logger } from '@picket/kernel';
import type { Delivery, WarStore } from './ports';
import type { WarEvent } from '../domain/model';

const FACTION_EMOJIS = {
  WARDENS: '<:warden:1559384158999027812>',
  COLONIALS: '<:colonial:1559384173410525244>',
  NONE: '⚪',
} as const;

export const WAR_LOG_COLORS = { favorable: 0x57f287, unfavorable: 0xed4245, neutral: 0x99aab5, WARDENS: 0x4b78a6, COLONIALS: 0x4a6a3e } as const;
const SPECIAL_EVENTS = {
  sc_built: { icon: '🏗️', effect: 'gain' },
  sc_destroyed: { icon: '💥', effect: 'loss' },
  launch_detected: { icon: '🚀', effect: 'gain' },
  launch_destroyed: { icon: '💥', effect: 'loss' },
  launch_armed: { icon: '🚨', effect: 'gain' },
  launch_disarmed: { icon: '🚀', effect: 'loss' },
  rocket_targeting: { icon: '🎯', effect: 'gain' },
  rocket_hit: { icon: '☢️', effect: 'gain' },
  rocket_no_target: { icon: '🎯', effect: 'loss' },
  // Removing an old impact marker says nothing about a new military outcome.
  rocket_forgotten: { icon: '☢️', effect: 'neutral' },
  // Here faction is the owner of the damaged structure, not the launcher.
  scorched: { icon: '🔥', effect: 'loss' },
} as const;

function perspectiveOf(event: WarEvent, perspective: Delivery['perspective'], effect: 'gain' | 'loss' | 'neutral') {
  const relation = perspective === 'NONE' || event.faction === 'NONE' ? 'neutral' : event.faction === perspective ? 'friendly' : 'hostile';
  const sentiment = relation === 'neutral' || effect === 'neutral' ? 'neutral' : (relation === 'friendly') === (effect === 'gain') ? 'favorable' : 'unfavorable';
  return { relation, sentiment } as const;
}

const escape = (text: string): string => text.replace(/\s+/g, ' ').replace(/([\\`*_~|<>])/g, '\\$1').slice(0, 256);
export function warMessage(delivery: Delivery, i18n: I18n, guildLocale: string | null): MessageView {
  const t = i18n.translator(i18n.resolve(guildLocale, delivery.locale)).t;
  const event = delivery.event;
  const base = { buttons: [], silent: true, nonce: `pw${delivery.id}` } as const;
  if (event.type === 'war_ended') {
    const { relation, sentiment } = perspectiveOf(event, delivery.perspective, 'gain');
    return { ...base, embeds: [{ title: t('warlog.embedTitles.war_ended'),
      description: `${FACTION_EMOJIS[event.faction]} ${t('warlog.ended', { war: event.war, faction: t(`warlog.factions.${event.faction}`) })}`,
      color: event.faction === 'NONE' ? WAR_LOG_COLORS.neutral : WAR_LOG_COLORS[event.faction],
      footer: t('warlog.embedFooter', { war: event.war, relation: t(`warlog.relations.${relation}`), sentiment: t(`warlog.sentiments.${sentiment}`) }),
      timestamp: new Date(event.occurredAt).toISOString(),
    }] };
  }
  let content: string;
  if (event.type === 'renew') content = t('warlog.renew', { war: event.war });
  else {
    const object = event.object!;
    const emoji = FACTION_EMOJIS[event.faction];
    const level = event.tier ?? Number(object.state[0]);
    const tier = level > 0 ? ` T${level}` : '';
    const region = escape(WAR_REGION_NAMES[object.region] ?? object.region);
    const action = t(`warlog.events.${event.type}`, {
      faction: t(`warlog.factions.${event.faction}`), structure: escape(WAR_STRUCTURES[object.code].name) + tier, location: escape(object.location),
    });
    if (event.type in SPECIAL_EVENTS) {
      const type = event.type as keyof typeof SPECIAL_EVENTS;
      const { icon, effect } = SPECIAL_EVENTS[type];
      const { relation, sentiment } = perspectiveOf(event, delivery.perspective, effect);
      return { ...base, embeds: [{ title: `${icon} ${t(`warlog.embedTitles.${type}`)}`, description: `${emoji} ${action}`,
        color: WAR_LOG_COLORS[sentiment],
        fields: [{ name: t('warlog.region'), value: region, inline: true }, { name: t('warlog.location'), value: escape(object.location), inline: true }],
        footer: t('warlog.embedFooter', { war: event.war, relation: t(`warlog.relations.${relation}`), sentiment: t(`warlog.sentiments.${sentiment}`) }),
        timestamp: new Date(event.occurredAt).toISOString(),
      }] };
    }
    content = `${emoji} <t:${Math.floor(event.occurredAt / 1000)}:T> ${region}: ${action}`;
  }
  return { ...base, content, embeds: [], suppressEmbeds: true };
}

export class PublishWarLog {
  #cursor = 0;
  constructor(private readonly store: WarStore, private readonly messaging: Messaging, private readonly i18n: I18n,
    private readonly clock: Clock, private readonly logger: Logger,
    private readonly locale: (guildId: GuildId) => Promise<string | null>,
    private readonly reset: (guildId: GuildId, war: number, startedAt: Date) => Promise<void>,
    private readonly perTick = 10) {}

  async tick(): Promise<void> {
    const guilds = await this.store.guilds();
    if (!guilds.length) return;
    // Start at the next guild every pass, so busy guilds cannot consume the whole shared budget.
    const deliveries: Delivery[] = [];
    for (let scanned = 0; scanned < guilds.length && deliveries.length < this.perTick; scanned++) {
      const guildId = guilds[this.#cursor++ % guilds.length]!;
      try {
        const delivery = await this.store.claim(guildId, this.clock.now());
        if (!delivery) continue;
        deliveries.push(delivery);
      } catch (error) { this.logger.error({ guild_id: guildId, err: error }, 'war log delivery pass failed'); }
    }
    await Promise.all(deliveries.map(async delivery => {
      const guildId = delivery.guildId;
      try {
        if (!await this.store.valid(delivery)) return;
        try {
          const view = warMessage(delivery, this.i18n, await this.locale(guildId));
          if (!await this.store.valid(delivery)) return;
          const messageId = await this.messaging.send(delivery.channelId, view);
          await this.store.finish(delivery, { kind: 'sent', messageId }, this.clock.now());
        } catch (error) {
          const reason = error instanceof DiscordApiError ? error.reason : 'unavailable';
          const blocked = ['unknown_channel', 'missing_access', 'missing_permissions'].includes(reason);
          await this.store.finish(delivery, { kind: blocked ? 'blocked' : 'retry', reason }, this.clock.now());
          this.logger.warn({ guild_id: guildId, reason }, 'war log delivery failed');
        }
      } catch (error) { this.logger.error({ guild_id: guildId, err: error }, 'war log delivery pass failed'); }
    }));
  }

  async hooks(): Promise<void> {
    for (const guildId of await this.store.hookGuilds()) {
      try { await this.store.runHook(guildId, (war, start) => this.reset(guildId, war, start), this.clock.now()); }
      catch (error) { this.logger.warn({ guild_id: guildId, err: error }, 'war start hook failed, other guilds continue'); }
    }
  }
}
