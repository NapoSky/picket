import type { GuildId, UserId } from '@picket/kernel';
import type { GuildSettings, SettingsDecision } from '../domain/guild-settings';

export interface GuildSettingsRepository {
  /** Create default settings on first access; idempotent and safe under concurrency. */
  findOrCreate(guildId: GuildId): Promise<GuildSettings>;
}

export interface GuildSettingsWriter {
  /**
   * Apply a decision atomically and serially per guild: `decide` sees current settings, and actual changes are
   * logged (before/after) in the same transaction.
   */
  modify(
    guildId: GuildId,
    actor: UserId,
    action: string,
    decide: (current: GuildSettings) => SettingsDecision,
  ): Promise<SettingsDecision>;
}

export interface GuildLocaleReader {
  /** Forced guild locale, or `null` (automatic or unknown guild). Creates nothing. */
  find(guildId: GuildId): Promise<string | null>;
}
