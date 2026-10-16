import {
  createVoicePanel,
  VoiceQuotaError,
  type VoiceService,
  type VoiceSession,
  type VoiceTemplate,
} from '@picket/voice';
import {
  decodeCustomId,
  toWireResponse,
  type CommandContext,
  type IncomingInteraction,
  type Reply,
} from '@picket/discord';
import { GuildId, UserId, noopLogger } from '@picket/kernel';
import { makeInteraction, testI18n } from '@picket/testing';
const model: VoiceTemplate = {
  id: '0000000000000001',
  name: 'Combat',
  categoryId: '600000000000000001',
  channelName: 'Combat',
  capacity: 99,
  idleMinutes: 15,
  revision: 1,
};
function setup(locale = 'en', settings = false, count = 1) {
  const models = Array.from({ length: count }, (_, i) => ({
    ...model,
    id: String(i + 1).padStart(16, '0'),
    name: `Combat ${i + 1}`,
  }));
  let session: VoiceSession = {
    id: '1234567812345678',
    revision: 0,
    state: {
      mode: settings ? 'settings' : 'member',
      selected: null,
      quantity: 1,
      queue: {},
      batchId: null,
    },
  };
  const service: jest.Mocked<VoiceService> = {
    templates: jest.fn().mockImplementation(async () => models),
    limit: jest.fn().mockResolvedValue(6),
    session: jest.fn().mockImplementation(async () => session),
    readSession: jest.fn().mockImplementation(async () => session),
    updateSession: jest.fn().mockImplementation(async (_i, _id, rev, state) => {
      if (rev !== session.revision) throw new Error('stale');
      session = { ...session, revision: rev + 1, state };
      return session;
    }),
    saveTemplate: jest.fn().mockResolvedValue(undefined),
    removeTemplate: jest.fn().mockResolvedValue(undefined),
    deploy: jest.fn().mockImplementation(async () => {
      session = {
        ...session,
        revision: session.revision + 1,
        state: { ...session.state, batchId: 'batch' },
      };
      return session;
    }),
    channels: jest.fn().mockResolvedValue([]),
    removeChannel: jest.fn().mockResolvedValue(undefined),
    resolveChannel: jest.fn().mockResolvedValue(undefined),
  };
  let level: 'member' | 'officer' | null = settings ? 'officer' : 'member';
  const panel = createVoicePanel({
    service,
    access: { levelOf: async () => level },
    gate: { suspensionOf: async () => null },
    clock: { now: () => new Date() },
    settingsHome: () => ({
      kind: 'button',
      customId: 'psnav:1:return',
      label: 'Settings',
    }),
  });
  const context = (
    overrides: Partial<IncomingInteraction> = {},
  ): CommandContext => ({
    interaction: makeInteraction(overrides),
    guildId: GuildId.assert('700000000000000001'),
    level: settings ? 'officer' : 'member',
    logger: noopLogger,
    t: testI18n.translator(locale).t,
  });
  async function finish(r: Reply): Promise<Reply> {
    if (r.kind !== 'deferred') return r;
    const out = await r.run();
    if (!out) throw new Error('No result');
    return out.kind === 'deferred' ? finish(out) : out;
  }
  const open = async () =>
    finish(
      await (settings
        ? panel.settingsCommand.handler(context())
        : panel.createCommand.handler(context())),
    );
  const control = (r: Reply, action: string) => {
    if (r.kind !== 'panel') throw new Error(JSON.stringify(r));
    toWireResponse(r);
    const ids = r.panel.components.flatMap((c) =>
      c.kind === 'buttons'
        ? c.buttons.map((b) => b.customId)
        : c.kind === 'section'
          ? [c.button.customId]
          : 'customId' in c
            ? [c.customId]
            : [],
    );
    const found = ids.find(
      (x) => decodeCustomId(x)?.payload.split('.')[2] === action,
    );
    if (!found) throw new Error(`Missing ${action}`);
    return found;
  };
  const click = async (
    r: Reply,
    action: string,
    overrides: Partial<IncomingInteraction> = {},
  ) => {
    const raw = control(r, action),
      decoded = decodeCustomId(raw)!;
    const handler = panel.families.find(
      (f) => f.namespace === decoded.namespace,
    )!.onComponent!;
    return finish(
      await handler({
        ...context({
          kind: 'component',
          componentKind: 'button',
          customId: raw,
          ...overrides,
        }),
        payload: decoded.payload,
      }),
    );
  };
  return {
    open,
    click,
    control,
    service,
    context,
    finish,
    panel,
    models,
    read: () => session,
    revoke: () => {
      level = null;
    },
  };
}
function quantityOptions(reply: Reply): string[] {
  if (reply.kind !== 'panel') throw new Error('Expected panel');
  const select = reply.panel.components.find(
    (component) =>
      component.kind === 'stringSelect' &&
      decodeCustomId(component.customId)?.payload.split('.')[2] === 'quantity',
  );
  return select?.kind === 'stringSelect'
    ? select.options.map((option) => option.value)
    : [];
}
const openChannels = (count: number) =>
  Array.from({ length: count }, (_, n) => ({
    id: String(n),
    channelId: String(610000000000000000n + BigInt(n)),
    name: `Existing ${n}`,
    status: 'active' as const,
    occupants: 0,
    deleteAfter: null,
    lastVerifiedAt: null,
  }));
