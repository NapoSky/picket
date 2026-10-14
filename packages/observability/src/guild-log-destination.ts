import { randomUUID } from 'node:crypto';
import type { DestinationStream } from 'pino';
import { GuildId, type GuildApplicationLog } from '@picket/kernel';

export interface GuildLogDestinationOptions {
  readonly append: (entries: readonly GuildApplicationLog[]) => Promise<void>;
  /** Global diagnostics only: no copies of lines containing guild data. */
  readonly diagnostics?: DestinationStream;
  readonly version?: string;
  /** Separate, sanitized operational stream; never appended to tenant storage. */
  readonly monitoring?: DestinationStream;
}

const BATCH_SIZE = 100;
const MAX_PENDING_BYTES = 10 * 1024 * 1024;

/** Destination for lines already serialized/redacted by Pino; guild journals go only to the database. */
export function createGuildLogDestination(options: GuildLogDestinationOptions) {
  const diagnostics = options.diagnostics ?? process.stdout;
  const pending: { entry: GuildApplicationLog; bytes: number }[] = [];
  let pendingBytes = 0;
  let work: Promise<void> | null = null;
  let overflow = false;
  let unavailable = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const reportFailure = () => {
    const line = JSON.stringify({ level: 50, time: new Date().toISOString(), service: 'picket',
      version: options.version ?? 'unknown', msg: 'guild log persistence unavailable' }) + '\n';
    diagnostics.write(line);
    options.monitoring?.write(line);
  };

  function drain() {
    if (work !== null || pending.length === 0) return;
    if (retry !== null) clearTimeout(retry);
    retry = null;
    work = Promise.resolve().then(async () => {
      while (pending.length > 0) {
        const batch = pending.slice(0, BATCH_SIZE);
        await options.append(batch.map((item) => item.entry));
        pending.splice(0, batch.length);
        pendingBytes -= batch.reduce((sum, item) => sum + item.bytes, 0);
      }
      unavailable = false;
    }).catch(() => {
      // Keep the batch in memory for retry; never put guild content in diagnostics.
      reportFailure();
      unavailable = true;
      if (!closed) {
        retry = setTimeout(() => { retry = null; drain(); }, 5_000);
        retry.unref();
      }
    }).finally(() => { work = null; });
  }

  const destination: DestinationStream = {
    write(chunk: string) {
      options.monitoring?.write(chunk);
      for (const line of chunk.split('\n')) {
        if (!line) continue;
        const record = JSON.parse(line) as Record<string, unknown>;
        const guild = GuildId.parse(record.guild_id);
        if (!guild.ok) {
          diagnostics.write(line + '\n');
          continue;
        }
        const at = new Date(record.time as string | number);
        const bytes = Buffer.byteLength(line, 'utf8');
        if (!Number.isFinite(at.getTime()) || pendingBytes + bytes > MAX_PENDING_BYTES) {
          // Bound memory during prolonged outages, then reject exports that would falsely claim completeness.
          overflow = true;
          reportFailure();
          continue;
        }
        pending.push({ entry: { id: randomUUID(), guildId: guild.value, at, record }, bytes });
        pendingBytes += bytes;
      }
      drain();
    },
  };

  async function flush(): Promise<void> {
    if (work !== null) await work;
    drain();
    if (work !== null) await work;
    if (pending.length > 0 || overflow) throw new Error('Guild log persistence unavailable');
  }

  return {
    destination,
    /** Called before export and at shutdown; failed batches are also retried automatically. */
    flush,
    get healthy(): boolean { return !unavailable && !overflow; },
    async close(): Promise<void> {
      closed = true;
      try { await flush(); }
      finally { if (retry !== null) clearTimeout(retry); retry = null; }
    },
  };
}
