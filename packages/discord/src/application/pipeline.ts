import type { Translator } from '@picket/i18n';
import type { GuildId, InteractionId, Logger } from '@picket/kernel';
import { ACCESS_RANK, type AccessLevel, type CommandRegistry } from './commands';
import type { ComponentRegistry } from './components';
import { ephemeral, type IncomingInteraction, type Reply } from './interaction';

export interface InteractionReceipts {
  /** `true` si l'interaction est vue pour la première fois (atomique, partagé entre répliques). */
  claim(id: InteractionId, guildId: GuildId | null): Promise<boolean>;
}

export interface AccessPolicy {
  /** Niveau de l'utilisateur dans la guilde, ou `null` s'il n'a aucun accès. Une erreur vaut refus. */
  levelOf(interaction: IncomingInteraction, guildId: GuildId): Promise<AccessLevel | null>;
}

export interface Suspension {
  /** Date de suppression définitive des données de la guilde. */
  readonly purgeAt: Date;
}

export interface GuildGate {
  /** `null` si la guilde est active. Une erreur vaut refus. */
  suspensionOf(guildId: GuildId): Promise<Suspension | null>;
}

export interface GuildLanguage {
  /** Langue imposée au serveur, ou `null` pour laisser la langue de l'utilisateur. */
  localeOf(guildId: GuildId): Promise<string | null>;
}

export interface FeatureGate {
  /** La fonctionnalité est-elle activée pour la guilde ? Une erreur vaut refus. */
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
  /** Discord exige une réponse sous 3 s. */
  readonly handlerTimeoutMs?: number;
  /** Travail différé : le jeton d'interaction reste valable 15 minutes. */
  readonly deferredTimeoutMs?: number;
}

const DEFAULT_HANDLER_TIMEOUT_MS = 2500;
const DEFAULT_DEFERRED_TIMEOUT_MS = 60_000;

class HandlerTimeoutError extends Error {}

/** Ce que le pipeline doit contrôler avant d'exécuter une commande ou un composant. */
interface Target {
  readonly label: string;
  readonly level: AccessLevel;
  readonly feature: string | undefined;
  readonly availableWhenSuspended: boolean;
  readonly invoke: (guildId: GuildId, level: AccessLevel) => Promise<Reply>;
}

/** Chemin unique pour slash, autocomplete, boutons et modales ; ne lève jamais. */
export class InteractionPipeline {
  readonly #deps: PipelineDependencies;

  constructor(deps: PipelineDependencies) {
    this.#deps = deps;
  }

  async handle(interaction: IncomingInteraction): Promise<Reply> {
    const logger = this.#deps.logger.child({
      interaction_id: interaction.id,
      guild_id: interaction.guildId,
      kind: interaction.kind,
    });
    // Langue imposée au serveur, sinon celle de l'utilisateur, puis celle de la communauté, puis l'anglais.
    const i18n = this.#deps.registry.i18n;
    const serverLocale = await this.#serverLocale(interaction.guildId, logger);
    const { t } = i18n.translator(i18n.resolve(serverLocale, interaction.locale, interaction.guildLocale));

    try {
      // Un autocomplete est une lecture répétée à chaque frappe : pas de reçu (rien à dédoublonner, tout à perdre en écritures).
      if (interaction.kind !== 'autocomplete') {
        const isNew = await this.#deps.receipts.claim(interaction.id, interaction.guildId);
        if (!isNew) {
          logger.warn({}, 'duplicate interaction');
          return this.#fallback(interaction, t('errors.duplicate'));
        }
      }

      const resolved = this.#resolveTarget(interaction, logger, t);
      if ('reply' in resolved) return resolved.reply;
      const target = resolved.target;
      if (interaction.guildId === null) return this.#fallback(interaction, t('errors.guildOnly'));
      const guildId = interaction.guildId;

      const level = await this.#deps.access.levelOf(interaction, guildId);
      if (level === null || ACCESS_RANK[level] < ACCESS_RANK[target.level]) {
        logger.warn({ command: target.label, required: target.level, actual: level }, 'access denied');
        return this.#fallback(interaction, t('errors.denied', { level: t(`levels.${target.level}`) }));
      }

      if (target.feature !== undefined && !(await this.#deps.features.isEnabled(guildId, target.feature))) {
        return this.#fallback(interaction, t('errors.featureDisabled'));
      }

      if (!target.availableWhenSuspended) {
        const suspension = await this.#deps.gate.suspensionOf(guildId);
        if (suspension) {
          return this.#fallback(interaction, t('errors.suspended', { date: suspension.purgeAt.toISOString().slice(0, 10) }));
        }
      }

      const reply = await this.#withTimeout(target.invoke(guildId, level), this.#deps.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS);
      return reply.kind === 'deferred' ? { ...reply, run: () => this.#runDeferred(reply.run, target.label, logger, t) } : reply;
    } catch (error) {
      const label = interaction.commandPath.join(' ') || interaction.customId;
      if (error instanceof HandlerTimeoutError) {
        logger.error({ command: label }, 'handler timeout');
        return this.#fallback(interaction, t('errors.timeout'));
      }
      logger.error({ err: error, command: label }, 'interaction failed');
      return this.#fallback(interaction, t('errors.failure'));
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
        // Composant d'une version ou d'une session disparue : toujours une réponse, jamais le silence.
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
    try {
      return await this.#withTimeout(run(), this.#deps.deferredTimeoutMs ?? DEFAULT_DEFERRED_TIMEOUT_MS);
    } catch (error) {
      if (error instanceof HandlerTimeoutError) {
        logger.error({ command: label }, 'deferred work timeout');
        return ephemeral(t('errors.timeout'));
      }
      logger.error({ err: error, command: label }, 'deferred work failed');
      return ephemeral(t('errors.failure'));
    }
  }

  async #serverLocale(guildId: GuildId | null, logger: Logger): Promise<string | null> {
    if (guildId === null) return null;
    try {
      return await this.#deps.language.localeOf(guildId);
    } catch (error) {
      // Une langue illisible ne doit pas empêcher de répondre.
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
