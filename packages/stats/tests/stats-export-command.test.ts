import { GuildId, noopLogger } from '@picket/kernel';
import { englishT, makeInteraction } from '@picket/testing';
import { createStatsPanel, type StatsPanelStore, type DurableVoiceBuffer } from '../src';

describe('Discord statistics export attachment', () => {
  const guildId = GuildId.assert('700000000000000001');
  const row = { guildId, userId: '407197937387700225', name: 'elchap1567', seconds: 49353, sessions: 4, lastActivity: '2026-10-13T04:33:10.000Z' };
  const now = new Date('2026-10-13T12:00:00Z');
  function setup() {
    const store: StatsPanelStore = {
      config: async () => ({ guildId, enabled: true, roles: [], excludedChannels: [], afkChannelId: null, changedAt: now, enabledAt: now }),
      observe: async () => undefined, configure: async () => 'saved', privacy: async () => false, setPrivacy: async () => undefined,
      report: jest.fn(async () => ({ from: '2026-10-06T12:00:00Z', to: now.toISOString(), truncated: false, users: [row] })),
    };
    const buffer: DurableVoiceBuffer = { append: async () => undefined, replay: async () => 0, erase: async () => undefined, status: async () => ({ bytes: 0, count: 0, oldest: null }) };
    const access = { levelOf: jest.fn(async (): Promise<'officer' | 'member'> => 'officer') };
    const panel = createStatsPanel({ store, buffer, access, gate: { suspensionOf: async () => null }, clock: { now: () => now }, updatePermissions: { execute: jest.fn() } });
    const command = panel.entries.find((entry) => entry.path[1] === 'export')!;
    return { command, store, access };
  }
  it.each(['json', 'csv'] as const)('sends the common %s format as a private attachment', async (format) => {
    const { command, store } = setup();
    const reply = await command.handler({ guildId, interaction: makeInteraction({ options: { days: 7, format } }), level: 'officer', logger: noopLogger, t: englishT });
    if (reply.kind !== 'deferred') throw new Error('Expected deferred export');
    const file = await reply.run();
    if (file?.kind !== 'file') throw new Error('Expected file attachment');
    expect(file.ephemeral).toBe(true);
    const content = new TextDecoder().decode(file.file.bytes);
    if (format === 'json') expect(JSON.parse(content)).toEqual([{
      userId: row.userId, username: row.name, totalSeconds: row.seconds, lastActivityDate: '2026-10-13T04:33:10+00:00',
    }]);
    else expect(content).toBe('user_id,username,total_seconds,last_activity_date\r\n407197937387700225,elchap1567,49353,2026-10-13T04:33:10+00:00\r\n');
    expect(store.report).toHaveBeenCalledWith(expect.objectContaining({ kind: 'guild', guildId }), { from: new Date('2026-10-06T12:00:00Z'), to: now });
  });
  it('rechecks officer access after deferral and prevents an export after revocation', async () => {
    const { command, access, store } = setup();
    const reply = await command.handler({ guildId, interaction: makeInteraction({ options: { format: 'json' } }), level: 'officer', logger: noopLogger, t: englishT });
    if (reply.kind !== 'deferred') throw new Error('Expected deferred export');
    access.levelOf.mockResolvedValueOnce('member');
    expect(await reply.run()).toMatchObject({ kind: 'message', ephemeral: true });
    expect(store.report).not.toHaveBeenCalled();
  });
});
