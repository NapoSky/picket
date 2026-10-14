import type { GuildId } from '@picket/kernel';

/** Current names for menus; never infer permissions from these names. */
export interface GuildRoles {
  names(guildId: GuildId): Promise<Readonly<Record<string, string>>>;
}
