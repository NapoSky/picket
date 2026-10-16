import { DiscordVoice, VoiceError } from '@picket/voice';
import { GuildId, UserId } from '@picket/kernel';
import type { DiscordBotRestClient } from '@picket/discord';
const guild = GuildId.assert('700000000000000001'),
  category = '600000000000000001';
it('checks actual category permissions and requests no audio or audit data', async () => {
  const get = jest.fn(async (path: string) =>
    path === '/users/@me'
      ? { id: '800000000000000001' }
      : path.includes('/roles')
        ? [{ id: guild, permissions: String(1049600n | 16n) }]
        : path.includes('/members/')
          ? { roles: [] }
          : {
              id: category,
              guild_id: guild,
              type: 4,
              permission_overwrites: [],
            },
  );
  const adapter = new DiscordVoice({ get } as unknown as DiscordBotRestClient);
  await adapter.category(guild, category, {
    guildId: guild,
    userId: UserId.assert('500000000000000001'),
    roleIds: [],
  });
  expect(get.mock.calls.flat().join(' ')).not.toMatch(/audit|voice-states/);
});
it('does not interpret 403 as channel absence', async () => {
  const adapter = new DiscordVoice({
    get: jest.fn().mockRejectedValue({ code: 50001, status: 403 }),
  } as unknown as DiscordBotRestClient);
  await expect(adapter.exists(guild, category)).rejects.toMatchObject({
    status: 403,
  });
  const missing = new DiscordVoice({
    get: jest.fn().mockRejectedValue({ code: 10003, status: 404 }),
  } as unknown as DiscordBotRestClient);
  expect(await missing.exists(guild, category)).toBe(false);
});
it('creates a voice channel with inherited category access and no explicit permission overrides', async () => {
  const post = jest
    .fn()
    .mockResolvedValue({ id: '610000000000000001', guild_id: guild, type: 2 });
  const adapter = new DiscordVoice({ post } as unknown as DiscordBotRestClient);
  await adapter.create(
    guild,
    {
      name: 'Combat',
      channelName: 'Combat',
      categoryId: category,
      capacity: 99,
      idleMinutes: 15,
    },
    'Combat · 01',
  );
  expect(post).toHaveBeenCalledWith(`/guilds/${guild}/channels`, {
    body: { type: 2, name: 'Combat · 01', parent_id: category, user_limit: 99 },
  });
});

it('caches ordinary category reads but forces a fresh authorization at deployment', async () => {
  const get = jest.fn(async (path: string) =>
    path === '/users/@me'
      ? { id: '800000000000000001' }
      : path.includes('/roles')
        ? [{ id: guild, permissions: String(1049600n | 16n) }]
        : path.includes('/members/')
          ? { roles: [] }
          : {
              id: category,
              guild_id: guild,
              type: 4,
              permission_overwrites: [],
            },
  );
  const adapter = new DiscordVoice({ get } as unknown as DiscordBotRestClient),
    person = {
      guildId: guild,
      userId: UserId.assert('500000000000000001'),
      roleIds: [],
    };
  await adapter.category(guild, category, person);
  const first = get.mock.calls.length;
  await adapter.category(guild, category, person);
  expect(get).toHaveBeenCalledTimes(first);
  await adapter.category(guild, category, person, true);
  expect(get.mock.calls.length).toBeGreaterThan(first);
});
