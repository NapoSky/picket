import {
  AccessCheckError, encodeCustomId, ephemeral, type CommandContext, type CommandEntry, type ComponentContext,
  type ComponentFamily, type PanelButton, type PanelContent, type Reply, type RootDescriptor, type InteractionReplies,
} from '@picket/discord';
import type { I18n, MessageKey } from '@picket/i18n';
import { GuildId, type Clock } from '@picket/kernel';
import { GuildOperatorService, OpsError, type OpsOperation, type OpsSession, type OpsState } from '../../application/guild-operations';

export const OPS_ROOT: RootDescriptor = { name: 'picket-ops', description: 'ops.command' };
export const isOpsInteraction = (interaction: CommandContext['interaction']): boolean =>
  interaction.commandPath[0] === OPS_ROOT.name || interaction.customId?.startsWith('ops:') === true;

/** All names and reasons are untrusted Discord text. */
function display(value: string, max = 500): string {
  return value.replace(/[\r\n\t]/g, ' ').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '').trim().slice(0, max)
    .replace(/([\\`*_{}\[\]()<>~|])/g, '\\$1').replace(/@/g, '@\u200b');
}
const normalized = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
const stamp = (value: Date) => `<t:${Math.floor(value.getTime() / 1000)}:f>`;
const text = (value: string): PanelContent => ({ kind: 'text', text: value });

export function createOperationsPanel(service: GuildOperatorService, i18n: I18n, clock: Clock, replies?: InteractionReplies) {
  const local = <T extends CommandContext>(context: T): T => ({ ...context, t: i18n.translator(i18n.resolve(context.interaction.locale, context.interaction.guildLocale)).t });
  const id = (session: OpsSession, action: string, arg = '0') => encodeCustomId('ops', 1, `${session.id}.${action}.${arg}`);
  const button = (ctx: CommandContext, session: OpsSession, label: MessageKey, action: string, arg = '0', style: PanelButton['style'] = 'secondary', disabled = false): PanelButton =>
    ({ kind: 'button', label: ctx.t(label), customId: id(session, action, arg), style, disabled });
  const panel = (ctx: CommandContext, components: PanelContent[]): Reply => ({ kind: 'panel', update: ctx.interaction.message !== null, panel: { accentColor: 0xe09f3e, components } });
  const navigation = (ctx: CommandContext, session: OpsSession): PanelContent => ({ kind: 'buttons', buttons: [
    button(ctx, session, 'ops.servers', 'servers'), button(ctx, session, 'ops.refresh', 'refresh'), button(ctx, session, 'ops.history', 'history', 'all'),
  ] });
  const expiry = (ctx: CommandContext, session: OpsSession) => text(ctx.t('ops.sessionExpiry', { date: stamp(session.expiresAt) }));
  const pagination = (ctx: CommandContext, session: OpsSession, total: number): PanelContent[] => {
    const pages = Math.max(1, Math.ceil(total / 5));
    return [text(ctx.t('ops.page', { page: session.state.page + 1, total: pages })), { kind: 'buttons', buttons: [
      button(ctx, session, 'ops.previous', 'prev', '0', 'secondary', session.state.page <= 0),
      button(ctx, session, 'ops.next', 'next', '0', 'secondary', session.state.page + 1 >= pages),
    ] }];
  };
  const featureNames = (ctx: CommandContext, features: Readonly<Record<string, boolean>>) =>
    (['timers', 'todolists', 'warlog', 'stats'] as const).filter(key => features[key]).map(key => ctx.t(`features.${key}`)).join(' · ') || ctx.t('ops.none');
  const purgeText = (ctx: CommandContext, since: Date | null, fallback: Date = clock.now(), days = service.retentionDays) =>
    ctx.t('ops.purge', { date: stamp(new Date((since ?? fallback).getTime() + days * 86_400_000)) });

  async function render(ctx: CommandContext, session: OpsSession): Promise<Reply> {
    const { t } = ctx;
    if (session.state.view === 'history') {
      const result = await service.repository.history(session.state.target, session.state.page);
      if (session.state.page > 0 && session.state.page * 5 >= result.total) {
        session = { ...session, state: { ...session.state, page: Math.max(0, Math.ceil(result.total / 5) - 1) } };
        await service.repository.saveSession(session.id, session.state);
        return render(ctx, session);
      }
      return panel(ctx, [text(`## ${t('ops.history')}`), text(t('ops.historyHelp')),
        ...result.operations.map(op => ({ kind: 'section' as const,
          text: `**${display(op.targetName, 80) || t('ops.unknownName')}**\n${stamp(op.requestedAt!)} · ${display(op.actorName, 32)}\n${t(`ops.status.${op.status}`)}${op.failure ? ` — ${t(`ops.failure.${op.failure}`)}` : ''}\n${t('ops.reason')}: ${display(op.reason, 96)}${op.reason.length > 96 ? '…' : ''}${op.purgeSince ? `\n${purgeText(ctx, op.purgeSince, op.completedAt ?? clock.now(), op.retentionDays)}` : ''}`,
          button: button(ctx, session, 'ops.inspect', 'record', op.id),
        })),
        ...(result.total ? pagination(ctx, session, result.total) : [text(t('ops.emptyHistory'))]), navigation(ctx, session), expiry(ctx, session)]);
    }
    if (session.state.view === 'detail' && session.state.target) {
      const { detail, live } = await service.inspect(session.state.target);
      let prepared: OpsOperation | null = null;
      let notice: MessageKey | null = null;
      if (detail.id === session.supportGuildId) notice = 'ops.protected';
      else if (detail.pending) notice = 'ops.busy';
      else if (live === 'unknown') notice = 'ops.verification';
      else if (live === 'absent' || !detail.present) notice = 'ops.absent';
      else {
        const peers = await service.repository.servers();
        if (peers.some(other => other.id !== detail.id && normalized(other.name) === normalized(detail.name) &&
          Math.floor(other.registeredAt.getTime() / 60_000) === Math.floor(detail.registeredAt.getTime() / 60_000))) notice = 'ops.ambiguous';
        else {
          try { prepared = await service.prepare(session, detail.id); }
          catch (error) { if (error instanceof OpsError) notice = `ops.${error.reason}`; else throw error; }
        }
      }
      const components: PanelContent[] = [text(`## ${display(detail.name) || t('ops.unknownName')}`),
        text(`${t('ops.presence')}: **${t(`ops.live.${live}`)}**\n${t('ops.service')}: ${t(detail.inactiveSince ? 'ops.suspended' : 'ops.active')}\n${t('ops.registered', { date: stamp(detail.registeredAt) })}\n${t('ops.checked', { date: stamp(clock.now()) })}`),
        text(`**${t('ops.modules')}**\n${featureNames(ctx, detail.features)}\n${t('ops.configuredNotUsage')}`),
        text(t('ops.records', { boards: detail.boards, assets: detail.assets, warlog: t(detail.warlogConfigured ? 'ops.yes' : 'ops.no'), stats: t(detail.features.stats ? 'ops.yes' : 'ops.no') })),
        text(`${t('ops.consequences')}\n${purgeText(ctx, detail.inactiveSince)}\n${t(detail.deletionRequested ? 'ops.requestedDeletion' : 'ops.returnAllowed')}`),
      ];
      if (notice) components.push(text(t(notice)));
      components.push({ kind: 'buttons', buttons: [button(ctx, session, 'ops.prepare', 'confirm', prepared?.id ?? '0', 'danger', !prepared),
        button(ctx, session, 'ops.history', 'history', detail.id)] }, navigation(ctx, session), expiry(ctx, session));
      return panel(ctx, components);
    }
    const servers = await service.repository.servers();
    const matching = servers.filter(server => normalized(server.name).includes(normalized(session.state.query)) &&
      (session.state.filter === 'all' || (session.state.filter === 'present' ? server.present : session.state.filter === 'absent' ? !server.present : server.pending)));
    matching.sort((a, b) => session.state.sort === 'recent' ? b.registeredAt.getTime() - a.registeredAt.getTime() || a.id.localeCompare(b.id) :
      normalized(a.name).localeCompare(normalized(b.name)) || a.registeredAt.getTime() - b.registeredAt.getTime() || a.id.localeCompare(b.id));
    const page = Math.max(0, Math.min(session.state.page, Math.max(0, Math.ceil(matching.length / 5) - 1)));
    if (page !== session.state.page) {
      session = { ...session, state: { ...session.state, page } };
      await service.repository.saveSession(session.id, session.state);
    }
    return panel(ctx, [text(`## ${t('ops.title')}`), text(t('ops.counts', { present: servers.filter(server => server.present).length,
      absent: servers.filter(server => !server.present).length, pending: servers.filter(server => server.pending).length })),
      ...(session.state.query ? [text(`${t('ops.search')}: ${display(session.state.query, 100)}`)] : []),
      { kind: 'buttons', buttons: [button(ctx, session, 'ops.search', 'search'), button(ctx, session, 'ops.clear', 'clear'), button(ctx, session, 'ops.history', 'history', 'all')] },
      { kind: 'stringSelect', customId: id(session, 'filter'), placeholder: t('ops.filter'), options: (['present', 'absent', 'pending', 'all'] as const).map(value => ({ label: t(`ops.filterValues.${value}`), value, selected: session.state.filter === value })) },
      { kind: 'stringSelect', customId: id(session, 'sort'), placeholder: t('ops.sort'), options: (['name', 'recent'] as const).map(value => ({ label: t(`ops.sortValues.${value}`), value, selected: session.state.sort === value })) },
      ...matching.slice(page * 5, page * 5 + 5).map(server => ({ kind: 'section' as const,
        text: `**${display(server.name) || t('ops.unknownName')}**\n${t(server.present ? 'ops.live.present' : 'ops.live.absent')} · ${featureNames(ctx, server.features)}\n${t('ops.registered', { date: stamp(server.registeredAt) })}`,
        button: button(ctx, session, 'ops.inspect', 'detail', server.id),
      })),
      ...(matching.length ? pagination(ctx, session, matching.length) : [text(t('ops.noResults'))]),
      { kind: 'buttons', buttons: [button(ctx, session, 'ops.refresh', 'refresh')] }, expiry(ctx, session),
    ]);
  }

  async function outcome(ctx: CommandContext, session: OpsSession, op: OpsOperation): Promise<Reply> {
    const { t } = ctx;
    return panel(ctx, [text(`## ${display(op.targetName)}`), text(`**${t(`ops.status.${op.status}`)}**${op.failure ? `\n${t(`ops.failure.${op.failure}`)}` : ''}`),
      text(`${op.requestedAt ? `${stamp(op.requestedAt)}\n` : ''}${t('ops.operator')}: ${display(op.actorName)}\n${t('ops.reason')}: ${display(op.reason)}`),
      ...(['left', 'absent'].includes(op.status) ? [text(purgeText(ctx, op.purgeSince ?? op.inactiveSince, op.completedAt ?? clock.now(), op.retentionDays)), text(t(op.deletionRequested ? 'ops.requestedDeletion' : 'ops.returnAllowed')),
        ...(!op.syncedAt ? [text(t('ops.syncPending'))] : [])] : []),
      text(t('ops.historyResult')), { kind: 'buttons', buttons: [
        button(ctx, session, 'ops.servers', 'servers'), button(ctx, session, 'ops.refresh', 'record', op.id), button(ctx, session, 'ops.history', 'history', 'all'),
      ] }, expiry(ctx, session)]);
  }
  async function safe(ctx: CommandContext, run: () => Promise<Reply>): Promise<Reply> {
    try { return await run(); }
    catch (error) {
      if (error instanceof AccessCheckError) return ephemeral(ctx.t(error.messageKey));
      if (error instanceof OpsError) return ephemeral(ctx.t(`ops.${error.reason}`));
      throw error;
    }
  }
  const deferred = (ctx: CommandContext, run: () => Promise<Reply>): Reply => ({ kind: 'deferred', ephemeral: true, update: ctx.interaction.message !== null, run: () => safe(ctx, run) });

  const command: CommandEntry = { path: ['picket-ops', 'servers'], description: 'ops.serversCommand', level: 'admin', availableWhenSuspended: true,
    handler: raw => { const ctx = local(raw); return Promise.resolve(deferred(ctx, async () => render(ctx, await service.start(ctx.interaction)))); } };
  const handler = async (raw: ComponentContext): Promise<Reply> => {
    const ctx = local(raw);
    return safe(ctx, async () => {
      const [sessionId, action, arg = '0', extra] = ctx.payload.split('.');
      if (!sessionId || !/^[a-f0-9]{32}$/.test(sessionId) || !action || extra) throw new OpsError('expired');
      const session = await service.session(sessionId, ctx.interaction);
      if (action === 'search' && ctx.interaction.kind === 'component') return { kind: 'modal', customId: id(session, 'query'), title: ctx.t('ops.search'),
        inputs: [{ customId: 'query', label: ctx.t('ops.searchLabel'), style: 'short', required: false, maxLength: 100, value: session.state.query }] };
      if (action === 'confirm' && ctx.interaction.kind === 'component') {
        const op = await service.repository.operation(arg);
        if (!op || op.sessionId !== session.id || op.status !== 'prepared' || op.expiresAt <= clock.now()) throw new OpsError('expired');
        return { kind: 'modal', customId: id(session, 'submit', op.id), title: ctx.t('ops.modalTitle'),
          description: `**${display(op.targetName)}**\n${ctx.t('ops.registered', { date: stamp(op.registeredAt) })}\n${ctx.t('ops.consequences')}\n${purgeText(ctx, op.inactiveSince)}\n${ctx.t(op.deletionRequested ? 'ops.requestedDeletion' : 'ops.returnAllowed')}\n${ctx.t('ops.modalHelp')}`,
          inputs: [
            { customId: 'reason', label: ctx.t('ops.reason'), style: 'paragraph', required: true, minLength: 10, maxLength: 500, placeholder: ctx.t('ops.reasonPlaceholder') },
            { customId: 'confirmation', label: ctx.t('ops.confirmation'), style: 'short', required: true, minLength: 7, maxLength: 7 },
          ] };
      }
      if (action === 'submit' && ctx.interaction.kind === 'modal') return deferred(ctx, async () => outcome(ctx, session,
        await service.submit(session, arg, ctx.interaction.fields.reason ?? '', ctx.interaction.fields.confirmation ?? '', async () => {
          if (!replies) return;
          await replies.editOriginal({ applicationId: ctx.interaction.applicationId, token: ctx.interaction.token }, {
            components: [text(ctx.t('ops.status.executing'))], accentColor: 0xe09f3e,
          });
        })));
      if (action === 'record' && ctx.interaction.kind === 'component') return deferred(ctx, async () => {
        const op = await service.repository.operation(arg);
        if (!op?.requestedAt) throw new OpsError('expired');
        return outcome(ctx, session, op);
      });
      const allowed = ctx.interaction.kind === 'modal' ? action === 'query' : ['servers', 'refresh', 'history', 'detail', 'filter', 'sort', 'next', 'prev', 'clear'].includes(action);
      if (!allowed) throw new OpsError('expired');
      return deferred(ctx, async () => {
        const state: OpsState = { ...session.state };
        if (action === 'servers') { state.view = 'servers'; state.target = null; state.page = 0; }
        if (action === 'history') { state.view = 'history'; state.target = arg === 'all' ? null : GuildId.assert(arg); state.page = 0; }
        if (action === 'detail') { state.view = 'detail'; state.target = GuildId.assert(arg); }
        if (action === 'next') state.page = Math.min(100_000, state.page + 1);
        if (action === 'prev') state.page = Math.max(0, state.page - 1);
        if (action === 'query') { state.query = (ctx.interaction.fields.query ?? '').trim().slice(0, 100); state.view = 'servers'; state.page = 0; }
        if (action === 'clear') { state.query = ''; state.page = 0; }
        const selected = ctx.interaction.selectedValues;
        if (action === 'filter') {
          if (selected.length !== 1 || !['present','absent','pending','all'].includes(selected[0]!)) throw new OpsError('invalid');
          state.filter = selected[0] as OpsState['filter']; state.page = 0;
        }
        if (action === 'sort') {
          if (selected.length !== 1 || !['name','recent'].includes(selected[0]!)) throw new OpsError('invalid');
          state.sort = selected[0] as OpsState['sort']; state.page = 0;
        }
        await service.repository.saveSession(session.id, state);
        return render(ctx, { ...session, state });
      });
    });
  };
  const family: ComponentFamily = { namespace: 'ops', version: 1, level: 'admin', availableWhenSuspended: true, onComponent: handler, onModal: handler };
  return { command, family };
}
