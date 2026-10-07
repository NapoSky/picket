import { pino, type DestinationStream } from 'pino';
import type { Logger } from '@picket/kernel';

export * from './health-server';
export * from './guild-log-destination';

export interface CreateLoggerOptions {
  readonly level: string;
  readonly service: string;
  readonly version?: string;
  readonly destination?: DestinationStream;
}

// Les champs portant un jeton ou une URL de connexion ne sortent jamais en clair.
const REDACTED_PATHS = [
  'token',
  '*.token',
  'botToken',
  '*.botToken',
  'databaseUrl',
  '*.databaseUrl',
  'password',
  '*.password',
  'req.headers.authorization',
  'req.headers["x-signature-ed25519"]',
];

export function createLogger(options: CreateLoggerOptions): Logger {
  return pino(
    {
      level: options.level,
      base: { service: options.service, version: options.version ?? 'unknown' },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
    },
    options.destination,
  );
}
