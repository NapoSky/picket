import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import type { ApplicationId, Secret } from '@picket/kernel';
import type { CommandRegistry } from '../application/commands';
import { buildCommandsPayload, hashCommandsPayload, type CommandsPayload } from './commands-payload';

export interface CommandsApi {
  replaceGlobalCommands(payload: CommandsPayload): Promise<void>;
}

export interface DeployedHashStore {
  get(): Promise<string | null>;
  set(hash: string): Promise<void>;
}

export class DiscordRestCommandsApi implements CommandsApi {
  readonly #rest: REST;
  readonly #applicationId: ApplicationId;

  constructor(applicationId: ApplicationId, botToken: Secret) {
    this.#applicationId = applicationId;
    this.#rest = new REST({ version: '10' }).setToken(botToken.reveal());
  }

  async replaceGlobalCommands(payload: CommandsPayload): Promise<void> {
    await this.#rest.put(Routes.applicationCommands(this.#applicationId), { body: payload });
  }
}

export interface DeployResult {
  readonly deployed: boolean;
  readonly hash: string;
  readonly commands: number;
}

/** Idempotent : n'appelle Discord (remplacement global) que si la définition générée a changé. */
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
