import {
  MAX_EMBEDS_PER_MESSAGE,
  MAX_EMBEDS_TOTAL_LENGTH,
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
import { compareAssets, displayedMoment, type TimerAsset } from '../domain/asset';
import { BOARD_COLOR, DEFAULT_LOCATION_EMOJI, DEFAULT_REGION_EMOJI, MAX_ACTIVE_PER_PAGE } from '../domain/constants';
import { contentHash } from '../domain/hash';
import { refreshCustomId } from './custom-ids';

/** Text already translated by the caller: rendering is locale-independent. */
export interface BoardTexts {
  readonly title: string;
  readonly empty: string;
  /** First message footer: board's last modification timestamp. */
  readonly updated: string;
  readonly assetColumn: string;
  readonly codeColumn: string;
  readonly timerColumn: string;
}

export interface BoardIcons {
  readonly region: string;
  readonly location: string;
}

export const DEFAULT_BOARD_ICONS: BoardIcons = { region: DEFAULT_REGION_EMOJI, location: DEFAULT_LOCATION_EMOJI };

export const STRUCK_ICON = '❌';
/** Thin space: separate the type icon from the letter without widening the column. */
const THIN_SPACE = '\u2009';
const ZERO_WIDTH = '\u200b';

export interface RenderedPage {
  readonly view: MessageView;
  /** Content hash excluding the update date: edit a page only when its content changes. */
  readonly hash: string;
  /** Active assets on the page, in button order. */
  readonly activeAssetIds: readonly string[];
}

// Margin for the title, footer and unexpectedly long translations.
const RESERVED_CHARACTERS = 300;
const FIELDS_BUDGET = MAX_EMBEDS_TOTAL_LENGTH - RESERVED_CHARACTERS;
// Each location uses 4 fields (header and three columns): 6 locations per embed, as on the original server.
const FIELDS_PER_EMBED = 24;
const COLUMN_LIMIT = MAX_FIELD_VALUE - 24;

/** User-entered name text: no formatting, links or mentions. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_~`|>#[\]])/gu, '\\$1').replace(/@/gu, '@\u200b').replace(/</gu, '<\u200b');
}

/** Regional indicator 🇦 to 🇾: identifies an active asset within its page, nothing more. */
export const indicatorEmoji = (index: number): string => String.fromCodePoint(0x1f1e6 + index);

const unix = (date: Date): number => Math.floor(date.getTime() / 1000);

interface Entry {
  readonly asset: TimerAsset;
  /** Rank among the page's active assets, `null` for a struck asset. */
  readonly index: number | null;
}

interface Columns {
  readonly names: string[];
  readonly codes: string[];
  readonly timers: string[];
}

function rowOf(entry: Entry): { name: string; code: string; timer: string } {
  const { asset, index } = entry;
  const type = ASSET_TYPES[asset.type];
  const name = escapeMarkdown(asset.name);
  const moment = `<t:${unix(displayedMoment(asset))}:R>`;
  if (asset.status === 'struck' || index === null) {
    return {
      name: `~~${type.icon}${THIN_SPACE}${STRUCK_ICON}・${name}~~`,
      code: `~~${asset.code ?? ZERO_WIDTH}~~`,
      timer: `~~${moment}~~`,
    };
  }
  return {
    name: `${type.icon}${THIN_SPACE}${indicatorEmoji(index)}・${name}`,
    code: asset.code ?? ZERO_WIDTH,
    timer: type.showOwner ? `${moment}・<@${asset.ownerId}>` : moment,
  };
}

const sameCity = (a: TimerAsset, b: TimerAsset): boolean => a.regionKey === b.regionKey && a.locationKey === b.locationKey;

/**
 * Match the original server: each location has a header (show the region only when it changes), then three
 * adjacent columns: Asset, Code and Timer. A location exceeding 1,024 characters per column continues in
 * another column group without a repeated header.
 */
function buildFieldGroups(entries: readonly Entry[], texts: BoardTexts, icons: BoardIcons): EmbedFieldView[][] {
  const groups: EmbedFieldView[][] = [];
  let previousRegion: string | null = null;

  for (let start = 0; start < entries.length; ) {
    let end = start + 1;
    while (end < entries.length && sameCity((entries[end] as Entry).asset, (entries[start] as Entry).asset)) end += 1;
    const city = entries.slice(start, end);
    const first = (city[0] as Entry).asset;

    const regionName = findRegion(first.regionKey)?.name ?? first.regionKey;
    const locationName = findLocation(first.regionKey, first.locationKey)?.name ?? first.locationKey;
    const header: EmbedFieldView = {
      name: first.regionKey !== previousRegion ? clip(`${icons.region} ${regionName}`, MAX_FIELD_NAME) : ZERO_WIDTH,
      value: clip(`${icons.location} **${locationName}**`, MAX_FIELD_VALUE),
    };
    previousRegion = first.regionKey;

    const chunks: Columns[] = [];
    let current: Columns = { names: [], codes: [], timers: [] };
    const lengths = { names: 0, codes: 0, timers: 0 };
    for (const entry of city) {
      const row = rowOf(entry);
      const overflow =
        lengths.names + row.name.length + 1 > COLUMN_LIMIT ||
        lengths.codes + row.code.length + 1 > COLUMN_LIMIT ||
        lengths.timers + row.timer.length + 1 > COLUMN_LIMIT;
      if (overflow && current.names.length > 0) {
        chunks.push(current);
        current = { names: [], codes: [], timers: [] };
        lengths.names = lengths.codes = lengths.timers = 0;
      }
      current.names.push(row.name);
      current.codes.push(row.code);
      current.timers.push(row.timer);
      lengths.names += row.name.length + 1;
      lengths.codes += row.code.length + 1;
      lengths.timers += row.timer.length + 1;
    }
    chunks.push(current);

    chunks.forEach((chunk, position) => {
      groups.push([
        ...(position === 0 ? [header] : []),
        { name: texts.assetColumn, value: chunk.names.join('\n'), inline: true },
        { name: texts.codeColumn, value: chunk.codes.join('\n'), inline: true },
        { name: texts.timerColumn, value: chunk.timers.join('\n'), inline: true },
      ]);
    });
    start = end;
  }

  // An empty line separates locations visually, except after the last one.
  groups.forEach((group, position) => {
    if (position === groups.length - 1) return;
    const last = group[group.length - 1] as EmbedFieldView;
    group[group.length - 1] = { ...last, value: `${last.value}\n${ZERO_WIDTH}` };
  });
  return groups;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const fieldsLength = (groups: readonly (readonly EmbedFieldView[])[]): number =>
  groups.reduce((sum, group) => sum + group.reduce((inner, field) => inner + field.name.length + field.value.length, 0), 0);

/** Assign button ranks: 🇦 to 🇾 among the page's active assets only. */
function withIndexes(assets: readonly TimerAsset[]): Entry[] {
  let next = 0;
  return assets.map((asset) => (asset.status === 'active' ? { asset, index: next++ } : { asset, index: null }));
}

/**
 * Deterministic pagination: at most 25 buttons, 6,000 embed characters and 10 embeds. A struck asset needs
 * no button but keeps its sorted position.
 */
function paginate(sorted: readonly TimerAsset[], texts: BoardTexts, icons: BoardIcons): TimerAsset[][] {
  const pages: TimerAsset[][] = [[]];
  for (const asset of sorted) {
    const current = pages[pages.length - 1] as TimerAsset[];
    const candidate = [...current, asset];
    const groups = buildFieldGroups(withIndexes(candidate), texts, icons);
    const tooMany = candidate.filter((item) => item.status === 'active').length > MAX_ACTIVE_PER_PAGE;
    const tooLong = fieldsLength(groups) > FIELDS_BUDGET || embedsNeeded(groups) > MAX_EMBEDS_PER_MESSAGE;
    if (current.length > 0 && (tooMany || tooLong)) pages.push([asset]);
    else pages[pages.length - 1] = candidate;
  }
  return pages;
}

function splitIntoEmbeds(groups: readonly (readonly EmbedFieldView[])[]): EmbedFieldView[][] {
  const embeds: EmbedFieldView[][] = [];
  let current: EmbedFieldView[] = [];
  for (const group of groups) {
    if (current.length > 0 && current.length + group.length > FIELDS_PER_EMBED) {
      embeds.push(current);
      current = [];
    }
    current.push(...group);
  }
  if (current.length > 0) embeds.push(current);
  return embeds;
}

const embedsNeeded = (groups: readonly (readonly EmbedFieldView[])[]): number => splitIntoEmbeds(groups).length;

function assemble(
  assets: readonly TimerAsset[],
  pageIndex: number,
  texts: BoardTexts,
  icons: BoardIcons,
  now: Date,
): RenderedPage {
  const entries = withIndexes(assets);
  const embedFields = splitIntoEmbeds(buildFieldGroups(entries, texts, icons));

  const bodies: EmbedView[] =
    embedFields.length === 0
      ? [{ description: texts.empty, color: BOARD_COLOR }]
      : embedFields.map((fields) => ({ fields, color: BOARD_COLOR }));
  // The title opens each message; show the last-update timestamp only below the first message.
  const embeds = bodies.map((embed, position): EmbedView => ({
    ...embed,
    ...(position === 0 ? { title: texts.title } : {}),
    ...(position === 0 && pageIndex === 0 ? { footer: texts.updated } : {}),
  }));
  if (embedsLength(embeds) > MAX_EMBEDS_TOTAL_LENGTH) throw new RangeError('Board page over the embed budget');

  const buttons: ButtonView[] = entries
    .filter((entry): entry is Entry & { index: number } => entry.index !== null)
    .map((entry) => ({ customId: refreshCustomId(entry.asset.id), emoji: indicatorEmoji(entry.index) }));
  const hash = contentHash(JSON.stringify({ embeds, buttons }));
  const stamped = pageIndex === 0 ? embeds.map((embed, position) => (position === 0 ? { ...embed, timestamp: now.toISOString() } : embed)) : embeds;
  return {
    view: { embeds: stamped, buttons },
    hash,
    activeAssetIds: entries.filter((entry) => entry.index !== null).map((entry) => entry.asset.id),
  };
}

/**
 * Pure function: the same state always produces the same messages. Keep at least one page, even without
 * assets, so the board always has a message to edit.
 */
export function renderBoard(input: {
  readonly assets: readonly TimerAsset[];
  readonly texts: BoardTexts;
  readonly now: Date;
  readonly icons?: BoardIcons;
}): RenderedPage[] {
  const icons = input.icons ?? DEFAULT_BOARD_ICONS;
  const sorted = [...input.assets].sort(compareAssets);
  const pages = paginate(sorted, input.texts, icons);
  return pages.map((assets, index) => assemble(assets, index, input.texts, icons, input.now));
}
