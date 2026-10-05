import {
  ComponentRegistry,
  CUSTOM_ID_MAX_LENGTH,
  RegistryError,
  decodeCustomId,
  encodeCustomId,
  ephemeral,
  type ComponentFamily,
} from '@picket/discord';

const handler = async () => ephemeral('ok');
const family = (overrides: Partial<ComponentFamily> = {}): ComponentFamily => ({
  namespace: 'td',
  version: 1,
  level: 'member',
  onComponent: handler,
  ...overrides,
});

describe('custom_id codec (DIS-RQ-04)', () => {
  it('encodes ns:version:payload and decodes it back', () => {
    const id = encodeCustomId('td', 1, 'i12');
    expect(id).toBe('td:1:i12');
    expect(decodeCustomId(id)).toEqual({ namespace: 'td', version: 1, payload: 'i12' });
  });

  it('allows an empty payload and colons inside the payload', () => {
    expect(decodeCustomId(encodeCustomId('ab', 2, ''))).toEqual({ namespace: 'ab', version: 2, payload: '' });
    expect(decodeCustomId('ab:2:x:y:z')).toEqual({ namespace: 'ab', version: 2, payload: 'x:y:z' });
  });

  it('refuses to produce an identifier over 100 characters, the Discord limit', () => {
    expect(() => encodeCustomId('td', 1, 'x'.repeat(80))).not.toThrow();
    expect(encodeCustomId('td', 1, 'x'.repeat(80)).length).toBeLessThanOrEqual(CUSTOM_ID_MAX_LENGTH);
    expect(() => encodeCustomId('td', 1, 'x'.repeat(81))).toThrow(RegistryError);
  });

  it.each([
    ['uppercase namespace', () => encodeCustomId('TD', 1, 'a')],
    ['empty namespace', () => encodeCustomId('', 1, 'a')],
    ['namespace starting with a digit', () => encodeCustomId('1td', 1, 'a')],
    ['namespace over 8 characters', () => encodeCustomId('abcdefghi', 1, 'a')],
    ['version 0', () => encodeCustomId('td', 0, 'a')],
    ['version over 99', () => encodeCustomId('td', 100, 'a')],
    ['non integer version', () => encodeCustomId('td', 1.5, 'a')],
    ['payload with a space', () => encodeCustomId('td', 1, 'a b')],
    ['payload with an accent', () => encodeCustomId('td', 1, 'é')],
  ])('refuses %s', (_label, encode) => {
    expect(encode).toThrow(RegistryError);
  });

  it.each([null, '', 'td', 'td:1', ':1:a', 'TD:1:a', 'td:x:a', 'td:0:a', 'td:1.5:a', 'td:1:a b', `td:1:${'x'.repeat(100)}`])(
    'decodes %j as nothing',
    (raw) => {
      expect(decodeCustomId(raw)).toBeNull();
    },
  );
});

describe('ComponentRegistry', () => {
  it('finds the handler of a component or of a modal, with the payload', () => {
    const onModal = jest.fn(handler);
    const registry = new ComponentRegistry([family({ onModal })]);
    const component = registry.resolve('td:1:i3', 'component');
    expect(component).toMatchObject({ kind: 'found', payload: 'i3', handler });
    expect(registry.resolve('td:1:create', 'modal')).toMatchObject({ kind: 'found', payload: 'create', handler: onModal });
  });

  it.each([
    ['malformed', 'garbage', 'component', 'malformed'],
    ['unknown namespace', 'zz:1:a', 'component', 'unknown_namespace'],
    ['version mismatch', 'td:2:a', 'component', 'version_mismatch'],
    ['no modal handler', 'td:1:a', 'modal', 'no_handler'],
    ['null', null, 'component', 'malformed'],
  ] as const)('DIS-EC-07: %s is stale, never silently ignored', (_label, customId, kind, reason) => {
    expect(new ComponentRegistry([family()]).resolve(customId, kind)).toEqual({ kind: 'stale', reason });
  });

  it('DIS-EC-08: detects a namespace collision when the process starts', () => {
    expect(() => new ComponentRegistry([family(), family()])).toThrow(RegistryError);
    expect(() => new ComponentRegistry([family(), family({ namespace: 'tm' })])).not.toThrow();
  });

  it('refuses a family without handler, with a bad namespace or with a bad version', () => {
    expect(() => new ComponentRegistry([{ namespace: 'td', version: 1, level: 'member' }])).toThrow(RegistryError);
    expect(() => new ComponentRegistry([family({ namespace: 'Bad' })])).toThrow(RegistryError);
    expect(() => new ComponentRegistry([family({ version: 0 })])).toThrow(RegistryError);
  });

  it('is empty by default', () => {
    expect(new ComponentRegistry([]).resolve('td:1:a', 'component')).toEqual({ kind: 'stale', reason: 'unknown_namespace' });
  });
});
