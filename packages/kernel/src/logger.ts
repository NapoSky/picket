import type { GuildId } from './ids';

export type LogFields = { readonly [key: string]: unknown };

export interface GuildApplicationLog {
  readonly id: string;
  readonly guildId: GuildId;
  readonly at: Date;
  /** Ligne JSON après sérialisation des erreurs et masquage des secrets. */
  readonly record: Readonly<Record<string, unknown>>;
}

export interface Logger {
  debug(fields: LogFields, message?: string): void;
  info(fields: LogFields, message?: string): void;
  warn(fields: LogFields, message?: string): void;
  error(fields: LogFields, message?: string): void;
  fatal(fields: LogFields, message?: string): void;
  child(bindings: LogFields): Logger;
}

export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  child: () => noopLogger,
};
