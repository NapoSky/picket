import {
  createVoicePanel,
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
describe('private voice deployment queue', () => {
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
      'category', 'channelName', 'capacity', 'delay',
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
