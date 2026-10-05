import type { GuildId, UserId } from '@picket/kernel';
import { decideSettingsChange, type SettingsChange, type SettingsDecision } from '../domain/guild-settings';
import type { GuildLocaleReader, GuildSettingsWriter } from './guild-settings-repository';

export interface UpdateSettingsCommand {
  readonly guildId: GuildId;
  readonly actorId: UserId;
  readonly change: SettingsChange;
}

export class UpdateGuildSettings {
  readonly #writer: GuildSettingsWriter;
  readonly #supportedLocales: readonly string[];

  constructor(writer: GuildSettingsWriter, supportedLocales: readonly string[]) {
    this.#writer = writer;
    this.#supportedLocales = supportedLocales;
  }

  execute(command: UpdateSettingsCommand): Promise<SettingsDecision> {
    return this.#writer.modify(command.guildId, command.actorId, `settings.${command.change.kind}`, (current) =>
      decideSettingsChange(current, command.change, this.#supportedLocales),
    );
  }
}

export class GetGuildLocale {
  readonly #reader: GuildLocaleReader;

  constructor(reader: GuildLocaleReader) {
    this.#reader = reader;
  }

  execute(guildId: GuildId): Promise<string | null> {
    return this.#reader.find(guildId);
  }
}
