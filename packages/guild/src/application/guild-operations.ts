import { AccessCheckError, type GuildOperationsDiscord, type IncomingInteraction, type OperatorScope } from '@picket/discord';
import { noopLogger, type ChannelId, type Clock, type GuildId, type Logger, type UserId } from '@picket/kernel';

export type OpsFilter = 'present' | 'absent' | 'pending' | 'all';
export interface OpsState {
  query: string;
  filter: OpsFilter;
  sort: 'name' | 'recent';
  page: number;
  view: 'servers' | 'detail' | 'history';
  target: GuildId | null;
}
export interface OpsSession {
  readonly id: string;
  readonly actorId: UserId;
  readonly actorName: string;
  readonly supportGuildId: GuildId;
  /** Configured notification channel used to resolve the support guild, not the invocation channel. */
  readonly channelId: ChannelId;
  readonly expiresAt: Date;
  readonly state: OpsState;
}
export interface OpsServer {
  readonly id: GuildId;
  readonly name: string;
  readonly registeredAt: Date;
  readonly present: boolean;
  readonly inactiveSince: Date | null;
  readonly deletionRequested: boolean;
  readonly revision: string;
  readonly features: Readonly<Record<string, boolean>>;
  readonly pending: boolean;
}
export interface OpsDetail extends OpsServer {
  readonly boards: number;
  readonly assets: number;
  readonly voiceChannels: number;
  readonly reservedVoiceChannels: number;
  readonly warlogConfigured: boolean;
}
export type OpsStatus = 'prepared' | 'pending' | 'executing' | 'uncertain' | 'left' | 'absent' | 'failed' | 'returned';
export type OpsFailure = 'expired' | 'changed' | 'protected' | 'denied' | 'verification' | 'present';
export interface OpsOperation {
  readonly id: string;
  readonly sessionId: string;
  readonly actorId: UserId;
  readonly actorName: string;
  readonly supportGuildId: GuildId;
  readonly channelId: ChannelId;
  readonly targetId: GuildId;
  readonly targetName: string;
  readonly registeredAt: Date;
  readonly revision: string;
  readonly inactiveSince: Date | null;
  readonly deletionRequested: boolean;
  readonly configuration: string;
  readonly retentionDays: number;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly requestedAt: Date | null;
  readonly attemptedAt: Date | null;
  readonly completedAt: Date | null;
  readonly syncedAt: Date | null;
  readonly purgeSince: Date | null;
  readonly status: OpsStatus;
  readonly reason: string;
  readonly failure: OpsFailure | null;
}
export interface GuildOperationsRepository {
  createSession(scope: OperatorScope, expiresAt: Date): Promise<OpsSession>;
  session(id: string): Promise<OpsSession | null>;
  saveSession(id: string, state: OpsState): Promise<void>;
  servers(): Promise<readonly OpsServer[]>;
  detail(guildId: GuildId): Promise<OpsDetail | null>;
  prepare(session: OpsSession, target: OpsDetail, retentionDays: number, now: Date): Promise<OpsOperation>;
  operation(id: string): Promise<OpsOperation | null>;
  claim(id: string, sessionId: string, reason: string, now: Date): Promise<boolean>;
  update(id: string, status: OpsStatus, now: Date, failure?: OpsFailure): Promise<void>;
  synchronized(id: string, now: Date, purgeSince?: Date | null): Promise<void>;
  /** Atomically recheck the membership, deactivate it, observe departure and synchronize the operation. */
  finalizeDeparture(operation: OpsOperation, now: Date): Promise<void>;
  recoverable(): Promise<readonly OpsOperation[]>;
  history(target: GuildId | null, page: number): Promise<{ operations: readonly OpsOperation[]; total: number }>;
  cleanup(now: Date): Promise<void>;
}
export interface OpsLock { withLock<T>(key: string, work: () => Promise<T>): Promise<T> }

export const opsConfiguration = (detail: OpsDetail): string => JSON.stringify([
  ...(['timers', 'todolists', 'warlog', 'stats'] as const).map(feature => detail.features[feature] === true),
  detail.boards, detail.assets, detail.warlogConfigured, detail.deletionRequested,
]);

export class OpsError extends Error {
  constructor(readonly reason: 'denied' | 'expired' | 'protected' | 'verification' | 'changed' | 'absent' | 'busy' | 'invalid' | 'ambiguous') {
    super(`Operator action rejected: ${reason}`);
  }
}

