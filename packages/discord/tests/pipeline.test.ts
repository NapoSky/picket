import {
  CommandRegistry,
  ComponentRegistry,
  InteractionPipeline,
  ephemeral,
  type AccessLevel,
  type AccessPolicy,
  type CommandEntry,
  type ComponentFamily,
  type ComponentHandler,
  type FeatureGate,
  type GuildGate,
  type GuildLanguage,
  type InteractionReceipts,
  type Reply,
} from '@picket/discord';
import { InteractionId } from '@picket/kernel';
import { allFeaturesEnabled, makeInteraction, noComponents, recordingLogger, testI18n } from '@picket/testing';

const roots = [{ name: 'picket', description: 'commands.picket.description' as const }];

class MemoryReceipts implements InteractionReceipts {
  readonly seen = new Set<string>();
  async claim(id: InteractionId): Promise<boolean> {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    return true;
  }
}

const accessFor = (level: AccessLevel | null): AccessPolicy => ({ levelOf: jest.fn(async () => level) });

interface Options {
  readonly timeoutMs?: number;
  readonly receipts?: InteractionReceipts;
  readonly access?: AccessPolicy;
  readonly gate?: GuildGate;
  readonly language?: GuildLanguage;
  readonly required?: AccessLevel;
  readonly availableWhenSuspended?: boolean;
}

const openGate: GuildGate = { suspensionOf: async () => null };

function pipelineWith(handler: CommandEntry['handler'], options: Options = {}) {
  const logger = recordingLogger();
  const registry = new CommandRegistry(roots, [
    {
      path: ['picket', 'status'],
      description: 'commands.picket.status.description',
      level: options.required ?? 'member',
      ...(options.availableWhenSuspended !== undefined ? { availableWhenSuspended: options.availableWhenSuspended } : {}),
      handler,
    },
  ], testI18n);
  const pipeline = new InteractionPipeline({
    registry,
    receipts: options.receipts ?? new MemoryReceipts(),
    access: options.access ?? accessFor('admin'),
    gate: options.gate ?? openGate,
    language: options.language ?? { localeOf: async () => null },
    components: noComponents,
    features: allFeaturesEnabled,
    logger,
    ...(options.timeoutMs !== undefined ? { handlerTimeoutMs: options.timeoutMs } : {}),
  });
  return { pipeline, logger };
}

