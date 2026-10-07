import { DiscordApiError, type AuditChannelAccess, type GuildChannels, type Messaging } from '@picket/discord';
import type { I18n } from '@picket/i18n';
import type { ChannelId, Clock, GuildId, Logger, UserId } from '@picket/kernel';
import { auditMessage } from './audit-message';

export interface AuditEvent {
  readonly id: string;
  readonly guildId: GuildId;
  readonly channelId: ChannelId;
  readonly locale: string | null;
  readonly actor: string;
  readonly action: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly detail: unknown;
  readonly assetId: string | null;
  readonly sourceChannelId: string | null;
  readonly at: Date;
}
export type AuditDeliveryResult = { readonly kind: 'sent'; readonly messageId: string }
  | { readonly kind: 'blocked'; readonly reason: string }
  | { readonly kind: 'retry'; readonly reason: string };
export interface GuildAuditRepository {
  due(now: Date, limit: number): Promise<readonly GuildId[]>;
  deliver(guildId: GuildId, now: Date, publish: (event: AuditEvent) => Promise<AuditDeliveryResult>): Promise<boolean>;
  resume(guildId: GuildId, channelId: ChannelId, actor: UserId): Promise<boolean>;
  channel(guildId: GuildId): Promise<ChannelId | null>;
}
export interface AuditControl {
  inspect(guildId: GuildId, channelId: ChannelId): Promise<AuditChannelAccess>;
  test(guildId: GuildId, actor: UserId): Promise<'queued' | 'no_channel' | 'blocked' | 'unavailable'>;
}

/** Le résultat métier est déjà validé en base ; un échec Discord ne l'annule jamais. */
export class PublishGuildAudit implements AuditControl {
  constructor(private readonly repository: GuildAuditRepository, private readonly channels: GuildChannels,
    private readonly messaging: Messaging, private readonly i18n: I18n, private readonly clock: Clock, private readonly logger: Logger) {}

  inspect(guildId: GuildId, channelId: ChannelId) { return this.channels.inspect(guildId, channelId); }

  async test(guildId: GuildId, actor: UserId): Promise<'queued' | 'no_channel' | 'blocked' | 'unavailable'> {
    const channel = await this.repository.channel(guildId);
    if (channel === null) return 'no_channel';
    try {
      if ((await this.inspect(guildId, channel)).kind === 'blocked') return 'blocked';
      return await this.repository.resume(guildId, channel, actor) ? 'queued' : 'no_channel';
    } catch { return 'unavailable'; }
  }

  async tick(): Promise<void> {
    const guilds = await this.repository.due(this.clock.now(), 25);
    // Chaque guilde est indépendante ; limiter les appels simultanés conserve des connexions pour les interactions.
    for (let start = 0; start < guilds.length; start += 3) {
      await Promise.all(guilds.slice(start, start + 3).map(async (guildId) => {
        try {
          await this.repository.deliver(guildId, this.clock.now(), async (event) => {
            try {
              const access = await this.inspect(guildId, event.channelId);
              if (access.kind === 'blocked') {
                this.logger.warn({ guild_id: guildId, reason: access.reason }, 'audit publication paused');
                return access;
              }
              const locale = this.i18n.resolve(event.locale, access.locale);
              const messageId = await this.messaging.send(event.channelId, auditMessage(event, this.i18n.translator(locale).t));
              return { kind: 'sent', messageId };
            } catch (error) {
              const reason = error instanceof DiscordApiError ? error.reason : 'unavailable';
              const blocked = ['unknown_channel', 'missing_access', 'missing_permissions'].includes(reason);
              this.logger.warn({ guild_id: guildId, reason }, blocked ? 'audit publication paused' : 'audit publication will retry');
              return { kind: blocked ? 'blocked' : 'retry', reason };
            }
          });
        } catch (error) { this.logger.error({ guild_id: guildId, err: error }, 'audit delivery failed'); }
      }));
    }
  }
}
