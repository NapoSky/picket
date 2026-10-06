import { REST, type RESTOptions } from '@discordjs/rest';
import { Routes, type APIRole } from 'discord-api-types/v10';
import { RoleId, type GuildId, type Secret } from '@picket/kernel';
import type { GuildRoles } from '../application/guild-roles';
import { mapRestError } from './rest-messaging';

export class DiscordRestGuildRoles implements GuildRoles {
  readonly #rest: REST;

  constructor(token: Secret, options: Partial<RESTOptions> = {}) {
    this.#rest = new REST({ version: '10', timeout: 10_000, retries: 2, ...options }).setToken(token.reveal());
  }

  async names(guildId: GuildId): Promise<Readonly<Record<string, string>>> {
    try {
      const roles = await this.#rest.get(Routes.guildRoles(guildId)) as APIRole[];
      return Object.fromEntries(roles.filter((role) => RoleId.parse(role.id).ok).map((role) => [role.id, role.name]));
    } catch (error) {
      throw mapRestError(error);
    }
  }
}
