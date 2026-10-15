import type { REST, RESTOptions } from '@discordjs/rest';
import { createDiscordBotRest } from './bot-rest';
import { Routes, ApplicationCommandType, type APIApplicationCommand } from 'discord-api-types/v10';
import { GuildId, type ApplicationId, type ChannelId, type Secret } from '@picket/kernel';
import type { GuildOperationsDiscord } from '../application/guild-operations';
import type { CommandRegistry } from '../application/commands';
import { buildCommandsPayload, hashCommandsPayload, type CommandsPayload } from './commands-payload';

export interface CommandsApi {
  replaceGlobalCommands(payload: CommandsPayload): Promise<void>;
}
export interface OperatorCommandsApi {
  syncOperatorCommands(guildId: GuildId, payload: CommandsPayload): Promise<void>;
}

export interface DeployedHashStore {
  get(): Promise<string | null>;
  set(hash: string): Promise<void>;
}

export class DiscordRestCommandsApi implements CommandsApi, OperatorCommandsApi {
  readonly #rest: REST;
  readonly #applicationId: ApplicationId;

  constructor(applicationId: ApplicationId, botToken: Secret, options: Partial<RESTOptions> = {}) {
    this.#applicationId = applicationId;
    this.#rest = createDiscordBotRest(botToken, { globalRequestsPerSecond: 5, ...options });
  }

  async replaceGlobalCommands(payload: CommandsPayload): Promise<void> {
    await this.#rest.put(Routes.applicationCommands(this.#applicationId), { body: payload });
  }

  async syncOperatorCommands(guildId: GuildId, payload: CommandsPayload): Promise<void> {
    if (payload.length > 1 || payload.some(command => command.name !== 'picket-ops')) throw new Error('Unexpected operator command payload');
    if (payload[0]) {
      await this.#rest.post(Routes.applicationGuildCommands(this.#applicationId, guildId), { body: payload[0] });
      return;
    }
    const commands = await this.#rest.get(Routes.applicationGuildCommands(this.#applicationId, guildId)) as APIApplicationCommand[];
    for (const command of commands.filter(command => command.name === 'picket-ops' && command.type === ApplicationCommandType.ChatInput)) {
      await this.#rest.delete(Routes.applicationGuildCommand(this.#applicationId, guildId, command.id));
    }
  }
}

/** Separate scope and deployment state: operator commands must never enter the global payload. */
export async function deployOperatorCommands(options: {
  readonly registry: CommandRegistry;
  readonly api: OperatorCommandsApi;
  readonly discord: GuildOperationsDiscord;
  readonly channelId: ChannelId | null;
  readonly store: DeployedHashStore;
  readonly force?: boolean;
}): Promise<{ deployed: boolean; enabled: boolean }> {
  const stored = await options.store.get();
  const previous = stored ? JSON.parse(stored) as { guildId: string | null; hash: string } : null;
  const scope = options.channelId ? await options.discord.scope(options.channelId, true) : null;
  const payload = buildCommandsPayload(options.registry).map(command => ({ ...command, default_member_permissions: '0' }));
  const hash = hashCommandsPayload(payload);
  if (previous?.guildId && previous.guildId !== scope?.guildId) await options.api.syncOperatorCommands(GuildId.assert(previous.guildId), []);
  if (!scope) {
    await options.store.set(JSON.stringify({ guildId: null, hash }));
    return { deployed: Boolean(previous?.guildId), enabled: false };
  }
  if (!options.force && previous?.guildId === scope.guildId && previous.hash === hash) return { deployed: false, enabled: true };
  await options.api.syncOperatorCommands(scope.guildId, payload);
  await options.store.set(JSON.stringify({ guildId: scope.guildId, hash }));
  return { deployed: true, enabled: true };
}

export interface DeployResult {
  readonly deployed: boolean;
  readonly hash: string;
  readonly commands: number;
}

/** Idempotent: call Discord (global replacement) only when the generated definition changes. */
export async function deployCommands(options: {
  readonly registry: CommandRegistry;
  readonly api: CommandsApi;
  readonly store: DeployedHashStore;
  readonly force?: boolean;
}): Promise<DeployResult> {
  const payload = buildCommandsPayload(options.registry);
  const hash = hashCommandsPayload(payload);
  if (!options.force && (await options.store.get()) === hash) {
    return { deployed: false, hash, commands: payload.length };
  }
  await options.api.replaceGlobalCommands(payload);
  await options.store.set(hash);
  return { deployed: true, hash, commands: payload.length };
}
