import { InteractionResponseType, type APIInteraction } from 'discord-api-types/v10';
import {
  CommandRegistry,
  InteractionPipeline,
  RegistryError,
  buildCommandsPayload,
  ephemeral,
  toIncomingInteraction,
  toWireResponse,
  type AccessLevel,
  type AutocompleteContext,
  type CommandEntry,
  type InteractionReceipts,
} from '@picket/discord';
import { createI18n, type MessageKey } from '@picket/i18n';
import { allFeaturesEnabled, makeInteraction, noComponents, recordingLogger } from '@picket/testing';

const key = (value: string) => value as MessageKey;
const i18n = createI18n({ en: { d: 'Description', root: 'Root' }, fr: { d: 'Description FR' } });
const roots = [{ name: 'timers', description: key('root') }];

const entryWith = (extra: Partial<CommandEntry>): CommandEntry => ({
  path: ['timers', 'add'],
  description: key('d'),
  level: 'member',
  handler: async () => ephemeral('ok'),
  ...extra,
});

const asPayload = (value: Record<string, unknown>) => value as unknown as APIInteraction;

describe('autocomplete: interaction mapping', () => {
  it('reports the focused option and keeps the partial text and the other options', () => {
    const result = toIncomingInteraction(
      asPayload({
        id: '900000000000000001',
        application_id: '800000000000000001',
        token: 'interaction-token',
        version: 1,
        guild_id: '700000000000000001',
        channel_id: '600000000000000001',
        member: { user: { id: '500000000000000001' }, roles: [], permissions: '0' },
        type: 4,
        data: {
          name: 'timers',
          type: 1,
          options: [
            {
              type: 1,
              name: 'add',
              options: [
                { type: 3, name: 'region', value: 'Deadlands' },
                { type: 3, name: 'location', value: 'Ab', focused: true },
              ],
            },
          ],
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      kind: 'autocomplete',
      commandPath: ['timers', 'add'],
      focusedOption: 'location',
      options: { region: 'Deadlands', location: 'Ab' },
    });
  });
});

describe('autocomplete: registry and payload', () => {
  const autocompleteOption = { type: 'string', name: 'region', description: key('d'), autocomplete: true } as const;
  const handler = async () => [];

  it('requires a handler for every autocomplete option, and an option for every handler', () => {
    expect(() => new CommandRegistry(roots, [entryWith({ options: [autocompleteOption] })], i18n)).toThrow(RegistryError);
    expect(() => new CommandRegistry(roots, [entryWith({ autocomplete: { region: handler } })], i18n)).toThrow(RegistryError);
    expect(
      () => new CommandRegistry(roots, [entryWith({ options: [autocompleteOption], autocomplete: { region: handler } })], i18n),
    ).not.toThrow();
  });

  it('refuses autocomplete on a non-string option, and combined with choices', () => {
    const bad = (option: Record<string, unknown>) =>
      new CommandRegistry(roots, [entryWith({ options: [option as never], autocomplete: { x: handler } })], i18n);
    expect(() => bad({ type: 'boolean', name: 'x', description: key('d'), autocomplete: true })).toThrow(RegistryError);
    expect(() => bad({ type: 'string', name: 'x', description: key('d'), autocomplete: true, choices: [{ label: 'a', value: 'a' }] })).toThrow(
      RegistryError,
    );
  });

  it('refuses value bounds outside integer options, and inverted bounds', () => {
    const bad = (option: Record<string, unknown>) => new CommandRegistry(roots, [entryWith({ options: [option as never] })], i18n);
    expect(() => bad({ type: 'string', name: 'x', description: key('d'), minValue: 1 })).toThrow(RegistryError);
    expect(() => bad({ type: 'integer', name: 'x', description: key('d'), minValue: 5, maxValue: 1 })).toThrow(RegistryError);
    expect(() => bad({ type: 'integer', name: 'x', description: key('d'), minValue: 1, maxValue: 5 })).not.toThrow();
  });

  it('declares autocomplete, user and integer options in the deployed payload', () => {
    const registry = new CommandRegistry(
      roots,
      [
        entryWith({
          options: [
            autocompleteOption,
            { type: 'user', name: 'owner', description: key('d') },
            { type: 'integer', name: 'hours', description: key('d'), minValue: 0, maxValue: 720 },
          ],
          autocomplete: { region: handler },
        }),
      ],
      i18n,
    );
    const options = (buildCommandsPayload(registry)[0]?.options?.[0] as unknown as { options: Record<string, unknown>[] }).options;
    expect(options).toEqual([
      expect.objectContaining({ type: 3, name: 'region', autocomplete: true }),
      expect.objectContaining({ type: 6, name: 'owner' }),
      expect.objectContaining({ type: 4, name: 'hours', min_value: 0, max_value: 720 }),
    ]);
    expect(options[0]).not.toHaveProperty('choices');
  });
});

describe('autocomplete: pipeline', () => {
  const claim = jest.fn(async () => true);
  const receipts: InteractionReceipts = { claim };

  function pipelineFor(handlerLevel: AccessLevel | null, extra: Partial<CommandEntry> = {}, feature = allFeaturesEnabled) {
    const seen: AutocompleteContext[] = [];
    const registry = new CommandRegistry(
      roots,
      [
        entryWith({
          options: [{ type: 'string', name: 'region', description: key('d'), autocomplete: true }],
          autocomplete: {
            region: async (context) => {
              seen.push(context);
              return [{ name: `${context.focused.value}!`, value: 'v' }];
            },
          },
          ...extra,
        }),
      ],
      i18n,
    );
    const pipeline = new InteractionPipeline({
      registry,
      receipts,
      access: { levelOf: async () => handlerLevel },
      gate: { suspensionOf: async () => null },
      language: { localeOf: async () => null },
      components: noComponents,
      features: feature,
      logger: recordingLogger(),
    });
    return { pipeline, seen };
  }

  const autocomplete = (overrides: Parameters<typeof makeInteraction>[0] = {}) =>
    makeInteraction({
      kind: 'autocomplete',
      commandPath: ['timers', 'add'],
      focusedOption: 'region',
      options: { region: 'Dead' },
      ...overrides,
    });

  it('answers with the handler choices, gives it the focused text and the access level, and writes no receipt', async () => {
    const { pipeline, seen } = pipelineFor('officer');
    const reply = await pipeline.handle(autocomplete());
    expect(reply).toEqual({ kind: 'autocomplete', choices: [{ name: 'Dead!', value: 'v' }] });
    expect(seen[0]).toMatchObject({ focused: { name: 'region', value: 'Dead' }, level: 'officer' });
    expect(claim).not.toHaveBeenCalled();
  });

  it('answers empty choices, never a message, when access is denied or the feature is off', async () => {
    expect(await pipelineFor(null).pipeline.handle(autocomplete())).toEqual({ kind: 'autocomplete', choices: [] });
    const off = pipelineFor('admin', { feature: 'timers' }, { isEnabled: async () => false });
    expect(await off.pipeline.handle(autocomplete())).toEqual({ kind: 'autocomplete', choices: [] });
    expect(off.seen).toHaveLength(0);
  });

  it('answers empty choices for an unknown command, an unknown option, or outside a guild', async () => {
    const { pipeline, seen } = pipelineFor('admin');
    expect(await pipeline.handle(autocomplete({ commandPath: ['timers', 'gone'] }))).toEqual({ kind: 'autocomplete', choices: [] });
    expect(await pipeline.handle(autocomplete({ focusedOption: 'other' }))).toEqual({ kind: 'autocomplete', choices: [] });
    expect(await pipeline.handle(autocomplete({ guildId: null }))).toEqual({ kind: 'autocomplete', choices: [] });
    expect(seen).toHaveLength(0);
  });

  it('answers empty choices when the handler fails', async () => {
    const { pipeline } = pipelineFor('admin', {
      autocomplete: {
        region: async () => {
          throw new Error('boom');
        },
      },
    });
    expect(await pipeline.handle(autocomplete())).toEqual({ kind: 'autocomplete', choices: [] });
  });

  it('gives the access level to command handlers too', async () => {
    const handler = jest.fn(async () => ephemeral('ok'));
    const { pipeline } = pipelineFor('officer', { handler });
    await pipeline.handle(makeInteraction({ commandPath: ['timers', 'add'] }));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ level: 'officer' }));
  });
});

