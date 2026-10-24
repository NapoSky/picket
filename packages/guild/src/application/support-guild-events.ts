import { DiscordApiError, type GatewayEvent, type MessageView, type Messaging } from '@picket/discord';
import type { I18n, Translator } from '@picket/i18n';
import type { ChannelId, Clock, GuildId, Logger } from '@picket/kernel';
import { purgeDate, shardOf } from '../domain/lifecycle';

export interface SupportGuildChange {
  readonly kind: 'joined' | 'left' | 'returned';
  readonly name: string;
  readonly inactiveSince: Date | null;
  readonly deletionRequested: boolean;
  readonly detectedOffline: boolean;
  readonly operator?: { readonly name: string; readonly reason: string };
}

export interface SupportDelivery {
  readonly id: string;
  /** Legacy text queued before localization; new deliveries carry an event. */
  readonly content: string | null;
  readonly event: { readonly change: SupportGuildChange; readonly retentionDays: number } | null;
  readonly attempts: number;
  readonly lastError: string | null;
}

export interface SupportGuildEventsRepository {
  seed(guildId: GuildId): Promise<void>;
  presentGuildIds(): Promise<readonly GuildId[]>;
  rename(guildId: GuildId, name: string): Promise<void>;
  observe(guildId: GuildId, present: boolean, name: string | undefined, offline: boolean,
    notification: { readonly channelId: ChannelId; readonly retentionDays: number } | null): Promise<void>;
  deliver(channelId: ChannelId, now: Date, publish: (delivery: SupportDelivery) => Promise<string | null>): Promise<boolean>;
}

/** Server names are untrusted text; neutralize mentions and Markdown formatting. */
function displayName(value: string, fallback: string, limit = 100): string {
  const name = value.replace(/[\r\n\t]/g, ' ').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '').trim().slice(0, limit);
  return (name || fallback).replace(/([\\`*_{}\[\]()<>~|])/g, '\\$1').replace(/@/g, '@\u200b');
}

export function supportGuildMessage(change: SupportGuildChange, retentionDays: number, t: Translator['t']): string {
  const name = `**${displayName(change.name, t('supportGuild.unknownName'))}**`;
  const date = change.inactiveSince === null ? '' : `<t:${Math.floor(purgeDate(change.inactiveSince, retentionDays).getTime() / 1000)}:D>`;
  if (change.kind === 'joined') return t('supportGuild.joined', { name });
  if (change.kind === 'returned') {
    return t('supportGuild.returned', { name, retention: change.deletionRequested
      ? t('supportGuild.deletionStillRequested', { date }) : t('supportGuild.purgeCancelled') });
  }
  const departure = change.operator
    ? t('supportGuild.operatorLeft', { name, operator: `**${displayName(change.operator.name, t('ops.unknownName'))}**`, reason: displayName(change.operator.reason, '', 500) })
    : t(change.detectedOffline ? 'supportGuild.leftOffline' : 'supportGuild.left', { name });
  const retention = date === '' ? '' : ` ${t(change.deletionRequested ? 'supportGuild.purgeRequested' : 'supportGuild.purgeUnlessReturn', { date })}`;
  return `🔴 ${departure}${retention}`;
}

/** Membership is independent of Stats and administrator-requested deletion. */
export class ObserveSupportGuildEvents {
  constructor(private readonly repository: SupportGuildEventsRepository, private readonly channelId: ChannelId | null,
    private readonly retentionDays: number) {}

  async handle(event: GatewayEvent): Promise<void> {
    const notification = this.channelId === null ? null : {
      channelId: this.channelId, retentionDays: this.retentionDays,
    };
    switch (event.type) {
      case 'ready': {
        const present = new Set<string>(event.guildIds);
        for (const guildId of await this.repository.presentGuildIds()) {
          if (shardOf(guildId, event.shardCount) === event.shardId && !present.has(guildId)) {
            await this.repository.observe(guildId, false, undefined, true, notification);
          }
        }
        // READY lists existing memberships, including unavailable guilds. Seed silently on first deployment.
        for (const guildId of event.guildIds) await this.repository.seed(guildId);
        return;
      }
      case 'guild_available':
        await this.repository.observe(event.guildId, true, event.name ?? event.voiceSnapshot?.name, false, notification);
        return;
      case 'guild_removed':
        await this.repository.observe(event.guildId, false, undefined, false, notification);
        return;
      case 'guild_voice_metadata':
        await this.repository.rename(event.guildId, event.name);
        return;
      default: return;
    }
  }
}

/** Delivery runs under the job-runner lease; Discord failures do not affect lifecycle processing. */
export class PublishSupportGuildEvents {
  constructor(private readonly repository: SupportGuildEventsRepository, private readonly channelId: ChannelId,
    private readonly messaging: Messaging, private readonly clock: Clock, private readonly logger: Logger,
    private readonly i18n: I18n, private readonly destinationLocale: () => Promise<string | null>) {}

  async tick(): Promise<void> {
    // Resolve lazily: an empty queue needs no Discord lookup, and one batch shares its translator.
    let translator: Promise<Translator> | undefined;
    for (let i = 0; i < 25; i += 1) {
      const delivered = await this.repository.deliver(this.channelId, this.clock.now(), async (delivery) => {
        try {
          let content = delivery.content ?? '';
          if (delivery.event) {
            translator ??= this.destinationLocale().then(locale => this.i18n.translator(this.i18n.resolve(locale)));
            content = supportGuildMessage(delivery.event.change, delivery.event.retentionDays, (await translator).t);
          }
          const message: MessageView = { content, embeds: [], buttons: [], nonce: `support:${BigInt(delivery.id).toString(36)}`, suppressEmbeds: true };
          await this.messaging.send(this.channelId, message);
          return null;
        } catch (error) {
          const reason = error instanceof DiscordApiError ? error.reason : 'unavailable';
          if (delivery.attempts === 0 || delivery.lastError !== reason) {
            this.logger.warn({ reason }, 'support guild notification will retry');
          }
          return reason;
        }
      });
      if (!delivered) return;
    }
  }
}