describe('private voice deployment queue', () => {
  it.each([
    { limit: 6, open: 0, maximum: 6 },
    { limit: 10, open: 0, maximum: 6 },
    { limit: 3, open: 0, maximum: 3 },
    { limit: 6, open: 13, maximum: 2 },
    { limit: 10, open: 15, maximum: 0 },
  ])(
    'offers only usable quantities with deployment limit $limit and $open channels already reserved',
    async ({ limit, open, maximum }) => {
      const e = setup();
      e.service.limit.mockResolvedValue(limit);
      e.service.channels.mockResolvedValue(openChannels(open));
      const reply = await e.open();
      expect(quantityOptions(reply)).toEqual(
        Array.from({ length: maximum }, (_, n) => String(n + 1)),
      );
      toWireResponse(reply);
    },
  );
  it('shrinks quantities after queue additions and checks changed server capacity before adding', async () => {
    const e = setup();
    let reply = await e.open();
    reply = await e.click(reply, 'pick', {
      componentKind: 'stringSelect',
      selectedValues: [e.models[0]!.id],
    });
    reply = await e.click(reply, 'quantity', {
      componentKind: 'stringSelect',
      selectedValues: ['4'],
    });
    e.service.channels.mockResolvedValue(openChannels(13));
    e.service.updateSession.mockClear();
    expect(JSON.stringify(await e.click(reply, 'addQueue'))).toContain(
      'Server limit: 15 temporary voice channels. Already open or reserved: 13. Requested in this deployment: 4. Over the limit by: 2.',
    );
    expect(e.service.updateSession).not.toHaveBeenCalled();
    reply = await e.click(reply, 'quantity', {
      componentKind: 'stringSelect',
      selectedValues: ['1'],
    });
    reply = await e.click(reply, 'addQueue');
    expect(quantityOptions(reply)).toEqual(['1']);
    reply = await e.click(reply, 'pick', {
      componentKind: 'stringSelect',
      selectedValues: [e.models[0]!.id],
    });
    reply = await e.click(reply, 'addQueue');
    expect(quantityOptions(reply)).toEqual([]);
    expect(e.read().state.queue[e.models[0]!.id]!.quantity).toBe(2);
    expect(JSON.stringify(reply)).toContain('Your queue: 2 / 2 channels');
    if (reply.kind !== 'panel') throw new Error('Expected panel');
    const add = reply.panel.components
      .flatMap((component) =>
        component.kind === 'buttons' ? component.buttons : [],
      )
      .find(
        (button) =>
          decodeCustomId(button.customId)?.payload.split('.')[2] === 'addQueue',
      );
    expect(add?.disabled).toBe(true);
    toWireResponse(reply);
  });
  it('rejects forged quantities above six and the removed free-form option even when deployments allow ten', async () => {
    const e = setup();
    e.service.limit.mockResolvedValue(10);
    const reply = await e.open();
    for (const value of ['7', '99', 'other']) {
      expect(
        (
          await e.click(reply, 'quantity', {
            componentKind: 'stringSelect',
            selectedValues: [value],
          })
        ).kind,
      ).toBe('message');
    }
    expect(e.service.updateSession).not.toHaveBeenCalled();
  });
  it.each(['en', 'fr', 'de', 'es-ES', 'pt-BR', 'pl'])(
    'explains an atomic deployment quota refusal in %s without losing the queue',
    async (locale) => {
      const e = setup(locale);
      let reply = await e.open();
      reply = await e.click(reply, 'pick', {
        componentKind: 'stringSelect',
        selectedValues: [e.models[0]!.id],
      });
      reply = await e.click(reply, 'quantity', {
        componentKind: 'stringSelect',
        selectedValues: ['4'],
      });
      reply = await e.click(reply, 'addQueue');
      e.service.deploy.mockRejectedValueOnce(new VoiceQuotaError(13, 4));
      e.service.updateSession.mockClear();
      const refused = await e.click(reply, 'deploy');
      const expected = testI18n
        .translator(locale)
        .t('voice.errors.serverQuota', {
          maximum: 15,
          current: 13,
          requested: 4,
          excess: 2,
        });
      expect(refused).toMatchObject({ kind: 'message', content: expected });
      expect(expected).not.toContain('{{');
      expect(expected).toContain('15');
      expect(expected).toContain('13');
      expect(expected).toContain('4');
      expect(expected).toContain('2');
      expect(e.service.updateSession).not.toHaveBeenCalled();
      expect(e.read().state.queue[e.models[0]!.id]!.quantity).toBe(4);
      e.service.channels.mockResolvedValue(openChannels(13));
      const refreshed = await e.open();
      expect(JSON.stringify(refreshed)).toContain(expected);
      toWireResponse(refreshed);
    },
  );
  it('reports the complete queue when a subsequent addition exceeds the server quota', async () => {
    const e = setup('fr');
    let reply = await e.open();
    reply = await e.click(reply, 'pick', {
      componentKind: 'stringSelect',
      selectedValues: [e.models[0]!.id],
    });
    reply = await e.click(reply, 'quantity', {
      componentKind: 'stringSelect',
      selectedValues: ['3'],
    });
    reply = await e.click(reply, 'addQueue');
    reply = await e.click(reply, 'pick', {
      componentKind: 'stringSelect',
      selectedValues: [e.models[0]!.id],
    });
    e.service.channels.mockResolvedValue(openChannels(12));
    e.service.updateSession.mockClear();
    const refused = await e.click(reply, 'addQueue');
    expect(JSON.stringify(refused)).toContain(
      'Déjà ouverts ou réservés : 12. Demandés pour ce déploiement : 4. En trop : 1.',
    );
    expect(e.service.updateSession).not.toHaveBeenCalled();
    expect(e.read().state.queue[e.models[0]!.id]!.quantity).toBe(3);
  });
  it('bounds queue editing against the space occupied by other entries', async () => {
    const e = setup('en', false, 2);
    let reply = await e.open();
    for (const [index, quantity] of [
      [0, '2'],
      [1, '3'],
    ] as const) {
      reply = await e.click(reply, 'pick', {
        componentKind: 'stringSelect',
        selectedValues: [e.models[index]!.id],
      });
      reply = await e.click(reply, 'quantity', {
        componentKind: 'stringSelect',
        selectedValues: [quantity],
      });
      reply = await e.click(reply, 'addQueue');
    }
    const modal = await e.click(reply, 'editQueue', {
      componentKind: 'stringSelect',
      selectedValues: [e.models[0]!.id],
    });
    if (modal.kind !== 'modal') throw new Error('Expected modal');
    expect(modal.inputs[0]).toMatchObject({
      value: '2',
      placeholder: '0–3',
      maxLength: 1,
    });
    const payload = decodeCustomId(modal.customId)!.payload;
    e.service.updateSession.mockClear();
    const result = await e.finish(
      await e.panel.families[0]!.onModal!({
        ...e.context({ kind: 'modal', fields: { quantity: '4' } }),
        payload,
      }),
    );
    expect(result.kind).toBe('message');
    expect(e.service.updateSession).not.toHaveBeenCalled();
  });
  it.each(testI18n.locales)(
    'renders a queue and the ten-template settings within Discord limits in %s',
    async (locale) => {
      const member = setup(locale, false, 10),
        officer = setup(locale, true, 10);
      toWireResponse(await member.open());
      toWireResponse(await officer.open());
    },
  );
  it('adds quantities across models, merges repeated entries and creates nothing before deployment', async () => {
    const e = setup('en', false, 2);
    let r = await e.open();
    r = await e.click(r, 'pick', {
      componentKind: 'stringSelect',
      selectedValues: [e.models[0]!.id],
    });
    r = await e.click(r, 'quantity', {
      componentKind: 'stringSelect',
      selectedValues: ['2'],
    });
    r = await e.click(r, 'addQueue');
    expect(e.read().state.selected).toBeNull();
    expect(e.read().state.queue[e.models[0]!.id]!.quantity).toBe(2);
    r = await e.click(r, 'pick', {
      componentKind: 'stringSelect',
      selectedValues: [e.models[0]!.id],
    });
    r = await e.click(r, 'addQueue');
    expect(e.read().state.queue[e.models[0]!.id]!.quantity).toBe(3);
    r = await e.click(r, 'pick', {
      componentKind: 'stringSelect',
      selectedValues: [e.models[1]!.id],
    });
    r = await e.click(r, 'addQueue');
    expect(Object.keys(e.read().state.queue)).toHaveLength(2);
    expect(e.service.deploy).not.toHaveBeenCalled();
    r = await e.click(r, 'deploy');
    expect(e.service.deploy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(r)).toContain('Deployment');
  });
  it('opens a four-field modal with category first, then channel name, capacity 99 and delay 15', async () => {
    const e = setup('fr', true);
    const r = await e.click(await e.open(), 'addModel');
    expect(r.kind).toBe('modal');
    if (r.kind !== 'modal') return;
    expect(r.inputs).toHaveLength(4);
    expect(r.inputs.map((input) => input.customId)).toEqual([
      'category',
      'channelName',
      'capacity',
      'delay',
    ]);
    expect(r.inputs[0]).toMatchObject({
      kind: 'channelSelect',
      channelKinds: ['category'],
    });
    expect(r.inputs[1]).toMatchObject({ customId: 'channelName' });
    expect(r.inputs[2]).toMatchObject({ value: '99' });
    expect(r.inputs[3]).toMatchObject({
      kind: 'stringSelect',
      options: expect.arrayContaining([
        { label: '15 min', value: '15', selected: true },
      ]),
    });
    toWireResponse(r);
  });
  it('checks access again for deferred actions and does not accept forged button actions', async () => {
    const e = setup();
    const r = await e.open();
    e.revoke();
    const denied = await e.click(r, 'clear');
    expect(denied.kind).toBe('message');
    expect(e.service.updateSession).not.toHaveBeenCalled();
  });
  it('does not emit an invalid empty template select when no templates are available', async () => {
    const result = await setup('en', false, 0).open();
    toWireResponse(result);
  });
  it('confirms template removal against the version actually shown to the officer', async () => {
    const e = setup('en', true);
    let r = await e.open();
    r = await e.click(r, 'pick', {
      componentKind: 'stringSelect',
      selectedValues: [e.models[0]!.id],
    });
    r = await e.click(r, 'removeModel');
    expect(e.service.removeTemplate).not.toHaveBeenCalled();
    await e.click(r, 'confirmRemove');
    expect(e.service.removeTemplate).toHaveBeenCalledWith(
      expect.anything(),
      e.models[0]!.id,
      1,
    );
    const other = setup('en', true);
    let stale = await other.open();
    stale = await other.click(stale, 'pick', {
      componentKind: 'stringSelect',
      selectedValues: [other.models[0]!.id],
    });
    stale = await other.click(stale, 'removeModel');
    other.models[0]!.revision = 2;
    const rejected = await other.click(stale, 'confirmRemove');
    expect(rejected.kind).toBe('message');
    expect(other.service.removeTemplate).not.toHaveBeenCalled();
  });
});
