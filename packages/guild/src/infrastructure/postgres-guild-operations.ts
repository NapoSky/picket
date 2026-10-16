import { randomBytes } from 'node:crypto';
import type { OperatorScope } from '@picket/discord';
import { GuildId, type ChannelId } from '@picket/kernel';
import { sql, withTenant, type Db } from '@picket/persistence';
import { OpsError, opsConfiguration, type GuildOperationsRepository, type OpsDetail, type OpsFailure, type OpsOperation, type OpsServer, type OpsSession, type OpsState, type OpsStatus } from '../application/guild-operations';
import { supportGuildMessage } from '../application/support-guild-events';
import { PostgresGuildLifecycleRepository } from './postgres-guild-lifecycle-repository';
import { PostgresSupportGuildEventsRepository } from './postgres-support-guild-events-repository';

const token = () => randomBytes(16).toString('hex');
interface ServerRow {
  server_id: string; name: string; registered_at: Date; present: boolean; inactive_since: Date | null;
  inactive_reason: string | null; revision: string; features: Record<string, boolean>; pending: boolean;
}
function server(row: ServerRow): OpsServer {
  return { id: GuildId.assert(row.server_id), name: row.name, registeredAt: row.registered_at, present: row.present,
    inactiveSince: row.inactive_since, deletionRequested: row.inactive_reason === 'requested', revision: row.revision,
    features: row.features, pending: row.pending };
}
type Snapshot = Omit<OpsOperation, 'id' | 'targetName' | 'actorName' | 'reason' | 'status' | 'failure' | 'createdAt' | 'expiresAt' | 'requestedAt' | 'attemptedAt' | 'completedAt' | 'syncedAt' | 'purgeSince' | 'registeredAt' | 'inactiveSince'> & {
  registeredAt: string; inactiveSince: string | null;
};
interface OperationRow {
  id: string; target_name: string; actor_name: string; snapshot: Snapshot; status: OpsStatus; reason: string; failure: OpsFailure | null;
  created_at: Date; expires_at: Date; requested_at: Date | null; attempted_at: Date | null; completed_at: Date | null; synced_at: Date | null; purge_since: Date | null;
}
const operation = (row: OperationRow): OpsOperation => ({
  ...row.snapshot, id: row.id, targetName: row.target_name, actorName: row.actor_name, reason: row.reason, status: row.status,
  failure: row.failure, registeredAt: new Date(row.snapshot.registeredAt), inactiveSince: row.snapshot.inactiveSince ? new Date(row.snapshot.inactiveSince) : null,
  createdAt: row.created_at, expiresAt: row.expires_at, requestedAt: row.requested_at, attemptedAt: row.attempted_at,
  completedAt: row.completed_at, syncedAt: row.synced_at, purgeSince: row.purge_since,
});

export class PostgresGuildOperationsRepository implements GuildOperationsRepository {
  constructor(private readonly db: Db, private readonly channelId: ChannelId | null = null, private readonly retentionDays = 30) {}

  async createSession(scope: OperatorScope, expiresAt: Date): Promise<OpsSession> {
    const id = token();
    const state: OpsState = { query: '', filter: 'present', sort: 'name', page: 0, view: 'servers', target: null };
    await sql`INSERT INTO operator_sessions(id, scope, state, expires_at)
      VALUES (${id}, ${JSON.stringify(scope)}::jsonb, ${JSON.stringify(state)}::jsonb, ${expiresAt})`.execute(this.db);
    return { id, actorId: scope.ownerId, actorName: scope.ownerName, supportGuildId: scope.guildId, channelId: scope.channelId, expiresAt, state };
  }

  async session(id: string): Promise<OpsSession | null> {
    const row = (await sql<{ id: string; scope: OperatorScope; state: OpsState; expires_at: Date }>`
      SELECT * FROM operator_sessions WHERE id=${id}`.execute(this.db)).rows[0];
    return row ? { id: row.id, actorId: row.scope.ownerId, actorName: row.scope.ownerName, supportGuildId: row.scope.guildId,
      channelId: row.scope.channelId, expiresAt: row.expires_at, state: row.state } : null;
  }

