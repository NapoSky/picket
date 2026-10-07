import {
  CommandRegistry,
  RegistryError,
  buildCommandsPayload,
  deployCommands,
  ephemeral,
  hashCommandsPayload,
  type CommandEntry,
  type CommandsApi,
  type DeployedHashStore,
} from '@picket/discord';
import { createI18n, type MessageKey } from '@picket/i18n';
import { testI18n } from '@picket/testing';

const handler: CommandEntry['handler'] = async () => ephemeral('ok');

// Catalogue minimal : les textes de commandes sont ici contrôlés par chaque test.
const key = (value: string) => value as MessageKey;
const i18n = createI18n({
  en: { d: 'Description', root: 'Root', group: 'Group', long: 'x'.repeat(101), empty: '', choice: 'Choice' },
  fr: { d: 'Description FR', choice: 'Choix' },
});

function entry(path: CommandEntry['path'], extra: Partial<CommandEntry> = {}): CommandEntry {
  return { path, description: key('d'), level: 'member', handler, ...extra };
}

const roots = [
  { name: 'picket', description: key('root'), groups: { permissions: key('group') } },
  { name: 'todolist', description: key('root') },
];
const entries: CommandEntry[] = [
  entry(['picket', 'status']),
  entry(['picket', 'permissions', 'show']),
  entry(['picket', 'permissions', 'set'], { level: 'admin' }),
  entry(['todolist', 'create']),
];
const registryOf = (r = roots, e: readonly CommandEntry[] = entries, catalogs = i18n) => new CommandRegistry(r, e, catalogs);

describe('CommandRegistry', () => {
  it('resolves commands by path and exposes its i18n', () => {
    const registry = registryOf();
    expect(registry.resolve(['picket', 'permissions', 'set'])).toBe(entries[2]);
    expect(registry.resolve(['picket', 'nope'])).toBeUndefined();
    expect(registry.resolve(['picket'])).toBeUndefined();
    expect(registry.i18n).toBe(i18n);
  });

  it.each([
    ['duplicate command', [entries[0] as CommandEntry, entries[0] as CommandEntry]],
    ['unknown root', [entry(['ghost', 'x'])]],
    ['unknown group', [entry(['picket', 'nogroup', 'x'])]],
    ['command named like a group', [entry(['picket', 'permissions'])]],
    ['uppercase name', [entry(['picket', 'Status'])]],
    ['name too long', [entry(['picket', 'a'.repeat(33)])]],
    ['empty description', [entry(['picket', 'x'], { description: key('empty') })]],
    ['description over 100 characters', [entry(['picket', 'x'], { description: key('long') })]],
  ])('rejects %s at startup', (_label, invalid) => {
    expect(() => registryOf(roots, invalid)).toThrow(RegistryError);
  });

  it('rejects duplicate roots, over-long root texts and more than 25 children', () => {
    expect(() => registryOf([roots[1] as (typeof roots)[1], roots[1] as (typeof roots)[1]], [])).toThrow(RegistryError);
    expect(() => registryOf([{ name: 'x', description: key('long') }], [])).toThrow(RegistryError);
    const many = Array.from({ length: 26 }, (_v, index) => entry(['todolist', `c${index}`]));
    expect(() => registryOf(roots, many)).toThrow(RegistryError);
  });

  it('validates the texts of every language, not only English', () => {
    const badFrench = createI18n({ en: { d: 'ok', root: 'ok' }, fr: { d: 'y'.repeat(101) } });
    expect(() => new CommandRegistry([{ name: 'a', description: key('root') }], [entry(['a', 'b'])], badFrench)).toThrow(
      /\(fr\)/,
    );
  });

  describe('options', () => {
    const withOptions = (options: CommandEntry['options']) => () =>
      registryOf(roots, [entry(['todolist', 'create'], options ? { options } : {})]);
    const option = (name: string, extra: object = {}) => ({ type: 'boolean' as const, name, description: key('d'), ...extra });

    it('accepts valid options with choices', () => {
      expect(
        withOptions([
          { type: 'string', name: 'level', description: key('d'), required: true, choices: [{ name: key('choice'), value: 'officer' }] },
          { type: 'role', name: 'role', description: key('d'), required: true },
          option('confirm'),
        ]),
      ).not.toThrow();
    });

    it('accepts literal choice labels and channel options', () => {
      expect(
        withOptions([
          { type: 'string', name: 'language', description: key('d'), choices: [{ label: 'Français', value: 'fr' }] },
          { type: 'channel', name: 'channel', description: key('d'), channelKinds: ['text'] },
        ]),
      ).not.toThrow();
    });

    it.each([
      ['a required option after an optional one', [option('a'), option('b', { required: true })]],
      ['an empty literal choice label', [{ type: 'string', name: 'a', description: key('d'), choices: [{ label: '', value: 'x' }] }]],
      ['an over-long literal choice label', [{ type: 'string', name: 'a', description: key('d'), choices: [{ label: 'l'.repeat(101), value: 'x' }] }]],
      ['channel kinds on a non-channel option', [option('a', { channelKinds: ['text'] })]],
      ['a duplicate option name', [option('a'), option('a')]],
      ['an invalid option name', [option('Bad Name')]],
      ['an over-long option description', [option('a', { description: key('long') })]],
      ['choices on a non-string option', [option('a', { choices: [{ name: key('choice'), value: 'x' }] })]],
      ['an empty choices list', [{ type: 'string', name: 'a', description: key('d'), choices: [] }]],
      ['more than 25 choices', [{ type: 'string', name: 'a', description: key('d'), choices: Array.from({ length: 26 }, (_v, i) => ({ name: key('choice'), value: `v${i}` })) }]],
      ['a choice value over 100 characters', [{ type: 'string', name: 'a', description: key('d'), choices: [{ name: key('choice'), value: 'v'.repeat(101) }] }]],
      ['a prefixed choice name over 100 characters', [{ type: 'string', name: 'a', description: key('d'), choices: [{ name: key('choice'), prefix: 'x'.repeat(95), value: 'x' }] }]],
      ['more than 25 options', Array.from({ length: 26 }, (_v, i) => option(`o${i}`))],
    ] as [string, CommandEntry['options']][])('rejects %s', (_label, options) => {
      expect(withOptions(options)).toThrow(RegistryError);
    });
  });
});

