import type { GuildId } from '@picket/kernel';
import type { DeactivationReason } from '../domain/lifecycle';
import type { AuditActor } from './permission-repository';

export interface DeactivationResult {
  /** `false` if the guild was already inactive (preserving the original date and reason) or unknown. */
  readonly changed: boolean;
  readonly inactiveSince: Date;
}

export interface GuildLifecycleRepository {
  /** Initialize default guild settings; idempotent. */
  initialize(guildId: GuildId): Promise<void>;
  /** `null` if the guild is active or unknown. */
  inactiveSince(guildId: GuildId): Promise<Date | null>;
  /**
   * For `left`, do nothing if the guild is unknown (nothing to protect or purge). For `requested`, initialize
   * the guild if necessary.
   */
  markInactive(
    guildId: GuildId,
    actor: AuditActor,
    action: string,
    now: Date,
    reason: DeactivationReason,
  ): Promise<DeactivationResult>;
  /** `true` if the previously inactive guild (with the requested reason, if specified) was reactivated. */
  reactivate(
    guildId: GuildId,
    actor: AuditActor,
    action: string,
    onlyReason?: DeactivationReason,
  ): Promise<boolean>;
  listActive(): Promise<GuildId[]>;
  findPurgeable(cutoff: Date, limit: number): Promise<GuildId[]>;
  purge(guildId: GuildId): Promise<void>;
}
