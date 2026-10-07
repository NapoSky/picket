import type { Clock, GuildId } from '@picket/kernel';

export const MAX_GUILD_EXPORT_BYTES = 10 * 1024 * 1024;

export type GuildDataRows = Readonly<Record<string, readonly unknown[]>>;

export interface GuildDataExportRepository {
  /** Instantané cohérent et limité au serveur ; aucun export partiel en cas de dépassement. */
  read(guildId: GuildId, maxBytes: number): Promise<GuildDataRows | null>;
}

export type GuildDataExportResult =
  | { readonly kind: 'exported'; readonly filename: string; readonly bytes: Uint8Array }
  | { readonly kind: 'too_large'; readonly maxBytes: number };

/** Export à la demande, sans conserver une copie du fichier dans PICKET. */
export class ExportGuildData {
  constructor(private readonly repository: GuildDataExportRepository, private readonly clock: Clock) {}

  async execute(guildId: GuildId, attachmentSizeLimit = MAX_GUILD_EXPORT_BYTES): Promise<GuildDataExportResult> {
    const maxBytes = Math.min(MAX_GUILD_EXPORT_BYTES, Math.max(0, attachmentSizeLimit));
    if (!Number.isSafeInteger(maxBytes) || maxBytes === 0) return { kind: 'too_large', maxBytes: 0 };
    const data = await this.repository.read(guildId, maxBytes);
    if (data === null) return { kind: 'too_large', maxBytes };
    const exportedAt = this.clock.now().toISOString();
    const bytes = new TextEncoder().encode(JSON.stringify({
      format: 'picket.guild-data', version: 1, guildId, exportedAt,
      scope: 'All records in the current PICKET database belonging to this Discord server.',
      notIncluded: [
        'Content stored only in Discord, including todolists.',
        'Global application state, process coordination and secrets.',
      ],
      data,
    }, null, 2) + '\n');
    if (bytes.byteLength > maxBytes) return { kind: 'too_large', maxBytes };
    return { kind: 'exported', filename: `picket-data-${guildId}-${exportedAt.replace(/[:.]/g, '-')}.json`, bytes };
  }
}
