import type { APIInteraction } from 'discord-api-types/v10';
import { toIncomingInteraction } from '@picket/discord';

const base = {
  id: '900000000000000001',
  application_id: '800000000000000001',
  token: 'interaction-token',
  version: 1,
  guild_id: '700000000000000001',
  channel_id: '600000000000000001',
  locale: 'fr',
  guild_locale: 'en-US',
  member: { user: { id: '500000000000000001' }, roles: ['400000000000000001', 'bad'], permissions: '8' },
  app_permissions: '2048',
};

const asPayload = (value: Record<string, unknown>) => value as unknown as APIInteraction;

describe('toIncomingInteraction', () => {
  it('extracts the full command path through groups and subcommands', () => {
    const result = toIncomingInteraction(
      asPayload({
        ...base,
        type: 2,
        data: {
          name: 'picket',
          type: 1,
          options: [{ type: 2, name: 'permissions', options: [{ type: 1, name: 'set', options: [{ type: 3, name: 'role', value: 'x' }] }] }],
        },
      }),
    );
    expect(result.ok && result.value.commandPath).toEqual(['picket', 'permissions', 'set']);
  });

  it('maps member, locales and permission bitfields; drops invalid role ids', () => {
    const result = toIncomingInteraction(asPayload({ ...base, type: 2, data: { name: 'picket', type: 1 } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      kind: 'command',
      locale: 'fr',
      guildLocale: 'en-US',
      memberRoleIds: ['400000000000000001'],
      memberPermissions: 8n,
      appPermissions: 2048n,
      commandPath: ['picket'],
    });
    expect(result.value.token.reveal()).toBe('interaction-token');
  });

  it('collects leaf option values and ignores containers', () => {
    const result = toIncomingInteraction(
      asPayload({
        ...base,
        type: 2,
        data: {
          name: 'picket',
          type: 1,
          options: [
            {
              type: 2,
              name: 'permissions',
              options: [
                {
                  type: 1,
                  name: 'set',
                  options: [
                    { type: 3, name: 'level', value: 'officer' },
                    { type: 8, name: 'role', value: '400000000000000001' },
                    { type: 5, name: 'confirm', value: true },
                  ],
                },
              ],
            },
          ],
        },
      }),
    );
    expect(result.ok && result.value.options).toEqual({ level: 'officer', role: '400000000000000001', confirm: true });
  });

  it('ignores positional options that are not subcommands', () => {
    const result = toIncomingInteraction(
      asPayload({ ...base, type: 2, data: { name: 'todolist', type: 1, options: [{ type: 3, name: 'title', value: 'x' }] } }),
    );
    expect(result.ok && result.value.commandPath).toEqual(['todolist']);
  });

  it('gives commands without options an empty record', () => {
    const result = toIncomingInteraction(asPayload({ ...base, type: 2, data: { name: 'picket', type: 1 } }));
    expect(result.ok && result.value.options).toEqual({});
  });

  it('keeps component and modal custom ids', () => {
    const component = toIncomingInteraction(asPayload({ ...base, type: 3, data: { custom_id: 'td1:abc', component_type: 2 } }));
    const modal = toIncomingInteraction(asPayload({ ...base, type: 5, data: { custom_id: 'td1:modal', components: [] } }));
    expect(component.ok && component.value).toMatchObject({ kind: 'component', customId: 'td1:abc', commandPath: [] });
    expect(modal.ok && modal.value).toMatchObject({ kind: 'modal', customId: 'td1:modal' });
  });

  it('keeps the clicked message of a component interaction, and no message for the others', () => {
    const message = { id: '910000000000000001', channel_id: '600000000000000002' };
    const component = toIncomingInteraction(asPayload({ ...base, type: 3, message, data: { custom_id: 'td:1:i0', component_type: 2 } }));
    expect(component.ok && component.value.message).toEqual({ id: '910000000000000001', channelId: '600000000000000002' });
    const command = toIncomingInteraction(asPayload({ ...base, type: 2, data: { name: 'picket', type: 1 } }));
    expect(command.ok && command.value.message).toBeNull();
  });

  it('ignores a component message with malformed identifiers instead of trusting it', () => {
    const component = toIncomingInteraction(
      asPayload({ ...base, type: 3, message: { id: 'x', channel_id: 'y' }, data: { custom_id: 'td:1:i0', component_type: 2 } }),
    );
    expect(component.ok && component.value.message).toBeNull();
    const missing = toIncomingInteraction(asPayload({ ...base, type: 3, data: { custom_id: 'td:1:i0', component_type: 2 } }));
    expect(missing.ok && missing.value.message).toBeNull();
  });

  it('reads the text fields of a modal, in action rows as well as in labels', () => {
    const modal = toIncomingInteraction(
      asPayload({
        ...base,
        type: 5,
        data: {
          custom_id: 'td:1:create',
          components: [
            { type: 1, components: [{ type: 4, custom_id: 'content', value: 'A・a\nB・b' }] },
            { type: 18, component: { type: 4, custom_id: 'title', value: 'My list' } },
            { type: 1, components: [{ type: 4, custom_id: 'broken' }] },
          ],
        },
      }),
    );
    expect(modal.ok && modal.value.fields).toEqual({ content: 'A・a\nB・b', title: 'My list' });
  });

  it('gives interactions without fields an empty record', () => {
    const modal = toIncomingInteraction(asPayload({ ...base, type: 5, data: { custom_id: 'td:1:create' } }));
    expect(modal.ok && modal.value.fields).toEqual({});
  });

  it('maps autocomplete interactions', () => {
    const result = toIncomingInteraction(
      asPayload({ ...base, type: 4, data: { name: 'timers', type: 1, options: [{ type: 1, name: 'add', options: [] }] } }),
    );
    expect(result.ok && result.value).toMatchObject({ kind: 'autocomplete', commandPath: ['timers', 'add'] });
  });

  it('handles direct messages (no guild, no member)', () => {
    const { guild_id: _g, member: _m, ...dm } = base;
    const result = toIncomingInteraction(
      asPayload({ ...dm, type: 2, user: { id: '500000000000000002' }, data: { name: 'picket', type: 1 } }),
    );
    expect(result.ok && result.value).toMatchObject({ guildId: null, userId: '500000000000000002', memberPermissions: null });
  });

  it('falls back to en-US when Discord sends no locale', () => {
    const { locale: _l, guild_locale: _gl, ...rest } = base;
    const result = toIncomingInteraction(asPayload({ ...rest, type: 2, data: { name: 'picket', type: 1 } }));
    expect(result.ok && result.value.locale).toBe('en-US');
  });

  it.each([
    ['bad interaction id', { id: 'x' }],
    ['bad application id', { application_id: 'x' }],
    ['bad guild id', { guild_id: 'x' }],
    ['no user at all', { member: undefined }],
  ])('rejects %s', (_label, override) => {
    const result = toIncomingInteraction(asPayload({ ...base, type: 2, data: { name: 'picket', type: 1 }, ...override }));
    expect(result.ok).toBe(false);
  });
});
