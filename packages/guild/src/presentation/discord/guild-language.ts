import type { GuildLanguage } from '@picket/discord';
import type { GetGuildLocale } from '../../application/settings-use-cases';

/** Adapt the locale-reading use case to the interaction pipeline's port. */
export function createGuildLanguage(getLocale: GetGuildLocale): GuildLanguage {
  return { localeOf: (guildId) => getLocale.execute(guildId) };
}
