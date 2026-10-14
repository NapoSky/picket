import type { GuildId, RoleId, UserId } from '@picket/kernel';
import type { PermissionConfig, PermissionDecision } from '../domain/permissions';

/** Change author: a user or the system (responding to a Discord event). */
export type AuditActor = UserId | 'system';

export interface ModifyResult {
  readonly decision: PermissionDecision;
  readonly before: PermissionConfig;
}

export interface PermissionRepository {
  /** Initialize the guild (default settings and `member` role) on first access, then read its configuration. */
  load(guildId: GuildId): Promise<PermissionConfig>;

  /**
   * Apply a decision atomically and serially per guild: `decide` sees current configuration, and actual
   * changes are logged (before/after) in the same transaction.
   */
  modify(
    guildId: GuildId,
    actor: AuditActor,
    action: string,
    decide: (current: PermissionConfig) => PermissionDecision,
  ): Promise<ModifyResult>;
}

export interface AccessRequest {
  readonly guildId: GuildId;
  readonly roleIds: readonly RoleId[];
  readonly permissions: bigint | null;
}
