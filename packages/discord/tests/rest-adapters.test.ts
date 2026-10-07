import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DiscordAPIError, HTTPError, RateLimitError } from '@discordjs/rest';
import {
  ApplicationId,
  ChannelId,
  GuildId,
  MessageId,
  Secret,
} from '@picket/kernel';
import {
  DiscordApiError,
  DiscordRestInteractionReplies,
  DiscordRestGuildRoles,
  DiscordRestMessaging,
  mapRestError,
  toRestMessage,
  type MessageView,
} from '@picket/discord';

const channel = ChannelId.assert('600000000000000001');
const message = MessageId.assert('910000000000000001');
const application = ApplicationId.assert('800000000000000001');

const view: MessageView = {
  embeds: [{ title: '📋 Todolist', description: '🇦・a', footer: '📋 1/2', color: 0x5865f2 }],
  buttons: [{ customId: 'td:1:i0', emoji: '🇦' }],
};

describe('toRestMessage', () => {
  it('maps embeds and spreads buttons over rows of five, with no mention allowed', () => {
    const body = toRestMessage({
      embeds: [{ description: 'd' }],
      buttons: Array.from({ length: 12 }, (_value, index) => ({ customId: `td:1:i${index}`, emoji: '🇦' })),
    });
    expect(body.embeds).toEqual([{ description: 'd' }]);
    expect(body.components?.map((row) => ('components' in row ? row.components.length : 0))).toEqual([5, 5, 2]);
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });

  it('sends the full embed fields and a secondary button with an emoji and no label', () => {
    const body = toRestMessage(view);
    expect(body.embeds).toEqual([
      { title: '📋 Todolist', description: '🇦・a', footer: { text: '📋 1/2' }, color: 0x5865f2 },
    ]);
    expect(body.components).toEqual([
      { type: 1, components: [{ type: 2, style: 2, custom_id: 'td:1:i0', emoji: { name: '🇦' } }] },
    ]);
  });

  it('sends an empty component list when no button remains, so that edited messages lose their old buttons', () => {
    expect(toRestMessage({ embeds: [{ description: 'd' }], buttons: [] }).components).toEqual([]);
  });

  it('accepts 25 buttons and refuses 26, and refuses a description over 4096 characters', () => {
    const buttons = (count: number) => Array.from({ length: count }, (_value, index) => ({ customId: `td:1:i${index}`, emoji: '🇦' }));
    expect(toRestMessage({ embeds: [], buttons: buttons(25) }).components).toHaveLength(5);
    expect(() => toRestMessage({ embeds: [], buttons: buttons(26) })).toThrow(RangeError);
    expect(() => toRestMessage({ embeds: [{ description: 'x'.repeat(4097) }], buttons: [] })).toThrow(RangeError);
    expect(() => toRestMessage({ embeds: [{ description: 'x'.repeat(4096) }], buttons: [] })).not.toThrow();
  });
});

describe('mapRestError (DIS-RQ-07)', () => {
  const url = 'https://discord.com/api/v10/webhooks/800000000000000001/SECRET-INTERACTION-TOKEN/messages/@original';
  const apiError = (code: number, status: number) =>
    new DiscordAPIError({ code, message: 'boom' }, code, status, 'PATCH', url, { body: undefined, files: undefined } as never);

  it.each([
    [10003, 404, 'unknown_channel'],
    [10008, 404, 'unknown_message'],
    [50001, 403, 'missing_access'],
    [50007, 400, 'cannot_dm'],
    [50013, 403, 'missing_permissions'],
    [99999, 400, 'unknown'],
    [0, 429, 'rate_limited'],
    [0, 502, 'unavailable'],
  ] as const)('maps Discord code %i (HTTP %i) to %s', (code, status, reason) => {
    const mapped = mapRestError(apiError(code, status));
    expect(mapped).toBeInstanceOf(DiscordApiError);
    expect(mapped.reason).toBe(reason);
    expect(mapped.status).toBe(status);
    expect(mapped.discordCode).toBe(code);
  });

  it('never carries the interaction token, in the message, the fields or a cause', () => {
    const mapped = mapRestError(apiError(10008, 404));
    expect(mapped.message).not.toContain('SECRET');
    expect(mapped.cause).toBeUndefined();
    expect(JSON.stringify(mapped, Object.getOwnPropertyNames(mapped))).not.toContain('SECRET');
  });

  it('maps rate limits, server errors, network failures and the rest', () => {
    const limited = new RateLimitError({
      timeToReset: 1,
      limit: 1,
      method: 'POST',
      hash: 'h',
      url,
      route: '/x',
      majorParameter: 'm',
      global: false,
      retryAfter: 1,
      sublimit: false,
      scope: 'user',
    } as never);
    expect(mapRestError(limited).reason).toBe('rate_limited');
    expect(mapRestError(new HTTPError(503, 'Service Unavailable', 'GET', url, {} as never)).reason).toBe('unavailable');
    expect(mapRestError(new HTTPError(400, 'Bad Request', 'GET', url, {} as never)).reason).toBe('unknown');
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(mapRestError(abort).reason).toBe('unavailable');
    expect(mapRestError(Object.assign(new Error('reset'), { code: 'ECONNRESET' })).reason).toBe('unavailable');
    expect(mapRestError(new TypeError('bug')).reason).toBe('unknown');
    expect(mapRestError('weird').reason).toBe('unknown');
  });

  it('leaves an already mapped error alone', () => {
    const original = new DiscordApiError('missing_access', 'x');
    expect(mapRestError(original)).toBe(original);
  });
});

