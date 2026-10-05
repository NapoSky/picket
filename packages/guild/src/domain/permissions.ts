import type { GuildId, RoleId } from '@picket/kernel';

export type AccessLevel = 'member' | 'officer' | 'admin';
export type ConfigurableLevel = 'officer' | 'member';

export interface PermissionConfig {
  readonly officer: readonly RoleId[];
  readonly member: readonly RoleId[];
}

export const ADMINISTRATOR_BIT = 1n << 3n;

/** Le rôle @everyone porte l'identifiant de la guilde. */
export function everyoneRoleId(guildId: GuildId): RoleId {
  return guildId as string as RoleId;
}

export function defaultPermissionConfig(guildId: GuildId): PermissionConfig {
  return { officer: [], member: [everyoneRoleId(guildId)] };
}

function sortedUnique(roles: readonly RoleId[]): RoleId[] {
  return [...new Set(roles)].sort();
}

export interface AccessInput {
  readonly guildId: GuildId;
  readonly roleIds: readonly RoleId[];
  /** Permissions calculées par Discord ; `null` = interaction partielle, jamais autorisée par défaut. */
  readonly permissions: bigint | null;
  readonly config: PermissionConfig;
}

/**
 * Le niveau le plus élevé l'emporte. `administrator` couvre le propriétaire (Discord lui attribue
 * toutes les permissions) et les rôles portant la permission Administrator.
 */
export function resolveAccessLevel(input: AccessInput): AccessLevel | null {
  if (input.permissions === null) return null;
  if ((input.permissions & ADMINISTRATOR_BIT) !== 0n) return 'admin';

  const roles = new Set(input.roleIds);
  if (input.config.officer.some((role) => roles.has(role))) return 'officer';

  const everyone = everyoneRoleId(input.guildId);
  if (input.config.member.some((role) => role === everyone || roles.has(role))) return 'member';
  return null;
}

export interface PermissionChangeRequest {
  readonly level: ConfigurableLevel;
  readonly roleId: RoleId;
  readonly action: 'add' | 'remove';
  readonly confirmed: boolean;
}

export type PermissionDecision =
  | { readonly kind: 'unchanged'; readonly reason: 'already_present' | 'not_present' }
  | { readonly kind: 'rejected'; readonly reason: 'everyone_not_allowed_for_officer' }
  | { readonly kind: 'confirmation_required'; readonly reason: 'opens_to_everyone' }
  | { readonly kind: 'apply'; readonly next: PermissionConfig };

export function decidePermissionChange(
  guildId: GuildId,
  current: PermissionConfig,
  request: PermissionChangeRequest,
): PermissionDecision {
  const everyone = everyoneRoleId(guildId);
  const roles = current[request.level];
  const present = roles.includes(request.roleId);

  if (request.action === 'add') {
    if (request.level === 'officer' && request.roleId === everyone) {
      return { kind: 'rejected', reason: 'everyone_not_allowed_for_officer' };
    }
    if (present) return { kind: 'unchanged', reason: 'already_present' };
    if (request.level === 'member' && request.roleId === everyone && !request.confirmed) {
      return { kind: 'confirmation_required', reason: 'opens_to_everyone' };
    }
    return { kind: 'apply', next: { ...current, [request.level]: sortedUnique([...roles, request.roleId]) } };
  }

  if (!present) return { kind: 'unchanged', reason: 'not_present' };
  return { kind: 'apply', next: { ...current, [request.level]: roles.filter((role) => role !== request.roleId) } };
}

/** Retire un rôle supprimé de la guilde de tous les niveaux. */
export function removeRoleFromConfig(current: PermissionConfig, roleId: RoleId): PermissionDecision {
  if (!current.officer.includes(roleId) && !current.member.includes(roleId)) {
    return { kind: 'unchanged', reason: 'not_present' };
  }
  return {
    kind: 'apply',
    next: {
      officer: current.officer.filter((role) => role !== roleId),
      member: current.member.filter((role) => role !== roleId),
    },
  };
}

export type PermissionWarning = 'no_officer_role' | 'member_open_to_everyone';

export function permissionWarnings(guildId: GuildId, config: PermissionConfig): readonly PermissionWarning[] {
  const warnings: PermissionWarning[] = [];
  if (config.officer.length === 0) warnings.push('no_officer_role');
  if (config.member.includes(everyoneRoleId(guildId))) warnings.push('member_open_to_everyone');
  return warnings;
}