describe('buildCommandsPayload', () => {
  const registry = registryOf();

  it('generates guild-only chat input commands with subcommands and groups', () => {
    const payload = buildCommandsPayload(registry);
    expect(payload.map((command) => command.name)).toEqual(['picket', 'todolist']);
    expect(payload[0]).toMatchObject({
      type: 1,
      contexts: [0],
      integration_types: [0],
      options: [
        { type: 1, name: 'status' },
        { type: 2, name: 'permissions', options: [{ type: 1, name: 'set' }, { type: 1, name: 'show' }] },
      ],
    });
  });

  it('sends English as the default text and other languages as localizations', () => {
    const [picket] = buildCommandsPayload(registry);
    expect(picket).toMatchObject({ description: 'Root' });
    expect(picket).not.toHaveProperty('description_localizations');
    expect(picket?.options?.[0]).toMatchObject({
      name: 'status',
      description: 'Description',
      description_localizations: { fr: 'Description FR' },
    });
  });

  it('exposes options with their types, requirement, choices and prefixed localized choice names', () => {
    const withOptions = registryOf(roots, [
      entry(['picket', 'permissions', 'set'], {
        options: [
          { type: 'string', name: 'level', description: key('d'), required: true, choices: [
            { name: key('choice'), prefix: '📦 ', value: 'officer' },
            { name: key('choice'), value: 'member' },
          ] },
          { type: 'role', name: 'role', description: key('d'), required: true },
          { type: 'boolean', name: 'confirm', description: key('d') },
        ],
      }),
    ]);
    const group = buildCommandsPayload(withOptions)[0]?.options?.[0];
    expect(group).toMatchObject({
      type: 2,
      options: [
        {
          type: 1,
          name: 'set',
          options: [
            { type: 3, name: 'level', required: true, choices: [
              { name: '📦 Choice', name_localizations: { fr: '📦 Choix' }, value: 'officer' },
              { name: 'Choice', name_localizations: { fr: 'Choix' }, value: 'member' },
            ] },
            { type: 8, name: 'role', required: true },
            { type: 5, name: 'confirm', required: false },
          ],
        },
      ],
    });
  });

  it('is independent of declaration order', () => {
    const shuffled = registryOf([...roots].reverse(), [...entries].reverse());
    expect(hashCommandsPayload(buildCommandsPayload(shuffled))).toBe(hashCommandsPayload(buildCommandsPayload(registry)));
  });

  it('changes the hash when a definition or a translation changes', () => {
    const changed = registryOf(roots, [...entries, entry(['todolist', 'close'])]);
    expect(hashCommandsPayload(buildCommandsPayload(changed))).not.toBe(hashCommandsPayload(buildCommandsPayload(registry)));

    const retranslated = registryOf(roots, entries, createI18n({ ...{ en: { d: 'Description', root: 'Root', group: 'Group' } }, fr: { d: 'Autre texte' } }));
    expect(hashCommandsPayload(buildCommandsPayload(retranslated))).not.toBe(hashCommandsPayload(buildCommandsPayload(registry)));
  });
});

describe('shipped command definitions', () => {
  it('uses only keys that exist in the English catalog', () => {
    expect(testI18n.text('commands.picket.status.description').default).toBe('Show the PICKET status for this server');
    expect(testI18n.text('commands.picket.status.description').localizations['fr']).toBe("Afficher l'état de PICKET pour ce serveur");
  });
});

describe('deployCommands', () => {
  const registry = registryOf();

  function fakes() {
    let stored: string | null = null;
    const api: CommandsApi & { calls: number } = {
      calls: 0,
      async replaceGlobalCommands() {
        this.calls += 1;
      },
    };
    const store: DeployedHashStore = {
      get: async () => stored,
      set: async (hash) => {
        stored = hash;
      },
    };
    return { api, store };
  }

  it('deploys once, then skips while the definition is unchanged', async () => {
    const { api, store } = fakes();
    expect((await deployCommands({ registry, api, store })).deployed).toBe(true);
    expect((await deployCommands({ registry, api, store })).deployed).toBe(false);
    expect(api.calls).toBe(1);
  });

  it('redeploys when forced', async () => {
    const { api, store } = fakes();
    await deployCommands({ registry, api, store });
    expect((await deployCommands({ registry, api, store, force: true })).deployed).toBe(true);
    expect(api.calls).toBe(2);
  });

  it('does not record the hash when Discord rejects the update', async () => {
    const { store } = fakes();
    const failing: CommandsApi = {
      replaceGlobalCommands: async () => {
        throw new Error('429');
      },
    };
    await expect(deployCommands({ registry, api: failing, store })).rejects.toThrow('429');
    expect(await store.get()).toBeNull();
  });
});