describe('InteractionPipeline', () => {
  it('runs the matching handler with the guild context', async () => {
    const handler = jest.fn(async () => ephemeral('ok'));
    const { pipeline } = pipelineWith(handler);
    const interaction = makeInteraction();

    expect(await pipeline.handle(interaction)).toEqual(ephemeral('ok'));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ interaction, guildId: interaction.guildId }));
  });

  it('answers a duplicate interaction without running the handler again', async () => {
    const handler = jest.fn(async () => ephemeral('ok'));
    const { pipeline } = pipelineWith(handler);
    const interaction = makeInteraction();

    await pipeline.handle(interaction);
    const second = await pipeline.handle(interaction);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ kind: 'message', ephemeral: true });
  });

  it('refuses commands used outside a guild', async () => {
    const handler = jest.fn(async () => ephemeral('ok'));
    const { pipeline } = pipelineWith(handler);

    const reply = await pipeline.handle(makeInteraction({ guildId: null }));

    expect(handler).not.toHaveBeenCalled();
    expect(reply).toMatchObject({ kind: 'message', ephemeral: true });
  });

  it('answers unknown commands with a localized-ready message', async () => {
    const { pipeline } = pipelineWith(async () => ephemeral('ok'));
    const reply = await pipeline.handle(makeInteraction({ commandPath: ['picket', 'gone'] }));
    expect(reply).toMatchObject({ kind: 'message', ephemeral: true });
  });

  it('answers stale components and modals instead of staying silent', async () => {
    const handler = jest.fn(async () => ephemeral('ok'));
    const { pipeline } = pipelineWith(handler);
    const ids = [InteractionId.assert('900000000000000011'), InteractionId.assert('900000000000000012')];

    for (const [index, kind] of (['component', 'modal'] as const).entries()) {
      const reply = await pipeline.handle(
        makeInteraction({ kind, commandPath: [], customId: 'old:1:x', id: ids[index] as InteractionId }),
      );
      expect(reply).toMatchObject({ kind: 'message', ephemeral: true });
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('answers autocomplete with an empty choice list', async () => {
    const { pipeline } = pipelineWith(async () => ephemeral('ok'));
    const reply = await pipeline.handle(makeInteraction({ kind: 'autocomplete' }));
    expect(reply).toEqual({ kind: 'autocomplete', choices: [] });
  });

  it('hides handler failures from the user but logs them', async () => {
    const { pipeline, logger } = pipelineWith(async () => {
      throw new Error('database password is hunter2');
    });

    const reply = await pipeline.handle(makeInteraction());

    expect(JSON.stringify(reply)).not.toContain('hunter2');
    expect(logger.records.some((record) => record.level === 'error')).toBe(true);
  });

  it('replies before the Discord deadline when a handler hangs', async () => {
    const { pipeline, logger } = pipelineWith(() => new Promise(() => undefined), { timeoutMs: 20 });
    const reply = await pipeline.handle(makeInteraction());
    expect(reply).toMatchObject({ kind: 'message', ephemeral: true });
    expect(logger.records.some((record) => record.message === 'handler timeout')).toBe(true);
  });

  it('survives a failing receipt store', async () => {
    const { pipeline } = pipelineWith(async () => ephemeral('ok'), {
      receipts: {
        claim: async () => {
          throw new Error('db down');
        },
      },
    });
    expect(await pipeline.handle(makeInteraction())).toMatchObject({ kind: 'message', ephemeral: true });
  });
});

describe('InteractionPipeline access control', () => {
  const ok = async () => ephemeral('executed');

  it.each<[AccessLevel, AccessLevel, boolean]>([
    ['member', 'member', true],
    ['officer', 'member', true],
    ['admin', 'member', true],
    ['member', 'officer', false],
    ['officer', 'officer', true],
    ['admin', 'officer', true],
    ['member', 'admin', false],
    ['officer', 'admin', false],
    ['admin', 'admin', true],
  ])('user level %s on a %s command -> allowed: %s', async (actual, required, allowed) => {
    const handler = jest.fn(ok);
    const { pipeline } = pipelineWith(handler, { access: accessFor(actual), required });

    const reply = await pipeline.handle(makeInteraction());

    expect(handler).toHaveBeenCalledTimes(allowed ? 1 : 0);
    if (!allowed) {
      expect(reply).toMatchObject({ kind: 'message', ephemeral: true });
      expect(JSON.stringify(reply)).toContain(`required level: ${required}`);
    }
  });

  it('denies a user without any level', async () => {
    const handler = jest.fn(ok);
    const { pipeline, logger } = pipelineWith(handler, { access: accessFor(null) });

    await pipeline.handle(makeInteraction());

    expect(handler).not.toHaveBeenCalled();
    expect(logger.records.some((record) => record.message === 'access denied')).toBe(true);
  });

  it('denies (fail-closed) when the access policy fails', async () => {
    const handler = jest.fn(ok);
    const { pipeline } = pipelineWith(handler, {
      access: {
        levelOf: async () => {
          throw new Error('db down');
        },
      },
    });

    const reply = await pipeline.handle(makeInteraction());

    expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify(reply)).not.toContain('executed');
  });

  it('does not consult the access policy outside a guild', async () => {
    const access = accessFor('admin');
    const { pipeline } = pipelineWith(ok, { access });
    await pipeline.handle(makeInteraction({ guildId: null }));
    expect(access.levelOf).not.toHaveBeenCalled();
  });
});

