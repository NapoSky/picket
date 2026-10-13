import { WAR_ICONS, WAR_STRUCTURES, type StructureCode } from '@picket/game-data';

export interface War { readonly id: string; readonly number: number; readonly startedAt: number | null; readonly endedAt: number | null; readonly winner: 'NONE' | 'WARDENS' | 'COLONIALS' }
export const isActiveWar = (war: War): boolean => war.startedAt !== null && war.endedAt === null;
export interface MapItem { readonly iconType: number; readonly x: number; readonly y: number; readonly flags: number; readonly teamId: War['winner'] }
export interface MapLabel { readonly text: string; readonly x: number; readonly y: number; readonly major: boolean }
export interface MapData { readonly version: number; readonly updatedAt: number; readonly items: readonly MapItem[] }
export interface WarObject { readonly key: string; readonly region: string; readonly code: StructureCode; readonly x: number; readonly y: number; readonly location: string; readonly state: string; readonly stateAt: number }
export const EVENT_TYPES = ['appeared', 'disappeared', 'scorched', 'no_longer_scorched', 'didnt_build', 'lost', 'building', 'upgrading', 'claimed', 'couldnt_upgrade', 'upgraded', 'built', 'launch_detected', 'launch_destroyed', 'launch_armed', 'launch_disarmed', 'rocket_targeting', 'rocket_hit', 'rocket_no_target', 'rocket_forgotten', 'sc_built', 'sc_destroyed', 'ic_built', 'ic_destroyed', 'ws_built', 'ws_destroyed', 'sc_dried', 'ic_dried', 'ws_dried', 'war_ended'] as const;
export type EventType = typeof EVENT_TYPES[number];
export interface WarEvent { readonly type: EventType; readonly war: number; readonly object: WarObject | null; readonly faction: War['winner']; readonly tier?: number; readonly occurredAt: number; readonly detectedAt: number }
export interface PollSnapshot { readonly war: War; readonly regions: Readonly<Record<string, MapData>>; readonly objects: Readonly<Record<string, WarObject>> }
/** Collection metadata; tracked structures are exposed separately by WarStateReader.objects(). */
export interface StoredWarState { readonly generation: string; readonly available: boolean; readonly highestWar: number; readonly snapshot: Pick<PollSnapshot, 'war' | 'regions'> | null }

export function closestLabel(code: StructureCode, x: number, y: number, labels: readonly MapLabel[], fallback: string): string {
  const majors = labels.filter(label => label.major);
  const candidates = ['1A', '1B', '1C', '2A'].includes(code) && majors.length ? majors : labels;
  return [...candidates].sort((a, b) => ((a.x - x) ** 2 + (a.y - y) ** 2) - ((b.x - x) ** 2 + (b.y - y) ** 2) || a.text.localeCompare(b.text))[0]?.text ?? fallback;
}

export function mapObject(region: string, item: MapItem, labels: readonly MapLabel[], at: number, previous?: WarObject): WarObject | null {
  const iconCode = WAR_ICONS[item.iconType];
  if (!iconCode) return null;
  const code = iconCode === '1B' && (item.flags & 1) ? '1A' : iconCode;
  if (!WAR_STRUCTURES[code].tracked) return null;
  const tier = ({ 56: 1, 57: 2, 58: 3, 35: 1 } as Record<number, number>)[item.iconType] ?? 0;
  let state: string;
  if (item.flags & 16) state = `${tier}S`;
  else if (item.teamId === 'NONE') state = code.startsWith('3') || code.startsWith('4') ? '?' : '0N';
  else {
    const blueprint = Boolean(item.flags & 4) || item.iconType === 37 || item.iconType === 70;
    const suffix = item.teamId === 'WARDENS' ? blueprint ? 'V' : 'W' : blueprint ? 'K' : 'C';
    let level = tier;
    if (blueprint && previous && ['1A', '1B', '2A'].includes(code)) {
      if (previous.state.endsWith(suffix)) level = Number(previous.state[0]);
      else if (previous.state.endsWith(item.teamId === 'WARDENS' ? 'W' : 'C')) level = Math.min(code === '2A' ? 2 : 3, Number(previous.state[0]) + 1);
    }
    state = `${level}${suffix}`;
  }
  const x = Number(item.x.toFixed(5)), y = Number(item.y.toFixed(5));
  return { key: `${region}:${code}:${x.toFixed(5)}:${y.toFixed(5)}`, region, code, x, y, location: closestLabel(code, x, y, labels, region), state, stateAt: previous?.state === state ? previous.stateAt : at };
}

