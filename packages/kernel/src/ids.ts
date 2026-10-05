import { InvalidIdError } from './errors';
import { err, ok, type Result } from './result';

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

// Un snowflake Discord est un entier 64 bits non signé, transporté en chaîne.
const SNOWFLAKE = /^\d{15,25}$/;

interface SnowflakeFactory<T extends string> {
  parse(value: unknown): Result<T, InvalidIdError>;
  assert(value: unknown): T;
}

function snowflake<T extends string>(kind: string): SnowflakeFactory<T> {
  const parse = (value: unknown): Result<T, InvalidIdError> =>
    typeof value === 'string' && SNOWFLAKE.test(value)
      ? ok(value as T)
      : err(new InvalidIdError(`Invalid ${kind}`));
  return {
    parse,
    assert(value) {
      const result = parse(value);
      if (!result.ok) throw result.error;
      return result.value;
    },
  };
}

export type GuildId = Brand<string, 'GuildId'>;
export const GuildId = snowflake<GuildId>('GuildId');

export type ChannelId = Brand<string, 'ChannelId'>;
export const ChannelId = snowflake<ChannelId>('ChannelId');

export type MessageId = Brand<string, 'MessageId'>;
export const MessageId = snowflake<MessageId>('MessageId');

export type UserId = Brand<string, 'UserId'>;
export const UserId = snowflake<UserId>('UserId');

export type RoleId = Brand<string, 'RoleId'>;
export const RoleId = snowflake<RoleId>('RoleId');

export type InteractionId = Brand<string, 'InteractionId'>;
export const InteractionId = snowflake<InteractionId>('InteractionId');

export type ApplicationId = Brand<string, 'ApplicationId'>;
export const ApplicationId = snowflake<ApplicationId>('ApplicationId');
