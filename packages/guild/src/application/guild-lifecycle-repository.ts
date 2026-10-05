import type { GuildId } from '@picket/kernel';
import type { DeactivationReason } from '../domain/lifecycle';
import type { AuditActor } from './permission-repository';

export interface DeactivationResult {
  /** `false` si la guilde était déjà inactive (date et raison d'origine conservées) ou inconnue. */
  readonly changed: boolean;
  readonly inactiveSince: Date;
}

export interface GuildLifecycleRepository {
  /** Crée les réglages par défaut d'une guilde ; idempotent. */
  initialize(guildId: GuildId): Promise<void>;
  /** `null` si la guilde est active ou inconnue. */
  inactiveSince(guildId: GuildId): Promise<Date | null>;
  /**
   * Pour `left`, ne fait rien si la guilde est inconnue (rien à protéger ni à purger).
   * Pour `requested`, initialise la guilde au besoin.
   */
  markInactive(
    guildId: GuildId,
    actor: AuditActor,
    action: string,
    now: Date,
    reason: DeactivationReason,
  ): Promise<DeactivationResult>;
  /** `true` si la guilde était inactive (pour la raison demandée, si précisée) et vient d'être réactivée. */
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
