import { ephemeral } from '@picket/discord';
import { GuildId, noopLogger } from '@picket/kernel';
import {
  GetGuildStatus,
  enabledFeatures,
  statusCommand,
  type GuildSettings,
  type GuildSettingsRepository,
} from '@picket/guild';
import { englishT, makeInteraction } from '@picket/testing';

const guildId = GuildId.assert('700000000000000001');

const settings = (overrides: Partial<GuildSettings> = {}): GuildSettings => ({
  guildId,
  locale: 'fr',
  timezone: 'Europe/Paris',
  auditChannelId: null,
  features: { timers: true, todolists: true, warlog: false },
  installedAt: new Date('2026-10-05T00:00:00Z'),
  ...overrides,
});

const repositoryReturning = (value: GuildSettings): GuildSettingsRepository => ({
  findOrCreate: jest.fn(async () => value),
});

describe('enabledFeatures', () => {
  it('lists only enabled features, in the canonical order', () => {
    expect(enabledFeatures(settings())).toEqual(['timers', 'todolists']);
    expect(enabledFeatures(settings({ features: { timers: false, todolists: false, warlog: true } }))).toEqual(['warlog']);
  });
});

describe('GetGuildStatus', () => {
  it('summarises the guild settings', async () => {
    const repository = repositoryReturning(settings());
    const status = await new GetGuildStatus(repository).execute(guildId);

    expect(repository.findOrCreate).toHaveBeenCalledWith(guildId);
    expect(status).toEqual({
      locale: 'fr',
      timezone: 'Europe/Paris',
      enabledFeatures: ['timers', 'todolists'],
      auditChannelConfigured: false,
    });
  });
});

describe('/picket status', () => {
  it('replies ephemerally with the guild configuration', async () => {
    const command = statusCommand(new GetGuildStatus(repositoryReturning(settings())));
    expect(command.path).toEqual(['picket', 'status']);

    const reply = await command.handler({ interaction: makeInteraction(), guildId, logger: noopLogger, level: 'member', t: englishT });

    expect(reply).toMatchObject({ kind: 'message', ephemeral: true });
    expect(reply).not.toEqual(ephemeral(''));
    const content = reply.kind === 'message' ? reply.content : '';
    expect(content).toContain('Europe/Paris');
    expect(content).toContain('timers, todolists');
  });

  it('says so when no feature is enabled', async () => {
    const none = settings({ features: { timers: false, todolists: false, warlog: false } });
    const command = statusCommand(new GetGuildStatus(repositoryReturning(none)));
    const reply = await command.handler({ interaction: makeInteraction(), guildId, logger: noopLogger, level: 'member', t: englishT });
    expect(reply.kind === 'message' && reply.content).toContain('Enabled features: none');
  });
});
