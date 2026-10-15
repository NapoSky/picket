import type { Translator } from '@picket/i18n';
import type { GuildId, InteractionId, Logger, MetricOutcome, OperationalMetrics } from '@picket/kernel';
import { ACCESS_RANK, type AccessLevel, type CommandRegistry } from './commands';
import type { ComponentRegistry } from './components';
import { ephemeral, type IncomingInteraction, type Reply } from './interaction';

export interface InteractionReceipts {
  /** `true` if this is the first occurrence of the interaction (atomic, shared across replicas). */
  claim(id: InteractionId, guildId: GuildId | null): Promise<boolean>;
}

export interface AccessPolicy {
  /** User access level in the guild, or `null` for no access. Errors deny access. */
  levelOf(interaction: IncomingInteraction, guildId: GuildId): Promise<AccessLevel | null>;
  denialMessage?(interaction: IncomingInteraction, required: AccessLevel, t: Translator['t']): string;
}

export interface Suspension {
  /** Permanent guild-data deletion date. */
  readonly purgeAt: Date;
}

export interface GuildGate {
  /** `null` if the guild is active. Errors deny access. */
  suspensionOf(guildId: GuildId): Promise<Suspension | null>;
}

export interface GuildLanguage {
  /** Forced guild locale, or `null` to use the user's locale. */
  localeOf(guildId: GuildId): Promise<string | null>;
}

export interface FeatureGate {
  /** Is the feature enabled for this guild? Errors deny access. */
  isEnabled(guildId: GuildId, feature: string): Promise<boolean>;
}

export interface PipelineDependencies {
  readonly registry: CommandRegistry;
  readonly components: ComponentRegistry;
  readonly receipts: InteractionReceipts;
  readonly access: AccessPolicy;
  readonly gate: GuildGate;
  readonly language: GuildLanguage;
  readonly features: FeatureGate;
  readonly logger: Logger;
  readonly metrics?: OperationalMetrics;
  /** Budget for the entire initial path, including checks; Discord requires a response within 3 s. */
  readonly handlerTimeoutMs?: number;
  /** Deferred work: the interaction token remains valid for 15 minutes. */
  readonly deferredTimeoutMs?: number;
}

const DEFAULT_HANDLER_TIMEOUT_MS = 2500;
const DEFAULT_DEFERRED_TIMEOUT_MS = 60_000;

class HandlerTimeoutError extends Error {}

/** Checks the pipeline must perform before invoking a command or component. */
interface Target {
  readonly label: string;
  readonly level: AccessLevel;
  readonly feature: string | undefined;
  readonly availableWhenSuspended: boolean;
  readonly invoke: (guildId: GuildId, level: AccessLevel) => Promise<Reply>;
}

/** Shared path for slash commands, autocomplete, buttons and modals; never throws. */
export class InteractionPipeline {
  readonly #deps: PipelineDependencies;

  constructor(deps: PipelineDependencies) {
    this.#deps = deps;
  }

