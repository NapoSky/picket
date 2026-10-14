import { createHash } from 'node:crypto';
import type { Lease } from '@picket/coordination';
import { validWarZones, warZoneOf, WAR_STRUCTURES, type WarZone } from '@picket/game-data';
import { ChannelId, GuildId, type UserId } from '@picket/kernel';
import { sql, withTenant, type Db, type Tx } from '@picket/persistence';
import { isActiveWar, type PollSnapshot, type StoredWarState, type WarEvent, type WarObject } from '../domain/model';
import type { Delivery, SettingsChange, SettingsResult, Subscription, WarStore } from '../application/ports';

interface StateRow { generation: string; available: boolean; highest_war: number; payload: PollSnapshot | null }
interface SubRow { perspective: Subscription['perspective']; channel_id: string | null; zones: WarZone[]; locale: string | null; paused: boolean; confirmed_war: number | null; revision: number; failure_reason: string | null; enabled_at: Date | null }
interface DeliveryRow { id: string; perspective: Delivery['perspective']; channel_id: string; payload: Delivery['event']; locale: string | null; generation: string; revision: number; attempts: number }
const empty: Subscription = { perspective: 'NONE', channelId: null, zones: [], locale: null, paused: true, confirmedWar: null, revision: 0, failureReason: null };
const subscription = (row?: SubRow): Subscription => row ? { perspective: row.perspective, channelId: row.channel_id ? ChannelId.assert(row.channel_id) : null, zones: row.zones, locale: row.locale, paused: row.paused, confirmedWar: row.confirmed_war, revision: row.revision, failureReason: row.failure_reason } : empty;
const keyOf = (event: WarEvent): string => createHash('sha256').update(JSON.stringify([event.war, event.object?.key, event.type, event.occurredAt, event.object?.state, event.faction])).digest('hex');

