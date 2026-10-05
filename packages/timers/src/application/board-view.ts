import {
  MAX_EMBEDS_PER_MESSAGE,
  MAX_EMBEDS_TOTAL_LENGTH,
  MAX_EMBED_FIELDS,
  MAX_FIELD_NAME,
  MAX_FIELD_VALUE,
  embedsLength,
  type ButtonView,
  type EmbedFieldView,
  type EmbedView,
  type MessageView,
} from '@picket/discord';
import { findLocation, findRegion } from '@picket/game-data';
import { ASSET_TYPES } from '../domain/asset-types';
import { compareAssets, displayedMoment, isExpired, type TimerAsset } from '../domain/asset';
import { MAX_ACTIVE_PER_PAGE, BOARD_COLOR } from '../domain/constants';
import { contentHash } from '../domain/hash';
import { refreshCustomId } from './custom-ids';

/** Textes déjà traduits par l'appelant : le rendu ne connaît aucune langue. */
export interface BoardTexts {
  readonly title: string;
  readonly empty: string;
  readonly footer: (page: number, total: number) => string;
}

export const BOARD_ICONS = { region: '🏞️', location: '🏙️', struck: '❌', expired: '⌛' } as const;

export interface RenderedPage {
  readonly view: MessageView;
  readonly hash: string;
  /** Assets actifs de la page, dans l'ordre des boutons. */
  readonly activeAssetIds: readonly string[];
}

// Marge pour le titre, le pied de page et les messages traduits plus longs que prévu.
const RESERVED_CHARACTERS = 300;
const FIELDS_BUDGET = MAX_EMBEDS_TOTAL_LENGTH - RESERVED_CHARACTERS;
const MAX_FIELDS_PER_PAGE = MAX_EMBED_FIELDS * MAX_EMBEDS_PER_MESSAGE;

/** Texte d'un nom saisi par un utilisateur : ni mise en forme, ni lien, ni mention. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_~`|>#[\]])/gu, '\\$1').replace(/@/gu, '@\u200b').replace(/</gu, '<\u200b');
}

/** Lettre régionale 🇦 à 🇾 : identifie un asset actif au sein de sa page, rien de plus. */
export const indicatorEmoji = (index: number): string => String.fromCodePoint(0x1f1e6 + index);

const unix = (date: Date): number => Math.floor(date.getTime() / 1000);

interface Entry {
  readonly asset: TimerAsset;
  /** Rang parmi les assets actifs de la page, `null` pour un asset barré. */
  readonly index: number | null;
}

function assetLine(entry: Entry, now: Date): string {
  const { asset, index } = entry;
  const icon = ASSET_TYPES[asset.type].icon;
  const name = escapeMarkdown(asset.name);
  const code = asset.code === null ? '' : ` \`${asset.code}\``;
  const moment = `<t:${unix(displayedMoment(asset))}:R>`;
  const owner = `<@${asset.ownerId}>`;
  if (asset.status === 'struck' || index === null) return `~~${BOARD_ICONS.struck}・${icon} ${name}${code}・${moment}~~・${owner}`;
  const expired = isExpired(asset, now) ? `${BOARD_ICONS.expired} ` : '';
  return `${indicatorEmoji(index)}・${icon} **${name}**${code}・${expired}${moment}・${owner}`;
}

function headerOf(asset: TimerAsset): string {
  const region = findRegion(asset.regionKey)?.name ?? asset.regionKey;
  const location = findLocation(asset.regionKey, asset.locationKey)?.name ?? asset.locationKey;
  const header = `${BOARD_ICONS.region} ${region}・${BOARD_ICONS.location} ${location}`;
  return header.length > MAX_FIELD_NAME ? `${header.slice(0, MAX_FIELD_NAME - 1)}…` : header;
}

