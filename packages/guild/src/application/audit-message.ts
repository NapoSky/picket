import { MAX_MESSAGE_CONTENT, type MessageView } from '@picket/discord';
import type { MessageKey, Translator } from '@picket/i18n';
import type { AuditEvent } from './publish-guild-audit';

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const singleLine = (value: string) => value.replace(/\s+/g, ' ').trim();
const clip = (value: string, limit = 250) => value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
const escape = (value: unknown) => clip(singleLine(String(value)).replace(/([\\`*_~|<>])/g, '\\$1'));
const snowflake = (value: unknown): value is string => typeof value === 'string' && /^\d{17,20}$/.test(value);
const TITLES: Readonly<Record<string, MessageKey>> = {
  'settings.language': 'audit.language', 'settings.timezone': 'audit.timezone', 'settings.audit_channel': 'audit.channel',
  'settings.feature': 'audit.feature', 'permissions.add': 'audit.permissions', 'permissions.remove': 'audit.permissions',
  'permissions.role_deleted': 'audit.roleDeleted', 'guild.deletion_requested': 'audit.suspended',
  'guild.deletion_cancelled': 'audit.resumed', 'guild.left': 'audit.departed', 'guild.left_while_offline': 'audit.departed', 'guild.rejoined': 'audit.returned',
  'audit.test': 'audit.test', add: 'audit.timerCreated', reactivate: 'audit.timerReactivated', strike: 'audit.timerStruck',
  cleanup: 'audit.timerCleanup', auto_purge: 'audit.timerCleanup', reset_war: 'audit.timerReset',
  acknowledge: 'audit.alertAcknowledged', 'todolist.created': 'audit.todolistCreated',
};
const TIMER_ACTIONS = new Set(['add', 'reactivate', 'strike', 'cleanup', 'auto_purge', 'reset_war', 'acknowledge']);

export function auditMessage(event: AuditEvent, t: Translator['t']): MessageView {
  const parts: string[] = [];
  const before = object(event.before), after = object(event.after), detail = object(event.detail);
  const value = (key: string, raw: unknown): string => {
    if (key === 'language') return raw === null ? t('status.languageAuto') : escape(raw);
    if (key === 'auditChannelId' && snowflake(raw)) return `<#${raw}>`;
    if ((key === 'member' || key === 'officer') && Array.isArray(raw)) {
      const roles = raw.filter(snowflake);
      return roles.length === 0 ? t('levels.none') : roles.slice(0, 6).map((id) => id === event.guildId ? '@everyone' : `<@&${id}>`).join(', ') + (roles.length > 6 ? ` (+${roles.length - 6})` : '');
    }
    if (raw === null || raw === undefined) return t('levels.none');
    return escape(raw);
  };
  for (const key of ['language', 'timezone', 'auditChannelId', 'features', 'member', 'officer']) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    if ((key === 'member' || key === 'officer') && Array.isArray(before[key]) && Array.isArray(after[key])) {
      const oldRoles = before[key] as unknown[], newRoles = after[key] as unknown[];
      const added = newRoles.filter((id) => !oldRoles.includes(id)), removed = oldRoles.filter((id) => !newRoles.includes(id));
      const level = t(key === 'member' ? 'audit.memberAccess' : 'audit.officerAccess');
      if (added.length) parts.push(`${level} : + ${value(key, added)}`);
      if (removed.length) parts.push(`${level} : − ${value(key, removed)}`);
    } else if (key === 'features') {
      const previous = object(before.features), next = object(after.features);
      for (const feature of ['timers', 'todolists'] as const) {
        if (previous[feature] !== next[feature]) parts.push(`${t(`features.${feature}`)} : ${t(previous[feature] === true ? 'panel.enabled' : 'panel.disabled')} → ${t(next[feature] === true ? 'panel.enabled' : 'panel.disabled')}`);
      }
    } else parts.push(`${value(key, before[key])} → ${value(key, after[key])}`);
  }
  if (event.assetId !== null) parts.push(`${escape(detail.name ?? event.assetId)}${detail.code ? ` (${escape(detail.code)})` : ''}`);
  if (detail.region || detail.location) parts.push([detail.region, detail.location].filter(Boolean).map(escape).join(' / '));
  if (typeof detail.count === 'number') parts.push(`${t('audit.count')} : ${detail.count}`);
  if (typeof detail.thresholdMin === 'number') parts.push(`${detail.thresholdMin} min`);
  if (snowflake(event.sourceChannelId)) parts.push(`<#${event.sourceChannelId}>`);
  if (event.action === 'todolist.created') {
    if (typeof detail.messages === 'number') parts.push(t('audit.pageCount', { count: detail.messages }));
    const first = Array.isArray(detail.message_ids) ? detail.message_ids.find(snowflake) : undefined;
    if (snowflake(detail.channel_id) && first) parts.push(`[${t('audit.open')}](https://discord.com/channels/${event.guildId}/${detail.channel_id}/${first})`);
  }
  const icon = event.action === 'todolist.created' ? '📋' : TIMER_ACTIONS.has(event.action) ? '⏱️' : '⚙️';
  const heading = `${icon} **${singleLine(t(TITLES[event.action] ?? 'audit.configuration'))}**`;
  const tail = ` · ${singleLine(t('audit.actor', { actor: snowflake(event.actor) ? `<@${event.actor}>` : t('audit.system') }))} · <t:${Math.floor(event.at.getTime() / 1000)}:f>`;
  let content = heading;
  // Garder l'auteur et l'heure ; omettre les derniers détails plutôt que couper un lien ou une mention.
  for (const part of parts) {
    const addition = ` · ${singleLine(part)}`;
    if (content.length + addition.length + tail.length + 4 > MAX_MESSAGE_CONTENT) { content += ' · …'; break; }
    content += addition;
  }
  return { nonce: `pa${event.id}`, silent: true, suppressEmbeds: true, buttons: [], embeds: [], content: content + tail };
}
