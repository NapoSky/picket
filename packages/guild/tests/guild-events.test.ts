import type { GatewayEvent } from '@picket/discord';
import { GuildId, RoleId, noopLogger } from '@picket/kernel';
import { createGuildEventHandler, type GuildEventUseCases } from '@picket/guild';

const guildId = GuildId.assert('700000000000000001');
const roleId = RoleId.assert('400000000000000011');

function setup(overrides: { removed?: boolean; roleDeleted?: boolean } = {}) {
  const useCases = {
    available: { execute: jest.fn(async () => undefined) },
    removed: { execute: jest.fn(async () => overrides.removed ?? true) },
    reconcile: { execute: jest.fn(async () => [guildId]) },
    roleDeleted: { execute: jest.fn(async () => overrides.roleDeleted ?? true) },
  };
  const handler = createGuildEventHandler(useCases as unknown as GuildEventUseCases, noopLogger);
  return { useCases, handle: (event: GatewayEvent) => handler.handle(event) };
}

describe('createGuildEventHandler', () => {
  it('reconciles the shard guilds when the connection is ready', async () => {
    const { useCases, handle } = setup();
    await handle({ type: 'ready', shardId: 1, shardCount: 4, guildIds: [guildId] });
    expect(useCases.reconcile.execute).toHaveBeenCalledWith({ shardId: 1, shardCount: 4, presentGuildIds: [guildId] });
  });

  it('initialises a guild that becomes available', async () => {
    const { useCases, handle } = setup();
    await handle({ type: 'guild_available', guildId });
    expect(useCases.available.execute).toHaveBeenCalledWith(guildId);
  });

  it('records the removal of the bot', async () => {
    const { useCases, handle } = setup();
    await handle({ type: 'guild_removed', guildId });
    expect(useCases.removed.execute).toHaveBeenCalledWith(guildId);
  });

  it('removes a deleted role from the access levels', async () => {
    const { useCases, handle } = setup();
    await handle({ type: 'role_deleted', guildId, roleId });
    expect(useCases.roleDeleted.execute).toHaveBeenCalledWith(guildId, roleId);
  });

  it('lets use case failures reach the queue that logs them', async () => {
    const { useCases, handle } = setup();
    useCases.available.execute.mockRejectedValueOnce(new Error('db down'));
    await expect(handle({ type: 'guild_available', guildId })).rejects.toThrow('db down');
  });

  it('tolerates repeated events that change nothing', async () => {
    const { handle } = setup({ removed: false, roleDeleted: false });
    await expect(handle({ type: 'guild_removed', guildId })).resolves.toBeUndefined();
    await expect(handle({ type: 'role_deleted', guildId, roleId })).resolves.toBeUndefined();
  });
});
