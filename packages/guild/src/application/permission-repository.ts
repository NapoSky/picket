import type { GuildId, RoleId, UserId } from '@picket/kernel';
import type { PermissionConfig, PermissionDecision } from '../domain/permissions';

/** Auteur d'un changement : un utilisateur, ou le système (réaction à un événement Discord). */
export type AuditActor = UserId | 'system';

export interface ModifyResult {
  readonly decision: PermissionDecision;
  readonly before: PermissionConfig;
}

export interface PermissionRepository {
  /** Initialise la guilde (réglages et rôle `member` par défaut) au premier accès, puis lit la configuration. */
  load(guildId: GuildId): Promise<PermissionConfig>;

  /**
   * Applique une décision de façon atomique et sérialisée par guilde : `decide` voit la configuration
   * courante, et un changement effectif est journalisé (avant/après) dans la même transaction.
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
