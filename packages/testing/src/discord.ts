import { generateKeyPairSync, sign } from 'node:crypto';
import type { IncomingInteraction } from '@picket/discord';
import {
  ApplicationId,
  ChannelId,
  GuildId,
  InteractionId,
  Secret,
  UserId,
  type Logger,
} from '@picket/kernel';

export interface TestKeys {
  readonly publicKeyHex: string;
  signRequest(timestamp: string, body: string): string;
}

/** Paire Ed25519 jetable jouant le rôle de la clé de l'application Discord. */
export function createTestKeys(): TestKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  return {
    publicKeyHex,
    signRequest: (timestamp, body) => sign(null, Buffer.from(timestamp + body), privateKey).toString('hex'),
  };
}

export function makeInteraction(overrides: Partial<IncomingInteraction> = {}): IncomingInteraction {
  return {
    id: InteractionId.assert('900000000000000001'),
    kind: 'command',
    applicationId: ApplicationId.assert('800000000000000001'),
    token: new Secret('interaction-token'),
    guildId: GuildId.assert('700000000000000001'),
    channelId: ChannelId.assert('600000000000000001'),
    userId: UserId.assert('500000000000000001'),
    locale: 'en-US',
    guildLocale: 'en-US',
    memberRoleIds: [],
    memberPermissions: 0n,
    appPermissions: 0n,
    commandPath: ['picket', 'status'],
    options: {},
    focusedOption: null,
    customId: null,
    message: null,
    fields: {},
    ...overrides,
  };
}

interface LogRecord {
  readonly level: string;
  readonly fields: unknown;
  readonly message?: string | undefined;
}

export function recordingLogger(): Logger & { readonly records: LogRecord[] } {
  const records: LogRecord[] = [];
  const logger: Logger & { records: LogRecord[] } = {
    records,
    debug: (fields, message) => void records.push({ level: 'debug', fields, message }),
    info: (fields, message) => void records.push({ level: 'info', fields, message }),
    warn: (fields, message) => void records.push({ level: 'warn', fields, message }),
    error: (fields, message) => void records.push({ level: 'error', fields, message }),
    fatal: (fields, message) => void records.push({ level: 'fatal', fields, message }),
    child: () => logger,
  };
  return logger;
}
