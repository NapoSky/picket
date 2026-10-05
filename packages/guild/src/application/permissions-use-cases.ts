import type { GuildId, RoleId, UserId } from '@picket/kernel';
import {
  decidePermissionChange,
  permissionWarnings,
  removeRoleFromConfig,
  resolveAccessLevel,
  type AccessLevel,
  type PermissionChangeRequest,
  type PermissionConfig,
  type PermissionDecision,
  type PermissionWarning,
} from '../domain/permissions';
import type { AccessRequest, PermissionRepository } from './permission-repository';

export class ResolveAccess {
  readonly #repository: PermissionRepository;

  constructor(repository: PermissionRepository) {
    this.#repository = repository;
  }

  async execute(request: AccessRequest): Promise<AccessLevel | null> {
    // Une interaction sans permissions calculées est refusée sans même consulter la base.
    if (request.permissions === null) return null;
    const config = await this.#repository.load(request.guildId);
    return resolveAccessLevel({ ...request, config });
  }
}

export interface UpdatePermissionsCommand {
  readonly guildId: GuildId;
  readonly actorId: UserId;
  readonly change: PermissionChangeRequest;
}

export class UpdatePermissions {
  readonly #repository: PermissionRepository;

  constructor(repository: PermissionRepository) {
    this.#repository = repository;
  }

  async execute(command: UpdatePermissionsCommand): Promise<PermissionDecision> {
    const { decision } = await this.#repository.modify(
      command.guildId,
      command.actorId,
      `permissions.${command.change.action}`,
      (current) => decidePermissionChange(command.guildId, current, command.change),
    );
    return decision;
  }
}

export interface PermissionOverview {
  readonly config: PermissionConfig;
  readonly yourLevel: AccessLevel | null;
  readonly warnings: readonly PermissionWarning[];
}

export class ShowPermissions {
  readonly #repository: PermissionRepository;

  constructor(repository: PermissionRepository) {
    this.#repository = repository;
  }

  async execute(request: AccessRequest): Promise<PermissionOverview> {
    const config = await this.#repository.load(request.guildId);
    return {
      config,
      yourLevel: request.permissions === null ? null : resolveAccessLevel({ ...request, config }),
      warnings: permissionWarnings(request.guildId, config),
    };
  }
}

/** Réaction à la suppression d'un rôle Discord : retrait automatique des niveaux (XCT-EC-01). */
export class HandleRoleDeleted {
  readonly #repository: PermissionRepository;

  constructor(repository: PermissionRepository) {
    this.#repository = repository;
  }

  async execute(guildId: GuildId, roleId: RoleId): Promise<boolean> {
    const { decision } = await this.#repository.modify(guildId, 'system', 'permissions.role_deleted', (current) =>
      removeRoleFromConfig(current, roleId),
    );
    return decision.kind === 'apply';
  }
}
