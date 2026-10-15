import { DiscordAPIError, DiscordRestCommandsApi, DiscordRestGuildOperations, CommandRegistry, buildCommandsPayload, createDiscordBotRest, deployOperatorCommands, ephemeral, toWireResponse, type DiscordBotRestClient, type GuildOperationsDiscord } from '@picket/discord';
import { ApplicationId, ChannelId, GuildId, Secret, UserId } from '@picket/kernel';
import { testI18n } from '@picket/testing';

const channelId = ChannelId.assert('600000000000000001');
const guildId = GuildId.assert('700000000000000001');
const ownerId = UserId.assert('500000000000000001');
const other = GuildId.assert('700000000000000002');
const registry = new CommandRegistry([{ name: 'picket-ops', description: 'ops.command' }], [
  { path: ['picket-ops', 'servers'], description: 'ops.serversCommand', level: 'admin', handler: async () => ephemeral('ok') },
], testI18n);

describe('operator Discord adapters', () => {
  const get = jest.fn();
  const adapter = () => new DiscordRestGuildOperations({ get } as unknown as DiscordBotRestClient);
  beforeEach(() => { get.mockReset(); });

  it('resolves the support guild and personal application owner, caching only navigation checks', async () => {
    get.mockImplementation(async (route: string) => route.startsWith('/channels/')
      ? { guild_id: guildId, type: 0 } : { name: 'PICKET', team: null, owner: { id: ownerId, username: 'Owner' } });
    const api = adapter();
    expect(await api.scope(channelId)).toEqual({ guildId, channelId, ownerId, ownerName: 'Owner' });
    await api.scope(channelId);
    expect(get).toHaveBeenCalledTimes(2);
    await api.scope(channelId, true);
    expect(get).toHaveBeenCalledTimes(4);
  });

  it('uses the team owner rather than every team member or the application team account', async () => {
    get.mockImplementation(async (route: string) => route.startsWith('/channels/') ? { guild_id: guildId, type: 0 } : {
      name: 'PICKET', owner: { id: '500000000000000009', username: 'Team account' },
      team: { owner_user_id: ownerId, members: [{ user: { id: ownerId, username: 'Team owner' } }, { user: { id: '500000000000000008' } }] },
    });
    expect(await adapter().scope(channelId)).toMatchObject({ ownerId, ownerName: 'Team owner' });
  });

  it.each([{ type: 1 }, { type: 2, guild_id: guildId }, { type: 0 }])('rejects an unsupported operator channel %j', async channel => {
    get.mockImplementation(async (route: string) => route.startsWith('/channels/') ? channel : { owner: { id: ownerId } });
    await expect(adapter().scope(channelId)).rejects.toThrow('Operator channel');
  });

  it('does not treat missing permissions or network errors as an absent guild', async () => {
    const api = adapter();
    const failure = (code: number) => new DiscordAPIError({ code, message: 'test' }, code, 404, 'GET', 'https://discord.com/api/v10/guilds/test', { body: undefined, files: undefined } as never);
    get.mockRejectedValueOnce(failure(10004));
    expect(await api.guild(guildId)).toBeNull();
    get.mockRejectedValueOnce(failure(50001));
    await expect(api.guild(guildId)).rejects.toBeInstanceOf(DiscordAPIError);
    get.mockRejectedValueOnce(new Error('network'));
    await expect(api.guild(guildId)).rejects.toThrow('network');
  });

  it('never retries an ambiguous server departure', async () => {
    const makeRequest = jest.fn(async () => { throw Object.assign(new Error('response lost'), { code: 'ECONNRESET' }); });
    const departure = createDiscordBotRest(new Secret('test-token'), { retries: 0, rejectOnRateLimit: () => true, makeRequest });
    const api = new DiscordRestGuildOperations({ get } as unknown as DiscordBotRestClient, departure);
    await expect(api.leave(guildId)).rejects.toThrow('response lost');
    expect(makeRequest).toHaveBeenCalledTimes(1);
    await expect(adapter().leave(guildId)).rejects.toThrow('non-retrying');
    const retrying = createDiscordBotRest(new Secret('test-token'), { retries: 2, makeRequest });
    await expect(new DiscordRestGuildOperations(departure, retrying).leave(guildId)).rejects.toThrow('non-retrying');
    await expect(api.leave(guildId, new Date(Date.now() - 1))).rejects.toThrow('expired');
    expect(makeRequest).toHaveBeenCalledTimes(1);
  });

  it('renders a non-editable modal summary alongside the two confirmation fields', () => {
    const wire = toWireResponse({ kind: 'modal', customId: 'ops:1:test', title: 'Remove PICKET', description: 'Selected server', inputs: [
      { customId: 'reason', label: 'Reason', style: 'paragraph', required: true, minLength: 10, maxLength: 500 },
      { customId: 'confirmation', label: 'Type QUITTER', style: 'short', required: true },
    ] });
    expect(wire).toMatchObject({ type: 9, data: { components: [{ type: 10, content: 'Selected server' }, { type: 18 }, { type: 18 }] } });
  });

  it('deletes only the operator slash command and preserves unrelated guild commands', async () => {
    const makeRequest = jest.fn(async (_url, init) => init.method === 'GET' ? new Response(JSON.stringify([
      { id: '900000000000000001', type: 1, name: 'picket-ops' },
      { id: '900000000000000002', type: 1, name: 'other-command' },
      { id: '900000000000000003', type: 2, name: 'picket-ops' },
    ]), { headers: { 'Content-Type': 'application/json' } }) : new Response(null, { status: 204 }));
    const api = new DiscordRestCommandsApi(ApplicationId.assert('800000000000000001'), new Secret('test-token'), { makeRequest });
    await api.syncOperatorCommands(guildId, []);
    expect(makeRequest).toHaveBeenCalledTimes(2);
    expect(makeRequest.mock.calls[1]![0]).toContain('/commands/900000000000000001');
    expect(makeRequest.mock.calls[1]![1].method).toBe('DELETE');
  });
});

