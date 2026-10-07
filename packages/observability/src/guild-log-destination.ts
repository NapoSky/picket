import { randomUUID } from 'node:crypto';
import type { DestinationStream } from 'pino';
import { GuildId, type GuildApplicationLog } from '@picket/kernel';

export interface GuildLogDestinationOptions {
  readonly append: (entries: readonly GuildApplicationLog[]) => Promise<void>;
  /** Diagnostics globaux uniquement : aucune copie des lignes contenant des données de serveur. */
  readonly diagnostics?: DestinationStream;
  readonly version?: string;
}

const BATCH_SIZE = 100;
const MAX_PENDING_BYTES = 10 * 1024 * 1024;

/** Destination des lignes déjà sérialisées/masquées par Pino ; les journaux de serveur vont uniquement en base. */
export function createGuildLogDestination(options: GuildLogDestinationOptions) {
  const diagnostics = options.diagnostics ?? process.stdout;
  const pending: { entry: GuildApplicationLog; bytes: number }[] = [];
  let pendingBytes = 0;
  let work: Promise<void> | null = null;
  let overflow = false;
  let unavailable = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const reportFailure = () => diagnostics.write(JSON.stringify({
    level: 50, time: new Date().toISOString(), service: 'picket', version: options.version ?? 'unknown', msg: 'guild log persistence unavailable',
  }) + '\n');

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
      // Le lot reste en mémoire pour une nouvelle tentative ; jamais de contenu de serveur dans les diagnostics.
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
          // En cas de panne prolongée, borner la mémoire et refuser ensuite un export prétendument complet.
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
    /** Appelée avant l'export et à l'arrêt ; les lots en échec sont aussi retentés automatiquement. */
    flush,
    get healthy(): boolean { return !unavailable && !overflow; },
    async close(): Promise<void> {
      closed = true;
      try { await flush(); }
      finally { if (retry !== null) clearTimeout(retry); retry = null; }
    },
  };
}
