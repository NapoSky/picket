import { EventEmitter } from 'node:events';
import { WebSocketManager, WebSocketShardEvents, type SessionInfo } from '@discordjs/ws';
import { createWsShardConnector } from '@picket/discord';
import { noopLogger, Secret } from '@picket/kernel';
const managers: EventEmitter[] = [];
jest.mock('@discordjs/ws', () => ({
  ...jest.requireActual('@discordjs/ws'),
  WebSocketManager: jest.fn().mockImplementation(() => {
    const manager = Object.assign(new EventEmitter(), {
      connect: jest.fn(async () => undefined),
      destroy: jest.fn(async () => undefined),
    });
    managers.push(manager);
    return manager;
  }),
}));
const lease = { name: 'gateway:shard:0', holder: 'holder', token: 1n };
const info: SessionInfo = {
  shardId: 0,
  resumeURL: 'wss://gateway.discord.gg',
  sequence: 10,
  sessionId: 'session',
  shardCount: 1,
};
it('requests only guild, member-role and voice-state events', async () => {
  const connection = createWsShardConnector({
    token: new Secret('unused'),
    logger: noopLogger,
    sessions: {
      load: async () => ({ ...info, shardId: 0, intents: 131 }),
      save: async () => true,
      clear: async () => undefined,
    },
    handler: { handle: async () => undefined },
  })({ shardId: 0, shardCount: 1, lease });
  await connection.start();
  expect(jest.mocked(WebSocketManager).mock.calls.at(-1)![0].intents).toBe(131);
  await connection.stop();
});
it('persists only the sequence delivered durably and never advances past a failed event', async () => {
  const save = jest.fn(async () => true);
  const handle = jest.fn(async () => undefined).mockRejectedValueOnce(new Error('buffer full'));
  const connection = createWsShardConnector({
    token: new Secret('unused'),
    logger: noopLogger,
    sessions: { load: async () => ({ ...info, shardId: 0, intents: 131 }), save, clear: async () => undefined },
    handler: { handle },
  })({ shardId: 0, shardCount: 1, lease });
  await connection.start();
  const options = jest.mocked(WebSocketManager).mock.calls.at(-1)![0];
  const manager = managers.at(-1)!;
  await options.updateSessionInfo!(0, { ...info, sequence: 11 });
  manager.emit(
    WebSocketShardEvents.Dispatch,
    {
      t: 'VOICE_STATE_UPDATE',
      s: 11,
      d: { guild_id: '700000000000000001', user_id: '300000000000000001', channel_id: null },
    },
    0,
  );
  await options.updateSessionInfo!(0, { ...info, sequence: 12 });
  manager.emit(
    WebSocketShardEvents.Dispatch,
    {
      t: 'VOICE_STATE_UPDATE',
      s: 12,
      d: { guild_id: '700000000000000001', user_id: '300000000000000001', channel_id: null },
    },
    0,
  );
  await connection.stop();
  expect(handle).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalled();
});
it('saves the latest successfully consumed sequence during handoff', async () => {
  const save = jest.fn(async () => true);
  const connection = createWsShardConnector({
    token: new Secret('unused'),
    logger: noopLogger,
    sessions: { load: async () => ({ ...info, shardId: 0, intents: 131 }), save, clear: async () => undefined },
    handler: { handle: async () => undefined },
  })({ shardId: 0, shardCount: 1, lease });
  await connection.start();
  const options = jest.mocked(WebSocketManager).mock.calls.at(-1)![0];
  await options.updateSessionInfo!(0, { ...info, sequence: 11 });
  managers
    .at(-1)!
    .emit(
      WebSocketShardEvents.Dispatch,
      {
        t: 'VOICE_STATE_UPDATE',
        s: 11,
        d: { guild_id: '700000000000000001', user_id: '300000000000000001', channel_id: null },
      },
      0,
    );
  await connection.stop();
  expect(save).toHaveBeenCalledWith(lease, { ...info, shardId: 0, sequence: 11, intents: 131 });
});

it.each([undefined, 1])('replaces a saved session with legacy or incompatible intents (%s)', async intents => {
  const clear = jest.fn(async () => undefined);
  const handle = jest.fn(async () => undefined);
  const connection = createWsShardConnector({
    token: new Secret('unused'), logger: noopLogger,
    sessions: { load: async () => ({ ...info, ...(intents === undefined ? {} : { intents }) }),
      save: async () => true, clear }, handler: { handle },
  })({ shardId: 0, shardCount: 1, lease });
  await connection.start();
  const options = jest.mocked(WebSocketManager).mock.calls.at(-1)![0];
  expect(await options.retrieveSessionInfo!(0)).toBeNull();
  expect(clear).toHaveBeenCalledWith(lease, 0);
  managers.at(-1)!.emit(WebSocketShardEvents.Dispatch, {
    t: 'VOICE_STATE_UPDATE', s: 11, d: { guild_id: '700000000000000001', user_id: '300000000000000001',
      channel_id: '600000000000000001', member: { roles: ['400000000000000001'], user: { id: '300000000000000001' } } },
  }, 0);
  await connection.stop();
  expect(handle).toHaveBeenCalledWith(expect.objectContaining({ type: 'voice_state' }),
    expect.objectContaining({ replayed: false }));
});

it('resumes a session with the current intents without identifying on every rollout', async () => {
  const clear = jest.fn(async () => undefined);
  const connection = createWsShardConnector({
    token: new Secret('unused'), logger: noopLogger,
    sessions: { load: async () => ({ ...info, intents: 131 }), save: async () => true, clear },
    handler: { handle: async () => undefined },
  })({ shardId: 0, shardCount: 1, lease });
  await connection.start();
  expect(await jest.mocked(WebSocketManager).mock.calls.at(-1)![0].retrieveSessionInfo!(0))
    .toMatchObject({ sessionId: info.sessionId, sequence: info.sequence });
  expect(clear).not.toHaveBeenCalled();
  await connection.stop();
});