  async handle(interaction: IncomingInteraction): Promise<Reply> {
    const started = Date.now();
    const deadline = started + (this.#deps.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS);
    let outcome: MetricOutcome = 'success';
    const logger = this.#deps.logger.child({
      interaction_id: interaction.id,
      guild_id: interaction.guildId,
      kind: interaction.kind,
    });
    // Forced guild locale, otherwise the user's locale, then the community locale, then English.
    const i18n = this.#deps.registry.i18n;
    let { t } = i18n.translator(i18n.resolve(null, interaction.locale, interaction.guildLocale));
    // Each awaited stage rejects at the same deadline. Its eventual completion
    // cannot resume authorization or invoke an action after the timeout reply.
    const beforeDeadline = <T>(work: () => Promise<T>): Promise<T> => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return Promise.reject(new HandlerTimeoutError());
      return this.#withTimeout(work(), remaining);
    };

    try {
      const serverLocale = await beforeDeadline(() => this.#serverLocale(interaction.guildId, logger));
      ({ t } = i18n.translator(i18n.resolve(serverLocale, interaction.locale, interaction.guildLocale)));
      // Autocomplete reads on every keystroke: no receipt (nothing to deduplicate, only unnecessary writes).
      if (interaction.kind !== 'autocomplete') {
        const isNew = await beforeDeadline(() => this.#deps.receipts.claim(interaction.id, interaction.guildId));
        if (!isNew) {
          outcome = 'duplicate';
          logger.warn({}, 'duplicate interaction');
          return this.#fallback(interaction, t('errors.duplicate'));
        }
      }

      const resolved = this.#resolveTarget(interaction, logger, t);
      if ('reply' in resolved) return resolved.reply;
      const target = resolved.target;
      if (interaction.guildId === null) return this.#fallback(interaction, t('errors.guildOnly'));
      const guildId = interaction.guildId;

      const level = await beforeDeadline(() => this.#deps.access.levelOf(interaction, guildId));
      if (level === null || ACCESS_RANK[level] < ACCESS_RANK[target.level]) {
        outcome = 'rejected';
        logger.warn({ command: target.label, required: target.level, actual: level }, 'access denied');
        return this.#fallback(interaction, this.#deps.access.denialMessage?.(interaction, target.level, t)
          ?? t('errors.denied', { level: t(`levels.${target.level}`) }));
      }

      if (target.feature !== undefined && !(await beforeDeadline(() => this.#deps.features.isEnabled(guildId, target.feature!)))) {
        return this.#fallback(interaction, t('errors.featureDisabled'));
      }

      if (!target.availableWhenSuspended) {
        const suspension = await beforeDeadline(() => this.#deps.gate.suspensionOf(guildId));
        if (suspension) {
          return this.#fallback(interaction, t('errors.suspended', { date: suspension.purgeAt.toISOString().slice(0, 10) }));
        }
      }

      const reply = await beforeDeadline(() => target.invoke(guildId, level));
      return reply.kind === 'deferred' ? { ...reply, run: () => this.#runDeferred(reply.run, target.label, logger, t) } : reply;
    } catch (error) {
      const label = interaction.commandPath.join(' ') || interaction.customId;
      if (error instanceof HandlerTimeoutError) {
        outcome = 'timeout';
        logger.error({ command: label }, 'handler timeout');
        return this.#fallback(interaction, t('errors.timeout'));
      }
      logger.error({ err: error, command: label }, 'interaction failed');
      outcome = 'error';
      return this.#fallback(interaction, t('errors.failure'));
    } finally {
      this.#deps.metrics?.record('interaction', (Date.now() - started) / 1000, outcome, 'interactions');
    }
  }

  #resolveTarget(
    interaction: IncomingInteraction,
    logger: Logger,
    t: Translator['t'],
  ): { target: Target } | { reply: Reply } {
    if (interaction.kind === 'command' || interaction.kind === 'autocomplete') {
      const entry = this.#deps.registry.resolve(interaction.commandPath);
      if (!entry) {
        logger.warn({ command: interaction.commandPath.join(' ') }, 'unknown command');
        return { reply: this.#fallback(interaction, t('errors.unknownCommand')) };
      }
      const label = interaction.commandPath.join(' ');
      const base = { label, level: entry.level, feature: entry.feature, availableWhenSuspended: entry.availableWhenSuspended === true };
      if (interaction.kind === 'command') {
        return { target: { ...base, invoke: (guildId, level) => entry.handler({ interaction, guildId, logger, level, t }) } };
      }
      const focused = interaction.focusedOption;
      const handler = focused === null ? undefined : entry.autocomplete?.[focused];
      if (focused === null || handler === undefined) {
        logger.warn({ command: label, option: focused }, 'autocomplete without handler');
        return { reply: { kind: 'autocomplete', choices: [] } };
      }
      const value = String(interaction.options[focused] ?? '');
      return {
        target: {
          ...base,
          invoke: async (guildId, level) => ({
            kind: 'autocomplete',
            choices: await handler({ interaction, guildId, logger, level, t, focused: { name: focused, value } }),
          }),
        },
      };
    }
    if (interaction.kind === 'component' || interaction.kind === 'modal') {
      const resolution = this.#deps.components.resolve(interaction.customId, interaction.kind);
      if (resolution.kind === 'stale') {
        // Component from an obsolete version or session: always respond, never remain silent.
        logger.warn({ reason: resolution.reason }, 'stale component');
        return { reply: ephemeral(t('errors.expired')) };
      }
      const { family, handler, payload } = resolution;
      return {
        target: {
          label: `${interaction.kind} ${family.namespace}`,
          level: family.level,
          feature: family.feature,
          availableWhenSuspended: family.availableWhenSuspended === true,
          invoke: (guildId, level) => handler({ interaction, guildId, logger, level, t, payload }),
        },
      };
    }
    return { reply: this.#fallback(interaction, t('errors.expired')) };
  }

  async #runDeferred(
    run: () => Promise<Reply | null>,
    label: string,
    logger: Logger,
    t: Translator['t'],
  ): Promise<Reply | null> {
    const started = Date.now();
    let outcome: MetricOutcome = 'success';
    try {
      return await this.#withTimeout(run(), this.#deps.deferredTimeoutMs ?? DEFAULT_DEFERRED_TIMEOUT_MS);
    } catch (error) {
      if (error instanceof HandlerTimeoutError) {
        outcome = 'timeout';
        logger.error({ command: label }, 'deferred work timeout');
        return ephemeral(t('errors.timeout'));
      }
      logger.error({ err: error, command: label }, 'deferred work failed');
      outcome = 'error';
      return ephemeral(t('errors.failure'));
    } finally {
      this.#deps.metrics?.record('deferred', (Date.now() - started) / 1000, outcome, 'interactions');
    }
  }

  async #serverLocale(guildId: GuildId | null, logger: Logger): Promise<string | null> {
    if (guildId === null) return null;
    try {
      return await this.#deps.language.localeOf(guildId);
    } catch (error) {
      // An unavailable locale must not prevent responding.
      logger.warn({ err: error }, 'server language unavailable');
      return null;
    }
  }

  #fallback(interaction: IncomingInteraction, content: string): Reply {
    return interaction.kind === 'autocomplete' ? { kind: 'autocomplete', choices: [] } : ephemeral(content);
  }

  async #withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new HandlerTimeoutError()), timeoutMs);
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
