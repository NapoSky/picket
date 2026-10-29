import { createHash } from 'node:crypto';
import { GuildId } from '@picket/kernel';
import { FEATURES, type Feature } from '@picket/guild';
import { sql, withTenant, type Db, type Tx } from '@picket/persistence';
import type { Lease } from '@picket/coordination';
import {
  eligible,
  STATS_RETENTION_MS,
  validTargets,
  type StatsConfig,
  type StatsPeriod,
  type StatsScope,
  type VoiceObservation,
} from '../domain/model';

export interface ActivityRow {
  readonly guildId: string;
  readonly userId: string;
  readonly name: string;
  readonly seconds: number;
  readonly lastActivity: string;
  readonly sessions: number;
}
export class StatsLeaseLostError extends Error {}
export interface ServerActivity {
  readonly guildId: string;
  readonly seconds: number;
  readonly activeUsers: number;
  readonly sessions: number;
  readonly inVoice: number;
  readonly daily: readonly { day: string; seconds: number; users: number }[];
}
export interface ActivityReport {
  readonly snapshotAt?: string;
  readonly from: string;
  readonly to: string;
  readonly timezone: string;
  readonly seconds: number;
  readonly activeUsers: number;
  readonly sessions: number;
  readonly inVoice: number;
  readonly serverActivity: readonly ServerActivity[];
  readonly daily: readonly { day: string; seconds: number; users: number }[];
  readonly channels: readonly { id: string; name: string; seconds: number }[];
  readonly users: readonly ActivityRow[];
  readonly recent: readonly {
    guildId: string;
    userId: string;
    name: string;
    channel: string;
    startedAt: string;
    endedAt: string | null;
    confirmedThrough: string;
    seconds: number;
    quality: string;
    endReason: string | null;
  }[];
  readonly updatedAt: string | null;
  readonly interruptedAt: string | null;
  readonly interruptedSegments: number;
  readonly truncated: boolean;
  readonly peakConcurrency: number;
  readonly hourly: readonly { hour: number; seconds: number }[];
}
export interface InstanceOverview {
  readonly activeGuilds: number;
  readonly features: readonly { feature: Feature; enabledGuilds: number }[];
  readonly updatedAt: string;
}
export interface CollectionStatus {
  readonly recovering: boolean;
  readonly delayed: boolean;
}

