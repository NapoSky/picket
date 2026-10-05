import type { Translator } from '@picket/i18n';
import type { MessageView } from '@picket/discord';
import { findLocation, findRegion } from '@picket/game-data';
import { ASSET_TYPES } from '../domain/asset-types';
import { deadline, type TimerAsset } from '../domain/asset';
import type { BoardSettings } from '../domain/board-settings';
import { escapeMarkdown, type BoardTexts } from './board-view';
import { ackCustomId } from './custom-ids';

type T = Translator['t'];

export function boardTexts(t: T): BoardTexts {
  return {
    title: t('timers.board.title'),
    empty: t('timers.board.empty'),
    footer: (page, total) => t('timers.board.footer', { page, total }),
  };
}

export const ALERT_ACK_EMOJI = '✅';

/**
 * Message d'alerte : seuls les rôles configurés du board sont mentionnés (jamais autre chose), et sans notification
 * push si le board est en mode silencieux.
 */
export function buildAlertView(asset: TimerAsset, thresholdMin: number, settings: BoardSettings, t: T): MessageView {
  const end = deadline(asset);
  const region = findRegion(asset.regionKey)?.name ?? asset.regionKey;
  const location = findLocation(asset.regionKey, asset.locationKey)?.name ?? asset.locationKey;
  const text = t('timers.alert.text', {
    icon: ASSET_TYPES[asset.type].icon,
    name: escapeMarkdown(asset.name),
    place: `${location}, ${region}`,
    time: end === null ? '' : `<t:${Math.floor(end.getTime() / 1000)}:R>`,
  });
  const mentions = settings.alertRoleIds.map((id) => `<@&${id}>`).join(' ');
  return {
    embeds: [],
    buttons: [{ customId: ackCustomId(asset.id, thresholdMin), emoji: ALERT_ACK_EMOJI }],
    content: mentions === '' ? text : `${mentions} ${text}`,
    mentionRoleIds: settings.alertRoleIds,
    silent: settings.alertSilent,
  };
}
