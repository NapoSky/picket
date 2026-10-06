import type { GuildId } from '@picket/kernel';

/** Noms actuels, destinés aux menus ; aucune permission n'est déduite de ces noms. */
export interface GuildRoles {
  names(guildId: GuildId): Promise<Readonly<Record<string, string>>>;
}
