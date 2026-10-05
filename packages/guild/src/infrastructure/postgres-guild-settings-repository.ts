import { ChannelId, type GuildId, type UserId } from '@picket/kernel';
import { withTenant, type Db } from '@picket/persistence';
import type {
  GuildLocaleReader,
  GuildSettingsRepository,
  GuildSettingsWriter,
} from '../application/guild-settings-repository';
import {
  FEATURES,
  settingsSnapshot,
  type GuildFeatures,
  type GuildSettings,
  type SettingsDecision,
} from '../domain/guild-settings';
import { ensureGuildInitialized } from './ensure-guild';

interface Row {
  readonly guild_id: string;
  readonly locale: string | null;
  readonly timezone: string;
  readonly audit_channel_id: string | null;
  readonly features: Record<string, boolean>;
  readonly installed_at: Date;
}

function toFeatures(raw: Record<string, boolean>): GuildFeatures {
  return Object.fromEntries(FEATURES.map((feature) => [feature, raw[feature] === true])) as GuildFeatures;
}

function toSettings(guildId: GuildId, row: Row): GuildSettings {
  const auditChannel = row.audit_channel_id === null ? null : ChannelId.parse(row.audit_channel_id);
  return {
    guildId,
    locale: row.locale,
    timezone: row.timezone,
    auditChannelId: auditChannel?.ok ? auditChannel.value : null,
    features: toFeatures(row.features),
    installedAt: row.installed_at,
  };
}

export class PostgresGuildSettingsRepository
  implements GuildSettingsRepository, GuildSettingsWriter, GuildLocaleReader
{
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  findOrCreate(guildId: GuildId): Promise<GuildSettings> {
    return withTenant(this.#db, guildId, async (trx) => {
      await ensureGuildInitialized(trx, guildId);
      const row: Row = await trx
        .selectFrom('guild_settings')
        .selectAll()
        .where('guild_id', '=', guildId)
        .executeTakeFirstOrThrow();
      return toSettings(guildId, row);
    });
  }

  modify(
    guildId: GuildId,
    actor: UserId,
    action: string,
    decide: (current: GuildSettings) => SettingsDecision,
  ): Promise<SettingsDecision> {
    return withTenant(this.#db, guildId, async (trx) => {
      await ensureGuildInitialized(trx, guildId);
      // Verrou par guilde : deux modifications concurrentes s'enchaînent et leurs avant/après restent cohérents.
      const row: Row = await trx
        .selectFrom('guild_settings')
        .selectAll()
        .where('guild_id', '=', guildId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      const before = toSettings(guildId, row);
      const decision = decide(before);
      if (decision.kind === 'apply') {
        const { next } = decision;
        await trx
          .updateTable('guild_settings')
          .set({
            locale: next.locale,
            timezone: next.timezone,
            audit_channel_id: next.auditChannelId,
            features: JSON.stringify({ ...row.features, ...next.features }),
          })
          .where('guild_id', '=', guildId)
          .execute();
        await trx
          .insertInto('guild_audit_log')
          .values({
            guild_id: guildId,
            actor_id: actor,
            action,
            before: JSON.stringify(settingsSnapshot(before)),
            after: JSON.stringify(settingsSnapshot(next)),
          })
          .execute();
      }
      return decision;
    });
  }

  find(guildId: GuildId): Promise<string | null> {
    return withTenant(this.#db, guildId, async (trx) => {
      const row = await trx.selectFrom('guild_settings').select('locale').where('guild_id', '=', guildId).executeTakeFirst();
      return row?.locale ?? null;
    });
  }
}
