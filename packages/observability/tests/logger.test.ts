import { Writable } from 'node:stream';
import { createLogger } from '@picket/observability';

function capture(): { lines: () => Record<string, unknown>[]; stream: Writable } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { stream, lines: () => chunks.join('').trim().split('\n').map((line) => JSON.parse(line)) };
}

describe('createLogger', () => {
  it('emits JSON with the service name and structured fields', () => {
    const { stream, lines } = capture();
    const logger = createLogger({ level: 'info', service: 'picket', version: 'abc1234', destination: stream });
    logger.child({ guild_id: '1' }).info({ action: 'x' }, 'hello');
    expect(lines()[0]).toMatchObject({ service: 'picket', version: 'abc1234', guild_id: '1', action: 'x', msg: 'hello', level: 30 });
  });

  it('redacts tokens and connection strings', () => {
    const { stream, lines } = capture();
    const logger = createLogger({ level: 'info', service: 'picket', destination: stream });
    logger.info({ interaction: { token: 'interaction-token' }, botToken: 'bot-token', databaseUrl: 'postgres://u:p@h/d' });
    const output = JSON.stringify(lines());
    expect(output).not.toContain('interaction-token');
    expect(output).not.toContain('bot-token');
    expect(output).not.toContain('postgres://');
    expect(output).toContain('[REDACTED]');
  });

  it('respects the level', () => {
    const { stream, lines } = capture();
    const logger = createLogger({ level: 'warn', service: 'picket', destination: stream });
    logger.info({}, 'ignored');
    logger.warn({}, 'kept');
    expect(lines().map((line) => line['msg'])).toEqual(['kept']);
  });
});
