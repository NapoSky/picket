import type { GatewayDispatchPayload } from 'discord-api-types/v10';
import { SerialQueue, normalizeDispatch } from '@picket/discord';
import { noopLogger } from '@picket/kernel';
import { recordingLogger } from '@picket/testing';

const dispatch = (t: string, d: unknown) => ({ op: 0, s: 1, t, d }) as unknown as GatewayDispatchPayload;

describe('normalizeDispatch', () => {
  it('turns READY into the full guild list of the shard, unavailable guilds included', () => {
    const event = normalizeDispatch(
      dispatch('READY', {
        guilds: [{ id: '700000000000000001', unavailable: true }, { id: '700000000000000002', unavailable: true }, { id: 'bad' }],
        shard: [2, 4],
      }),
      2,
      1,
    );
    expect(event).toEqual({
      type: 'ready',
      shardId: 2,
      shardCount: 4,
      guildIds: ['700000000000000001', '700000000000000002'],
    });
  });

  it('falls back to the configured shard count when READY carries no shard info', () => {
    expect(normalizeDispatch(dispatch('READY', { guilds: [] }), 0, 3)).toMatchObject({ shardCount: 3 });
  });

  it('maps GUILD_CREATE to guild_available', () => {
    expect(normalizeDispatch(dispatch('GUILD_CREATE', { id: '700000000000000001', name: 'x' }), 0, 1)).toEqual({
      type: 'guild_available',
      guildId: '700000000000000001',
    });
  });

  it('maps GUILD_DELETE to guild_removed only when the bot actually left', () => {
    expect(normalizeDispatch(dispatch('GUILD_DELETE', { id: '700000000000000001' }), 0, 1)).toEqual({
      type: 'guild_removed',
      guildId: '700000000000000001',
    });
  });

  it('ignores GUILD_DELETE caused by an outage (unavailable: true)', () => {
    expect(normalizeDispatch(dispatch('GUILD_DELETE', { id: '700000000000000001', unavailable: true }), 0, 1)).toBeNull();
  });

  it('maps GUILD_ROLE_DELETE', () => {
    expect(
      normalizeDispatch(dispatch('GUILD_ROLE_DELETE', { guild_id: '700000000000000001', role_id: '400000000000000011' }), 0, 1),
    ).toEqual({ type: 'role_deleted', guildId: '700000000000000001', roleId: '400000000000000011' });
  });

  it('drops malformed identifiers and unrelated events', () => {
    expect(normalizeDispatch(dispatch('GUILD_CREATE', { id: 'nope' }), 0, 1)).toBeNull();
    expect(normalizeDispatch(dispatch('GUILD_DELETE', { id: 'nope' }), 0, 1)).toBeNull();
    expect(normalizeDispatch(dispatch('GUILD_ROLE_DELETE', { guild_id: '1', role_id: '2' }), 0, 1)).toBeNull();
    expect(normalizeDispatch(dispatch('MESSAGE_CREATE', { id: '700000000000000001' }), 0, 1)).toBeNull();
    expect(normalizeDispatch(dispatch('INTERACTION_CREATE', {}), 0, 1)).toBeNull();
  });
});

describe('SerialQueue', () => {
  it('runs tasks strictly in arrival order, even when an earlier one is slower', async () => {
    const queue = new SerialQueue(noopLogger);
    const order: string[] = [];
    queue.enqueue('slow', async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push('first');
    });
    queue.enqueue('fast', async () => void order.push('second'));
    queue.enqueue('fastest', async () => void order.push('third'));

    await queue.drain();
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('logs a failing task and keeps processing the following ones', async () => {
    const logger = recordingLogger();
    const queue = new SerialQueue(logger);
    const ran: string[] = [];
    queue.enqueue('boom', async () => {
      throw new Error('boom');
    });
    queue.enqueue('after', async () => void ran.push('after'));

    await queue.drain();
    expect(ran).toEqual(['after']);
    expect(logger.records.filter((record) => record.level === 'error')).toHaveLength(1);
  });

  it('drain resolves immediately when idle', async () => {
    await expect(new SerialQueue(noopLogger).drain()).resolves.toBeUndefined();
  });
});
