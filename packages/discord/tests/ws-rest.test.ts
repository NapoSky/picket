import { WebSocketManager } from '@discordjs/ws';
import { createDiscordBotRest, createWsShardConnector } from '@picket/discord';
import { noopLogger, Secret } from '@picket/kernel';

jest.mock('@discordjs/ws', () => ({
  ...jest.requireActual('@discordjs/ws'),
  WebSocketManager: jest.fn().mockImplementation(() => ({
    on: jest.fn(), connect: jest.fn().mockResolvedValue(undefined), destroy: jest.fn().mockResolvedValue(undefined),
  })),
}));

it('keeps all shards and reconnects on the process-wide authenticated REST counter', async () => {
  const token = new Secret('bot-token');
  const rest = createDiscordBotRest(token, { globalRequestsPerSecond: 7 });
  const connect = createWsShardConnector({
    token, rest, logger: noopLogger,
    sessions: { load: async () => null, save: async () => true, clear: async () => undefined },
    handler: { handle: async () => undefined },
  });
  for (const shardId of [0, 1, 0]) {
    const shard = connect({ shardId, shardCount: 2, lease: { name: `gateway:shard:${shardId}`, holder: 'a', token: 1n } });
    await shard.start();
    await shard.stop();
  }
  const calls = jest.mocked(WebSocketManager).mock.calls;
  expect(calls).toHaveLength(3);
  expect(calls.map(([options]) => options.rest)).toEqual([rest, rest, rest]);
  expect(rest.options.globalRequestsPerSecond).toBe(7);
});
