import { CommandRegistry, InteractionPipeline, buildCommandsPayload, type CommandEntry, type Reply } from '@picket/discord';
import { ChannelId, GuildId, InteractionId, UserId, noopLogger } from '@picket/kernel';
import {
  GetGuildLocale,
  PICKET_ROOT,
  UpdateGuildSettings,
  createGuildLanguage,
  settingsCommands,
  statusCommand,
  GetGuildStatus,
  type GuildLocaleReader,
  type GuildSettings,
  type GuildSettingsWriter,
  type SettingsDecision,
} from '@picket/guild';
import { allFeaturesEnabled, englishT, makeInteraction, noComponents, testI18n } from '@picket/testing';

const guildId = GuildId.assert('700000000000000001');
const officer = UserId.assert('500000000000000009');
const channel = ChannelId.assert('600000000000000001');

interface AuditRecord {
  readonly actor: UserId;
  readonly action: string;
  readonly before: GuildSettings;
  readonly after: GuildSettings;
}

class InMemorySettings implements GuildSettingsWriter, GuildLocaleReader {
  settings: GuildSettings = {
    guildId,
    locale: null,
    timezone: 'UTC',
    auditChannelId: null,
    features: { timers: true, todolists: true, warlog: false },
    installedAt: new Date('2026-10-05T00:00:00Z'),
  };
  readonly audit: AuditRecord[] = [];

  async modify(
    _guildId: GuildId,
    actor: UserId,
    action: string,
    decide: (current: GuildSettings) => SettingsDecision,
  ): Promise<SettingsDecision> {
    const before = this.settings;
    const decision = decide(before);
    if (decision.kind === 'apply') {
      this.settings = decision.next;
      this.audit.push({ actor, action, before, after: decision.next });
    }
    return decision;
  }

  async find(): Promise<string | null> {
    return this.settings.locale;
  }
}

function setup() {
  const store = new InMemorySettings();
  const entries = settingsCommands({ update: new UpdateGuildSettings(store, testI18n.locales), locales: testI18n.locales });
  const byName = (name: string): CommandEntry => entries.find((entry) => entry.path[2] === name) as CommandEntry;
  const run = async (name: string, options: Record<string, string | boolean>): Promise<string> => {
    const reply: Reply = await byName(name).handler({
      interaction: makeInteraction({ userId: officer, options }),
      guildId,
      logger: noopLogger,
      level: 'officer',
      t: englishT,
    });
    return reply.kind === 'message' ? reply.content : '';
  };
  return { store, entries, run };
}