  async saveSession(id: string, state: OpsState): Promise<void> {
    await sql`UPDATE operator_sessions SET state=${JSON.stringify(state)}::jsonb WHERE id=${id}`.execute(this.db);
  }

  async servers(): Promise<readonly OpsServer[]> {
    return (await sql<ServerRow>`SELECT * FROM picket_operator_servers()`.execute(this.db)).rows.map(server);
  }

  async detail(guildId: GuildId): Promise<OpsDetail | null> {
    const row = (await sql<ServerRow>`SELECT * FROM picket_operator_servers() WHERE server_id=${guildId}`.execute(this.db)).rows[0];
    if (!row) return null;
    return withTenant(this.db, guildId, async trx => {
      const counts = (await sql<{ boards: string; assets: string; voice_channels: string; reserved_voice_channels: string; warlog: boolean }>`SELECT
        (SELECT count(*) FROM timer_boards WHERE guild_id=${guildId} AND archived_at IS NULL) AS boards,
        (SELECT count(*) FROM timer_assets WHERE guild_id=${guildId} AND status='active') AS assets,
        (SELECT count(*) FROM voice_channels WHERE guild_id=${guildId} AND status='active') AS voice_channels,
        (SELECT count(*) FROM voice_channels WHERE guild_id=${guildId} AND status IN ('pending','creating','uncertain')) AS reserved_voice_channels,
        EXISTS (SELECT 1 FROM warlog_subscriptions WHERE guild_id=${guildId} AND channel_id IS NOT NULL) AS warlog`.execute(trx)).rows[0]!;
      return { ...server(row), boards: Number(counts.boards), assets: Number(counts.assets),
        voiceChannels: Number(counts.voice_channels), reservedVoiceChannels: Number(counts.reserved_voice_channels), warlogConfigured: counts.warlog };
    });
  }

  async prepare(session: OpsSession, target: OpsDetail, retentionDays: number, now: Date): Promise<OpsOperation> {
    const id = token();
    const snapshot: Snapshot = { sessionId: session.id, actorId: session.actorId, channelId: session.channelId,
      supportGuildId: session.supportGuildId, targetId: target.id, registeredAt: target.registeredAt.toISOString(),
      revision: target.revision, inactiveSince: target.inactiveSince?.toISOString() ?? null, retentionDays,
      deletionRequested: target.deletionRequested, configuration: opsConfiguration(target) };
    const expiresAt = new Date(Math.min(session.expiresAt.getTime(), now.getTime() + 120_000));
    await sql`INSERT INTO operator_departures(id, session_id, target_id, target_name, actor_name, expected_revision, snapshot, status, created_at, expires_at)
      VALUES (${id}, ${session.id}, ${target.id}, ${target.name}, ${session.actorName}, ${target.revision}::bigint,
        ${JSON.stringify(snapshot)}::jsonb, 'prepared', ${now}, ${expiresAt})`.execute(this.db);
    return (await this.operation(id))!;
  }

  async operation(id: string): Promise<OpsOperation | null> {
    const row = (await sql<OperationRow>`SELECT * FROM operator_departures WHERE id=${id}`.execute(this.db)).rows[0];
    return row ? operation(row) : null;
  }

  async claim(id: string, sessionId: string, reason: string, now: Date): Promise<boolean> {
    try {
      return (await sql`UPDATE operator_departures SET status='pending', reason=${reason}, requested_at=${now}
        WHERE id=${id} AND session_id=${sessionId} AND status='prepared' AND expires_at>${now} RETURNING id`.execute(this.db)).rows.length === 1;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new OpsError('busy');
      throw error;
    }
  }

