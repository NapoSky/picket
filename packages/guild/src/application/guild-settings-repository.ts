import type { GuildId, UserId } from '@picket/kernel';
import type { GuildSettings, SettingsDecision } from '../domain/guild-settings';

export interface GuildSettingsRepository {
  /** Crée les réglages par défaut au premier accès ; idempotent et sûr en concurrence. */
  findOrCreate(guildId: GuildId): Promise<GuildSettings>;
}

export interface GuildSettingsWriter {
  /**
   * Applique une décision de façon atomique et sérialisée par guilde : `decide` voit les réglages courants,
   * et un changement effectif est journalisé (avant/après) dans la même transaction.
   */
  modify(
    guildId: GuildId,
    actor: UserId,
    action: string,
    decide: (current: GuildSettings) => SettingsDecision,
  ): Promise<SettingsDecision>;
}

export interface GuildLocaleReader {
  /** Langue imposée au serveur, ou `null` (automatique, ou serveur inconnu). Ne crée rien. */
  find(guildId: GuildId): Promise<string | null>;
}
