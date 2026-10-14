import { createGuildLogDestination, createLogger, createMonitoringDestination } from '@picket/observability';
import type { GuildApplicationLog } from '@picket/kernel';

describe('separate operational log stream', () => {
  it('excludes personal fields and raw errors from monitoring without changing tenant journals', async () => {
    const writes: string[] = [];
    const stored: GuildApplicationLog[] = [];
    const monitoring = createMonitoringDestination({ write: line => { writes.push(line); } });
    const destination = createGuildLogDestination({ monitoring, diagnostics: { write: () => undefined }, append: async entries => { stored.push(...entries); } });
    const logger = createLogger({ level: 'info', service: 'picket', version: 'image', destination: destination.destination });
    logger.child({ guild_id: '700000000000000001', interaction_id: '900000000000000001' })
      .error({ user_id: '500000000000000001', name: 'PRIVATE NAME', channel_id: '600000000000000001',
        token: 'SECRET', password: 'SECRET', err: new Error('https://discord.com/api/webhooks/SECRET'), durationMs: 10 }, 'interaction failed');
    logger.info({ memory: 10 }, 'picket started');
    await destination.flush();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.record).toMatchObject({ guild_id: '700000000000000001', user_id: '500000000000000001' });
    expect(writes).toHaveLength(2);
    expect(JSON.stringify(writes)).not.toMatch(/700000000000000001|900000000000000001|500000000000000001|600000000000000001|PRIVATE NAME|SECRET|webhooks/);
    expect(JSON.parse(writes[0]!)).toMatchObject({ msg: 'interaction failed', durationMs: 10, service: 'picket' });
    await destination.close();
  });

  it('drops interpolated messages and remains best-effort when the sink fails', () => {
    const write = jest.fn();
    const monitoring = createMonitoringDestination({ write });
    monitoring.write(JSON.stringify({ level: 50, time: '2026-10-14T00:00:00Z', service: 'picket', version: 'image', msg: 'member 500000000000000001 failed' }) + '\n');
    expect(write.mock.calls[0]?.[0]).not.toContain('500000000000000001');
    write.mockImplementation(() => { throw new Error('stdout closed'); });
    expect(() => monitoring.write('{}\ninvalid JSON\n')).not.toThrow();
  });
});
