import { createGuildLogDestination, createLogger } from '@picket/observability';
import type { GuildApplicationLog } from '@picket/kernel';

const GUILD_A = '700000000000000001';
const GUILD_B = '700000000000000002';

describe('guild log destination', () => {
  it('routes complete redacted guild records to storage and only global diagnostics to stdout', async () => {
    const stored: GuildApplicationLog[] = [];
    const diagnostics = { write: jest.fn() };
    const destination = createGuildLogDestination({ append: async (entries) => { stored.push(...entries); }, diagnostics });
    const logger = createLogger({ level: 'info', service: 'picket', destination: destination.destination });
    logger.info({ shard_id: 0 }, 'started');
    logger.child({ guild_id: GUILD_A, interaction_id: '900000000000000001' }).info({ user_id: '500000000000000001', token: 'SECRET', password: 'SECRET', databaseUrl: 'SECRET', interaction: { token: 'SECRET' } }, 'todolist created');
    logger.child({ guild_id: GUILD_B }).error({ err: new Error('failure'), channel_id: '600000000000000001' }, 'timer failed');
    logger.child({ guild_id: GUILD_A }).debug({}, 'filtered out');
    await destination.flush();
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ guildId: GUILD_A, at: expect.any(Date), record: { level: 30, user_id: '500000000000000001', msg: 'todolist created', token: '[REDACTED]' } });
    expect(stored[1]).toMatchObject({ guildId: GUILD_B, record: { level: 50, err: { message: 'failure' } } });
    expect(JSON.stringify(stored)).not.toContain('SECRET');
    expect(diagnostics.write).toHaveBeenCalledTimes(1);
    expect(diagnostics.write.mock.calls[0]?.[0]).toContain('started');
    expect(JSON.stringify(diagnostics.write.mock.calls)).not.toContain(GUILD_A);
    expect(JSON.stringify(diagnostics.write.mock.calls)).not.toContain(GUILD_B);
  });

  it('keeps failed batches for retry, with stable identifiers and no private data in the failure diagnostic', async () => {
    const append = jest.fn<Promise<void>, [readonly GuildApplicationLog[]]>().mockRejectedValueOnce(new Error('SECRET')).mockResolvedValue(undefined);
    const diagnostics = { write: jest.fn() };
    const destination = createGuildLogDestination({ append, diagnostics, version: 'abc1234' });
    const logger = createLogger({ level: 'info', service: 'picket', version: 'abc1234', destination: destination.destination });
    logger.child({ guild_id: GUILD_A }).info({ user_id: '500000000000000001' }, 'tick');
    await destination.flush();
    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls[0]?.[0]).toEqual(append.mock.calls[1]?.[0]);
    const output = JSON.stringify(diagnostics.write.mock.calls);
    expect(JSON.parse(diagnostics.write.mock.calls[0]?.[0] as string)).toMatchObject({ version: 'abc1234' });
    expect(append.mock.calls[0]?.[0][0]?.record).toMatchObject({ version: 'abc1234' });
    expect(output).toContain('guild log persistence unavailable');
    expect(output).not.toContain('SECRET');
    expect(output).not.toContain(GUILD_A);
    expect(output).not.toContain('500000000000000001');
  });

  it('fails a flush during an ongoing storage failure so an export cannot pretend logs are complete', async () => {
    const destination = createGuildLogDestination({ append: async () => { throw new Error('unavailable'); }, diagnostics: { write: jest.fn() } });
    const logger = createLogger({ level: 'info', service: 'picket', destination: destination.destination });
    logger.child({ guild_id: GUILD_A }).warn({}, 'denied');
    await expect(destination.flush()).rejects.toThrow('Guild log persistence unavailable');
    expect(destination.healthy).toBe(false);
    await expect(destination.close()).rejects.toThrow('Guild log persistence unavailable');
  });

  it('retries independently of the nightly cleanup and restores health when storage recovers', async () => {
    jest.useFakeTimers();
    try {
      const append = jest.fn<Promise<void>, [readonly GuildApplicationLog[]]>()
        .mockRejectedValueOnce(new Error('unavailable')).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(undefined);
      const destination = createGuildLogDestination({ append, diagnostics: { write: jest.fn() } });
      const logger = createLogger({ level: 'info', service: 'picket', destination: destination.destination });
      logger.child({ guild_id: GUILD_A }).info({}, 'tick');
      await expect(destination.flush()).rejects.toThrow('Guild log persistence unavailable');
      expect(destination.healthy).toBe(false);
      await jest.advanceTimersByTimeAsync(5_000);
      expect(destination.healthy).toBe(true);
      expect(append).toHaveBeenCalledTimes(3);
      expect(append.mock.calls[0]?.[0]).toEqual(append.mock.calls[2]?.[0]);
      await destination.close();
    } finally { jest.useRealTimers(); }
  });

  it('flushes records appended while the previous batch is still being written', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const stored: GuildApplicationLog[] = [];
    const append = jest.fn(async (entries: readonly GuildApplicationLog[]) => {
      if (stored.length === 0) await blocked;
      stored.push(...entries);
    });
    const destination = createGuildLogDestination({ append, diagnostics: { write: jest.fn() } });
    const logger = createLogger({ level: 'info', service: 'picket', destination: destination.destination }).child({ guild_id: GUILD_A });
    logger.info({}, 'first');
    await Promise.resolve();
    logger.info({}, 'second');
    const flush = destination.flush();
    release();
    await flush;
    expect(stored.map((entry) => entry.record.msg)).toEqual(['first', 'second']);
  });

  it('bounds the retry buffer and refuses an export after overflow without emitting the original records', async () => {
    const diagnostics = { write: jest.fn() };
    const destination = createGuildLogDestination({ append: async () => undefined, diagnostics });
    const logger = createLogger({ level: 'info', service: 'picket', destination: destination.destination });
    logger.child({ guild_id: GUILD_A }).info({ value: 'x'.repeat(10 * 1024 * 1024) }, 'large');
    await expect(destination.flush()).rejects.toThrow('Guild log persistence unavailable');
    expect(JSON.stringify(diagnostics.write.mock.calls)).not.toContain(GUILD_A);
  });
});