export class PostgresWarStore implements WarStore {
  constructor(private readonly db: Db) {}
  /** Aggregate scheduling metadata only; no tenant payloads or identifiers leave this boundary. */
  async operationalState(): Promise<{ pendingGuilds: number; overdueSeconds: number }> {
    const row = (await sql<{ pending: number; overdue: number }>`SELECT count(*)::int AS pending,
      COALESCE(GREATEST(0, EXTRACT(EPOCH FROM (clock_timestamp() - min(wake_at)))), 0)::double precision AS overdue
      FROM warlog_schedule WHERE wake_at IS NOT NULL`.execute(this.db)).rows[0]!;
    return { pendingGuilds: row.pending, overdueSeconds: row.overdue };
  }
  async state(): Promise<StoredWarState> {
    const row = (await sql<StateRow>`SELECT generation, available, highest_war, payload FROM warlog_state WHERE id = 1`.execute(this.db)).rows[0]!;
    return { generation: row.generation, available: row.available, highestWar: row.highest_war, snapshot: row.payload };
  }
  async objects(region?: string): Promise<readonly WarObject[]> {
    const result = await sql<{ payload: WarObject }>`SELECT o.payload FROM war_objects o JOIN warlog_state s ON s.id = 1
      WHERE o.war_number = (s.payload->'war'->>'number')::integer AND (${region ?? null}::text IS NULL OR o.payload->>'region' = ${region ?? null})`.execute(this.db);
    return result.rows.map(row => row.payload);
  }
  async #fenced(trx: Tx, lease: Lease): Promise<boolean> {
    const result = await sql`SELECT 1 FROM leases WHERE name = ${lease.name} AND holder = ${lease.holder}
      AND token = ${lease.token.toString()}::bigint AND expires_at > clock_timestamp() FOR SHARE`.execute(trx);
    return Boolean(result.rows.length);
  }
  async recover(lease: Lease): Promise<boolean> {
    return this.db.transaction().execute(async trx => {
      await sql`SELECT id FROM warlog_state WHERE id = 1 FOR UPDATE`.execute(trx);
      if (!await this.#fenced(trx, lease)) return false;
      await sql`UPDATE warlog_state SET available = false, generation = generation + 1, updated_at = now() WHERE id = 1 AND available`.execute(trx);
      return true;
    });
  }
  async guilds(): Promise<readonly GuildId[]> {
    return (await sql<{ guild_id: string }>`SELECT s.guild_id FROM warlog_schedule s JOIN guild_registry r USING(guild_id)
      WHERE r.inactive_since IS NULL AND s.wake_at <= now() ORDER BY s.last_served_at, s.guild_id LIMIT 300`.execute(this.db)).rows.map(row => GuildId.assert(row.guild_id));
  }
  async hookGuilds(): Promise<readonly GuildId[]> {
    return (await sql<{ guild_id: string }>`SELECT s.guild_id FROM warlog_schedule s JOIN guild_registry r USING(guild_id)
      WHERE r.inactive_since IS NULL AND s.hook_pending ORDER BY s.guild_id LIMIT 300`.execute(this.db)).rows.map(row => GuildId.assert(row.guild_id));
  }
  async #schedule(trx: Tx, guild: string): Promise<void> {
    await sql`INSERT INTO warlog_schedule(guild_id, wake_at)
      VALUES(${guild}, (SELECT min(GREATEST(next_attempt_at, COALESCE(claimed_until, next_attempt_at))) FROM warlog_deliveries WHERE guild_id = ${guild} AND completed_at IS NULL))
      ON CONFLICT(guild_id) DO UPDATE SET wake_at = excluded.wake_at, last_served_at = clock_timestamp()`.execute(trx);
  }
  async #tenant(trx: Tx, guildId: GuildId): Promise<void> { await sql`SELECT set_config('app.guild_id', ${guildId}, true)`.execute(trx); }
  async #enqueue(trx: Tx, guild: string, channel: string, revision: number, generation: string, locale: string | null, eventKey: string, event: Delivery['event'], now: Date, notice = false): Promise<void> {
    await sql`INSERT INTO warlog_deliveries(guild_id, event_key, war_number, channel_id, generation, revision, payload, locale, notice, queued_at, next_attempt_at)
      VALUES(${guild}, ${eventKey}, ${event.war}, ${channel}, ${generation}::bigint, ${revision}, ${JSON.stringify(event)}::jsonb, ${locale}, ${notice}, ${now}, ${now})
      ON CONFLICT(guild_id, event_key) DO NOTHING`.execute(trx);
    await sql`INSERT INTO warlog_schedule(guild_id, wake_at) VALUES(${guild}, ${now})
      ON CONFLICT(guild_id) DO UPDATE SET wake_at = LEAST(warlog_schedule.wake_at, excluded.wake_at)`.execute(trx);
  }
  async commit(lease: Lease, snapshot: PollSnapshot, incoming: readonly WarEvent[], baseline: boolean, now: Date): Promise<boolean> {
    return this.db.transaction().execute(async trx => {
      const previous = (await sql<StateRow>`SELECT * FROM warlog_state WHERE id = 1 FOR UPDATE`.execute(trx)).rows[0]!;
      if (!await this.#fenced(trx, lease) || snapshot.war.number < previous.highest_war) return false;
      const newWar = isActiveWar(snapshot.war) && snapshot.war.number > previous.highest_war;
      const generation = previous.generation;
      await sql`INSERT INTO wars(war_number, payload) VALUES(${snapshot.war.number}, ${JSON.stringify(snapshot.war)}::jsonb)
        ON CONFLICT(war_number) DO UPDATE SET payload = excluded.payload`.execute(trx);
      if (baseline) await sql`DELETE FROM war_objects WHERE war_number = ${snapshot.war.number}`.execute(trx);
      else await sql`DELETE FROM war_objects WHERE war_number = ${snapshot.war.number} AND NOT (object_key = ANY(${Object.keys(snapshot.objects)}::text[]))`.execute(trx);
      const entries = Object.values(snapshot.objects);
      for (let start = 0; start < entries.length; start += 200) {
        const values = entries.slice(start, start + 200).map(object => sql`(${snapshot.war.number}, ${object.key}, ${JSON.stringify(object)}::jsonb)`);
        await sql`INSERT INTO war_objects(war_number, object_key, payload) VALUES ${sql.join(values)}
          ON CONFLICT(war_number, object_key) DO UPDATE SET payload = excluded.payload
          WHERE war_objects.payload IS DISTINCT FROM excluded.payload`.execute(trx);
      }
      const events = [...incoming];
      // Known timers retain their observation time across recovery; vanished weapons cancel them.
      await sql`DELETE FROM concrete_timers c WHERE c.war_number <> ${snapshot.war.number} OR NOT EXISTS
        (SELECT 1 FROM war_objects o WHERE o.war_number = c.war_number AND o.object_key = c.object_key AND o.payload->>'state' NOT IN ('?', '0N', '0S'))`.execute(trx);
      if (baseline) await sql`UPDATE concrete_timers SET notified_at = ${now} WHERE ready_at <= ${now} AND notified_at IS NULL`.execute(trx);
      else if (isActiveWar(snapshot.war)) {
        const due = await sql<{ object_key: string; payload: WarEvent; ready_at: Date }>`UPDATE concrete_timers SET notified_at = ${now}
          WHERE war_number = ${snapshot.war.number} AND ready_at <= ${now} AND notified_at IS NULL RETURNING object_key, payload, ready_at`.execute(trx);
        for (const timer of due.rows) {
          const prefix = timer.payload.object!.code === '3A' ? 'sc' : timer.payload.object!.code === '3B' ? 'ic' : 'ws';
          events.push({ ...timer.payload, type: `${prefix}_dried`, object: snapshot.objects[timer.object_key] ?? timer.payload.object, occurredAt: timer.ready_at.getTime(), detectedAt: now.getTime() });
        }
      }
      for (const event of events) {
        const id = keyOf(event);
        await sql`INSERT INTO war_events(event_id, war_number, occurred_at, detected_at, payload)
          VALUES(${id}, ${event.war}, ${new Date(event.occurredAt)}, ${new Date(event.detectedAt)}, ${JSON.stringify(event)}::jsonb)
          ON CONFLICT(event_id) DO NOTHING`.execute(trx);
        if (event.object && ['sc_built', 'ic_built', 'ws_built'].includes(event.type)) {
          const hours = WAR_STRUCTURES[event.object.code].concreteHours;
          await sql`INSERT INTO concrete_timers(war_number, object_key, observed_at, ready_at, payload)
            VALUES(${event.war}, ${event.object.key}, ${new Date(event.detectedAt)}, ${new Date(event.detectedAt + hours * 3_600_000)}, ${JSON.stringify(event)}::jsonb)
            ON CONFLICT(war_number, object_key) DO NOTHING`.execute(trx);
        }
        if (event.object && ['sc_destroyed', 'ic_destroyed', 'ws_destroyed'].includes(event.type)) await sql`DELETE FROM concrete_timers WHERE war_number = ${event.war} AND object_key = ${event.object.key}`.execute(trx);
      }
      // Only current and previous observed wars remain; map lists can change between wars.
      await sql`DELETE FROM wars WHERE war_number NOT IN (SELECT war_number FROM wars ORDER BY war_number DESC LIMIT 2)`.execute(trx);
      const guilds = baseline || events.length ? (await sql<{ guild_id: string }>`SELECT guild_id FROM guild_registry WHERE inactive_since IS NULL ORDER BY guild_id`.execute(trx)).rows : [];
      for (const { guild_id: guild } of guilds) {
        const guildId = GuildId.assert(guild);
        await this.#tenant(trx, guildId);
        const sub = (await sql<SubRow>`SELECT * FROM warlog_subscriptions WHERE guild_id = ${guild} FOR UPDATE`.execute(trx)).rows[0];
        // Cancellation also bounds old queue data after poller recovery, independently of subscription renewals.
        await sql`DELETE FROM warlog_deliveries WHERE guild_id = ${guild} AND (generation <> ${generation}::bigint OR war_number <> ${snapshot.war.number} OR completed_at < ${new Date(now.getTime() - 86_400_000)})`.execute(trx);
        if (newWar && previous.highest_war > 0) {
          if (sub && !sub.paused && sub.channel_id) {
            await sql`UPDATE warlog_subscriptions SET paused = true, revision = revision + 1, failure_reason = NULL WHERE guild_id = ${guild}`.execute(trx);
            await sql`INSERT INTO guild_audit_log(guild_id, actor_id, action, before, after)
              VALUES(${guild}, 'system', 'settings.warlog.renew', ${JSON.stringify(subscription(sub))}::jsonb,
                ${JSON.stringify({ ...subscription(sub), paused: true, revision: sub.revision + 1, failureReason: null })}::jsonb)`.execute(trx);
            await sql`UPDATE guild_settings SET features = jsonb_set(features, '{warlog}', 'false') WHERE guild_id = ${guild}`.execute(trx);
            await sql`DELETE FROM warlog_deliveries WHERE guild_id = ${guild}`.execute(trx);
            await this.#enqueue(trx, guild, sub.channel_id, sub.revision + 1, generation, sub.locale, `renew:${snapshot.war.number}`, { type: 'renew', war: snapshot.war.number }, now, true);
          }
          await sql`INSERT INTO warlog_hook_jobs(guild_id, war_number, started_at)
            SELECT ${guild}, ${snapshot.war.number}, ${new Date(snapshot.war.startedAt!)}
            WHERE EXISTS (SELECT 1 FROM timer_boards WHERE guild_id = ${guild} AND archived_at IS NULL AND (settings->>'resetOnNewWar')::boolean)
            ON CONFLICT DO NOTHING`.execute(trx);
          await sql`INSERT INTO warlog_schedule(guild_id, hook_pending)
            SELECT ${guild}, true WHERE EXISTS (SELECT 1 FROM warlog_hook_jobs WHERE guild_id = ${guild} AND war_number = ${snapshot.war.number} AND completed_at IS NULL)
            ON CONFLICT(guild_id) DO UPDATE SET hook_pending = true`.execute(trx);
        }
        if (!sub || sub.paused || sub.confirmed_war !== snapshot.war.number || !sub.channel_id || baseline) continue;
        const enabled = (await sql<{ enabled: boolean }>`SELECT (features->>'warlog')::boolean AS enabled FROM guild_settings WHERE guild_id = ${guild}`.execute(trx)).rows[0]?.enabled;
        if (!enabled) continue;
        for (const event of events) {
          if (event.type === 'building' || event.detectedAt < (sub.enabled_at?.getTime() ?? Infinity)) continue;
          const zone = event.object ? warZoneOf(event.object.region) : null;
          if (event.object && (!zone || !sub.zones.includes(zone))) continue;
          await this.#enqueue(trx, guild, sub.channel_id, sub.revision, generation, sub.locale, keyOf(event), event, now);
        }
      }
      // Raw API items are cached only in the HTTP adapter; persistent state contains tracked structures and metadata.
      const metadata: PollSnapshot = { ...snapshot, objects: {}, regions: Object.fromEntries(Object.entries(snapshot.regions).map(([region, map]) => [region, { ...map, items: [] }])) };
      await sql`UPDATE warlog_state SET available = true, highest_war = ${isActiveWar(snapshot.war) ? Math.max(previous.highest_war, snapshot.war.number) : previous.highest_war}, payload = ${JSON.stringify(metadata)}::jsonb, updated_at = ${now} WHERE id = 1`.execute(trx);
      if (!await this.#fenced(trx, lease)) throw new Error('War poll lease expired before commit');
      return true;
    });
  }
  async subscription(guildId: GuildId): Promise<Subscription> {
    return withTenant(this.db, guildId, async trx => subscription((await sql<SubRow>`SELECT * FROM warlog_subscriptions WHERE guild_id = ${guildId}`.execute(trx)).rows[0]));
  }
  async configure(guildId: GuildId, actor: UserId, change: SettingsChange, now: Date): Promise<SettingsResult> {
    return withTenant(this.db, guildId, async trx => {
      const state = (await sql<StateRow>`SELECT * FROM warlog_state WHERE id = 1 FOR UPDATE`.execute(trx)).rows[0]!;
      const guild = (await sql<{ inactive_since: Date | null }>`SELECT inactive_since FROM guild_registry WHERE guild_id = ${guildId} FOR KEY SHARE`.execute(trx)).rows[0];
      if (!guild || guild.inactive_since !== null) return 'suspended';
      await sql`INSERT INTO warlog_subscriptions(guild_id) VALUES(${guildId}) ON CONFLICT DO NOTHING`.execute(trx);
      const row = (await sql<SubRow>`SELECT * FROM warlog_subscriptions WHERE guild_id = ${guildId} FOR UPDATE`.execute(trx)).rows[0]!;
      const before = subscription(row);
      const next = { ...row, zones: [...row.zones] };
      if (change.kind === 'perspective') {
        if (!['NONE', 'WARDENS', 'COLONIALS'].includes(change.perspective)) return 'invalid';
        next.perspective = change.perspective;
      }
      if (change.kind === 'channel') { next.channel_id = change.channelId; next.locale = change.locale; }
      if (change.kind === 'zones') { if (change.zones.length && !validWarZones(change.zones)) return 'invalid'; next.zones = [...change.zones]; if (!next.zones.length) next.paused = true; }
      if (change.kind === 'disable') next.paused = true;
      if (change.kind === 'enable') {
        if (!state.available || !state.payload || !isActiveWar(state.payload.war)) return 'not_ready';
        if (change.war !== state.payload.war.number) return 'stale_war';
        if (!next.channel_id || !validWarZones(next.zones)) return 'invalid';
        next.paused = false; next.confirmed_war = change.war;
      }
      if (JSON.stringify(subscription(next)) === JSON.stringify(before) && !row.failure_reason) return 'unchanged';
      await sql`UPDATE warlog_subscriptions SET channel_id = ${next.channel_id}, zones = ${JSON.stringify(next.zones)}::jsonb,
        perspective = ${next.perspective}, locale = ${next.locale}, paused = ${next.paused}, confirmed_war = ${next.confirmed_war}, enabled_at = ${now}, revision = revision + 1, failure_reason = NULL WHERE guild_id = ${guildId}`.execute(trx);
      await sql`DELETE FROM warlog_deliveries WHERE guild_id = ${guildId}`.execute(trx);
      await this.#schedule(trx, guildId);
      await sql`UPDATE guild_settings SET features = jsonb_set(features, '{warlog}', ${JSON.stringify(!next.paused)}::jsonb) WHERE guild_id = ${guildId}`.execute(trx);
      await sql`INSERT INTO guild_audit_log(guild_id, actor_id, action, before, after)
        VALUES(${guildId}, ${actor}, ${`settings.warlog.${change.kind}`}, ${JSON.stringify(before)}::jsonb, ${JSON.stringify(subscription(next))}::jsonb)`.execute(trx);
      return 'saved';
    });
  }
  async claim(guildId: GuildId, now: Date): Promise<Delivery | null> {
    return withTenant(this.db, guildId, async trx => {
      // Never hold a pool connection during REST calls; one claim per guild preserves channel order.
      const result = await sql<DeliveryRow>`UPDATE warlog_deliveries d SET claimed_until = ${new Date(now.getTime() + 60_000)}
        WHERE d.id = (SELECT q.id FROM warlog_deliveries q JOIN warlog_subscriptions s USING(guild_id)
          JOIN warlog_state w ON w.id = 1 JOIN guild_settings g USING(guild_id) JOIN guild_registry r USING(guild_id)
          WHERE q.guild_id = ${guildId} AND w.available AND r.inactive_since IS NULL AND q.completed_at IS NULL
            AND q.generation = w.generation AND q.revision = s.revision AND q.channel_id = s.channel_id
            AND q.war_number = (w.payload->'war'->>'number')::integer
            AND (q.notice OR (NOT s.paused AND s.confirmed_war = q.war_number AND (g.features->>'warlog')::boolean))
            AND NOT EXISTS (SELECT 1 FROM warlog_deliveries earlier WHERE earlier.guild_id = q.guild_id AND earlier.completed_at IS NULL AND earlier.id < q.id AND earlier.generation = w.generation)
            AND q.next_attempt_at <= ${now} AND (q.claimed_until IS NULL OR q.claimed_until <= ${now})
          ORDER BY q.id LIMIT 1 FOR UPDATE OF q SKIP LOCKED)
        RETURNING d.*, (SELECT perspective FROM warlog_subscriptions WHERE guild_id = ${guildId}) AS perspective`.execute(trx);
      const row = result.rows[0];
      await this.#schedule(trx, guildId);
      return row ? { id: row.id, guildId, perspective: row.perspective, channelId: ChannelId.assert(row.channel_id), event: row.payload, locale: row.locale, generation: row.generation, revision: row.revision, attempts: row.attempts } : null;
    });
  }
  async valid(delivery: Delivery): Promise<boolean> {
    return withTenant(this.db, delivery.guildId, async trx => Boolean((await sql`SELECT 1 FROM warlog_deliveries d
      JOIN warlog_subscriptions s USING(guild_id) JOIN warlog_state w ON w.id = 1 JOIN guild_registry r USING(guild_id) JOIN guild_settings g USING(guild_id)
      WHERE d.id = ${delivery.id}::bigint AND d.completed_at IS NULL AND w.available AND r.inactive_since IS NULL
        AND d.generation = w.generation AND d.revision = s.revision AND d.channel_id = s.channel_id
        AND d.war_number = (w.payload->'war'->>'number')::integer
        AND (d.notice OR (NOT s.paused AND s.confirmed_war = d.war_number AND (g.features->>'warlog')::boolean))`.execute(trx)).rows.length));
  }
  async finish(delivery: Delivery, outcome: Parameters<WarStore['finish']>[1], now: Date): Promise<void> {
    await withTenant(this.db, delivery.guildId, async trx => {
      if (outcome.kind === 'sent') await sql`UPDATE warlog_deliveries SET completed_at = ${now}, message_id = ${outcome.messageId}, claimed_until = NULL WHERE id = ${delivery.id}::bigint`.execute(trx);
      else if (outcome.kind === 'retry') await sql`UPDATE warlog_deliveries SET claimed_until = NULL, attempts = attempts + 1,
        next_attempt_at = ${new Date(now.getTime() + Math.min(300_000, 1000 * 2 ** Math.min(delivery.attempts, 8)))}, last_error = ${outcome.reason} WHERE id = ${delivery.id}::bigint`.execute(trx);
      else {
        const changed = await sql`UPDATE warlog_subscriptions SET paused = true, revision = revision + 1, failure_reason = ${outcome.reason}
          WHERE guild_id = ${delivery.guildId} AND revision = ${delivery.revision} AND channel_id = ${delivery.channelId} RETURNING guild_id`.execute(trx);
        if (changed.rows.length) {
          await sql`INSERT INTO guild_audit_log(guild_id, actor_id, action, before, after)
            VALUES(${delivery.guildId}, 'system', 'settings.warlog.blocked', NULL, ${JSON.stringify({ paused: true, channelId: delivery.channelId, reason: outcome.reason })}::jsonb)`.execute(trx);
          await sql`DELETE FROM warlog_deliveries WHERE guild_id = ${delivery.guildId}`.execute(trx);
          await sql`UPDATE guild_settings SET features = jsonb_set(features, '{warlog}', 'false') WHERE guild_id = ${delivery.guildId}`.execute(trx);
        }
      }
      await this.#schedule(trx, delivery.guildId);
    });
  }
  async channelChanged(guildId: GuildId, channelId: ChannelId): Promise<void> {
    await withTenant(this.db, guildId, async trx => {
      const result = await sql`UPDATE warlog_subscriptions SET paused = true, revision = revision + 1, failure_reason = 'unsupported_channel' WHERE guild_id = ${guildId} AND channel_id = ${channelId}
        AND failure_reason IS DISTINCT FROM 'unsupported_channel' RETURNING guild_id`.execute(trx);
      if (result.rows.length) {
        await sql`INSERT INTO guild_audit_log(guild_id, actor_id, action, after)
          VALUES(${guildId}, 'system', 'settings.warlog.blocked', ${JSON.stringify({ paused: true, channelId, reason: 'unsupported_channel' })}::jsonb)`.execute(trx);
        await sql`DELETE FROM warlog_deliveries WHERE guild_id = ${guildId}`.execute(trx);
        await sql`UPDATE guild_settings SET features = jsonb_set(features, '{warlog}', 'false') WHERE guild_id = ${guildId}`.execute(trx);
        await this.#schedule(trx, guildId);
      }
    });
  }
  async runHook(guildId: GuildId, reset: (war: number, startedAt: Date) => Promise<void>, now: Date): Promise<void> {
    const job = await withTenant(this.db, guildId, async trx => (await sql<{ war_number: number; started_at: Date }>`SELECT j.war_number, j.started_at FROM warlog_hook_jobs j
      JOIN warlog_state w ON w.id = 1 JOIN guild_registry r USING(guild_id)
      WHERE j.guild_id = ${guildId} AND r.inactive_since IS NULL AND w.available AND j.completed_at IS NULL
        AND j.war_number = (w.payload->'war'->>'number')::integer ORDER BY j.war_number LIMIT 1`.execute(trx)).rows[0]);
    if (!job) { await sql`UPDATE warlog_schedule SET hook_pending = false WHERE guild_id = ${guildId}`.execute(this.db); return; }
    await reset(job.war_number, job.started_at);
    await withTenant(this.db, guildId, async trx => { await sql`UPDATE warlog_hook_jobs SET completed_at = ${now} WHERE guild_id = ${guildId} AND war_number = ${job.war_number}`.execute(trx); });
    await sql`UPDATE warlog_schedule SET hook_pending = false WHERE guild_id = ${guildId}`.execute(this.db);
  }
}
