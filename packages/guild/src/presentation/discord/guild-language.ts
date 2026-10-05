import type { GuildLanguage } from '@picket/discord';
import type { GetGuildLocale } from '../../application/settings-use-cases';

/** Adapte le cas d'usage de lecture de la langue au port attendu par le pipeline d'interactions. */
export function createGuildLanguage(getLocale: GetGuildLocale): GuildLanguage {
  return { localeOf: (guildId) => getLocale.execute(guildId) };
}