/** Persist the intent, dispatch DELETE once, then reconcile uncertainties without repeating it. */
export class GuildOperatorService {
  private readonly recoveryWarnings = new Set<string>();
  constructor(
    readonly repository: GuildOperationsRepository,
    private readonly discord: GuildOperationsDiscord,
    private readonly channelId: ChannelId | null,
    private readonly lock: OpsLock,
    private readonly clock: Clock,
    readonly retentionDays: number,
    private readonly logger: Logger = noopLogger,
  ) {}

  async authorize(interaction: IncomingInteraction, fresh = false): Promise<OperatorScope | null> {
    if (!this.channelId) {
      this.logger.warn({}, 'operator access denied: support channel not configured');
      return null;
    }
    let scope: OperatorScope;
    try {
      scope = await this.discord.scope(this.channelId, fresh);
    } catch (error) {
      // Keep operational diagnostics useful without logging REST request bodies or tokens.
      const failure = error as { status?: unknown; code?: unknown } | null;
      this.logger.warn({
        ...(typeof failure?.status === 'number' ? { status: failure.status } : {}),
        ...(typeof failure?.code === 'number' ? { code: failure.code } : {}),
      }, 'operator access verification unavailable');
      throw new AccessCheckError('ops.authorizationUnavailable');
    }
    if (interaction.guildId !== scope.guildId) {
      this.logger.warn({}, 'operator access denied: support guild mismatch');
      return null;
    }
    if (interaction.userId !== scope.ownerId) {
      this.logger.warn({}, 'operator access denied: application owner mismatch');
      return null;
    }
    return scope;
  }

  async start(interaction: IncomingInteraction): Promise<OpsSession> {
    const scope = await this.authorize(interaction);
    if (!scope) throw new OpsError('denied');
    return this.repository.createSession(scope, new Date(this.clock.now().getTime() + 600_000));
  }

  async session(id: string, interaction: IncomingInteraction): Promise<OpsSession> {
    const scope = await this.authorize(interaction);
    if (!scope) throw new OpsError('denied');
    const session = await this.repository.session(id);
    if (!session || session.actorId !== interaction.userId || session.supportGuildId !== scope.guildId ||
      session.channelId !== scope.channelId || session.expiresAt <= this.clock.now()) throw new OpsError('expired');
    return session;
  }

  async inspect(target: GuildId): Promise<{ detail: OpsDetail; live: 'present' | 'absent' | 'unknown' }> {
    const detail = await this.repository.detail(target);
    if (!detail) throw new OpsError('absent');
    try {
      const guild = await this.discord.guild(target);
      return { detail: { ...detail, name: guild?.name ?? detail.name }, live: guild ? 'present' : 'absent' };
    } catch { return { detail, live: 'unknown' }; }
  }

  async prepare(session: OpsSession, target: GuildId): Promise<OpsOperation> {
    if (target === session.supportGuildId) throw new OpsError('protected');
    const { detail, live } = await this.inspect(target);
    if (live === 'unknown') throw new OpsError('verification');
    if (live === 'absent' || !detail.present) throw new OpsError('absent');
    if (detail.pending) throw new OpsError('busy');
    const normalized = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
    if ((await this.repository.servers()).some(other => other.id !== detail.id && normalized(other.name) === normalized(detail.name) &&
      Math.floor(other.registeredAt.getTime() / 60_000) === Math.floor(detail.registeredAt.getTime() / 60_000))) throw new OpsError('ambiguous');
    return this.repository.prepare(session, detail, this.retentionDays, this.clock.now());
  }

  async submit(session: OpsSession, id: string, reason: string, confirmation: string, onClaim?: () => Promise<void>): Promise<OpsOperation> {
    const operation = await this.repository.operation(id);
    if (!operation || operation.sessionId !== session.id || operation.actorId !== session.actorId) throw new OpsError('expired');
    reason = reason.trim();
    if (confirmation.trim() !== 'QUITTER' || reason.length < 10 || reason.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(reason)) throw new OpsError('invalid');
    if (!await this.repository.claim(id, session.id, reason, this.clock.now())) throw new OpsError('expired');
    // Delivery failure cannot cancel an already authorized, durably recorded operation.
    await onClaim?.().catch(() => undefined);
    await this.execute(id);
    return (await this.repository.operation(id))!;
  }

