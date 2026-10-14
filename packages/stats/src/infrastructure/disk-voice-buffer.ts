import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, stat, unlink, rmdir, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { STATS_RETENTION_MS, type VoiceObservation } from '../domain/model';
import type { DurableVoiceBuffer } from '../application/store';
import type { OperationalMetrics } from '@picket/kernel';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const EVENT_FILE = /^[a-f0-9]{64}\.evt$/;
const marker = (kind: string, guildId: string, userId: string) => `${kind}-${digest(guildId)}-${digest(userId)}`;
export class VoiceBufferFullError extends Error {
  constructor() {
    super('Voice disk buffer is full; collection must pause');
  }
}

/** Shared Docker volume, exclusive short filesystem lock, fsync then atomic publication. */
export class DiskVoiceBuffer implements DurableVoiceBuffer {
  #maintainedAt = 0;
  constructor(
    readonly directory: string,
    readonly maxBytes = 128 * 1024 * 1024,
    readonly now: () => Date = () => new Date(),
    readonly metrics?: OperationalMetrics,
  ) {}
  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
  }

  async collectMetrics(): Promise<void> {
    const bytes = Number(await readFile(join(this.directory, '.usage'), 'utf8').catch(() => '0'));
    this.metrics?.set('buffer_bytes', bytes);
    this.metrics?.set('buffer_max_bytes', this.maxBytes);
  }

  private async locked<T>(work: () => Promise<T>): Promise<T> {
    await this.initialize();
    const path = join(this.directory, '.lock');
    const token = randomUUID();
    let recovered = false;
    const deadline = Date.now() + 5_000;
    for (;;) {
      try {
        await mkdir(path, { mode: 0o700 });
        await this.write(join(path, 'owner'), token);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const info = await stat(path).catch(() => null);
        if (info && Date.now() - info.mtimeMs > 30_000) {
          const stale = `${path}.${token}`;
          try {
            await rename(path, stale);
            await unlink(join(stale, 'owner')).catch(() => undefined);
            await rmdir(stale);
            recovered = true;
          } catch {
            /* Another process recovered the lock. */
          }
        }
        if (Date.now() > deadline) throw new Error('Voice buffer lock unavailable');
        await sleep(20);
      }
    }
    const heartbeat = setInterval(() => {
      void utimes(path, new Date(), new Date()).catch(() => undefined);
    }, 5_000);
    heartbeat.unref();
    try {
      const maintain = recovered || Date.now() - this.#maintainedAt > 60_000;
      // A crash before atomic publication never leaves a partial event visible to replay.
      for (const name of maintain
        ? (await readdir(this.directory)).filter((n) => n.startsWith('.pending-'))
        : []) {
        const pending = join(this.directory, name);
        try {
          const event = JSON.parse(await readFile(pending, 'utf8')) as VoiceObservation;
          if (
            typeof event.key === 'string' &&
            typeof event.guildId === 'string' &&
            typeof event.userId === 'string' &&
            Array.isArray(event.roles)
          ) {
            const target = join(this.directory, `${digest(event.key)}.evt`);
            if (await stat(target).catch(() => null)) await unlink(pending);
            else await rename(pending, target);
            recovered = true;
          } else await unlink(pending);
        } catch {
          await unlink(pending).catch(() => undefined);
        }
      }
      if (maintain) {
        for (const name of await readdir(this.directory)) {
          const path = join(this.directory, name);
          if (EVENT_FILE.test(name)) {
            const event = JSON.parse(await readFile(path, 'utf8')) as VoiceObservation;
            if (Date.parse(event.at) <= this.now().getTime() - STATS_RETENTION_MS) {
              await unlink(path);
              recovered = true;
            }
          } else if (name.startsWith('erased-')) {
            if (Number(await readFile(path, 'utf8')) <= this.now().getTime() - STATS_RETENTION_MS)
              await unlink(path);
          }
        }
        this.#maintainedAt = Date.now();
      }
      const usage = Number(await readFile(join(this.directory, '.usage'), 'utf8').catch(() => 'NaN'));
      if (recovered || !Number.isFinite(usage) || usage < 0) {
        let bytes = 0;
        for (const name of (await readdir(this.directory)).filter((n) => EVENT_FILE.test(n))) {
          const info = await stat(join(this.directory, name));
          bytes += info.blocks ? info.blocks * 512 : info.size;
        }
        await this.saveUsage(bytes);
      }
      return await work();
    } finally {
      clearInterval(heartbeat);
      if ((await readFile(join(path, 'owner'), 'utf8').catch(() => null)) === token) {
        await unlink(join(path, 'owner'));
        await rmdir(path);
      }
    }
  }

  private async write(path: string, value: string): Promise<void> {
    const file = await open(path, 'wx', 0o600);
    try {
      await file.writeFile(value, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
  }

  private async syncDirectory(): Promise<void> {
    const dir = await open(this.directory, 'r');
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  }
  private async saveUsage(bytes: number): Promise<void> {
    const temporary = join(this.directory, `.pending-${randomUUID()}`);
    await this.write(temporary, String(bytes));
    await rename(temporary, join(this.directory, '.usage'));
  }

  private async records(): Promise<{ name: string; event: VoiceObservation; bytes: number }[]> {
    const result: { name: string; event: VoiceObservation; bytes: number }[] = [];
    for (const name of (await readdir(this.directory)).filter((n) => EVENT_FILE.test(n))) {
      const path = join(this.directory, name);
      const raw = await readFile(path, 'utf8');
      const event = JSON.parse(raw) as VoiceObservation;
      if (
        typeof event.key !== 'string' ||
        !/^\d{15,25}$/.test(event.guildId) ||
        !/^\d{15,25}$/.test(event.userId) ||
        !Number.isFinite(Date.parse(event.at)) ||
        !Array.isArray(event.roles)
      )
        throw new Error('Malformed durable voice record');
      const info = await stat(path);
      result.push({ name, event, bytes: info.blocks ? info.blocks * 512 : info.size });
    }
    return result.sort(
      (a, b) =>
        a.event.at.localeCompare(b.event.at) ||
        a.event.key.localeCompare(b.event.key, undefined, { numeric: true }),
    );
  }

  async append(event: VoiceObservation): Promise<void> {
    await this.locked(async () => {
      if (Date.parse(event.at) <= this.now().getTime() - STATS_RETENTION_MS) return;
      const guildErased = await readFile(join(this.directory, `erased-guild-${digest(event.guildId)}`), 'utf8').catch(() => null);
      if (guildErased && Date.parse(event.at) <= Number(guildErased)) return;
      const erased = await readFile(
        join(this.directory, marker('erased', event.guildId, event.userId)),
        'utf8',
      ).catch(() => readFile(join(this.directory, `erased-${digest(`${event.guildId}:${event.userId}`)}`), 'utf8').catch(() => null));
      if (erased && Date.parse(event.at) <= Number(erased)) return;
      if (await this.isExcluded(event.guildId, event.userId)) return;
      const target = join(this.directory, `${digest(event.key)}.evt`);
      if (await stat(target).catch(() => null)) return;
      const value = JSON.stringify(event);
      const used = Number(await readFile(join(this.directory, '.usage'), 'utf8'));
      const blockSize = (await stat(this.directory)).blksize || 4096;
      if (used + Math.ceil(Buffer.byteLength(value) / blockSize) * blockSize > this.maxBytes) {
        this.metrics?.record('loop', 0, 'rejected', 'voice');
        throw new VoiceBufferFullError();
      }
      const temporary = join(this.directory, `.pending-${randomUUID()}`);
      await this.write(temporary, value);
      await rename(temporary, target);
      const info = await stat(target);
      await this.saveUsage(used + (info.blocks ? info.blocks * 512 : info.size));
      await this.syncDirectory();
    });
  }

  async replay(
    write: (event: VoiceObservation) => Promise<void>,
    limit = 100,
    shardIds?: readonly number[],
  ): Promise<number> {
    // The short lock is released during SQL. Concurrent replay is safe because event keys are unique.
    const records = await this.locked(() => this.records());
    let count = 0;
    for (const row of records
      .filter((row) => !shardIds || shardIds.includes(row.event.shardId))
      .slice(0, limit)) {
      if (Date.parse(row.event.at) > this.now().getTime() - STATS_RETENTION_MS) await write(row.event);
      await this.locked(async () => {
        const path = join(this.directory, row.name);
        const info = await stat(path).catch(() => null);
        if (info) {
          await unlink(path);
          const used = Number(await readFile(join(this.directory, '.usage'), 'utf8'));
          await this.saveUsage(Math.max(0, used - (info.blocks ? info.blocks * 512 : info.size)));
        }
        await this.syncDirectory();
      });
      count++;
    }
    return count;
  }

  async erase(guildId: string, userId: string): Promise<void> {
    await this.locked(async () => {
      const target = join(this.directory, marker('erased', guildId, userId));
      const temporary = join(this.directory, `.pending-${randomUUID()}`);
      await this.write(temporary, String(this.now().getTime()));
      await rename(temporary, target);
      let removed = 0;
      for (const row of await this.records())
        if (row.event.guildId === guildId && row.event.userId === userId) {
          await unlink(join(this.directory, row.name));
          removed += row.bytes;
        }
      const used = Number(await readFile(join(this.directory, '.usage'), 'utf8'));
      await this.saveUsage(Math.max(0, used - removed));
      await this.syncDirectory();
    });
  }

  async isExcluded(guildId: string, userId: string): Promise<boolean> {
    for (const name of [marker('excluded', guildId, userId), `excluded-${digest(`${guildId}:${userId}`)}`]) {
      try { await stat(join(this.directory, name)); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return false;
  }
  async setExcluded(guildId: string, userId: string, excluded: boolean): Promise<void> {
    await this.locked(async () => {
      const target = join(this.directory, marker('excluded', guildId, userId));
      if (excluded) {
        if (!(await stat(target).catch(() => null))) await this.write(target, '1');
      } else for (const path of [target, join(this.directory, `excluded-${digest(`${guildId}:${userId}`)}`)])
        await unlink(path).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        });
      await this.syncDirectory();
    });
  }

  async exportGuild(guildId: string, maxBytes: number): Promise<readonly VoiceObservation[] | null> {
    return this.locked(async () => {
      let bytes = 0;
      const result: VoiceObservation[] = [];
      for (const { event } of await this.records()) {
        if (event.guildId !== guildId || Date.parse(event.at) <= this.now().getTime() - STATS_RETENTION_MS) continue;
        bytes += Buffer.byteLength(JSON.stringify(event, null, 2), 'utf8');
        if (bytes > maxBytes) return null;
        result.push(event);
      }
      return result;
    });
  }

  async eraseGuild(guildId: string, userIds: readonly string[] = []): Promise<void> {
    await this.locked(async () => {
      const target = join(this.directory, `erased-guild-${digest(guildId)}`);
      const temporary = join(this.directory, `.pending-${randomUUID()}`);
      await this.write(temporary, String(this.now().getTime())); await rename(temporary, target);
      const known = new Set(userIds);
      let removed = 0;
      for (const row of await this.records()) if (row.event.guildId === guildId) {
        known.add(row.event.userId); await unlink(join(this.directory, row.name)); removed += row.bytes;
      }
      const legacy = new Set([...known].flatMap((userId) => ['excluded', 'erased'].map((kind) => `${kind}-${digest(`${guildId}:${userId}`)}`)));
      for (const name of await readdir(this.directory)) {
        if (name.startsWith(`excluded-${digest(guildId)}-`) || name.startsWith(`erased-${digest(guildId)}-`) || legacy.has(name))
          await unlink(join(this.directory, name));
      }
      const used = Number(await readFile(join(this.directory, '.usage'), 'utf8'));
      await this.saveUsage(Math.max(0, used - removed)); await this.syncDirectory();
    });
  }

  async personalGuildIds(userId: string): Promise<readonly string[]> {
    return this.locked(async () => [
      ...new Set((await this.records()).filter((r) => r.event.userId === userId).map((r) => r.event.guildId)),
    ]);
  }
  async status() {
    return this.locked(async () => {
      const rows = await this.records();
      return {
        bytes: rows.reduce((n, row) => n + row.bytes, 0),
        count: rows.length,
        oldest: rows[0]?.event.at ?? null,
      };
    });
  }
}
