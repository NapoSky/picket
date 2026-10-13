import { mkdtemp, rm, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DiskVoiceBuffer, VoiceBufferFullError } from '../src/infrastructure/disk-voice-buffer';
import type { VoiceObservation } from '../src/domain/model';
const event: VoiceObservation = {
  key: 'gateway:0:42',
  guildId: '700000000000000001',
  userId: '300000000000000001',
  channelId: '600000000000000001',
  channelName: 'Voice',
  name: 'Alice',
  roles: ['400000000000000001'],
  bot: false,
  shardId: 0,
  quality: 'observed',
  at: new Date().toISOString(),
};
describe('durable voice disk buffer', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'picket-voice-test-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it('survives a new instance, deduplicates and deletes only after successful SQL', async () => {
    const buffer = new DiskVoiceBuffer(directory);
    await buffer.append(event);
    await buffer.append(event);
    const restarted = new DiskVoiceBuffer(directory);
    expect((await restarted.status()).count).toBe(1);
    await expect(
      restarted.replay(async () => {
        throw new Error('SQL down');
      }),
    ).rejects.toThrow('SQL down');
    expect((await restarted.status()).count).toBe(1);
    const writes: VoiceObservation[] = [];
    await restarted.replay(async (row) => {
      writes.push(row);
    });
    expect(writes).toEqual([event]);
    expect((await buffer.status()).count).toBe(0);
  });
  it('has restrictive permissions and contains only normalized fields', async () => {
    const buffer = new DiskVoiceBuffer(directory);
    await buffer.append(event);
    const file = (await readdir(directory)).find((n) => n.endsWith('.evt'))!;
    expect((await stat(join(directory, file))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(join(directory, file), 'utf8'))).toEqual(event);
  });
  it('bounds disk usage across instances without silently evicting records', async () => {
    const bytes = 4096;
    const first = new DiskVoiceBuffer(directory, bytes);
    const other = new DiskVoiceBuffer(directory, bytes);
    await first.append(event);
    await expect(other.append({ ...event, key: 'next' })).rejects.toBeInstanceOf(VoiceBufferFullError);
    expect((await first.status()).count).toBe(1);
  });
  it('erasure removes pending records and rejects their later retransmission', async () => {
    const buffer = new DiskVoiceBuffer(directory);
    await buffer.append(event);
    await buffer.erase(event.guildId, event.userId);
    await buffer.append(event);
    expect((await buffer.status()).count).toBe(0);
  });
  it('rejects history older than the same 60-day cutoff', async () => {
    const buffer = new DiskVoiceBuffer(directory);
    await buffer.append({ ...event, at: '2020-01-01T00:00:00Z' });
    expect((await buffer.status()).count).toBe(0);
  });
  it('keeps opt-out effective during SQL outage and permits an explicit opt-in', async () => {
    const buffer = new DiskVoiceBuffer(directory);
    await buffer.setExcluded(event.guildId, event.userId, true);
    expect(await buffer.isExcluded(event.guildId, event.userId)).toBe(true);
    await buffer.append(event);
    expect((await buffer.status()).count).toBe(0);
    await new DiskVoiceBuffer(directory).setExcluded(event.guildId, event.userId, false);
    await buffer.append(event);
    expect((await buffer.status()).count).toBe(1);
  });
  it('recovers fully written pending records and repairs a corrupt quota counter', async () => {
    await writeFile(join(directory, '.pending-test'), JSON.stringify(event));
    await writeFile(join(directory, '.usage'), 'NaN');
    const buffer = new DiskVoiceBuffer(directory);
    expect((await buffer.status()).count).toBe(1);
    await buffer.append({ ...event, key: 'second' });
    expect((await buffer.status()).count).toBe(2);
  });
  it('preserves Gateway sequence order for events received in the same millisecond', async () => {
    const buffer = new DiskVoiceBuffer(directory);
    await buffer.append({ ...event, key: 'session:0:10:user' });
    await buffer.append({ ...event, key: 'session:0:9:user' });
    const keys: string[] = [];
    await buffer.replay(async (row) => {
      keys.push(row.key);
    });
    expect(keys).toEqual(['session:0:9:user', 'session:0:10:user']);
  });
  it('removes expired queued history without requiring a successful SQL replay', async () => {
    await new DiskVoiceBuffer(directory).append(event);
    const future = new DiskVoiceBuffer(
      directory,
      128 * 1024 * 1024,
      () => new Date(Date.parse(event.at) + 61 * 86_400_000),
    );
    expect((await future.status()).count).toBe(0);
  });
  it('exports only retained facts from one guild, enforces the size cap and keeps the journal intact', async () => {
    const buffer = new DiskVoiceBuffer(directory);
    await buffer.append(event);
    await buffer.append({ ...event, key: 'other-guild', guildId: '700000000000000002' });
    expect(await buffer.exportGuild(event.guildId, 10_000)).toEqual([event]);
    expect(await buffer.exportGuild(event.guildId, 1)).toBeNull();
    expect((await buffer.status()).count).toBe(2);
    const future = new DiskVoiceBuffer(directory, 128 * 1024 * 1024, () => new Date(Date.parse(event.at) + 61 * 86400_000));
    expect(await future.exportGuild(event.guildId, 10_000)).toEqual([]);
  });
  it('erases guild facts and preferences, isolates other guilds and fences delayed writers across restarts', async () => {
    const buffer = new DiskVoiceBuffer(directory);
    const other = { ...event, key: 'other-guild', guildId: '700000000000000002' };
    await buffer.append(event); await buffer.append(other);
    await buffer.setExcluded(event.guildId, '300000000000000099', true);
    await buffer.setExcluded(other.guildId, other.userId, true);
    await buffer.eraseGuild(event.guildId);
    expect(await buffer.isExcluded(event.guildId, '300000000000000099')).toBe(false);
    expect(await buffer.isExcluded(other.guildId, other.userId)).toBe(true);
    const restarted = new DiskVoiceBuffer(directory);
    await restarted.append(event);
    expect((await restarted.status()).count).toBe(1);
    expect(await restarted.exportGuild(event.guildId, 10_000)).toEqual([]);
    await restarted.eraseGuild(event.guildId);
    expect((await restarted.status()).count).toBe(1);
  });
});
