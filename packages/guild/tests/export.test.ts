import { ExportGuildData, MAX_GUILD_EXPORT_BYTES, type GuildDataExportRepository } from '@picket/guild';
import { GuildId } from '@picket/kernel';

const guildId = GuildId.assert('700000000000000001');
const clock = { now: () => new Date('2026-10-07T12:00:00Z') };

describe('ExportGuildData', () => {
  it('produces a versioned UTF-8 JSON download preserving identifiers, nulls and Unicode', async () => {
    const data = { guild_audit_log: [{ id: '9007199254740993', actor_id: '500000000000000001', before: null, after: { name: 'Béton 🏗️' } }] };
    const source: GuildDataExportRepository = { read: jest.fn(async () => data) };
    const result = await new ExportGuildData(source, clock).execute(guildId);
    expect(source.read).toHaveBeenCalledWith(guildId, MAX_GUILD_EXPORT_BYTES);
    expect(result.kind).toBe('exported');
    if (result.kind !== 'exported') throw new Error('Expected a file');
    expect(result.filename).toBe('picket-data-700000000000000001-2026-10-07T12-00-00-000Z.json');
    expect(JSON.parse(new TextDecoder().decode(result.bytes))).toMatchObject({ format: 'picket.guild-data', version: 1, guildId, exportedAt: clock.now().toISOString(), data });
  });

  it('uses the smaller of the Discord attachment limit and the application limit', async () => {
    const source: GuildDataExportRepository = { read: jest.fn(async () => ({})) };
    const exporter = new ExportGuildData(source, clock);
    expect((await exporter.execute(guildId, 1024)).kind).toBe('exported');
    expect(source.read).toHaveBeenLastCalledWith(guildId, 1024);
    await exporter.execute(guildId, MAX_GUILD_EXPORT_BYTES * 5);
    expect(source.read).toHaveBeenLastCalledWith(guildId, MAX_GUILD_EXPORT_BYTES);
  });

  it('refuses an oversized snapshot without sending a partial file', async () => {
    expect(await new ExportGuildData({ read: async () => null }, clock).execute(guildId)).toEqual({ kind: 'too_large', maxBytes: MAX_GUILD_EXPORT_BYTES });
  });

  it('counts UTF-8 bytes and the entire JSON envelope against the upload limit', async () => {
    const exporter = new ExportGuildData({ read: async () => ({ text: [{ name: '🏗️'.repeat(300) }] }) }, clock);
    const full = await exporter.execute(guildId);
    if (full.kind !== 'exported') throw new Error('Expected a file');
    const decoded = new TextDecoder().decode(full.bytes);
    expect(full.bytes.byteLength).toBeGreaterThan(decoded.length);
    expect((await exporter.execute(guildId, decoded.length)).kind).toBe('too_large');
  });
});