  async update(id: string, status: OpsStatus, now: Date, failure?: OpsFailure): Promise<void> {
    await sql`UPDATE operator_departures SET status=${status}, failure=${failure ?? null},
      attempted_at=CASE WHEN ${status}='executing' THEN COALESCE(attempted_at, ${now}) ELSE attempted_at END,
      completed_at=CASE WHEN ${['left', 'absent', 'failed', 'returned'].includes(status)} THEN COALESCE(completed_at, ${now}) ELSE completed_at END
      WHERE id=${id}`.execute(this.db);
  }

  async synchronized(id: string, now: Date, purgeSince: Date | null = null): Promise<void> {
    await sql`UPDATE operator_departures SET synced_at=${now}, purge_since=${purgeSince} WHERE id=${id}`.execute(this.db);
  }

  async finalizeDeparture(op: OpsOperation, now: Date): Promise<void> {
    await withTenant(this.db, op.targetId, async trx => {
      const registry = await trx.selectFrom('guild_registry').selectAll().where('guild_id', '=', op.targetId).forUpdate().executeTakeFirst();
      const presence = await trx.selectFrom('guild_support_presence').selectAll().where('guild_id', '=', op.targetId).executeTakeFirst();
      const revision = BigInt(presence?.revision ?? '0');
      const expected = BigInt(op.revision);
      const returned = registry && (registry.registered_at.getTime() !== op.registeredAt.getTime() ||
        revision > expected + 1n || (presence?.present && revision !== expected) ||
        (!presence?.present && revision === expected + 1n && registry.inactive_since === null));
      if (returned) {
        await sql`UPDATE operator_departures SET status='returned', synced_at=${now}, purge_since=NULL WHERE id=${op.id}`.execute(trx);
        return;
      }
      let purgeSince: Date | null = null;
      if (registry) {
        // The tenant audit keeps ordinary departure semantics; operator identity/reason stay private.
        const result = await new PostgresGuildLifecycleRepository(this.db).markInactiveInTransaction(
          trx, op.targetId, 'system', 'guild.left', op.completedAt ?? now, 'left');
        purgeSince = result.inactiveSince;
        await new PostgresSupportGuildEventsRepository(this.db).observeInTransaction(trx, op.targetId, false, undefined, false,
          this.channelId ? { channelId: this.channelId, format: change => supportGuildMessage(change, this.retentionDays) } : null);
      }
      await sql`UPDATE operator_departures SET synced_at=${now}, purge_since=${purgeSince} WHERE id=${op.id}`.execute(trx);
    });
  }

  async recoverable(): Promise<readonly OpsOperation[]> {
    return (await sql<OperationRow>`SELECT * FROM operator_departures WHERE status IN ('pending','executing','uncertain')
      OR (status IN ('left','absent') AND synced_at IS NULL) ORDER BY created_at LIMIT 50`.execute(this.db)).rows.map(operation);
  }

  async history(target: GuildId | null, page: number): Promise<{ operations: readonly OpsOperation[]; total: number }> {
    const where = sql`requested_at IS NOT NULL AND (${target}::text IS NULL OR target_id=${target})`;
    const [rows, count] = await Promise.all([
      sql<OperationRow>`SELECT * FROM operator_departures WHERE ${where} ORDER BY requested_at DESC, id LIMIT 5 OFFSET ${Math.max(0, page) * 5}`.execute(this.db),
      sql<{ count: string }>`SELECT count(*) FROM operator_departures WHERE ${where}`.execute(this.db),
    ]);
    return { operations: rows.rows.map(operation), total: Number(count.rows[0]!.count) };
  }

  async cleanup(now: Date): Promise<void> {
    await sql`DELETE FROM operator_sessions WHERE expires_at<=${now}`.execute(this.db);
    await sql`DELETE FROM operator_departures WHERE (status='prepared' AND expires_at<=${now}) OR
      (status IN ('left','absent','failed','returned') AND completed_at<=${new Date(now.getTime() - 30 * 86_400_000)}
        AND (status NOT IN ('left','absent') OR synced_at IS NOT NULL))`.execute(this.db);
  }
}
