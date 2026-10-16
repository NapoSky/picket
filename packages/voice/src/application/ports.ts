import type { GuildId, UserId } from '@picket/kernel';
import type { GatewayEventHandler } from '@picket/discord';
import type {
  TemplateInput,
  VoiceChannel,
  VoiceDraft,
  VoiceSession,
  VoiceTemplate,
} from '../domain/model';
export interface VoiceIdentity {
  guildId: GuildId;
  userId: UserId;
  roleIds: readonly string[];
}
export interface ManagedVoiceChannel {
  channelId: string;
  categoryId: string;
  templateId: string;
  templateName: string;
  name: string;
}
export interface VoiceDiscord {
  category(
    guildId: GuildId,
    categoryId: string,
    identity?: VoiceIdentity,
    fresh?: boolean,
  ): Promise<void>;
  create(guildId: GuildId, input: TemplateInput, name: string): Promise<string>;
  orderChannels(
    guildId: GuildId,
    channels: readonly ManagedVoiceChannel[],
  ): Promise<void>;
  exists(guildId: GuildId, channelId: string): Promise<boolean>;
  remove(channelId: string): Promise<void>;
}
export interface VoiceService {
  templates(identity: VoiceIdentity, all?: boolean): Promise<VoiceTemplate[]>;
  saveTemplate(
    identity: VoiceIdentity,
    input: TemplateInput,
    id?: string,
    revision?: number,
  ): Promise<void>;
  removeTemplate(
    identity: VoiceIdentity,
    id: string,
    revision: number,
  ): Promise<void>;
  limit(guildId: GuildId, value?: number): Promise<number>;
  session(
    identity: VoiceIdentity,
    mode: VoiceDraft['mode'],
  ): Promise<VoiceSession>;
  readSession(identity: VoiceIdentity, id: string): Promise<VoiceSession>;
  updateSession(
    identity: VoiceIdentity,
    id: string,
    revision: number,
    state: VoiceDraft,
  ): Promise<VoiceSession>;
  deploy(identity: VoiceIdentity, session: VoiceSession): Promise<VoiceSession>;
  channels(guildId: GuildId, batchId?: string): Promise<VoiceChannel[]>;
  resolveChannel(guildId: GuildId, id: string): Promise<void>;
  removeChannel(guildId: GuildId, id: string): Promise<void>;
}
export interface VoiceRuntime extends VoiceService, GatewayEventHandler {
  tick(): Promise<void>;
}
