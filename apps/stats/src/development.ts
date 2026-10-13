import { GuildId } from '@picket/kernel';
import { PostgresPermissionRepository } from '@picket/guild';
import type { Db } from '@picket/persistence';
import type { DashboardIdentityProvider, PostgresStatsStore } from '@picket/stats';

export type DevelopmentRole = 'member' | 'officer' | 'admin';
const USER = '300000000000000001';

/** Real development database, simulated Discord responses; never selected by main.ts. */
export function createDevelopmentIdentity(db: Db, store: PostgresStatsStore, role: DevelopmentRole): DashboardIdentityProvider {
  const permissions = new PostgresPermissionRepository(db);
  return {
    exchange: async (code) => {
      if (code !== 'local-development') throw new Error('Invalid development sign-in');
      return { token: 'local-development-session', expiresIn: 3600 };
    },
    user: async () => ({ id: USER, name: `Development ${role}` }),
    guilds: async () => Promise.all((await store.allGuildIds()).map(async (id) => {
      const config = await permissions.loadExisting(GuildId.assert(id));
      return { id, name: (await store.settings(id)).name, owner: false,
        permissions: role === 'officer' && !config?.officer.length ? '8' : '0' };
    })),
    memberRoles: async (_token, guild) => {
      const config = await permissions.loadExisting(GuildId.assert(guild));
      return [...(config?.member ?? []), ...(role === 'officer' ? config?.officer ?? [] : [])];
    },
    teamMember: async () => role === 'admin',
  };
}