describe('autocomplete: wire response', () => {
  it('keeps 25 choices at most, cuts long names and drops values Discord would reject', () => {
    const choices = Array.from({ length: 30 }, (_value, index) => ({ name: `n${index}`, value: `v${index}` }));
    const wire = toWireResponse({ kind: 'autocomplete', choices }) as { type: number; data: { choices: unknown[] } };
    expect(wire.type).toBe(InteractionResponseType.ApplicationCommandAutocompleteResult);
    expect(wire.data.choices).toHaveLength(25);

    const long = toWireResponse({
      kind: 'autocomplete',
      choices: [
        { name: 'n'.repeat(150), value: 'ok' },
        { name: 'dropped', value: 'v'.repeat(101) },
      ],
    }) as { data: { choices: { name: string; value: string }[] } };
    expect(long.data.choices).toHaveLength(1);
    expect(long.data.choices[0]?.name).toHaveLength(100);
  });

  it('prefills a modal input', () => {
    const wire = toWireResponse({
      kind: 'modal',
      customId: 'tm:1:a',
      title: 't',
      inputs: [{ customId: 'duration', label: 'l', style: 'short', value: '50' }],
    });
    expect(wire).toMatchObject({ data: { components: [{ component: { custom_id: 'duration', value: '50' } }] } });
  });
});