/** Un champ par lieu ; un lieu trop chargé pour 1 024 caractères continue dans un champ de même titre. */
function buildFields(entries: readonly Entry[], now: Date): EmbedFieldView[] {
  const fields: { name: string; lines: string[]; length: number }[] = [];
  for (const entry of entries) {
    const name = headerOf(entry.asset);
    const line = assetLine(entry, now);
    const last = fields[fields.length - 1];
    if (last !== undefined && last.name === name && last.length + 1 + line.length <= MAX_FIELD_VALUE) {
      last.lines.push(line);
      last.length += 1 + line.length;
    } else {
      fields.push({ name, lines: [line], length: line.length });
    }
  }
  return fields.map((field) => ({ name: field.name, value: field.lines.join('\n') }));
}

const fieldsLength = (fields: readonly EmbedFieldView[]): number => fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);

/** Affecte les rangs de boutons : 🇦 à 🇾 parmi les seuls assets actifs de la page. */
function withIndexes(assets: readonly TimerAsset[]): Entry[] {
  let next = 0;
  return assets.map((asset) => (asset.status === 'active' ? { asset, index: next++ } : { asset, index: null }));
}

/**
 * Découpe déterministe en pages : 25 boutons au plus, 6 000 caractères d'embed au plus, 10 embeds de 25 champs au plus.
 * Un asset barré ne coûte pas de bouton mais reste à sa place triée.
 */
function paginate(sorted: readonly TimerAsset[], now: Date): TimerAsset[][] {
  const pages: TimerAsset[][] = [[]];
  for (const asset of sorted) {
    const current = pages[pages.length - 1] as TimerAsset[];
    const candidate = [...current, asset];
    const fields = buildFields(withIndexes(candidate), now);
    const tooMany = candidate.filter((item) => item.status === 'active').length > MAX_ACTIVE_PER_PAGE;
    const tooLong = fieldsLength(fields) > FIELDS_BUDGET || fields.length > MAX_FIELDS_PER_PAGE;
    if (current.length > 0 && (tooMany || tooLong)) pages.push([asset]);
    else pages[pages.length - 1] = candidate;
  }
  return pages;
}

function assemble(assets: readonly TimerAsset[], pageIndex: number, total: number, texts: BoardTexts, now: Date): RenderedPage {
  const entries = withIndexes(assets);
  const fields = buildFields(entries, now);
  const embeds: EmbedView[] = [];
  for (let start = 0; start < fields.length; start += MAX_EMBED_FIELDS) {
    embeds.push({ fields: fields.slice(start, start + MAX_EMBED_FIELDS), color: BOARD_COLOR });
  }
  if (embeds.length === 0) embeds.push({ description: texts.empty, color: BOARD_COLOR });

  const labelled = embeds.map((embed, position): EmbedView => ({
    ...embed,
    ...(position === 0 ? { title: texts.title } : {}),
    ...(position === embeds.length - 1 && total > 1 ? { footer: texts.footer(pageIndex + 1, total) } : {}),
  }));
  if (embedsLength(labelled) > MAX_EMBEDS_TOTAL_LENGTH) throw new RangeError('Board page over the embed budget');

  const buttons: ButtonView[] = entries
    .filter((entry): entry is Entry & { index: number } => entry.index !== null)
    .map((entry) => ({ customId: refreshCustomId(entry.asset.id), emoji: indicatorEmoji(entry.index) }));
  const view: MessageView = { embeds: labelled, buttons };
  return {
    view,
    hash: contentHash(JSON.stringify(view)),
    activeAssetIds: entries.filter((entry) => entry.index !== null).map((entry) => entry.asset.id),
  };
}

/**
 * Fonction pure : le même état donne toujours les mêmes messages. Au moins une page, même sans asset, pour que le
 * board ait toujours un message à modifier.
 */
export function renderBoard(input: { readonly assets: readonly TimerAsset[]; readonly texts: BoardTexts; readonly now: Date }): RenderedPage[] {
  const sorted = [...input.assets].sort(compareAssets);
  const pages = paginate(sorted, input.now);
  return pages.map((assets, index) => assemble(assets, index, pages.length, input.texts, input.now));
}