describe('/picket settings', () => {
  it('declares four officer-level subcommands in the settings group', () => {
    const { entries } = setup();
    expect(entries.map((entry) => entry.path)).toEqual([
      ['picket', 'settings', 'language'],
      ['picket', 'settings', 'timezone'],
      ['picket', 'settings', 'audit-channel'],
      ['picket', 'settings', 'feature'],
    ]);
    expect(entries.every((entry) => entry.level === 'officer')).toBe(true);
  });

  it('builds a valid registry and Discord payload, with one language choice per catalog', () => {
    const { entries } = setup();
    const registry = new CommandRegistry([PICKET_ROOT], entries, testI18n);
    const picket = buildCommandsPayload(registry)[0];
    const group = picket?.options?.find((option) => option.name === 'settings') as {
      options: { name: string; options?: { name: string; type: number; choices?: { name: string; value: string }[]; channel_types?: number[] }[] }[];
    };

    expect(group.options.map((option) => option.name).sort()).toEqual(['audit-channel', 'feature', 'language', 'timezone']);
    const language = group.options.find((option) => option.name === 'language')?.options?.[0];
    expect(language?.choices?.map((choice) => choice.value)).toEqual(['auto', ...testI18n.locales]);
    expect(language?.choices?.find((choice) => choice.value === 'fr')?.name).toBe('Français');
    const audit = group.options.find((option) => option.name === 'audit-channel')?.options?.[0];
    expect(audit).toMatchObject({ type: 7, channel_types: [0, 5] });
  });

  it('changes the server language and journals it', async () => {
    const { store, run } = setup();
    expect(await run('language', { language: 'fr' })).toBe('Server language set to: Français.');
    expect(store.settings.locale).toBe('fr');
    expect(store.audit).toMatchObject([{ actor: officer, action: 'settings.language', before: { locale: null }, after: { locale: 'fr' } }]);
  });

  it('goes back to automatic language', async () => {
    const { store, run } = setup();
    await run('language', { language: 'fr' });
    expect(await run('language', { language: 'auto' })).toContain('Automatic');
    expect(store.settings.locale).toBeNull();
  });

  it('refuses a language that was not offered', async () => {
    const { store, run } = setup();
    expect(await run('language', { language: 'xx' })).toBe('This language is not available.');
    expect(store.audit).toHaveLength(0);
  });

  it('changes the time zone, normalising its name', async () => {
    const { store, run } = setup();
    expect(await run('timezone', { timezone: 'europe/paris' })).toBe('Time zone set to Europe/Paris.');
    expect(store.settings.timezone).toBe('Europe/Paris');
    expect(await run('timezone', { timezone: 'Europe/Paris' })).toContain('Nothing to change');
    expect(store.audit).toHaveLength(1);
  });

  it('refuses an unknown time zone and explains the expected format', async () => {
    const { store, run } = setup();
    expect(await run('timezone', { timezone: 'Mars/Olympus' })).toContain('IANA');
    expect(store.settings.timezone).toBe('UTC');
  });

  it('sets then clears the audit channel', async () => {
    const { store, run } = setup();
    expect(await run('audit-channel', { channel })).toBe(`Audit channel set to: <#${channel}>.`);
    expect(store.settings.auditChannelId).toBe(channel);
    expect(await run('audit-channel', {})).toContain('not configured');
    expect(store.settings.auditChannelId).toBeNull();
  });

  it('refuses a malformed channel identifier', async () => {
    const { store, run } = setup();
    expect(await run('audit-channel', { channel: 'garbage' })).toBe('Invalid value.');
    expect(store.audit).toHaveLength(0);
  });

  it('enables and disables a feature', async () => {
    const { store, run } = setup();
    expect(await run('feature', { feature: 'warlog', enabled: true })).toBe('War log enabled.');
    expect(store.settings.features.warlog).toBe(true);
    expect(await run('feature', { feature: 'warlog', enabled: true })).toContain('already enabled');
    expect(await run('feature', { feature: 'timers', enabled: false })).toBe('Timers disabled.');
    expect(store.audit.map((record) => record.action)).toEqual(['settings.feature', 'settings.feature']);
  });

  it('refuses an unknown feature', async () => {
    const { store, run } = setup();
    expect(await run('feature', { feature: 'stats', enabled: true })).toBe('Invalid value.');
    expect(store.audit).toHaveLength(0);
  });
});

describe('server language in the interaction pipeline', () => {
  it('answers in the language chosen with /picket settings language', async () => {
    const store = new InMemorySettings();
    const entries = [
      statusCommand(new GetGuildStatus({ findOrCreate: async () => store.settings })),
      ...settingsCommands({ update: new UpdateGuildSettings(store, testI18n.locales), locales: testI18n.locales }),
    ];
    let counter = 0;
    const pipeline = new InteractionPipeline({
      registry: new CommandRegistry([PICKET_ROOT], entries, testI18n),
      receipts: { claim: async () => true },
      access: { levelOf: async () => 'officer' },
      gate: { suspensionOf: async () => null },
      language: createGuildLanguage(new GetGuildLocale(store)),
      components: noComponents,
      features: allFeaturesEnabled,
      logger: noopLogger,
    });
    const call = (path: string[], options: Record<string, string> = {}) =>
      pipeline.handle(
        makeInteraction({ commandPath: path, options, locale: 'en-US', id: InteractionId.assert(`91000000000000${String(2000 + counter++)}`) }),
      );

    const before = await call(['picket', 'status']);
    expect(before.kind === 'message' && before.content).toContain('Language: automatic');

    await call(['picket', 'settings', 'language'], { language: 'fr' });

    const after = await call(['picket', 'status']);
    expect(after.kind === 'message' && after.content).toContain('Langue : fr');
  });
});
