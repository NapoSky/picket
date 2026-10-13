import type { StatsConfig, StatsPeriod, StatsScope, VoiceObservation } from '../domain/model';

export interface StatsWriteStore {
  config(guildId: string): Promise<StatsConfig>;
  observe(event: VoiceObservation): Promise<void>;
}

export interface DurableVoiceBuffer {
  append(event: VoiceObservation): Promise<void>;
  replay(
    write: (event: VoiceObservation) => Promise<void>,
    limit?: number,
    shardIds?: readonly number[],
  ): Promise<number>;
  erase(guildId: string, userId: string): Promise<void>;
  eraseGuild?(guildId: string, userIds?: readonly string[]): Promise<void>;
  exportGuild?(guildId: string, maxBytes: number): Promise<readonly VoiceObservation[] | null>;
  isExcluded?(guildId: string, userId: string): Promise<boolean>;
  setExcluded?(guildId: string, userId: string, excluded: boolean): Promise<void>;
  personalGuildIds?(userId: string): Promise<readonly string[]>;
  status(): Promise<{ readonly bytes: number; readonly count: number; readonly oldest: string | null }>;
}

export interface ActivityReadModel {
  report(scope: StatsScope, period: StatsPeriod): Promise<unknown>;
}

export interface StatsPanelStore extends StatsWriteStore {
  configure(
    guildId: string,
    actorId: string,
    input: {
      readonly enabled?: boolean;
      readonly excludedChannels?: readonly string[];
      readonly memberRoles?: readonly string[];
    },
  ): Promise<'saved' | 'invalid_roles'>;
  privacy(guildId: string, userId: string): Promise<boolean>;
  setPrivacy(guildId: string, userId: string, optedOut: boolean, erase: boolean): Promise<void>;
  report(
    scope: StatsScope,
    period: StatsPeriod,
  ): Promise<{
    readonly from: string;
    readonly to: string;
    readonly truncated: boolean;
    readonly users: readonly {
      readonly guildId: string;
      readonly userId: string;
      readonly name: string;
      readonly seconds: number;
      readonly sessions: number;
      readonly lastActivity: string;
    }[];
  }>;
}
