import { randomBytes } from 'node:crypto';
import { sql, withTenant, type Db, type Tx } from '@picket/persistence';
import { GuildId, type Clock, type Logger } from '@picket/kernel';
import type { GatewayDelivery, GatewayEvent } from '@picket/discord';
import type { Lease } from '@picket/coordination';
import type {
  VoiceDiscord,
  VoiceIdentity,
  VoiceRuntime,
} from '../application/ports';
import {
  DEFAULT_DEPLOY_LIMIT,
  MAX_CHANNELS,
  MAX_DEPLOY_LIMIT,
  MAX_TEMPLATES,
  SESSION_MS,
  VoiceError,
  integer,
  queueSize,
  validateTemplate,
  type TemplateInput,
  type VoiceChannel,
  type VoiceDraft,
  type VoiceSession,
  type VoiceTemplate,
} from '../domain/model';
const key = () => randomBytes(8).toString('hex');
interface TemplateRow {
  id: string;
  name: string;
  category_id: string;
  channel_name: string;
  capacity: number;
  idle_minutes: number;
  revision: number;
}
interface ChannelRow {
  id: string;
  guild_id: string;
  batch_id: string;
  template_id: string;
  template_revision: number;
  category_id: string;
  name: string;
  capacity: number;
  idle_minutes: number;
  channel_id: string | null;
  status: VoiceChannel['status'];
  attempted_at: Date | null;
  empty_since: Date | null;
  delete_after: Date | null;
  last_verified_at: Date | null;
  retry_at: Date;
  needs_check: boolean;
}
const template = (r: TemplateRow): VoiceTemplate => ({
  id: r.id,
  name: r.name,
  categoryId: r.category_id,
  channelName: r.channel_name,
  capacity: r.capacity,
  idleMinutes: r.idle_minutes,
  revision: r.revision,
});
export class PostgresVoice implements VoiceRuntime {
  private freshShards = new Set<number>();
  constructor(
    private readonly db: Db,
    private readonly discord: VoiceDiscord,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}
  private async lock(tx: Tx, guildId: GuildId) {
    await sql`INSERT INTO voice_settings(guild_id) VALUES(${guildId}) ON CONFLICT DO NOTHING`.execute(
      tx,
    );
    await sql`SELECT guild_id FROM voice_settings WHERE guild_id=${guildId} FOR UPDATE`.execute(
      tx,
    );
  }
  private async enabled(tx: Tx, guildId: GuildId) {
    const r = await sql<{
      ok: boolean;
    }>`SELECT COALESCE((s.features->>'voice')::boolean,true) AND g.inactive_since IS NULL AS ok FROM guild_settings s JOIN guild_registry g USING(guild_id) WHERE s.guild_id=${guildId}`.execute(
      tx,
    );
    if (!r.rows[0]?.ok) throw new VoiceError('disabled');
  }
  async templates(
    identity: VoiceIdentity,
    all = false,
    fresh = false,
  ): Promise<VoiceTemplate[]> {
    const rows = await withTenant(
      this.db,
      identity.guildId,
      async (tx) =>
        (
          await sql<TemplateRow>`SELECT * FROM voice_templates WHERE guild_id=${identity.guildId} ORDER BY name,id`.execute(
            tx,
          )
        ).rows,
    );
    if (all) return rows.map(template);
    const result: VoiceTemplate[] = [];
    const checked = new Map<string, boolean>();
    for (const row of rows) {
      let allowed = checked.get(row.category_id);
      if (allowed === undefined) {
        try {
          await this.discord.category(
            identity.guildId,
            row.category_id,
            identity,
            fresh,
          );
          allowed = true;
        } catch (e) {
          if (!(e instanceof VoiceError) || e.reason !== 'access') throw e;
          allowed = false;
        }
        checked.set(row.category_id, allowed);
      }
      if (allowed) result.push(template(row));
    }
    return result;
  }
  async saveTemplate(
    identity: VoiceIdentity,
    input: TemplateInput,
    id?: string,
    revision?: number,
  ): Promise<void> {
    const value = validateTemplate(input);
    await this.discord.category(
      identity.guildId,
      value.categoryId,
      undefined,
      true,
    );
    await withTenant(this.db, identity.guildId, async (tx) => {
      await this.lock(tx, identity.guildId);
      await this.enabled(tx, identity.guildId);
      if (!id) {
        const n = (
          await sql<{
            n: number;
          }>`SELECT count(*)::int n FROM voice_templates WHERE guild_id=${identity.guildId}`.execute(
            tx,
          )
        ).rows[0]!.n;
        if (n >= MAX_TEMPLATES) throw new VoiceError('limit');
      }
      try {
        if (id) {
          const r =
            await sql`UPDATE voice_templates SET name=${value.name},category_id=${value.categoryId},channel_name=${value.channelName},capacity=${value.capacity},idle_minutes=${value.idleMinutes},revision=revision+1 WHERE guild_id=${identity.guildId} AND id=${id} AND revision=${revision ?? 0} RETURNING id`.execute(
              tx,
            );
          if (!r.rows.length) throw new VoiceError('changed');
        } else
          await sql`INSERT INTO voice_templates(id,guild_id,name,category_id,channel_name,capacity,idle_minutes) VALUES(${key()},${identity.guildId},${value.name},${value.categoryId},${value.channelName},${value.capacity},${value.idleMinutes})`.execute(
            tx,
          );
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          throw new VoiceError('invalid');
        throw e;
      }
    });
  }
  async removeTemplate(
    identity: VoiceIdentity,
    id: string,
    revision: number,
  ): Promise<void> {
    await withTenant(this.db, identity.guildId, async (tx) => {
      await this.lock(tx, identity.guildId);
      const r =
        await sql`DELETE FROM voice_templates WHERE guild_id=${identity.guildId} AND id=${id} AND revision=${revision} RETURNING id`.execute(
          tx,
        );
      if (!r.rows.length) throw new VoiceError('changed');
    });
  }
  async limit(guildId: GuildId, value?: number): Promise<number> {
    if (value !== undefined) integer(String(value), 1, MAX_DEPLOY_LIMIT);
    return withTenant(this.db, guildId, async (tx) => {
      await this.lock(tx, guildId);
      if (value !== undefined)
        await sql`UPDATE voice_settings SET deployment_limit=${value} WHERE guild_id=${guildId}`.execute(
          tx,
        );
      return (
        (
          await sql<{
            deployment_limit: number;
          }>`SELECT deployment_limit FROM voice_settings WHERE guild_id=${guildId}`.execute(
            tx,
          )
        ).rows[0]?.deployment_limit ?? DEFAULT_DEPLOY_LIMIT
      );
    });
  }
  async session(
    identity: VoiceIdentity,
    mode: VoiceDraft['mode'],
  ): Promise<VoiceSession> {
    const id = key();
    const state: VoiceDraft = {
      mode,
      selected: null,
      quantity: 1,
      queue: {},
      batchId: null,
    };
    await withTenant(this.db, identity.guildId, async (tx) => {
      await sql`DELETE FROM voice_sessions WHERE guild_id=${identity.guildId} AND expires_at<=${this.clock.now()}`.execute(
        tx,
      );
      await sql`INSERT INTO voice_sessions(id,guild_id,user_id,state,expires_at) VALUES(${id},${identity.guildId},${identity.userId},${JSON.stringify(state)}::jsonb,${new Date(this.clock.now().getTime() + SESSION_MS)})`.execute(
        tx,
      );
    });
    return { id, revision: 0, state };
  }
  async readSession(
    identity: VoiceIdentity,
    id: string,
  ): Promise<VoiceSession> {
    return withTenant(this.db, identity.guildId, async (tx) => {
      const row = (
        await sql<VoiceSession>`SELECT id,revision,state FROM voice_sessions WHERE id=${id} AND guild_id=${identity.guildId} AND user_id=${identity.userId} AND expires_at>${this.clock.now()}`.execute(
          tx,
        )
      ).rows[0];
      if (!row) throw new VoiceError('expired');
      return row;
    });
  }
  async updateSession(
    identity: VoiceIdentity,
    id: string,
    revision: number,
    state: VoiceDraft,
  ): Promise<VoiceSession> {
    return withTenant(this.db, identity.guildId, async (tx) => {
      const row = (
        await sql<VoiceSession>`UPDATE voice_sessions SET state=${JSON.stringify(state)}::jsonb,revision=revision+1,expires_at=${new Date(this.clock.now().getTime() + SESSION_MS)} WHERE id=${id} AND guild_id=${identity.guildId} AND user_id=${identity.userId} AND revision=${revision} AND expires_at>${this.clock.now()} RETURNING id,revision,state`.execute(
          tx,
        )
      ).rows[0];
      if (!row) throw new VoiceError('expired');
      return row;
    });
  }
  async deploy(
    identity: VoiceIdentity,
    session: VoiceSession,
  ): Promise<VoiceSession> {
    const current = await this.readSession(identity, session.id);
    if (
      current.revision !== session.revision ||
      current.state.mode !== 'member' ||
      current.state.batchId
    )
      throw new VoiceError('expired');
    const models = await this.templates(identity, false, true);
    const total = queueSize(current.state.queue);
    if (!Number.isInteger(total) || total < 1 || total > MAX_DEPLOY_LIMIT)
      throw new VoiceError('limit');
    for (const [id, q] of Object.entries(current.state.queue)) {
      integer(String(q.quantity), 1, MAX_DEPLOY_LIMIT);
      const m = models.find((x) => x.id === id);
      if (!m) throw new VoiceError('access');
      if (m.revision !== q.revision) throw new VoiceError('changed');
    }
    return withTenant(this.db, identity.guildId, async (tx) => {
      await this.lock(tx, identity.guildId);
      await this.enabled(tx, identity.guildId);
      if (!(await this.live(tx, identity.guildId)))
        throw new VoiceError('unavailable');
      const draft = (
        await sql<{
          revision: number;
        }>`SELECT revision FROM voice_sessions WHERE id=${session.id} AND user_id=${identity.userId} AND guild_id=${identity.guildId} AND expires_at>${this.clock.now()} FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      if (draft?.revision !== session.revision) throw new VoiceError('expired');
      const limit = (
        await sql<{
          deployment_limit: number;
        }>`SELECT deployment_limit FROM voice_settings WHERE guild_id=${identity.guildId}`.execute(
          tx,
        )
      ).rows[0]!.deployment_limit;
      if (total > limit) throw new VoiceError('limit');
      const count = (
        await sql<{
          n: number;
        }>`SELECT count(*)::int n FROM voice_channels WHERE guild_id=${identity.guildId} AND status NOT IN ('deleted','failed')`.execute(
          tx,
        )
      ).rows[0]!.n;
      if (count + total > MAX_CHANNELS) throw new VoiceError('full');
      const batchId = key();
      for (const [id, q] of Object.entries(current.state.queue)) {
        const row = (
          await sql<TemplateRow>`SELECT * FROM voice_templates WHERE guild_id=${identity.guildId} AND id=${id}`.execute(
            tx,
          )
        ).rows[0];
        if (!row || row.revision !== q.revision)
          throw new VoiceError('changed');
        const used = new Set(
          (
            await sql<{
              name: string;
            }>`SELECT name FROM voice_channels WHERE guild_id=${identity.guildId}`.execute(
              tx,
            )
          ).rows.map((r) => r.name),
        );
        for (let i = 0; i < q.quantity; i++) {
          let n = 1;
          while (
            used.has(`${row.channel_name} · ${String(n).padStart(2, '0')}`)
          )
            n++;
          const name = `${row.channel_name} · ${String(n).padStart(2, '0')}`;
          used.add(name);
          await sql`INSERT INTO voice_channels(id,guild_id,batch_id,template_id,template_revision,category_id,name,capacity,idle_minutes,created_at,retry_at) VALUES(${key()},${identity.guildId},${batchId},${row.id},${row.revision},${row.category_id},${name},${row.capacity},${row.idle_minutes},${this.clock.now()},${this.clock.now()})`.execute(
            tx,
          );
        }
      }
      const state = { ...current.state, batchId };
      const row = (
        await sql<VoiceSession>`UPDATE voice_sessions SET state=${JSON.stringify(state)}::jsonb,revision=revision+1 WHERE id=${session.id} AND guild_id=${identity.guildId} RETURNING id,revision,state`.execute(
          tx,
        )
      ).rows[0]!;
      return row;
    });
  }
  async channels(guildId: GuildId, batchId?: string): Promise<VoiceChannel[]> {
    return withTenant(this.db, guildId, async (tx) => {
      const rows = (
        await sql<
          ChannelRow & { occupants: number }
        >`SELECT c.*,(SELECT count(*)::int FROM voice_presence p WHERE p.guild_id=c.guild_id AND p.channel_id=c.channel_id) occupants FROM voice_channels c WHERE c.guild_id=${guildId} AND (${batchId ?? null}::text IS NULL OR c.batch_id=${batchId ?? null}) AND (${batchId ?? null}::text IS NOT NULL OR c.status NOT IN ('deleted','failed')) ORDER BY c.created_at,c.id`.execute(
          tx,
        )
      ).rows;
      return rows.map((r) => ({
        id: r.id,
        channelId: r.channel_id,
        name: r.name,
        status: r.status,
        occupants: r.occupants,
        deleteAfter: r.delete_after,
        lastVerifiedAt: r.last_verified_at,
      }));
    });
  }
  private async live(tx: Tx, guildId: GuildId): Promise<boolean> {
    return (
      (
        await sql`SELECT 1 FROM voice_runtime r JOIN leases l ON l.name=r.lease_name AND l.token=r.lease_token WHERE r.guild_id=${guildId} AND r.ready AND l.expires_at>now()`.execute(
          tx,
        )
      ).rows.length > 0
    );
  }
  private async occupancy(tx: Tx, guildId: GuildId, reset = false) {
    const now = this.clock.now();
    await sql`UPDATE voice_channels c SET empty_since=NULL,delete_after=NULL,last_verified_at=${now} WHERE c.guild_id=${guildId} AND c.status='active' AND EXISTS(SELECT 1 FROM voice_presence p WHERE p.guild_id=c.guild_id AND p.channel_id=c.channel_id)`.execute(
      tx,
    );
    await sql`UPDATE voice_channels c SET empty_since=CASE WHEN ${reset} THEN ${now} ELSE COALESCE(empty_since,${now}) END,delete_after=CASE WHEN ${reset} THEN ${now}::timestamptz+idle_minutes*interval '1 minute' ELSE COALESCE(delete_after,${now}::timestamptz+idle_minutes*interval '1 minute') END,last_verified_at=${now} WHERE c.guild_id=${guildId} AND c.status='active' AND NOT EXISTS(SELECT 1 FROM voice_presence p WHERE p.guild_id=c.guild_id AND p.channel_id=c.channel_id)`.execute(
      tx,
    );
  }
  async removeChannel(
    guildId: GuildId,
    id: string,
    expectedDeadline?: Date,
  ): Promise<void> {
    // Verify current ownership and occupancy without holding a data transaction across REST.
    const job = await withTenant(this.db, guildId, async (tx) => {
      await this.lock(tx, guildId);
      if (!(await this.live(tx, guildId))) throw new VoiceError('unavailable');
      const row = (
        await sql<ChannelRow>`SELECT * FROM voice_channels WHERE guild_id=${guildId} AND id=${id} AND status='active' FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      if (!row?.channel_id) throw new VoiceError('changed');
      if (
        expectedDeadline &&
        (!row.delete_after ||
          row.delete_after.getTime() !== expectedDeadline.getTime() ||
          row.delete_after > this.clock.now())
      )
        throw new VoiceError('changed');
      const n = (
        await sql`SELECT 1 FROM voice_presence WHERE guild_id=${guildId} AND channel_id=${row.channel_id} LIMIT 1`.execute(
          tx,
        )
      ).rows.length;
      if (n) throw new VoiceError('occupied');
      return row;
    });
    if (!(await this.discord.exists(guildId, job.channel_id!))) {
      await this.deleted(guildId, id);
      return;
    }
    // Recheck after the REST read; new arrivals cancel this operation.
    await withTenant(this.db, guildId, async (tx) => {
      if (expectedDeadline) {
        const current = (
          await sql<{
            delete_after: Date | null;
          }>`SELECT delete_after FROM voice_channels WHERE guild_id=${guildId} AND id=${id} AND status='active'`.execute(
            tx,
          )
        ).rows[0];
        if (
          !current?.delete_after ||
          current.delete_after.getTime() !== expectedDeadline.getTime() ||
          current.delete_after > this.clock.now()
        )
          throw new VoiceError('changed');
      }
      if (!(await this.live(tx, guildId))) throw new VoiceError('unavailable');
      if (
        (
          await sql`SELECT 1 FROM voice_presence WHERE guild_id=${guildId} AND channel_id=${job.channel_id} LIMIT 1`.execute(
            tx,
          )
        ).rows.length
      )
        throw new VoiceError('occupied');
    });
    await this.discord.remove(job.channel_id!);
    await this.deleted(guildId, id);
  }
  private async deleted(guildId: GuildId, id: string) {
    await withTenant(this.db, guildId, async (tx) => {
      await sql`DELETE FROM voice_presence WHERE guild_id=${guildId} AND channel_id IN(SELECT channel_id FROM voice_channels WHERE guild_id=${guildId} AND id=${id})`.execute(
        tx,
      );
      await sql`UPDATE voice_channels SET status='deleted',completed_at=${this.clock.now()},delete_after=NULL,last_verified_at=${this.clock.now()} WHERE guild_id=${guildId} AND id=${id}`.execute(
        tx,
      );
    });
  }
  async resolveChannel(guildId: GuildId, id: string): Promise<void> {
    await withTenant(this.db, guildId, async (tx) => {
      await this.lock(tx, guildId);
      const result =
        await sql`UPDATE voice_channels SET status='deleted',completed_at=${this.clock.now()},delete_after=NULL WHERE guild_id=${guildId} AND id=${id} AND status='uncertain' AND channel_id IS NULL RETURNING id`.execute(
          tx,
        );
      if (!result.rows.length) throw new VoiceError('changed');
    });
  }
  async tick(): Promise<void> {
    await sql`SELECT picket_voice_gc(${this.clock.now()})`.execute(this.db);
    const guilds = (
      await sql<{
        guild_id: string;
      }>`SELECT * FROM picket_voice_work(${this.clock.now()})`.execute(this.db)
    ).rows;
    for (const r of guilds) {
      const guildId = GuildId.assert(r.guild_id);
      try {
        await this.work(guildId);
      } catch (error) {
        this.logger.warn({ err: error }, 'voice maintenance deferred');
        await withTenant(this.db, guildId, async (tx) => {
          await sql`UPDATE voice_channels SET retry_at=${new Date(this.clock.now().getTime() + 60_000)} WHERE guild_id=${guildId} AND status IN ('pending','creating','active')`.execute(
            tx,
          );
        });
      }
    }
  }
  private async work(guildId: GuildId) {
    // Global worker is lease-owned by the existing job runner. Claim each POST durably before dispatch.
    const jobs = await withTenant(this.db, guildId, async (tx) => {
      await this.lock(tx, guildId);
      await sql`UPDATE voice_channels SET status='uncertain' WHERE guild_id=${guildId} AND status='creating' AND attempted_at<${new Date(this.clock.now().getTime() - 120_000)}`.execute(
        tx,
      );
      await sql`UPDATE voice_channels SET status='failed',completed_at=${this.clock.now()} WHERE guild_id=${guildId} AND status='pending' AND EXISTS(SELECT 1 FROM guild_settings WHERE guild_id=${guildId} AND NOT COALESCE((features->>'voice')::boolean,true))`.execute(
        tx,
      );
      return (
        await sql<ChannelRow>`SELECT * FROM voice_channels WHERE guild_id=${guildId} AND status='pending' ORDER BY created_at,id LIMIT 2`.execute(
          tx,
        )
      ).rows;
    });
    for (const job of jobs) {
      try {
        await this.discord.category(guildId, job.category_id, undefined, true);
      } catch (error) {
        if (error instanceof VoiceError && error.reason === 'access') {
          await withTenant(this.db, guildId, async (tx) => {
            await sql`UPDATE voice_channels SET status='failed',completed_at=${this.clock.now()} WHERE guild_id=${guildId} AND id=${job.id} AND status='pending'`.execute(
              tx,
            );
          });
          continue;
        }
        throw error;
      }
      const claimed = await withTenant(this.db, guildId, async (tx) => {
        await this.lock(tx, guildId);
        await this.enabled(tx, guildId);
        if (!(await this.live(tx, guildId))) return false;
        return (
          (
            await sql`UPDATE voice_channels SET status='creating',attempted_at=${this.clock.now()} WHERE guild_id=${guildId} AND id=${job.id} AND status='pending' RETURNING id`.execute(
              tx,
            )
          ).rows.length > 0
        );
      });
      if (!claimed) continue;
      try {
        const channelId = await this.discord.create(
          guildId,
          {
            name: job.name,
            categoryId: job.category_id,
            channelName: job.name,
            capacity: job.capacity,
            idleMinutes: job.idle_minutes,
          },
          job.name,
        );
        await withTenant(this.db, guildId, async (tx) => {
          await this.lock(tx, guildId);
          await sql`UPDATE voice_channels SET channel_id=${channelId},status='active',retry_at=${this.clock.now()} WHERE guild_id=${guildId} AND id=${job.id} AND status IN ('creating','uncertain') AND channel_id IS NULL`.execute(
            tx,
          );
          if (await this.live(tx, guildId)) await this.occupancy(tx, guildId);
        });
      } catch (error) {
        const status = (error as { status?: number }).status;
        await withTenant(this.db, guildId, async (tx) => {
          await sql`UPDATE voice_channels SET status=${status && status >= 400 && status < 500 ? 'failed' : 'uncertain'},completed_at=${status && status >= 400 && status < 500 ? this.clock.now() : null} WHERE guild_id=${guildId} AND id=${job.id} AND status='creating'`.execute(
            tx,
          );
        });
      }
    }
    const active = await withTenant(
      this.db,
      guildId,
      async (tx) =>
        (
          await sql<ChannelRow>`SELECT * FROM voice_channels WHERE guild_id=${guildId} AND status='active' AND retry_at<=${this.clock.now()} AND (needs_check OR delete_after<=${this.clock.now()}) ORDER BY retry_at,id LIMIT 2`.execute(
            tx,
          )
        ).rows,
    );
    for (const job of active) {
      if (!job.channel_id) continue;
      if (!(await this.discord.exists(guildId, job.channel_id))) {
        await this.deleted(guildId, job.id);
        continue;
      }
      if (!(await withTenant(this.db, guildId, (tx) => this.live(tx, guildId))))
        continue;
      if (job.needs_check)
        await withTenant(this.db, guildId, async (tx) => {
          await sql`UPDATE voice_channels SET needs_check=false,last_verified_at=${this.clock.now()} WHERE guild_id=${guildId} AND id=${job.id}`.execute(
            tx,
          );
        });
      else if (job.delete_after && job.delete_after <= this.clock.now())
        await this.removeChannel(guildId, job.id, job.delete_after);
    }
    await withTenant(this.db, guildId, async (tx) => {
      await sql`DELETE FROM voice_sessions WHERE guild_id=${guildId} AND expires_at<=${this.clock.now()}`.execute(
        tx,
      );
      await sql`DELETE FROM voice_channels WHERE guild_id=${guildId} AND status IN ('deleted','failed') AND completed_at<${new Date(this.clock.now().getTime() - 86400_000)}`.execute(
        tx,
      );
      await sql`DELETE FROM voice_presence WHERE guild_id=${guildId} AND NOT EXISTS(SELECT 1 FROM voice_channels WHERE guild_id=${guildId} AND status IN ('pending','creating','active','uncertain'))`.execute(
        tx,
      );
    });
  }
  async handle(event: GatewayEvent, delivery?: GatewayDelivery): Promise<void> {
    if (!delivery) return;
    if (event.type === 'ready') {
      this.freshShards.add(event.shardId);
      return;
    }
    if (!('guildId' in event)) return;
    const guildId = event.guildId;
    if (
      ![
        'guild_available',
        'voice_state',
        'channel_unusable',
        'guild_voice_unavailable',
        'guild_removed',
      ].includes(event.type)
    )
      return;
    await withTenant(this.db, guildId, async (tx) => {
      if (
        !(
          await sql`SELECT 1 FROM leases WHERE name=${delivery.lease.name} AND holder=${delivery.lease.holder} AND token=${delivery.lease.token.toString()}::bigint AND expires_at>now()`.execute(
            tx,
          )
        ).rows.length
      )
        return;
      if (
        event.type === 'guild_removed' ||
        event.type === 'guild_voice_unavailable'
      ) {
        await sql`UPDATE voice_runtime SET ready=false WHERE guild_id=${guildId}`.execute(
          tx,
        );
        return;
      }
      if (event.type === 'channel_unusable') {
        if (event.deleted) {
          const row = (
            await sql<{
              id: string;
            }>`UPDATE voice_channels SET status='deleted',completed_at=${this.clock.now()},delete_after=NULL WHERE guild_id=${guildId} AND channel_id=${event.channelId} RETURNING id`.execute(
              tx,
            )
          ).rows[0];
          if (row)
            await sql`DELETE FROM voice_presence WHERE guild_id=${guildId} AND channel_id=${event.channelId}`.execute(
              tx,
            );
        }
        return;
      }
      // Keep only current operational presence for guilds with managed work; no names, roles or history.
      if (
        !(
          await sql`SELECT 1 FROM voice_channels WHERE guild_id=${guildId} AND status IN ('pending','creating','active','uncertain') LIMIT 1`.execute(
            tx,
          )
        ).rows.length
      ) {
        if (event.type === 'guild_available')
          await sql`INSERT INTO voice_runtime(guild_id,lease_name,lease_token,ready) VALUES(${guildId},${delivery.lease.name},${delivery.lease.token.toString()}::bigint,${!!event.voiceSnapshot}) ON CONFLICT(guild_id) DO UPDATE SET lease_name=EXCLUDED.lease_name,lease_token=EXCLUDED.lease_token,ready=EXCLUDED.ready`.execute(
            tx,
          );
        return;
      }
      if (event.type === 'voice_state') {
        const current = (
          await sql<{
            previous: string | null;
            tracked: boolean;
            creating: boolean;
          }>`SELECT
          (SELECT channel_id FROM voice_presence WHERE guild_id=${guildId} AND user_id=${event.person.userId}) AS previous,
          EXISTS(SELECT 1 FROM voice_channels WHERE guild_id=${guildId} AND channel_id=${event.person.channelId} AND status='active') AS tracked,
          EXISTS(SELECT 1 FROM voice_channels WHERE guild_id=${guildId} AND status='creating') AS creating`.execute(
            tx,
          )
        ).rows[0]!;
        // No writes or per-guild lock for mute changes and unrelated voice activity.
        if (
          current.previous === event.person.channelId ||
          (!current.previous && !current.tracked && !current.creating)
        )
          return;
      }
      await this.lock(tx, guildId);
      if (event.type === 'guild_available' && event.voiceSnapshot) {
        await sql`DELETE FROM voice_presence WHERE guild_id=${guildId}`.execute(
          tx,
        );
        for (const p of event.voiceSnapshot.people)
          if (p.channelId)
            await sql`INSERT INTO voice_presence(guild_id,user_id,channel_id) SELECT ${guildId},${p.userId},${p.channelId} WHERE EXISTS(SELECT 1 FROM voice_channels WHERE guild_id=${guildId} AND channel_id=${p.channelId} AND status='active') ON CONFLICT(guild_id,user_id) DO UPDATE SET channel_id=EXCLUDED.channel_id`.execute(
              tx,
            );
        await sql`INSERT INTO voice_runtime(guild_id,lease_name,lease_token,ready) VALUES(${guildId},${delivery.lease.name},${delivery.lease.token.toString()}::bigint,true) ON CONFLICT(guild_id) DO UPDATE SET lease_name=EXCLUDED.lease_name,lease_token=EXCLUDED.lease_token,ready=true`.execute(
          tx,
        );
        await this.occupancy(tx, guildId, true);
      }
      if (event.type === 'voice_state') {
        await sql`DELETE FROM voice_presence WHERE guild_id=${guildId} AND user_id=${event.person.userId} AND channel_id IS DISTINCT FROM ${event.person.channelId}`.execute(
          tx,
        );
        if (event.person.channelId)
          await sql`INSERT INTO voice_presence(guild_id,user_id,channel_id) SELECT ${guildId},${event.person.userId},${event.person.channelId} WHERE EXISTS(SELECT 1 FROM voice_channels WHERE guild_id=${guildId} AND (channel_id=${event.person.channelId} AND status='active' OR status='creating')) ON CONFLICT(guild_id,user_id) DO UPDATE SET channel_id=EXCLUDED.channel_id`.execute(
            tx,
          );
        // Ignore mute/deafen updates: unchanged occupants do not extend an empty deadline.
        if (await this.live(tx, guildId)) await this.occupancy(tx, guildId);
      }
    });
  }
  async connectionChanged(
    _shardId: number,
    connected: boolean,
    lease: Lease,
  ): Promise<void> {
    if (!connected) this.freshShards.delete(_shardId);
    const guilds = (
      await sql<{
        guild_id: string;
      }>`SELECT * FROM picket_voice_shard_guilds(${lease.name})`.execute(
        this.db,
      )
    ).rows;
    // Discovery uses the global registry, then all writes are tenant-scoped and fenced.
    for (const row of guilds) {
      const guildId = GuildId.assert(row.guild_id);
      await withTenant(this.db, guildId, async (tx) => {
        if (
          !(
            await sql`SELECT 1 FROM leases WHERE name=${lease.name} AND holder=${lease.holder} AND token=${lease.token.toString()}::bigint AND expires_at>now()`.execute(
              tx,
            )
          ).rows.length
        )
          return;
        if (!connected) {
          await sql`UPDATE voice_runtime SET ready=false WHERE guild_id=${guildId}`.execute(
            tx,
          );
          await sql`UPDATE voice_channels SET needs_check=true WHERE guild_id=${guildId} AND status='active'`.execute(
            tx,
          );
          return;
        }
        if (this.freshShards.has(_shardId)) return;
        await sql`UPDATE voice_runtime SET ready=true,lease_name=${lease.name},lease_token=${lease.token.toString()}::bigint WHERE guild_id=${guildId}`.execute(
          tx,
        );
        await this.occupancy(tx, guildId, true);
      });
    }
  }
}