const factionOf = (state: string): War['winner'] => /[WV]$/.test(state) ? 'WARDENS' : /[CK]$/.test(state) ? 'COLONIALS' : 'NONE';

export function objectEvent(before: WarObject | undefined, after: WarObject | undefined, war: number, occurredAt: number, detectedAt: number): WarEvent | null {
  const object = after ?? before;
  if (!object || before?.state === after?.state || after?.state === '?' || (before?.state === '?' && after?.state === '0N')) return null;
  const old = before?.state === '?' ? '0N' : before?.state ?? '', next = after?.state ?? '';
  const os = old.slice(-1), ns = next.slice(-1), code = object.code;
  let faction = factionOf(next) !== 'NONE' ? factionOf(next) : factionOf(old);
  let type: EventType;
  if (code === '4A') {
    type = !old || os === 'N' ? 'launch_detected' : !next || ns === 'N' ? 'launch_destroyed' : /[VK]/.test(os) && /[WC]/.test(ns) ? 'launch_armed' : /[WC]/.test(os) && /[VK]/.test(ns) ? 'launch_disarmed' : 'launch_detected';
  } else if (code === '4B') {
    if (/[VK]/.test(ns) && ns) type = 'rocket_targeting';
    else if (/[WC]/.test(ns) && ns) type = 'rocket_hit';
    else if (!next || ns === 'N') type = /[VK]/.test(os) && os ? 'rocket_no_target' : 'rocket_forgotten';
    else return null;
  } else if (code.startsWith('3')) {
    const prefix = code === '3A' ? 'sc' : code === '3B' ? 'ic' : 'ws';
    if (!old || os === 'N') type = `${prefix}_built`;
    else if (!next || ns === 'N' || ns === 'S') { type = `${prefix}_destroyed`; faction = factionOf(old); }
    else return null;
  } else if (!old) type = 'appeared';
  else if (!next) { type = 'disappeared'; faction = factionOf(old); }
  else if (ns === 'S') { type = 'scorched'; faction = factionOf(old); }
  else if (ns === 'N') { type = os === 'S' ? 'no_longer_scorched' : /[VK]/.test(os) ? 'didnt_build' : 'lost'; faction = factionOf(old); }
  else if (/[VK]/.test(ns)) type = Number(next[0]) >= 2 ? 'upgrading' : 'building';
  else if (['1A', '1B', '1C'].includes(code)) type = !/[VK]/.test(os) || Number(old[0]) <= 1 ? 'claimed' : Number(next[0]) < Number(old[0]) ? 'couldnt_upgrade' : 'upgraded';
  else type = code.startsWith('5') ? 'claimed' : 'built';
  const level = Number((['lost', 'disappeared', 'scorched', 'didnt_build', 'couldnt_upgrade'].includes(type) ? old : next)[0]);
  return { type, war, object, faction, ...(level > 0 ? { tier: level } : {}), occurredAt, detectedAt };
}

/** First snapshot is a baseline. Only complete, newer observations are compared. */
export function snapshotEvents(before: PollSnapshot, after: PollSnapshot, detectedAt: number): readonly WarEvent[] {
  const events: WarEvent[] = [];
  for (const region of Object.keys(after.regions)) {
    const oldMap = before.regions[region], newMap = after.regions[region]!;
    if (!oldMap || (oldMap.version === newMap.version && oldMap.updatedAt === newMap.updatedAt)) continue;
    if (newMap.updatedAt < oldMap.updatedAt || newMap.version < oldMap.version) throw new Error('Map observation moved backwards');
    const keys = new Set([...Object.values(before.objects), ...Object.values(after.objects)].filter(obj => obj.region === region).map(obj => obj.key));
    for (const key of keys) {
      const event = objectEvent(before.objects[key], after.objects[key], after.war.number, newMap.updatedAt, detectedAt);
      if (event) events.push(event);
    }
  }
  return events;
}