describe('operator command deployment', () => {
  let stored: string | null;
  const syncOperatorCommands = jest.fn(async () => undefined);
  const discord: GuildOperationsDiscord = { scope: async () => ({ guildId, channelId, ownerId, ownerName: 'Owner' }), guild: async () => null, leave: async () => undefined };
  const options = () => ({ registry, api: { syncOperatorCommands }, discord, channelId,
    store: { get: async () => stored, set: async (value: string) => { stored = value; } } });
  beforeEach(() => { stored = null; syncOperatorCommands.mockClear(); });

  it('deploys only to the resolved support guild, with restrictive defaults, and is idempotent', async () => {
    expect(await deployOperatorCommands(options())).toEqual({ deployed: true, enabled: true });
    expect(syncOperatorCommands).toHaveBeenCalledWith(guildId, buildCommandsPayload(registry).map(command => ({ ...command, default_member_permissions: '0' })));
    expect(await deployOperatorCommands(options())).toEqual({ deployed: false, enabled: true });
    expect(syncOperatorCommands).toHaveBeenCalledTimes(1);
  });

  it('clears the previous guild when the configured support server changes', async () => {
    stored = JSON.stringify({ guildId: other, hash: 'old' });
    await deployOperatorCommands(options());
    expect(syncOperatorCommands.mock.calls).toEqual([[other, []], [guildId, expect.any(Array)]]);
  });

  it('removes old scoped commands when the feature is disabled', async () => {
    stored = JSON.stringify({ guildId, hash: 'old' });
    expect(await deployOperatorCommands({ ...options(), channelId: null })).toEqual({ deployed: true, enabled: false });
    expect(syncOperatorCommands).toHaveBeenCalledWith(guildId, []);
  });
});