export async function withStatsScope<T>(
  db: Db,
  scope: StatsScope,
  work: (trx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SET TRANSACTION READ ONLY`.execute(trx);
    await sql`SELECT set_config('statement_timeout',${scope.kind === 'global' ? '30000' : '10000'},true),set_config('lock_timeout','1000',true)`.execute(
      trx,
    );
    await sql`SELECT set_config('app.guild_id',${scope.guildId ?? ''},true),set_config('app.stats_scope',${scope.kind},true),set_config('app.stats_actor',${scope.userId},true)`.execute(
      trx,
    );
    return work(trx);
  });
}

async function readConfig(trx: Tx, guildId: string): Promise<StatsConfig> {
  const row = (
    await sql<{
      timezone: string;
      enabled: boolean;
      excluded_channels: string[];
      afk_channel_id: string | null;
      changed_at: Date;
      enabled_at: Date | null;
    }>`
    SELECT g.timezone,COALESCE((g.features->>'stats')::boolean,false) AND r.inactive_since IS NULL AS enabled,
      COALESCE(s.excluded_channels,'{}') AS excluded_channels,s.afk_channel_id,COALESCE(s.changed_at,g.installed_at) AS changed_at,s.enabled_at
    FROM guild_settings g JOIN guild_registry r USING(guild_id) LEFT JOIN stats_settings s USING(guild_id) WHERE g.guild_id=${guildId}`.execute(
      trx,
    )
  ).rows[0];
  const roles = (
    await sql<{
      role_id: string;
    }>`SELECT role_id FROM guild_permission_roles WHERE guild_id=${guildId} AND level='member'`.execute(trx)
  ).rows.map((r) => r.role_id);
  return {
    guildId,
    timezone: row?.timezone ?? 'UTC',
    enabled: row?.enabled ?? false,
    roles,
    excludedChannels: row?.excluded_channels ?? [],
    afkChannelId: row?.afk_channel_id ?? null,
    changedAt: row?.changed_at ?? new Date(0),
    enabledAt: row?.enabled_at ?? null,
  };
}
async function fence(trx: Tx, lease?: Lease): Promise<void> {
  if (
    lease &&
    !(
      await sql`SELECT name FROM leases WHERE name=${lease.name} AND holder=${lease.holder} AND token=${lease.token.toString()}::bigint AND expires_at>clock_timestamp() FOR SHARE`.execute(
        trx,
      )
    ).rows.length
  )
    throw new StatsLeaseLostError('Stats shard lease lost');
}

export class PostgresStatsStore {
  constructor(
    readonly db: Db,
    readonly now: () => Date = () => new Date(),
  ) {}

  config(guildId: string): Promise<StatsConfig> {
    return withTenant(this.db, GuildId.assert(guildId), (trx) => readConfig(trx, guildId));
  }

  async settings(guildId: string) {
    return withTenant(this.db, GuildId.assert(guildId), async (trx) => {
      const config = await readConfig(trx, guildId);
      const row = (
        await sql<{
          guild_name: string;
        }>`SELECT guild_name FROM stats_settings WHERE guild_id=${guildId}`.execute(trx)
      ).rows[0];
      return { ...config, name: row?.guild_name || guildId, nameKnown: !!row?.guild_name };
    });
  }

  /** Preserve trusted Discord names independently of collection and future bot departures. */
  async rememberGuildName(guildId: string, name: string, lease?: Lease): Promise<void> {
    if (!name.trim()) return;
    await withTenant(this.db, GuildId.assert(guildId), async (trx) => {
      await fence(trx, lease);
      await sql`INSERT INTO stats_settings(guild_id,guild_name) VALUES(${guildId},${name})
        ON CONFLICT(guild_id) DO UPDATE SET guild_name=EXCLUDED.guild_name
        WHERE stats_settings.guild_name IS DISTINCT FROM EXCLUDED.guild_name`.execute(trx);
    });
  }

  async configure(
    guildId: string,
    actorId: string,
    input: {
      readonly enabled?: boolean;
      readonly excludedChannels?: readonly string[];
      readonly memberRoles?: readonly string[];
    },
  ) {
    return withTenant(this.db, GuildId.assert(guildId), async (trx) => {
      await sql`SELECT guild_id FROM guild_settings WHERE guild_id=${guildId} FOR UPDATE`.execute(trx);
      const before = await readConfig(trx, guildId);
      if (input.memberRoles !== undefined) {
        if (!validTargets(guildId, input.memberRoles)) return 'invalid_roles' as const;
        const roles = [...new Set(input.memberRoles)];
        for (const role of roles)
          await sql`INSERT INTO guild_permission_roles(guild_id,level,role_id) VALUES(${guildId},'member',${role}) ON CONFLICT DO NOTHING`.execute(
            trx,
          );
        await sql`DELETE FROM guild_permission_roles WHERE guild_id=${guildId} AND level='member' AND NOT role_id=ANY(${roles}::text[])`.execute(
          trx,
        );
      }
      const targets = await readConfig(trx, guildId);
      if (input.enabled === true && !validTargets(guildId, targets.roles)) return 'invalid_roles' as const;
      await sql`INSERT INTO stats_settings(guild_id) VALUES(${guildId}) ON CONFLICT DO NOTHING`.execute(trx);
      if (input.excludedChannels !== undefined) {
        await sql`UPDATE stats_settings SET excluded_channels=${[...new Set(input.excludedChannels)]}::text[],changed_at=now() WHERE guild_id=${guildId}`.execute(
          trx,
        );
        await sql`UPDATE stats_voice_segments SET ended_at=GREATEST(started_at,CASE WHEN confirmed_through>now()-interval '120 seconds' THEN now() ELSE confirmed_through END),confirmed_through=GREATEST(started_at,CASE WHEN confirmed_through>now()-interval '120 seconds' THEN now() ELSE confirmed_through END),end_reason='excluded'
          WHERE guild_id=${guildId} AND ended_at IS NULL AND channel_id=ANY(${[...input.excludedChannels]}::text[])`.execute(
          trx,
        );
      }
      if (input.enabled !== undefined)
        await sql`UPDATE guild_settings SET features=jsonb_set(features,'{stats}',${JSON.stringify(input.enabled)}::jsonb) WHERE guild_id=${guildId}`.execute(
          trx,
        );
      const after = await readConfig(trx, guildId);
      await sql`INSERT INTO guild_audit_log(guild_id,actor_id,action,before,after) VALUES(${guildId},${actorId},'stats.settings',${JSON.stringify(before)}::jsonb,${JSON.stringify(after)}::jsonb)`.execute(
        trx,
      );
      return 'saved' as const;
    });
  }

  async channelName(guildId: string, channelId: string, name: string, lease?: Lease): Promise<void> {
    return this.rememberChannelNames(guildId, { [channelId]: name }, lease);
  }

  /** Rename retained participants without creating activity or extending retention. */
  async rememberMemberName(guildId: string, userId: string, name: string, lease?: Lease): Promise<void> {
    if (!name.trim() || name === userId) return;
    await withTenant(this.db, GuildId.assert(guildId), async trx => {
      await fence(trx, lease);
      await sql`UPDATE stats_users SET name=${name}
        WHERE guild_id=${guildId} AND user_id=${userId} AND name IS DISTINCT FROM ${name}`.execute(trx);
    });
  }

  /** Small keyset pages of retained identities, never Discord's complete member directory. */
  async nameTargets(guildId: string, kind: 'member' | 'channel', after: string, limit: number): Promise<string[]> {
    const table = kind === 'member' ? 'stats_users' : 'stats_channels';
    const id = sql.ref(kind === 'member' ? 'user_id' : 'channel_id');
    return withTenant(this.db, GuildId.assert(guildId), async trx => {
      const rows = (await sql<{ id: string }>`SELECT ${id} AS id FROM ${sql.table(table)}
        WHERE guild_id=${guildId} AND ${id}>${after}
          AND last_seen_at>${new Date(this.now().getTime() - STATS_RETENTION_MS)}
        ORDER BY ${id} LIMIT ${limit}`.execute(trx)).rows;
      return rows.map(row => row.id);
    });
  }

  async channelNames(guildId: string): Promise<Readonly<Record<string, string>>> {
    return withTenant(this.db, GuildId.assert(guildId), async trx => {
      const rows = (await sql<{ channel_id: string; name: string }>`SELECT channel_id,name FROM stats_channels
        WHERE guild_id=${guildId}`.execute(trx)).rows;
      return Object.fromEntries(rows.map(row => [row.channel_id, row.name]));
    });
  }

  /** Update only channels with retained activity; metadata does not extend retention. */
  async rememberChannelNames(guildId: string, names: Readonly<Record<string, string>>, lease?: Lease): Promise<void> {
    const entries = Object.entries(names).filter(([id, name]) => typeof name === 'string' && name.trim() && name !== id)
      .map(([id, name]) => ({ id, name }));
    if (!entries.length) return;
    await withTenant(this.db, GuildId.assert(guildId), async (trx) => {
      await fence(trx, lease);
      await sql`UPDATE stats_channels c SET name=n.name
        FROM jsonb_to_recordset(${JSON.stringify(entries)}::jsonb) AS n(id text,name text)
        WHERE c.guild_id=${guildId} AND c.channel_id=n.id AND c.name IS DISTINCT FROM n.name`.execute(trx);
    });
  }
  async metadata(guildId: string, name: string, afkChannelId: string | null, lease?: Lease): Promise<void> {
    await withTenant(this.db, GuildId.assert(guildId), async (trx) => {
      await fence(trx, lease);
      await sql`INSERT INTO stats_settings(guild_id,guild_name,afk_channel_id) VALUES(${guildId},${name},${afkChannelId})
        ON CONFLICT(guild_id) DO UPDATE SET guild_name=EXCLUDED.guild_name,afk_channel_id=EXCLUDED.afk_channel_id`.execute(
        trx,
      );
      await sql`UPDATE stats_voice_segments SET ended_at=GREATEST(started_at,CASE WHEN confirmed_through>now()-interval '120 seconds' THEN now() ELSE confirmed_through END),confirmed_through=GREATEST(started_at,CASE WHEN confirmed_through>now()-interval '120 seconds' THEN now() ELSE confirmed_through END),end_reason='excluded'
        WHERE guild_id=${guildId} AND ended_at IS NULL AND channel_id=${afkChannelId}`.execute(trx);
    });
  }

  async observe(event: VoiceObservation, lease?: Lease): Promise<void> {
    const at = new Date(event.at);
    if (
      !Number.isFinite(at.getTime()) ||
      at.getTime() <= this.now().getTime() - STATS_RETENTION_MS ||
      at > this.now()
    )
      return;
    await withTenant(this.db, GuildId.assert(event.guildId), async (trx) => {
      if (lease) {
        const valid = (
          await sql`SELECT name FROM leases WHERE name=${lease.name} AND holder=${lease.holder} AND token=${lease.token.toString()}::bigint AND expires_at>clock_timestamp() FOR SHARE`.execute(
            trx,
          )
        ).rows.length;
        if (!valid) throw new StatsLeaseLostError('Stats shard lease lost');
      }
      // Serialise state changes of one guild, including configuration and privacy actions.
      await sql`SELECT guild_id FROM guild_settings WHERE guild_id=${event.guildId} FOR UPDATE`.execute(trx);
      const config = await readConfig(trx, event.guildId);
      const privacy = (
        await sql<{
          opted_out: boolean;
          erased_before: Date;
        }>`SELECT opted_out,erased_before FROM stats_privacy WHERE guild_id=${event.guildId} AND user_id=${event.userId}`.execute(
          trx,
        )
      ).rows[0];
      if (privacy && (privacy.opted_out || at <= privacy.erased_before)) return;
      if (
        !config.enabled ||
        !validTargets(config.guildId, config.roles) ||
        (config.enabledAt && at < config.enabledAt)
      )
        return;
      if (
        (await sql`SELECT event_key FROM stats_voice_events WHERE event_key=${event.key}`.execute(trx)).rows
          .length
      )
        return;
      let open = (
        await sql<{
          id: string;
          channel_id: string;
          started_at: Date;
          confirmed_through: Date;
        }>`SELECT id,channel_id,started_at,confirmed_through FROM stats_voice_segments WHERE guild_id=${event.guildId} AND user_id=${event.userId} AND ended_at IS NULL FOR UPDATE`.execute(
          trx,
        )
      ).rows[0];
      if (open && event.quality === 'replayed') {
        await sql`UPDATE stats_voice_segments SET ended_at=confirmed_through,quality='interrupted',end_reason='recovery' WHERE id=${open.id}`.execute(
          trx,
        );
        open = undefined;
      }
      const follow = eligible(config, event);
      // Only currently connected humans get temporary state; never a full guild member list.
      if (!event.bot && event.channelId !== null) {
        await sql`INSERT INTO stats_voice_presence(guild_id,user_id,channel_id,roles,shard_id,seen_at) VALUES(${event.guildId},${event.userId},${event.channelId},${[...event.roles]}::text[],${event.shardId},${at})
          ON CONFLICT(guild_id,user_id) DO UPDATE SET channel_id=EXCLUDED.channel_id,roles=EXCLUDED.roles,shard_id=EXCLUDED.shard_id,seen_at=EXCLUDED.seen_at WHERE stats_voice_presence.seen_at<=EXCLUDED.seen_at`.execute(
          trx,
        );
      } else
        await sql`DELETE FROM stats_voice_presence WHERE guild_id=${event.guildId} AND user_id=${event.userId} AND seen_at<=${at}`.execute(
          trx,
        );
      if (!follow && !open) return;
      if (open && at < open.started_at) return;
      // Mute/video updates refresh the state but never create another connection or raw fact.
      if (open && follow && open.channel_id === event.channelId) {
        await sql`UPDATE stats_voice_segments SET current_roles=${[...event.roles]}::text[],confirmed_through=GREATEST(confirmed_through,${at}) WHERE id=${open.id}`.execute(
          trx,
        );
        await sql`UPDATE stats_users SET name=${event.name},last_seen_at=${at} WHERE guild_id=${event.guildId} AND user_id=${event.userId} AND name<>${event.name} AND ${event.name}<>${event.userId} AND ${event.name}<>''`.execute(
          trx,
        );
        return;
      }
      const kind = open
        ? follow
          ? 'move'
          : event.channelId === null
            ? 'leave'
            : event.roles.some((r) => config.roles.includes(r))
              ? 'excluded'
              : 'role_lost'
        : event.quality === 'snapshot'
          ? 'recovery'
          : 'join';
      const added = (
        await sql`INSERT INTO stats_voice_events(event_key,guild_id,user_id,channel_id,previous_channel_id,at,kind,quality)
        VALUES(${event.key},${event.guildId},${event.userId},${follow ? event.channelId : null},${open?.channel_id ?? null},${at},${kind},${event.quality}) ON CONFLICT DO NOTHING RETURNING event_key`.execute(
          trx,
        )
      ).rows.length;
      if (!added) return;
      if (open)
        await sql`UPDATE stats_voice_segments SET ended_at=${at},confirmed_through=${at},end_reason=${kind},quality=CASE WHEN ${event.quality}='interrupted' THEN 'interrupted' ELSE quality END WHERE id=${open.id}`.execute(
          trx,
        );
      if (follow && event.channelId && event.quality !== 'replayed') {
        const id = createHash('sha256').update(event.key).digest('hex');
        await sql`INSERT INTO stats_voice_segments(id,guild_id,user_id,channel_id,shard_id,started_at,confirmed_through,current_roles,quality)
          VALUES(${id},${event.guildId},${event.userId},${event.channelId},${event.shardId},${at},${at},${[...event.roles]}::text[],${event.quality}) ON CONFLICT DO NOTHING`.execute(
          trx,
        );
        await sql`INSERT INTO stats_users(guild_id,user_id,name,last_seen_at) VALUES(${event.guildId},${event.userId},${event.name || event.userId},${at})
          ON CONFLICT(guild_id,user_id) DO UPDATE SET name=CASE WHEN EXCLUDED.name=EXCLUDED.user_id THEN stats_users.name ELSE EXCLUDED.name END,last_seen_at=EXCLUDED.last_seen_at WHERE stats_users.last_seen_at<=EXCLUDED.last_seen_at`.execute(
          trx,
        );
        await sql`INSERT INTO stats_channels(guild_id,channel_id,name,last_seen_at) VALUES(${event.guildId},${event.channelId},${event.channelName || event.channelId},${at})
          ON CONFLICT(guild_id,channel_id) DO UPDATE SET
            name=CASE WHEN EXCLUDED.name=EXCLUDED.channel_id THEN stats_channels.name ELSE EXCLUDED.name END,
            last_seen_at=EXCLUDED.last_seen_at WHERE stats_channels.last_seen_at<=EXCLUDED.last_seen_at`.execute(
          trx,
        );
      }
      await sql`UPDATE stats_settings SET observed_through=GREATEST(observed_through,${at}) WHERE guild_id=${event.guildId}`.execute(
        trx,
      );
    });
  }

  async presence(guildId: string) {
    return withTenant(
      this.db,
      GuildId.assert(guildId),
      async (trx) =>
        (
          await sql<{
            user_id: string;
            channel_id: string;
            roles: string[];
            shard_id: number;
            seen_at: Date;
            name: string | null;
          }>`
      SELECT p.*,u.name FROM stats_voice_presence p LEFT JOIN stats_users u USING(guild_id,user_id) WHERE p.guild_id=${guildId}`.execute(
            trx,
          )
        ).rows,
    );
  }

  async openUserIds(guildId: string): Promise<Set<string>> {
    return withTenant(
      this.db,
      GuildId.assert(guildId),
      async (trx) =>
        new Set(
          (
            await sql<{
              user_id: string;
            }>`SELECT user_id FROM stats_voice_segments WHERE guild_id=${guildId} AND ended_at IS NULL`.execute(
              trx,
            )
          ).rows.map((r) => r.user_id),
        ),
    );
  }

  async interrupt(guildId: string, lease?: Lease): Promise<void> {
    await withTenant(this.db, GuildId.assert(guildId), async (trx) => {
      await fence(trx, lease);
      await sql`SELECT guild_id FROM guild_settings WHERE guild_id=${guildId} FOR UPDATE`.execute(trx);
      await sql`UPDATE stats_voice_segments SET ended_at=confirmed_through,end_reason='recovery',quality='interrupted' WHERE guild_id=${guildId} AND ended_at IS NULL`.execute(
        trx,
      );
      await sql`UPDATE stats_settings SET interrupted_at=${this.now()} WHERE guild_id=${guildId}`.execute(
        trx,
      );
    });
  }

  async checkpoint(guildId: string, lease: Lease, at: Date): Promise<void> {
    await withTenant(this.db, GuildId.assert(guildId), async (trx) => {
      await fence(trx, lease);
      // Serialize the successful cycle with interruptions and settings changes.
      await sql`SELECT guild_id FROM guild_settings WHERE guild_id=${guildId} FOR UPDATE`.execute(trx);
      await sql`UPDATE stats_voice_segments SET confirmed_through=GREATEST(confirmed_through,${at}) WHERE guild_id=${guildId} AND ended_at IS NULL`.execute(
        trx,
      );
      await sql`UPDATE stats_users SET last_seen_at=${at} WHERE guild_id=${guildId} AND user_id IN (SELECT user_id FROM stats_voice_segments WHERE guild_id=${guildId} AND ended_at IS NULL)`.execute(
        trx,
      );
      await sql`UPDATE stats_settings SET observed_through=${at},interrupted_at=NULL WHERE guild_id=${guildId}`.execute(trx);
    });
  }

  /** Operational state is live, independent of historical filters and admin snapshots. */
  async collectionStatus(scope: StatsScope): Promise<CollectionStatus> {
    return withStatsScope(this.db, scope, async trx => {
      const row = (await sql<CollectionStatus>`SELECT * FROM picket_stats_collection_status(
        ${scope.guildId},${new Date(this.now().getTime() - 180_000)})`.execute(trx)).rows[0]!;
      return row;
    });
  }

  async privacy(guildId: string, userId: string) {
    return withTenant(
      this.db,
      GuildId.assert(guildId),
      async (trx) =>
        (
          await sql<{
            opted_out: boolean;
          }>`SELECT opted_out FROM stats_privacy WHERE guild_id=${guildId} AND user_id=${userId}`.execute(trx)
        ).rows[0]?.opted_out ?? false,
    );
  }

  async setPrivacy(guildId: string, userId: string, optedOut: boolean, erase: boolean): Promise<void> {
    await withTenant(this.db, GuildId.assert(guildId), async (trx) => {
      await sql`SELECT guild_id FROM guild_settings WHERE guild_id=${guildId} FOR UPDATE`.execute(trx);
      const cutoff = erase ? this.now() : new Date(0);
      await sql`INSERT INTO stats_privacy(guild_id,user_id,opted_out,erased_before) VALUES(${guildId},${userId},${optedOut},${cutoff})
        ON CONFLICT(guild_id,user_id) DO UPDATE SET opted_out=EXCLUDED.opted_out,erased_before=GREATEST(stats_privacy.erased_before,EXCLUDED.erased_before)`.execute(
        trx,
      );
      if (erase) {
        for (const table of [
          'stats_voice_events',
          'stats_voice_segments',
          'stats_voice_presence',
          'stats_users',
        ])
          await sql`DELETE FROM ${sql.table(table)} WHERE guild_id=${guildId} AND user_id=${userId}`.execute(
            trx,
          );
      } else if (optedOut) {
        await sql`UPDATE stats_voice_segments SET ended_at=GREATEST(started_at,CASE WHEN confirmed_through>${new Date(this.now().getTime() - 120_000)} THEN ${this.now()} ELSE confirmed_through END),confirmed_through=GREATEST(started_at,CASE WHEN confirmed_through>${new Date(this.now().getTime() - 120_000)} THEN ${this.now()} ELSE confirmed_through END),end_reason='privacy' WHERE guild_id=${guildId} AND user_id=${userId} AND ended_at IS NULL`.execute(
          trx,
        );
        await sql`DELETE FROM stats_voice_presence WHERE guild_id=${guildId} AND user_id=${userId}`.execute(
          trx,
        );
      }
    });
  }

  async guildIds(): Promise<string[]> {
    return (
      await sql<{
        guild_id: string;
      }>`SELECT guild_id FROM guild_registry WHERE inactive_since IS NULL ORDER BY guild_id`.execute(this.db)
    ).rows.map((r) => r.guild_id);
  }
  async instanceOverview(): Promise<InstanceOverview> {
    const row = (await sql<{ active_guilds: string } & Record<Feature, string>>
      `SELECT * FROM picket_instance_overview()`.execute(this.db)).rows[0]!;
    return { activeGuilds: Number(row.active_guilds),
      features: FEATURES.map((feature) => ({ feature, enabledGuilds: Number(row[feature]) })),
      updatedAt: this.now().toISOString() };
  }
  async guildFeatures(guildId: string): Promise<readonly { feature: Feature; enabled: boolean }[]> {
    return withTenant(this.db, GuildId.assert(guildId), async (trx) => {
      const row = (await sql<{ features: Record<string, boolean> }>
        `SELECT features FROM guild_settings WHERE guild_id=${guildId}`.execute(trx)).rows[0];
      return FEATURES.map(feature => ({ feature, enabled: feature==='voice' ? row?.features.voice!==false : row?.features[feature] === true }));
    });
  }
  async allGuildIds(): Promise<string[]> {
    return (
      await sql<{ guild_id: string }>`SELECT guild_id FROM guild_registry ORDER BY guild_id`.execute(this.db)
    ).rows.map((r) => r.guild_id);
  }
  async personalGuildIds(userId: string): Promise<string[]> {
    return withStatsScope(this.db, { kind: 'global', guildId: null, userId }, async (trx) =>
      (
        await sql<{
          guild_id: string;
        }>`SELECT DISTINCT guild_id FROM stats_voice_segments WHERE user_id=${userId} UNION SELECT guild_id FROM stats_voice_events WHERE user_id=${userId} UNION SELECT guild_id FROM stats_privacy WHERE user_id=${userId} UNION SELECT guild_id FROM stats_voice_presence WHERE user_id=${userId}`.execute(
          trx,
        )
      ).rows.map((r) => r.guild_id),
    );
  }
  async isRegistered(guildId: string): Promise<boolean> {
    return (
      (await sql`SELECT guild_id FROM guild_registry WHERE guild_id=${guildId}`.execute(this.db)).rows
        .length > 0
    );
  }
  async isActive(guildId: string): Promise<boolean> {
    return (
      (
        await sql`SELECT guild_id FROM guild_registry WHERE guild_id=${guildId} AND inactive_since IS NULL`.execute(
          this.db,
        )
      ).rows.length > 0
    );
  }

  async maintenance(guildId: string): Promise<void> {
    const cutoff = new Date(this.now().getTime() - STATS_RETENTION_MS);
    await withTenant(this.db, GuildId.assert(guildId), async (trx) => {
      // Bounded chunks; repeatedly called by the leased job runner. Reads always enforce the exact cutoff.
      for (const [table, time] of [
        ['stats_voice_events', 'at'],
        ['stats_voice_segments', 'confirmed_through'],
        ['stats_users', 'last_seen_at'],
        ['stats_channels', 'last_seen_at'],
        ['stats_voice_presence', 'seen_at'],
      ] as const) {
        await sql`DELETE FROM ${sql.table(table)} WHERE ctid IN (SELECT ctid FROM ${sql.table(table)} WHERE guild_id=${guildId} AND ${sql.ref(time)}<${cutoff} LIMIT 1000)`.execute(
          trx,
        );
      }
      await sql`UPDATE stats_settings SET interrupted_at=CASE WHEN interrupted_at<${cutoff} THEN NULL ELSE interrupted_at END,observed_through=CASE WHEN observed_through<${cutoff} THEN NULL ELSE observed_through END WHERE guild_id=${guildId}`.execute(
        trx,
      );
      await sql`UPDATE stats_voice_segments SET started_at=${cutoff} WHERE guild_id=${guildId} AND started_at<${cutoff} AND confirmed_through>=${cutoff}`.execute(
        trx,
      );
    });
    await sql`DELETE FROM stats_web_sessions WHERE expires_at<${this.now()}`.execute(this.db);
    await sql`DELETE FROM stats_oauth_states WHERE expires_at<${this.now()}`.execute(this.db);
  }

  async report(
    scope: StatsScope,
    period: StatsPeriod,
    options: { readonly includeUsers?: boolean; readonly offset?: number; readonly limit?: number } = {},
  ): Promise<ActivityReport> {
    const from = new Date(Math.max(period.from.getTime(), this.now().getTime() - STATS_RETENTION_MS));
    const to = new Date(Math.min(period.to.getTime(), this.now().getTime()));
    return withStatsScope(this.db, scope, async (trx) => {
      let timezone = 'UTC';
      if (scope.guildId)
        timezone =
          (
            await sql<{
              timezone: string;
            }>`SELECT timezone FROM guild_settings WHERE guild_id=${scope.guildId}`.execute(trx)
          ).rows[0]?.timezone ?? 'UTC';
      // Scope is enforced by RLS; explicit bounds also make index scans predictable.
      const guildBound = scope.guildId ? sql`guild_id=${scope.guildId} AND` : sql``;
      const bounds = sql`${guildBound} started_at<${to} AND COALESCE(ended_at,confirmed_through)>${from} ${period.channelId ? sql`AND channel_id=${period.channelId}` : sql``}`;
      const duration = sql`GREATEST(0,EXTRACT(EPOCH FROM LEAST(COALESCE(ended_at,confirmed_through),${to})-GREATEST(started_at,${from})))`;
      const totals = (
        await sql<{
          seconds: string;
          active_users: string;
          sessions: string;
          interrupted: string;
        }>`SELECT COALESCE(SUM(${duration}),0) AS seconds,COUNT(DISTINCT user_id) AS active_users,COUNT(*) AS sessions,COUNT(*) FILTER(WHERE quality IN ('interrupted','replayed')) AS interrupted FROM stats_voice_segments WHERE ${bounds}`.execute(
          trx,
        )
      ).rows[0]!;
      const live = (
        await sql<{
          count: string;
        }>`SELECT COUNT(*) FROM stats_voice_segments WHERE ${guildBound} ended_at IS NULL AND confirmed_through>${new Date(this.now().getTime() - 120_000)} ${period.channelId ? sql`AND channel_id=${period.channelId}` : sql``}`.execute(
          trx,
        )
      ).rows[0]!;
      const channels = (
        await sql<{
          id: string;
          name: string;
          seconds: string;
        }>`SELECT s.channel_id AS id,COALESCE(MAX(c.name),s.channel_id) AS name,SUM(${duration}) AS seconds FROM stats_voice_segments s LEFT JOIN stats_channels c USING(guild_id,channel_id) WHERE ${bounds} GROUP BY s.channel_id ORDER BY seconds DESC LIMIT 100`.execute(
          trx,
        )
      ).rows;
      const limit = Math.min(10_000, Math.max(1, options.limit ?? 1000));
      const offset = Math.max(0, options.offset ?? 0);
      const users =
        options.includeUsers === false
          ? []
          : (
              await sql<{
                guild_id: string;
                user_id: string;
                name: string;
                seconds: string;
                last_activity: Date;
                sessions: string;
              }>`SELECT s.guild_id,s.user_id,COALESCE(MAX(u.name),s.user_id) AS name,SUM(${duration}) AS seconds,MAX(LEAST(COALESCE(ended_at,confirmed_through),${to})) AS last_activity,COUNT(*) AS sessions FROM stats_voice_segments s LEFT JOIN stats_users u USING(guild_id,user_id) WHERE ${bounds} GROUP BY s.guild_id,s.user_id ORDER BY seconds DESC,s.guild_id,s.user_id LIMIT ${limit + 1} OFFSET ${offset}`.execute(
                trx,
              )
            ).rows;
      const recent =
        options.includeUsers === false
          ? []
          : (
              await sql<{
                guild_id: string;
                user_id: string;
                name: string;
                channel: string;
                started_at: Date;
                ended_at: Date | null;
                confirmed_through: Date;
                seconds: string;
                quality: string;
                end_reason: string | null;
              }>`
        SELECT s.guild_id,s.user_id,COALESCE(u.name,s.user_id) AS name,COALESCE(c.name,s.channel_id) AS channel,
          GREATEST(s.started_at,${new Date(this.now().getTime() - STATS_RETENTION_MS)}) AS started_at,s.ended_at,s.confirmed_through,${duration} AS seconds,s.quality,s.end_reason
        FROM stats_voice_segments s LEFT JOIN stats_users u USING(guild_id,user_id) LEFT JOIN stats_channels c USING(guild_id,channel_id)
        WHERE ${bounds} ORDER BY s.started_at DESC,s.id LIMIT 100`.execute(trx)
            ).rows;
      // Expand each retained interval only into the days it overlaps. Grouping sets
      // share that read between per-guild series and the globally deduplicated series.
      const dayRows = (await sql<{ guild_id: string | null; day: string; seconds: string; users: string }>`
        WITH intervals AS (
          SELECT guild_id,user_id,GREATEST(started_at,${from}) AS a,LEAST(COALESCE(ended_at,confirmed_through),${to}) AS b
          FROM stats_voice_segments WHERE ${bounds}
        ), slices AS (
          SELECT guild_id,user_id,date_trunc('day',a AT TIME ZONE ${timezone}) AS d,
            GREATEST(0,EXTRACT(EPOCH FROM b-a)) AS seconds
          FROM intervals WHERE date_trunc('day',a AT TIME ZONE ${timezone}) = date_trunc('day',b AT TIME ZONE ${timezone})
          UNION ALL
          SELECT guild_id,user_id,d,GREATEST(0,EXTRACT(EPOCH FROM
            LEAST(b,(d+interval '1 day') AT TIME ZONE ${timezone})-GREATEST(a,d AT TIME ZONE ${timezone}))) AS seconds
          FROM intervals CROSS JOIN LATERAL generate_series(date_trunc('day',a AT TIME ZONE ${timezone}),
            date_trunc('day',b AT TIME ZONE ${timezone}),interval '1 day') AS days(d)
          WHERE date_trunc('day',a AT TIME ZONE ${timezone}) <> date_trunc('day',b AT TIME ZONE ${timezone})
            AND a<(d+interval '1 day') AT TIME ZONE ${timezone} AND b>d AT TIME ZONE ${timezone}
        ), people_days AS (
          SELECT guild_id,user_id,d,SUM(seconds) AS seconds FROM slices GROUP BY guild_id,user_id,d
        ), aggregate AS (
          SELECT guild_id,d,SUM(seconds) AS seconds,
            COUNT(DISTINCT user_id) AS users
          FROM people_days
          GROUP BY GROUPING SETS ((guild_id,d),(d))
        ), days AS (
          SELECT generate_series(date_trunc('day',${from}::timestamptz AT TIME ZONE ${timezone}),
            date_trunc('day',${new Date(to.getTime() - 1)}::timestamptz AT TIME ZONE ${timezone}),interval '1 day') AS d
        ) SELECT NULL::text AS guild_id,to_char(days.d,'YYYY-MM-DD') AS day,
          COALESCE(a.seconds,0) AS seconds,COALESCE(a.users,0) AS users
        FROM days LEFT JOIN aggregate a ON a.guild_id IS NULL AND a.d=days.d
        UNION ALL SELECT guild_id,to_char(d,'YYYY-MM-DD') AS day,seconds,users FROM aggregate WHERE guild_id IS NOT NULL
        ORDER BY day,guild_id`.execute(trx)).rows;
      const daily = dayRows.filter((row) => row.guild_id === null);
      // One grouped read for all authorised guilds; no per-guild report loop.
      const serverTotals = (await sql<{
        guild_id: string; seconds: string; users: string; sessions: string; in_voice: string;
      }>`WITH activity AS (
        SELECT guild_id,SUM(${duration}) AS seconds,COUNT(DISTINCT user_id) AS users,COUNT(*) AS sessions
        FROM stats_voice_segments WHERE ${bounds} GROUP BY guild_id
      ), live AS (
        SELECT guild_id,COUNT(*) AS in_voice FROM stats_voice_segments
        WHERE ${guildBound} ended_at IS NULL AND confirmed_through>${new Date(this.now().getTime() - 120_000)}
          ${period.channelId ? sql`AND channel_id=${period.channelId}` : sql``} GROUP BY guild_id
      ) SELECT COALESCE(a.guild_id,l.guild_id) AS guild_id,COALESCE(a.seconds,0) AS seconds,
        COALESCE(a.users,0) AS users,COALESCE(a.sessions,0) AS sessions,COALESCE(l.in_voice,0) AS in_voice
      FROM activity a FULL JOIN live l USING(guild_id) ORDER BY seconds DESC,guild_id`.execute(trx)).rows;
      const daysByGuild = new Map<string, { day: string; seconds: number; users: number }[]>();
      for (const row of dayRows) {
        if (row.guild_id === null) continue;
        const rows = daysByGuild.get(row.guild_id) ?? [];
        rows.push({ day: row.day, seconds: Number(row.seconds), users: Number(row.users) });
        daysByGuild.set(row.guild_id, rows);
      }
      const peak = (
        await sql<{ peak: string }>`WITH changes AS (
        SELECT GREATEST(started_at,${from}) AS at,1 AS delta FROM stats_voice_segments WHERE ${bounds}
        UNION ALL SELECT LEAST(COALESCE(ended_at,confirmed_through),${to}) AS at,-1 AS delta FROM stats_voice_segments WHERE ${bounds}
      ), grouped AS (SELECT at,SUM(delta) AS delta FROM changes GROUP BY at), counts AS (SELECT SUM(delta) OVER(ORDER BY at) AS n FROM grouped)
      SELECT COALESCE(MAX(n),0) AS peak FROM counts`.execute(trx)
      ).rows[0]!;
      // UTC needs one-hour bins; local zones retain fifteen-minute boundaries for DST and offset changes.
      const bin = timezone === 'UTC' ? sql`interval '1 hour'` : sql`interval '15 minutes'`;
      const hourly = (
        await sql<{ hour: number; seconds: string }>`WITH intervals AS (
        SELECT GREATEST(started_at,${from}) AS a,LEAST(COALESCE(ended_at,confirmed_through),${to}) AS b FROM stats_voice_segments WHERE ${bounds}
      ), bins AS (SELECT a,b,generate_series(date_bin(${bin},a,'2000-01-01'::timestamptz),b,${bin}) AS slot FROM intervals)
      SELECT EXTRACT(HOUR FROM slot AT TIME ZONE ${timezone})::integer AS hour,
        SUM(GREATEST(0,EXTRACT(EPOCH FROM LEAST(b,slot+${bin})-GREATEST(a,slot)))) AS seconds
        FROM bins GROUP BY hour ORDER BY hour`.execute(trx)
      ).rows;
      const state = (
        await sql<{
          updated_at: Date | null;
          interrupted_at: Date | null;
        }>`SELECT MIN(observed_through) AS updated_at,MAX(interrupted_at) AS interrupted_at FROM stats_settings ${scope.guildId ? sql`WHERE guild_id=${scope.guildId}` : sql``}`.execute(
          trx,
        )
      ).rows[0];
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        timezone,
        seconds: Number(totals.seconds),
        activeUsers: Number(totals.active_users),
        sessions: Number(totals.sessions),
        inVoice: Number(live.count),
        serverActivity: serverTotals.map((row) => ({ guildId: row.guild_id, seconds: Number(row.seconds),
          activeUsers: Number(row.users), sessions: Number(row.sessions), inVoice: Number(row.in_voice),
          daily: daysByGuild.get(row.guild_id) ?? [] })),
        recent: recent.map((r) => ({
          guildId: r.guild_id,
          userId: r.user_id,
          name: r.name,
          channel: r.channel,
          startedAt: r.started_at.toISOString(),
          endedAt: r.ended_at?.toISOString() ?? null,
          confirmedThrough: r.confirmed_through.toISOString(),
          seconds: Number(r.seconds),
          quality: r.quality,
          endReason: r.end_reason,
        })),
        daily: daily.map((r) => ({ day: r.day, seconds: Number(r.seconds), users: Number(r.users) })),
        channels: channels.map((r) => ({ id: r.id, name: r.name, seconds: Number(r.seconds) })),
        users: users.slice(0, limit).map((r) => ({
          guildId: r.guild_id,
          userId: r.user_id,
          name: r.name,
          seconds: Number(r.seconds),
          lastActivity: r.last_activity.toISOString(),
          sessions: Number(r.sessions),
        })),
        updatedAt: state?.updated_at?.toISOString() ?? null,
        interruptedAt: state?.interrupted_at?.toISOString() ?? null,
        interruptedSegments: Number(
          (
            await sql<{
              n: string;
            }>`SELECT COUNT(*) AS n FROM stats_voice_segments WHERE ${guildBound} quality='interrupted' AND started_at>=${from} AND started_at<${to} ${period.channelId ? sql`AND channel_id=${period.channelId}` : sql``}`.execute(
              trx,
            )
          ).rows[0]!.n,
        ),
        truncated: users.length > limit,
        peakConcurrency: Number(peak.peak),
        hourly: hourly.map((r) => ({ hour: r.hour, seconds: Number(r.seconds) })),
      };
    });
  }

  async adminSnapshotStatus(): Promise<{ snapshotAt: Date | null; scheduledAt: Date | null; dirty: boolean }> {
    const row = (await sql<{ snapshot_at: Date | null; scheduled_at: Date | null; dirty: boolean }>
      `SELECT * FROM picket_stats_admin_status()`.execute(this.db)).rows[0]!;
    return { snapshotAt: row.snapshot_at, scheduledAt: row.scheduled_at, dirty: row.dirty };
  }

  async invalidateAdminSnapshot(): Promise<void> {
    await this.db.transaction().execute(async trx => {
      await sql`SELECT set_config('app.stats_scope','global',true)`.execute(trx);
      await sql`SELECT picket_stats_admin_invalidate()`.execute(trx);
    });
  }

  /** Only the leased job runner calls this; refreshes never consume the HTTP request pool. */
  async refreshAdminSnapshot(scheduledAt = this.now()): Promise<boolean> {
    return this.db.transaction().setIsolationLevel('repeatable read').execute(async trx => {
      await sql`SELECT set_config('app.stats_scope','global',true),set_config('statement_timeout','600000',true),set_config('lock_timeout','1000',true),set_config('TimeZone','UTC',true)`.execute(trx);
      return (await sql<{ refreshed: boolean }>`SELECT picket_stats_admin_refresh(${this.now()},${scheduledAt}) AS refreshed`.execute(trx)).rows[0]!.refreshed;
    });
  }

  async adminReport(scope: StatsScope, period: StatsPeriod,
    options: { readonly offset?: number; readonly limit?: number } = {}): Promise<ActivityReport> {
    if (scope.kind !== 'global' || scope.guildId !== null) throw Object.assign(new Error('forbidden'), { statusCode: 403 });
    try {
      return await withStatsScope(this.db, scope, async trx => {
        const row = (await sql<{ report: ActivityReport }>`SELECT picket_stats_admin_report(
          ${period.from},${period.to},${period.channelId ?? null},${Math.min(10_000, Math.max(1, options.limit ?? 1000))},
          ${Math.max(0, options.offset ?? 0)},${this.now()}) AS report`.execute(trx)).rows[0]!;
        return row.report;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '55000')
        throw Object.assign(new Error('stats_snapshot_pending'), { statusCode: 503 });
      throw error;
    }
  }
}
