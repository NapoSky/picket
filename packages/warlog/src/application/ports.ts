import type { Lease } from '@picket/coordination';
import type { WarZone } from '@picket/game-data';
import type { ChannelId, GuildId, UserId } from '@picket/kernel';
import type { MapData, MapLabel, PollSnapshot, StoredWarState, War, WarEvent, WarObject } from '../domain/model';

export interface WarApi {
  war(): Promise<War>;
  maps(): Promise<readonly string[]>;
  labels(region: string): Promise<readonly MapLabel[]>;
  map(region: string): Promise<MapData>;
  reset(): void;
  stop(): void;
}
export interface Subscription {
  readonly perspective: War['winner'];
  readonly channelId: ChannelId | null;
  readonly zones: readonly WarZone[];
  readonly locale: string | null;
  readonly paused: boolean;
  readonly confirmedWar: number | null;
  readonly revision: number;
  readonly failureReason: string | null;
}
export interface Delivery {
  readonly id: string; readonly guildId: GuildId; readonly channelId: ChannelId;
  readonly perspective: War['winner'];
  readonly event: WarEvent | { readonly type: 'renew'; readonly war: number };
  readonly locale: string | null; readonly generation: string; readonly revision: number; readonly attempts: number;
}
export type SettingsChange = { readonly kind: 'channel'; readonly channelId: ChannelId; readonly locale: string }
  | { readonly kind: 'perspective'; readonly perspective: War['winner'] }
  | { readonly kind: 'zones'; readonly zones: readonly WarZone[] }
  | { readonly kind: 'enable'; readonly war: number }
  | { readonly kind: 'disable' };
export type SettingsResult = 'saved' | 'unchanged' | 'stale_war' | 'not_ready' | 'invalid' | 'suspended';
export interface WarStateReader { state(): Promise<StoredWarState>; objects(region?: string): Promise<readonly WarObject[]> }
export interface WarStore extends WarStateReader {
  recover(lease: Lease): Promise<boolean>;
  commit(lease: Lease, snapshot: PollSnapshot, events: readonly WarEvent[], baseline: boolean, now: Date): Promise<boolean>;
  subscription(guildId: GuildId): Promise<Subscription>;
  configure(guildId: GuildId, actor: UserId, change: SettingsChange, now: Date): Promise<SettingsResult>;
  guilds(): Promise<readonly GuildId[]>;
  hookGuilds(): Promise<readonly GuildId[]>;
  claim(guildId: GuildId, now: Date): Promise<Delivery | null>;
  valid(delivery: Delivery): Promise<boolean>;
  finish(delivery: Delivery, outcome: { readonly kind: 'sent'; readonly messageId: string } | { readonly kind: 'retry' | 'blocked'; readonly reason: string }, now: Date): Promise<void>;
  channelChanged(guildId: GuildId, channelId: ChannelId): Promise<void>;
  runHook(guildId: GuildId, reset: (war: number, startedAt: Date) => Promise<void>, now: Date): Promise<void>;
}
