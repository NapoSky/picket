import {
  DiscordVoice,
  VoiceError,
  type ManagedVoiceChannel,
} from '@picket/voice';
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

describe('managed channel placement', () => {
  const id = (number: number) => String(610000000000000000n + BigInt(number));
  const entry = (
    number: number,
    name: string,
    templateName = 'Combat',
    categoryId = category,
  ): ManagedVoiceChannel => ({
    channelId: id(number),
    categoryId,
    templateId: templateName,
    templateName,
    name,
  });
  function setup(
    channels: {
      id: string;
      type: number;
      parent_id: string;
      position: number;
    }[],
  ) {
    const get = jest.fn(async () =>
      channels.map((channel) => ({ ...channel, guild_id: guild })),
    );
    const patch = jest.fn(
      async (
        _path: string,
        options: { body: { id: string; position: number }[] },
      ) => {
        for (const move of options.body)
          channels.find((channel) => channel.id === move.id)!.position =
            move.position;
      },
    );
    const adapter = new DiscordVoice({
      get,
      patch,
    } as unknown as DiscordBotRestClient);
    const order = (categoryId = category) =>
      [...channels]
        .filter(
          (channel) => channel.type === 2 && channel.parent_id === categoryId,
        )
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
        .map((channel) => channel.id);
    return { adapter, get, patch, order };
  }
  it('inserts Combat 4 before Logi 1 and preserves permanent, stage and other-category slots', async () => {
    const otherCategory = '600000000000000002';
    const channels = [
      { id: id(10), type: 2, parent_id: category, position: 0 },
      ...[1, 2, 3, 4, 5].map((number, index) => ({
        id: id(number),
        type: 2,
        parent_id: category,
        position: index + 1,
      })),
      { id: id(11), type: 13, parent_id: category, position: 6 },
      { id: id(12), type: 2, parent_id: otherCategory, position: 7 },
      { id: id(13), type: 0, parent_id: category, position: 0 },
    ];
    const e = setup(channels);
    const managed = [
      entry(1, 'Combat · 01'),
      entry(2, 'Combat · 02'),
      entry(3, 'Combat · 03'),
      entry(4, 'Logi · 01', 'Logi'),
      entry(5, 'Combat · 04'),
    ];
    await e.adapter.orderChannels(guild, managed);
    expect(e.order()).toEqual([10, 1, 2, 3, 5, 4].map(id));
    expect(e.patch).toHaveBeenCalledWith(`/guilds/${guild}/channels`, {
      body: [
        { id: id(10), position: 0 },
        { id: id(1), position: 1 },
        { id: id(2), position: 2 },
        { id: id(3), position: 3 },
        { id: id(5), position: 4 },
        { id: id(4), position: 5 },
        { id: id(11), position: 6 },
      ],
    });
    expect(channels.find((channel) => channel.id === id(12))!.position).toBe(7);
    expect(channels.find((channel) => channel.id === id(13))!.position).toBe(0);
    await e.adapter.orderChannels(guild, managed);
    expect(e.patch).toHaveBeenCalledTimes(1);
  });
  it('alphabetizes an initial mixed deployment and sorts channel numbers naturally', async () => {
    const managed = [
      entry(1, 'Logi · 01', 'Logi'),
      entry(2, 'Combat · 10'),
      entry(3, 'Combat · 2'),
      entry(4, 'Alpha · 01', 'Alpha'),
    ];
    const e = setup(
      managed.map((channel, position) => ({
        id: channel.channelId,
        type: 2,
        parent_id: category,
        position,
      })),
    );
    await e.adapter.orderChannels(guild, managed);
    expect(e.order()).toEqual([4, 3, 2, 1].map(id));
  });
  it('keeps a template together even when its existing channel name differs from its current name', async () => {
    const managed = [
      entry(1, 'Zulu · 01'),
      entry(2, 'Logi · 01', 'Logi'),
      entry(3, 'Alpha · 02'),
    ];
    const e = setup(
      managed.map((channel, position) => ({
        id: channel.channelId,
        type: 2,
        parent_id: category,
        position,
      })),
    );
    await e.adapter.orderChannels(guild, managed);
    expect(e.order()).toEqual([1, 3, 2].map(id));
  });
  it('keeps a deleted template grouped when its saved channel prefixes changed over time', async () => {
    const managed = [
      entry(1, 'Zulu · 01', 'Zulu'),
      entry(2, 'Logi · 01', 'Logi'),
      { ...entry(3, 'Combat · 02'), templateId: 'Zulu' },
    ];
    const e = setup(
      managed.map((channel, position) => ({
        id: channel.channelId,
        type: 2,
        parent_id: category,
        position,
      })),
    );
    await e.adapter.orderChannels(guild, managed);
    expect(e.order()).toEqual([1, 3, 2].map(id));
  });
  it('normalizes tied Discord positions when their snowflake order conflicts with the desired order', async () => {
    const managed = [
      entry(1, 'Logi · 01', 'Logi'),
      entry(2, 'Combat · 02'),
      entry(3, 'Combat · 01'),
    ];
    const e = setup(
      managed.map((channel) => ({
        id: channel.channelId,
        type: 2,
        parent_id: category,
        position: 0,
      })),
    );
    await e.adapter.orderChannels(guild, managed);
    expect(e.order()).toEqual([3, 2, 1].map(id));
    expect(e.patch.mock.calls[0]![1].body.map((move) => move.position)).toEqual(
      [0, 1, 2],
    );
  });
  it('ignores missing channels and channels moved out of their configured category', async () => {
    const managed = [
      entry(1, 'Logi · 01', 'Logi'),
      entry(2, 'Combat · 01'),
      entry(3, 'Alpha · 01', 'Alpha'),
    ];
    const e = setup([
      { id: id(1), type: 2, parent_id: category, position: 0 },
      { id: id(2), type: 2, parent_id: '600000000000000002', position: 1 },
    ]);
    await e.adapter.orderChannels(guild, managed);
    expect(e.patch).not.toHaveBeenCalled();
  });
  it('makes no REST requests if no category has more than one managed voice channel', async () => {
    const e = setup([]);
    await e.adapter.orderChannels(guild, [
      entry(1, 'Combat · 01'),
      entry(2, 'Logi · 01', 'Logi', '600000000000000002'),
    ]);
    expect(e.get).not.toHaveBeenCalled();
    expect(e.patch).not.toHaveBeenCalled();
  });
  it('orders separate categories in one position update without changing their parents', async () => {
    const otherCategory = '600000000000000002';
    const managed = [
      entry(1, 'Logi · 01', 'Logi'),
      entry(2, 'Combat · 01'),
      entry(3, 'Zulu · 01', 'Zulu', otherCategory),
      entry(4, 'Alpha · 01', 'Alpha', otherCategory),
    ];
    const e = setup(
      managed.map((channel, position) => ({
        id: channel.channelId,
        type: 2,
        parent_id: channel.categoryId,
        position,
      })),
    );
    await e.adapter.orderChannels(guild, managed);
    expect(e.order()).toEqual([2, 1].map(id));
    expect(e.order(otherCategory)).toEqual([4, 3].map(id));
    expect(e.patch).toHaveBeenCalledTimes(1);
    expect(
      e.patch.mock.calls[0]![1].body.every(
        (move) => Object.keys(move).sort().join(',') === 'id,position',
      ),
    ).toBe(true);
  });
});