describe('InteractionPipeline guild suspension', () => {
  const ok = async () => ephemeral('executed');
  const suspended: GuildGate = { suspensionOf: jest.fn(async () => ({ purgeAt: new Date('2026-11-04T12:00:00Z') })) };

  it('blocks commands of a suspended guild and tells the user when the data will be deleted', async () => {
    const handler = jest.fn(ok);
    const { pipeline } = pipelineWith(handler, { gate: suspended });
    const reply = await pipeline.handle(makeInteraction());
    expect(JSON.stringify(reply)).toContain('scheduled for deletion on 2026-11-04');
    expect(handler).not.toHaveBeenCalled();
  });

  it('lets explicitly allowed commands through, without even consulting the gate', async () => {
    const gate: GuildGate = { suspensionOf: jest.fn(async () => ({ purgeAt: new Date('2026-11-04T12:00:00Z') })) };
    const handler = jest.fn(ok);
    const { pipeline } = pipelineWith(handler, { gate, availableWhenSuspended: true });
    await pipeline.handle(makeInteraction());
    expect(handler).toHaveBeenCalledTimes(1);
    expect(gate.suspensionOf).not.toHaveBeenCalled();
  });

  it('still enforces the access level on commands allowed while suspended', async () => {
    const handler = jest.fn(ok);
    const { pipeline } = pipelineWith(handler, { access: accessFor('member'), required: 'admin', availableWhenSuspended: true, gate: suspended });
    expect(JSON.stringify(await pipeline.handle(makeInteraction()))).toContain('required level: admin');
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not reveal the suspension to users without access', async () => {
    const { pipeline } = pipelineWith(ok, { access: accessFor(null), gate: suspended });
    expect(JSON.stringify(await pipeline.handle(makeInteraction()))).not.toContain('deletion');
  });

  it('denies (fail-closed) when the gate fails', async () => {
    const handler = jest.fn(ok);
    const gate: GuildGate = {
      suspensionOf: async () => {
        throw new Error('db down');
      },
    };
    const { pipeline } = pipelineWith(handler, { gate });
    await pipeline.handle(makeInteraction());
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('InteractionPipeline localization', () => {
  const content = (reply: unknown) => (reply as { content: string }).content;
  const denyAll = { access: accessFor(null) };

  it('answers in the language of the user', async () => {
    const { pipeline } = pipelineWith(async () => ephemeral('ok'), { ...denyAll, required: 'officer' });
    expect(content(await pipeline.handle(makeInteraction({ locale: 'fr' })))).toBe(
      "Vous n'avez pas accès à cette commande (niveau requis : officier).",
    );
  });

  it.each([
    ['fr', "Vous n'avez pas accès"],
    ['de', 'Du hast keinen Zugriff'],
    ['es-ES', 'No tienes acceso'],
    ['pt-BR', 'Você não tem acesso'],
  ])('falls back to the %s guild language when the user language is not supported', async (guildLocale, expected) => {
    const { pipeline } = pipelineWith(async () => ephemeral('ok'), denyAll);
    const reply = await pipeline.handle(makeInteraction({ locale: 'ja', guildLocale }));
    expect(content(reply)).toContain(expected);
  });

  it('falls back to English when neither language is supported, and for regional variants of English', async () => {
    const { pipeline } = pipelineWith(async () => ephemeral('ok'), denyAll);
    expect(content(await pipeline.handle(makeInteraction({ locale: 'ja', guildLocale: 'ko', id: InteractionId.assert('900000000000000021') })))).toContain('You do not have access');
    expect(content(await pipeline.handle(makeInteraction({ locale: 'en-GB', id: InteractionId.assert('900000000000000022') })))).toContain('You do not have access');
  });

  it('passes the translator to handlers in the resolved language', async () => {
    const { pipeline } = pipelineWith(async ({ t }) => ephemeral(t('errors.guildOnly')));
    expect(content(await pipeline.handle(makeInteraction({ locale: 'fr' })))).toBe(
      'Cette commande ne peut être utilisée que dans un serveur.',
    );
  });

  it('imposes the server language over the language of the user', async () => {
    const language: GuildLanguage = { localeOf: jest.fn(async () => 'fr') };
    const { pipeline } = pipelineWith(async () => ephemeral('ok'), { ...denyAll, language });
    const interaction = makeInteraction({ locale: 'en-US' });
    expect(content(await pipeline.handle(interaction))).toContain("Vous n'avez pas accès");
    expect(language.localeOf).toHaveBeenCalledWith(interaction.guildId);
  });

  it('ignores a server language that is no longer available', async () => {
    const language: GuildLanguage = { localeOf: async () => 'xx' };
    const { pipeline } = pipelineWith(async () => ephemeral('ok'), { ...denyAll, language });
    expect(content(await pipeline.handle(makeInteraction({ locale: 'fr' })))).toContain("Vous n'avez pas accès");
  });

  it('falls back to the language of the user when the server language cannot be read', async () => {
    const language: GuildLanguage = {
      localeOf: async () => {
        throw new Error('db down');
      },
    };
    const { pipeline, logger } = pipelineWith(async () => ephemeral('ok'), { ...denyAll, language });
    expect(content(await pipeline.handle(makeInteraction({ locale: 'fr' })))).toContain("Vous n'avez pas accès");
    expect(logger.records.some((record) => record.level === 'warn')).toBe(true);
  });
});

describe('InteractionPipeline: components, modals, features and deferred work', () => {
  const content = (reply: unknown) => (reply as { content: string }).content;
  const click = (overrides: Parameters<typeof makeInteraction>[0] = {}) =>
    makeInteraction({ kind: 'component', customId: 'td:1:go', commandPath: [], ...overrides });

  interface Setup {
    readonly access?: AccessPolicy;
    readonly gate?: GuildGate;
    readonly features?: FeatureGate;
    readonly family?: Partial<ComponentFamily>;
    readonly deferredTimeoutMs?: number;
  }

  function build(onComponent: ComponentHandler, setup: Setup = {}) {
    const logger = recordingLogger();
    const pipeline = new InteractionPipeline({
      registry: new CommandRegistry(roots, [], testI18n),
      components: new ComponentRegistry([
        { namespace: 'td', version: 1, level: 'member', onComponent, onModal: onComponent, ...setup.family },
      ]),
      receipts: new MemoryReceipts(),
      access: setup.access ?? accessFor('member'),
      gate: setup.gate ?? openGate,
      language: { localeOf: async () => null },
      features: setup.features ?? allFeaturesEnabled,
      logger,
      ...(setup.deferredTimeoutMs !== undefined ? { deferredTimeoutMs: setup.deferredTimeoutMs } : {}),
    });
    return { pipeline, logger };
  }

  it('runs a component handler with the decoded payload and the same context as a command', async () => {
    const handler = jest.fn<ReturnType<ComponentHandler>, Parameters<ComponentHandler>>(async () => ephemeral('clicked'));
    const { pipeline } = build(handler);
    const interaction = click();
    expect(await pipeline.handle(interaction)).toEqual(ephemeral('clicked'));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ interaction, guildId: interaction.guildId, payload: 'go' }));
  });

  it('runs a modal submission through the same chain', async () => {
    const handler = jest.fn<ReturnType<ComponentHandler>, Parameters<ComponentHandler>>(async () => ephemeral('submitted'));
    const { pipeline } = build(handler);
    expect(await pipeline.handle(makeInteraction({ kind: 'modal', customId: 'td:1:create', commandPath: [] }))).toEqual(ephemeral('submitted'));
  });

  it('DIS-EC-06: buttons are subject to the access level, like commands', async () => {
    const handler = jest.fn(async () => ephemeral('clicked'));
    const { pipeline, logger } = build(handler, { access: accessFor(null) });
    expect(content(await pipeline.handle(click()))).toContain('required level: member');
    expect(handler).not.toHaveBeenCalled();
    expect(logger.records.some((record) => record.message === 'access denied')).toBe(true);
  });

  it('uses the level of the family: an officer button refuses a plain member', async () => {
    const handler = jest.fn(async () => ephemeral('clicked'));
    const { pipeline } = build(handler, { access: accessFor('member'), family: { level: 'officer' } });
    expect(content(await pipeline.handle(click()))).toContain('required level: officer');
  });

  it('XCT-EC-06: denies, fail-closed, when the access policy fails on a button', async () => {
    const handler = jest.fn(async () => ephemeral('clicked'));
    const access: AccessPolicy = {
      levelOf: async () => {
        throw new Error('db down');
      },
    };
    const { pipeline } = build(handler, { access });
    expect(content(await pipeline.handle(click()))).toBe('Something went wrong. Please try again later.');
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses a stale component with an explanation and a warning, never silence (DIS-EC-07, DIS-RQ-05)', async () => {
    const handler = jest.fn(async () => ephemeral('clicked'));
    const { pipeline, logger } = build(handler);
    for (const [index, customId] of ['td:2:go', 'zz:1:go', 'broken', null].entries()) {
      const id = InteractionId.assert(`93100000000000${String(1000 + index)}`);
      expect(content(await pipeline.handle(click({ customId, id })))).toBe('This interaction is no longer available.');
    }
    expect(handler).not.toHaveBeenCalled();
    expect(logger.records.filter((record) => record.message === 'stale component')).toHaveLength(4);
  });

  it('refuses a modal for a family that has no modal handler', async () => {
    const { pipeline } = build(async () => ephemeral('x'), { family: { onModal: undefined as never } });
    expect(
      content(await pipeline.handle(makeInteraction({ kind: 'modal', customId: 'td:1:create', commandPath: [] }))),
    ).toBe('This interaction is no longer available.');
  });

  it('refuses a button used outside a guild', async () => {
    const { pipeline } = build(async () => ephemeral('x'));
    expect(content(await pipeline.handle(click({ guildId: null })))).toBe('This command can only be used in a server.');
  });

  it('checks the feature of the family, fail-closed (XCT-RQ-04)', async () => {
    const handler = jest.fn(async () => ephemeral('clicked'));
    const features: FeatureGate = { isEnabled: jest.fn(async () => false) };
    const { pipeline } = build(handler, { features, family: { feature: 'todolists' } });
    const interaction = click();
    expect(content(await pipeline.handle(interaction))).toContain('disabled on this server');
    expect(features.isEnabled).toHaveBeenCalledWith(interaction.guildId, 'todolists');
    expect(handler).not.toHaveBeenCalled();

    const broken: FeatureGate = {
      isEnabled: async () => {
        throw new Error('db down');
      },
    };
    const second = build(handler, { features: broken, family: { feature: 'todolists' } });
    expect(content(await second.pipeline.handle(click()))).toBe('Something went wrong. Please try again later.');
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not consult the feature gate for a family that declares no feature', async () => {
    const features: FeatureGate = { isEnabled: jest.fn(async () => false) };
    const { pipeline } = build(async () => ephemeral('clicked'), { features });
    expect(content(await pipeline.handle(click()))).toBe('clicked');
    expect(features.isEnabled).not.toHaveBeenCalled();
  });

  it('applies the suspension of a guild to buttons, unless the family is allowed while suspended', async () => {
    const gate: GuildGate = { suspensionOf: async () => ({ purgeAt: new Date('2026-11-04T00:00:00Z') }) };
    const handler = jest.fn(async () => ephemeral('clicked'));
    expect(content(await build(handler, { gate }).pipeline.handle(click()))).toContain('2026-11-04');
    expect(content(await build(handler, { gate, family: { availableWhenSuspended: true } }).pipeline.handle(click()))).toBe('clicked');
  });

  it('claims every button click once: a re-delivered click is not processed twice', async () => {
    const handler = jest.fn(async () => ephemeral('clicked'));
    const { pipeline } = build(handler);
    const interaction = click();
    await pipeline.handle(interaction);
    expect(content(await pipeline.handle(interaction))).toContain('already been processed');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('replies to a command handler that opens a modal as is', async () => {
    const modal: Reply = { kind: 'modal', customId: 'td:1:create', title: 'T', inputs: [] };
    const { pipeline } = pipelineWith(async () => modal);
    expect(await pipeline.handle(makeInteraction())).toEqual(modal);
  });

  describe('deferred work', () => {
    const deferred = (run: () => Promise<Reply | null>): Reply => ({ kind: 'deferred', ephemeral: true, update: true, run });

    it('returns the acknowledgement at once and lets the work run later, with its own result', async () => {
      const run = jest.fn(async () => ephemeral('done'));
      const { pipeline } = build(async () => deferred(run));
      const reply = await pipeline.handle(click());
      expect(reply).toMatchObject({ kind: 'deferred', ephemeral: true, update: true });
      expect(run).not.toHaveBeenCalled();
      if (reply.kind !== 'deferred') throw new Error('expected a deferred reply');
      expect(await reply.run()).toEqual(ephemeral('done'));
    });

    it('turns a failure of the work into a private error message and logs it', async () => {
      const { pipeline, logger } = build(async () =>
        deferred(async () => {
          throw new Error('boom');
        }),
      );
      const reply = await pipeline.handle(click());
      if (reply.kind !== 'deferred') throw new Error('expected a deferred reply');
      expect(await reply.run()).toEqual(ephemeral('Something went wrong. Please try again later.'));
      expect(logger.records.some((record) => record.message === 'deferred work failed')).toBe(true);
    });

    it('gives up on work that takes too long with its own, longer deadline', async () => {
      const { pipeline } = build(async () => deferred(() => new Promise<Reply | null>(() => undefined)), { deferredTimeoutMs: 20 });
      const reply = await pipeline.handle(click());
      if (reply.kind !== 'deferred') throw new Error('expected a deferred reply');
      expect(await reply.run()).toEqual(ephemeral('The request took too long. Please try again.'));
    });

    it('does not apply the 2.5 s answer deadline to the work itself', async () => {
      const slow = jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return ephemeral('late but fine');
      });
      const logger = recordingLogger();
      const pipeline = new InteractionPipeline({
        registry: new CommandRegistry(roots, [], testI18n),
        components: new ComponentRegistry([{ namespace: 'td', version: 1, level: 'member', onComponent: async () => deferred(slow) }]),
        receipts: new MemoryReceipts(),
        access: accessFor('member'),
        gate: openGate,
        language: { localeOf: async () => null },
        features: allFeaturesEnabled,
        logger,
        handlerTimeoutMs: 20,
      });
      const reply = await pipeline.handle(click());
      if (reply.kind !== 'deferred') throw new Error('expected a deferred reply');
      expect(await reply.run()).toEqual(ephemeral('late but fine'));
    });

    it('answers a handler that hangs before returning its acknowledgement', async () => {
      const quick = new InteractionPipeline({
        registry: new CommandRegistry(roots, [], testI18n),
        components: new ComponentRegistry([{ namespace: 'td', version: 1, level: 'member', onComponent: () => new Promise<Reply>(() => undefined) }]),
        receipts: new MemoryReceipts(),
        access: accessFor('member'),
        gate: openGate,
        language: { localeOf: async () => null },
        features: allFeaturesEnabled,
        logger: recordingLogger(),
        handlerTimeoutMs: 20,
      });
      expect(content(await quick.handle(click()))).toBe('The request took too long. Please try again.');
    });
  });
});