  private async execute(id: string): Promise<void> {
    const initial = await this.repository.operation(id);
    if (!initial) return;
    await this.lock.withLock(`ops:${initial.targetId}`, async () => {
      const op = await this.repository.operation(id);
      if (!op) return;
      if ((op.status === 'left' || op.status === 'absent') && !op.syncedAt) { await this.synchronize(op); return; }
      if (op.status === 'executing' || op.status === 'uncertain') {
        // Give an in-flight request time to settle. Never send DELETE a second time.
        if (!op.attemptedAt || this.clock.now().getTime() - op.attemptedAt.getTime() < 30_000) return;
        try {
          const detail = await this.repository.detail(op.targetId);
          const live = await this.discord.guild(op.targetId);
          if (!live) {
            await this.repository.update(id, 'left', this.clock.now());
            await this.synchronize((await this.repository.operation(id))!);
          } else if (detail && (detail.revision !== op.revision || detail.registeredAt.getTime() !== op.registeredAt.getTime())) {
            await this.repository.update(id, 'returned', this.clock.now());
            await this.repository.synchronized(id, this.clock.now());
          } else await this.repository.update(id, 'failed', this.clock.now(), 'present');
        } catch { this.warnRecovery(id); }
        return;
      }
      if (op.status !== 'pending') return;
      const reject = (failure: OpsFailure) => this.repository.update(id, 'failed', this.clock.now(), failure);
      if (op.expiresAt <= this.clock.now()) { await reject('expired'); return; }
      if (!this.channelId || op.channelId !== this.channelId) { await reject('denied'); return; }
      try {
        const scope = await this.discord.scope(this.channelId, true);
        if (op.supportGuildId !== scope.guildId || op.actorId !== scope.ownerId) { await reject('denied'); return; }
        if (op.targetId === scope.guildId) { await reject('protected'); return; }
        const detail = await this.repository.detail(op.targetId);
        const live = await this.discord.guild(op.targetId);
        if (!live) {
          await this.repository.update(id, 'absent', this.clock.now());
          try { await this.synchronize((await this.repository.operation(id))!); } catch { this.warnRecovery(id); }
          return;
        }
        if (!detail || !detail.present || detail.revision !== op.revision || live.name !== op.targetName ||
          detail.registeredAt.getTime() !== op.registeredAt.getTime() ||
          detail.inactiveSince?.getTime() !== op.inactiveSince?.getTime() || op.retentionDays !== this.retentionDays || opsConfiguration(detail) !== op.configuration) {
          await reject('changed'); return;
        }
      } catch { await reject('verification'); return; }
      if (op.expiresAt <= this.clock.now()) { await reject('expired'); return; }
      await this.repository.update(id, 'executing', this.clock.now());
      try { await this.discord.leave(op.targetId, op.expiresAt); }
      catch {
        await this.repository.update(id, 'uncertain', this.clock.now());
        this.logger.warn({ operation_id: id }, 'operator departure result uncertain; presence will be checked without repeating DELETE');
        return;
      }
      await this.repository.update(id, 'left', this.clock.now());
      try { await this.synchronize((await this.repository.operation(id))!); } catch { this.warnRecovery(id); }
    });
  }

  private async synchronize(op: OpsOperation): Promise<void> {
    const detail = await this.repository.detail(op.targetId);
    // A later installation is a different membership; never deactivate or remove it.
    const laterMembership = detail && (detail.registeredAt.getTime() !== op.registeredAt.getTime() ||
      BigInt(detail.revision) > BigInt(op.revision) + 1n || (detail.present && detail.revision !== op.revision));
    // Discord can already see a reinstallation before its Gateway event reaches this replica.
    if (laterMembership || (detail?.present && await this.discord.guild(op.targetId))) {
      await this.repository.update(op.id, 'returned', this.clock.now());
      await this.repository.synchronized(op.id, this.clock.now());
    } else {
      await this.repository.finalizeDeparture(op, this.clock.now());
    }
  }

  async recover(): Promise<void> {
    for (const op of await this.repository.recoverable()) {
      try {
        await this.execute(op.id);
        const status = (await this.repository.operation(op.id))?.status;
        if (status !== 'uncertain' && status !== 'executing') this.recoveryWarnings.delete(op.id);
      }
      catch { this.warnRecovery(op.id); }
    }
    await this.repository.cleanup(this.clock.now());
  }

  private warnRecovery(id: string): void {
    if (this.recoveryWarnings.has(id)) return;
    this.recoveryWarnings.add(id);
    this.logger.warn({ operation_id: id }, 'operator departure recovery will retry; no additional DELETE is sent');
  }
}