describe('Discord REST adapters against a local server', () => {
  interface Seen {
    readonly method: string;
    readonly url: string;
    readonly authorization: string | undefined;
    readonly body: unknown;
    readonly rawBody: string;
    readonly contentType: string | undefined;
  }

  let server: Server;
  let api = '';
  let seen: Seen[] = [];
  let respond: (request: IncomingMessage, response: ServerResponse) => void;

  const json = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const contentType = request.headers['content-type'];
        const payload = contentType?.startsWith('multipart/form-data')
          ? raw.match(/name="payload_json"[^\r\n]*\r\n(?:[^\r\n]+\r\n)*\r\n([\s\S]*?)\r\n--/)?.[1] ?? '{}'
          : raw;
        seen.push({
          method: request.method ?? '',
          url: request.url ?? '',
          authorization: request.headers.authorization,
          body: payload === '' ? null : JSON.parse(payload), rawBody: raw, contentType,
        });
        respond(request, response);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    seen = [];
    respond = (_request, response) => json(response, 200, {});
  });

  const messaging = () => new DiscordRestMessaging(new Secret('bot-token'), { api, retries: 0 });
  const replies = () => new DiscordRestInteractionReplies({ api, retries: 0 });

  it('posts a message with the bot token and returns the new identifier', async () => {
    respond = (_request, response) => json(response, 200, { id: message });
    expect(await messaging().send(channel, view)).toBe(message);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'POST', url: `/api/v10/channels/${channel}/messages`, authorization: 'Bot bot-token' });
    expect(seen[0]?.body).toMatchObject({ allowed_mentions: { parse: [] }, embeds: [{ description: '🇦・a' }] });
  });

  it('reads a message back as a stored message, with the embed fields', async () => {
    respond = (_request, response) =>
      json(response, 200, {
        id: message,
        channel_id: channel,
        embeds: [{ title: 'T', description: 'D', footer: { text: 'F' }, color: 5 }, {}],
      });
    expect(await messaging().fetch(channel, message)).toEqual({
      id: message,
      channelId: channel,
      embeds: [
        { title: 'T', description: 'D', footer: 'F', color: 5 },
        { title: null, description: null, footer: null, color: null },
      ],
    });
    expect(seen[0]).toMatchObject({ method: 'GET', url: `/api/v10/channels/${channel}/messages/${message}` });
  });

  it('edits and deletes a message', async () => {
    await messaging().edit(channel, message, view);
    await messaging().delete(channel, message);
    expect(seen.map((call) => `${call.method} ${call.url}`)).toEqual([
      `PATCH /api/v10/channels/${channel}/messages/${message}`,
      `DELETE /api/v10/channels/${channel}/messages/${message}`,
    ]);
    expect(seen[0]?.body).toMatchObject({ components: [{ type: 1 }] });
  });

  it.each([
    [404, 10008, 'unknown_message'],
    [404, 10003, 'unknown_channel'],
    [403, 50001, 'missing_access'],
    [403, 50013, 'missing_permissions'],
  ] as const)('DIS-RQ-11: turns HTTP %i / code %i into a %s error', async (status, code, reason) => {
    respond = (_request, response) => json(response, status, { code, message: 'nope' });
    await expect(messaging().fetch(channel, message)).rejects.toMatchObject({ name: 'DiscordApiError', reason });
    await expect(messaging().edit(channel, message, view)).rejects.toMatchObject({ reason });
    await expect(messaging().delete(channel, message)).rejects.toMatchObject({ reason });
    await expect(messaging().send(channel, view)).rejects.toMatchObject({ reason });
  });

  it('turns a server failure into an unavailable error', async () => {
    respond = (_request, response) => json(response, 503, { message: 'down' });
    await expect(messaging().send(channel, view)).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('turns an unreachable Discord into an unavailable error', async () => {
    const unreachable = new DiscordRestMessaging(new Secret('t'), { api: 'http://127.0.0.1:1/api', retries: 0 });
    await expect(unreachable.send(channel, view)).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('refuses a malformed identifier in the answer instead of trusting it', async () => {
    respond = (_request, response) => json(response, 200, { id: 'not-a-snowflake' });
    await expect(messaging().send(channel, view)).rejects.toMatchObject({ name: 'DiscordApiError', reason: 'unknown' });
  });

  it('edits, deletes and follows up an interaction response without the bot token, and privately', async () => {
    const target = { applicationId: application, token: new Secret('interaction-token') };
    await replies().editOriginal(target, 'edited');
    await replies().deleteOriginal(target);
    await replies().followUp(target, 'private note');

    expect(seen.map((call) => `${call.method} ${call.url}`)).toEqual([
      `PATCH /api/v10/webhooks/${application}/interaction-token/messages/%40original`,
      `DELETE /api/v10/webhooks/${application}/interaction-token/messages/%40original`,
      `POST /api/v10/webhooks/${application}/interaction-token`,
    ]);
    expect(seen.every((call) => call.authorization === undefined)).toBe(true);
    expect(seen[0]?.body).toEqual({ content: 'edited', allowed_mentions: { parse: [] } });
    expect(seen[2]?.body).toEqual({ content: 'private note', flags: 64, allowed_mentions: { parse: [] } });
  });

  it('sends rich panels on interaction webhooks, without legacy fields or bot authorization', async () => {
    const target = { applicationId: application, token: new Secret('current-component-token') };
    const panel = { components: [{ kind: 'text' as const, text: 'Settings saved' }] };
    await replies().editOriginal(target, panel); await replies().followUp(target, panel);
    expect(seen[0]).toMatchObject({ method: 'PATCH', url: `/api/v10/webhooks/${application}/current-component-token/messages/%40original`, body: { flags: 32768, components: [{ type: 17 }], allowed_mentions: { parse: [] } } });
    expect(seen[1]?.body).toMatchObject({ flags: 32832 });
    expect(seen.every((call) => call.authorization === undefined)).toBe(true);
    expect(seen[0]?.body).not.toHaveProperty('content'); expect(seen[0]?.body).not.toHaveProperty('embeds');
  });

  it('reads current role names for configured-role menus using the bot token', async () => {
    const guild = GuildId.assert('700000000000000001');
    respond = (_request, response) => json(response, 200, [{ id: '400000000000000011', name: 'Officers' }, { id: 'bad', name: 'bad' }]);
    const reader = new DiscordRestGuildRoles(new Secret('bot-token'), { api, retries: 0 });
    expect(await reader.names(guild)).toEqual({ '400000000000000011': 'Officers' });
    expect(seen[0]).toMatchObject({ method: 'GET', url: `/api/v10/guilds/${guild}/roles`, authorization: 'Bot bot-token' });
  });
  it('uploads JSON as multipart in a private follow-up without V2 flags, mentions or bot authorization', async () => {
    const target = { applicationId: application, token: new Secret('export-component-token') };
    const bytes = new TextEncoder().encode('{"name":"Béton 🏗️","guildId":"700000000000000001"}\n');
    await replies().followUp(target, { content: 'Private download', file: { filename: 'picket-data.json', bytes } });
    expect(seen[0]).toMatchObject({ method: 'POST', authorization: undefined,
      body: { content: 'Private download', flags: 64, allowed_mentions: { parse: [] }, attachments: [{ id: 0, filename: 'picket-data.json' }] },
    });
    expect(seen[0]?.contentType).toContain('multipart/form-data; boundary=');
    expect(seen[0]?.rawBody).toContain('name="files[0]"; filename="picket-data.json"');
    expect(seen[0]?.rawBody).toContain('Content-Type: application/json');
    expect(seen[0]?.rawBody).toContain(new TextDecoder().decode(bytes));
    expect(seen[0]?.body).not.toHaveProperty('components');
    expect(seen[0]?.body).not.toHaveProperty('embeds');
  });

  it('can also attach a file to an original deferred response', async () => {
    const target = { applicationId: application, token: new Secret('export-token') };
    await replies().editOriginal(target, { content: 'Download', file: { filename: 'data.json', bytes: new TextEncoder().encode('{}') } });
    expect(seen[0]).toMatchObject({ method: 'PATCH', authorization: undefined, body: { attachments: [{ id: 0, filename: 'data.json' }] } });
    expect(seen[0]?.contentType).toContain('multipart/form-data');
  });

  it('does not leak the interaction token in the error of a failed follow-up', async () => {
    respond = (_request, response) => json(response, 404, { code: 10015, message: 'Unknown Webhook' });
    const target = { applicationId: application, token: new Secret('interaction-token') };
    const failure = await replies().followUp(target, 'x').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DiscordApiError);
    expect(JSON.stringify(failure, Object.getOwnPropertyNames(failure))).not.toContain('interaction-token');
  });
});
