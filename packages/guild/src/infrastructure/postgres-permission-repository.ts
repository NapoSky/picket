import { RoleId, type GuildId } from '@picket/kernel';
import { withTenant, type Db, type Tx } from '@picket/persistence';
import type { AuditActor, ModifyResult, PermissionRepository } from '../application/permission-repository';
import type { PermissionConfig, PermissionDecision } from '../domain/permissions';
import { ensureGuildInitialized } from './ensure-guild';

async function readConfig(trx: Tx, guildId: GuildId): Promise<PermissionConfig> {
  const rows = await trx
    .selectFrom('guild_permission_roles')
    .select(['level', 'role_id'])
    .where('guild_id', '=', guildId)
    .orderBy('role_id')
    .execute();

  const officer: RoleId[] = [];
  const member: RoleId[] = [];
  for (const row of rows) {
    const role = RoleId.parse(row.role_id);
    if (!role.ok) continue;
    (row.level === 'officer' ? officer : member).push(role.value);
  }
  return { officer, member };
}

async function writeDifference(
  trx: Tx,
  guildId: GuildId,
  before: PermissionConfig,
  after: PermissionConfig,
): Promise<void> {
  for (const level of ['officer', 'member'] as const) {
    const removed = before[level].filter((role) => !after[level].includes(role));
    const added = after[level].filter((role) => !before[level].includes(role));
    if (removed.length > 0) {
      await trx
        .deleteFrom('guild_permission_roles')
        .where('guild_id', '=', guildId)
        .where('level', '=', level)
        .where('role_id', 'in', removed)
        .execute();
    }
    if (added.length > 0) {
      await trx
        .insertInto('guild_permission_roles')
        .values(added.map((role) => ({ guild_id: guildId, level, role_id: role })))
        .execute();
    }
  }
}

export class PostgresPermissionRepository implements PermissionRepository {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  load(guildId: GuildId): Promise<PermissionConfig> {
    return withTenant(this.#db, guildId, async (trx) => {
      await ensureGuildInitialized(trx, guildId);
      return readConfig(trx, guildId);
    });
  }

  modify(
    guildId: GuildId,
    actor: AuditActor,
    action: string,
    decide: (current: PermissionConfig) => PermissionDecision,
  ): Promise<ModifyResult> {
    return withTenant(this.#db, guildId, async (trx) => {
      await ensureGuildInitialized(trx, guildId);
      // Verrou par guilde : deux modifications concurrentes s'enchaînent et leurs avant/après restent cohérents.
      await trx.selectFrom('guild_settings').select('guild_id').where('guild_id', '=', guildId).forUpdate().executeTakeFirstOrThrow();

      const before = await readConfig(trx, guildId);
      const decision = decide(before);
      if (decision.kind === 'apply') {
        await writeDifference(trx, guildId, before, decision.next);
        await trx
          .insertInto('guild_audit_log')
          .values({
            guild_id: guildId,
            actor_id: actor,
            action,
            before: JSON.stringify(before),
            after: JSON.stringify(decision.next),
          })
          .execute();
      }
      return { decision, before };
    });
  }
}
