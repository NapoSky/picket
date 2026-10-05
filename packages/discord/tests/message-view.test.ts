import { MessageFlags } from 'discord-api-types/v10';
import { RoleId } from '@picket/kernel';
import { embedsLength, toRestMessage, type MessageView } from '@picket/discord';

const role = RoleId.assert('400000000000000001');

describe('toRestMessage: fields, content and mentions', () => {
  it('sends embed fields, omits an empty description, and defaults to no mention at all', () => {
    const body = toRestMessage({
      embeds: [{ title: 'T', fields: [{ name: 'N', value: 'V' }, { name: 'I', value: 'W', inline: true }] }],
      buttons: [],
    });
    expect(body.embeds).toEqual([
      {
        title: 'T',
        fields: [
          { name: 'N', value: 'V', inline: false },
          { name: 'I', value: 'W', inline: true },
        ],
      },
    ]);
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body).not.toHaveProperty('content');
    expect(body).not.toHaveProperty('flags');
  });

  it('only resolves the role mentions that were asked for, and can silence the notification', () => {
    const view: MessageView = { embeds: [], buttons: [], content: `<@&${role}> soon`, mentionRoleIds: [role], silent: true };
    const body = toRestMessage(view);
    expect(body.content).toBe(`<@&${role}> soon`);
    expect(body.allowed_mentions).toEqual({ parse: [], roles: [role] });
    expect(body.flags).toBe(MessageFlags.SuppressNotifications);
  });

  it('refuses what Discord would refuse: too many fields, over-long field, 10+ embeds, 6000+ characters, long content', () => {
    const fields = (count: number) => Array.from({ length: count }, () => ({ name: 'n', value: 'v' }));
    expect(() => toRestMessage({ embeds: [{ fields: fields(25) }], buttons: [] })).not.toThrow();
    expect(() => toRestMessage({ embeds: [{ fields: fields(26) }], buttons: [] })).toThrow(RangeError);
    expect(() => toRestMessage({ embeds: [{ fields: [{ name: 'n', value: 'v'.repeat(1025) }] }], buttons: [] })).toThrow(RangeError);
    expect(() => toRestMessage({ embeds: [{ fields: [{ name: 'n'.repeat(257), value: 'v' }] }], buttons: [] })).toThrow(RangeError);
    expect(() => toRestMessage({ embeds: Array.from({ length: 11 }, () => ({ title: 't' })), buttons: [] })).toThrow(RangeError);
    expect(() =>
      toRestMessage({ embeds: [{ description: 'x'.repeat(4000) }, { description: 'y'.repeat(2001) }], buttons: [] }),
    ).toThrow(RangeError);
    expect(() => toRestMessage({ embeds: [], buttons: [], content: 'x'.repeat(2001) })).toThrow(RangeError);
  });

  it('counts the characters of every embed part, as Discord does', () => {
    expect(
      embedsLength([
        { title: 'ab', description: 'cde', footer: 'f', fields: [{ name: 'gh', value: 'ijk' }] },
        { fields: [{ name: 'l', value: 'm' }] },
      ]),
    ).toBe(2 + 3 + 1 + 5 + 2);
  });
});
