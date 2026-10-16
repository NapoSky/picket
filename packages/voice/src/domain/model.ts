export const MAX_TEMPLATES = 10;
export const MAX_CHANNELS = 15;
export const DEFAULT_DEPLOY_LIMIT = 6;
export const MAX_DEPLOY_LIMIT = 10;
export const SESSION_MS = 15 * 60_000;
export const DELAYS = [1, 5, 10, 15, 20, 30] as const;
export interface VoiceTemplate {
  id: string;
  name: string;
  categoryId: string;
  channelName: string;
  capacity: number;
  idleMinutes: number;
  revision: number;
}
export type TemplateInput = Omit<VoiceTemplate, 'id' | 'revision'>;
export interface QueueEntry {
  quantity: number;
  revision: number;
}
export interface VoiceDraft {
  mode: 'member' | 'settings' | 'channels' | 'remove';
  selected: string | null;
  quantity: number;
  queue: Record<string, QueueEntry>;
  batchId: string | null;
}
export interface VoiceSession {
  id: string;
  revision: number;
  state: VoiceDraft;
}
export interface VoiceChannel {
  id: string;
  channelId: string | null;
  name: string;
  status:
    | 'pending'
    | 'creating'
    | 'active'
    | 'uncertain'
    | 'failed'
    | 'deleted';
  occupants: number;
  deleteAfter: Date | null;
  lastVerifiedAt: Date | null;
}
export class VoiceError extends Error {
  constructor(
    readonly reason:
      | 'invalid'
      | 'limit'
      | 'full'
      | 'changed'
      | 'expired'
      | 'access'
      | 'unavailable'
      | 'occupied'
      | 'disabled',
  ) {
    super(reason);
  }
}
export class VoiceQuotaError extends VoiceError {
  readonly maximum = MAX_CHANNELS;
  readonly excess: number;
  constructor(
    readonly current: number,
    readonly requested: number,
  ) {
    super('full');
    this.excess = current + requested - MAX_CHANNELS;
  }
}
export function integer(value: string, min: number, max: number): number {
  if (!/^\d+$/.test(value.trim())) throw new VoiceError('invalid');
  const n = Number(value.trim());
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw new VoiceError('invalid');
  return n;
}
export function validateTemplate(input: TemplateInput): TemplateInput {
  const name = input.name.trim(),
    channelName = input.channelName.trim();
  if (
    !name ||
    name.length > 90 ||
    !channelName ||
    channelName.length > 90 ||
    /[\r\n]/.test(name + channelName) ||
    !/^\d{15,25}$/.test(input.categoryId) ||
    !Number.isInteger(input.capacity) ||
    input.capacity < 1 ||
    input.capacity > 99 ||
    !DELAYS.includes(input.idleMinutes as (typeof DELAYS)[number])
  )
    throw new VoiceError('invalid');
  return { ...input, name, channelName };
}
export function queueSize(queue: Record<string, QueueEntry>): number {
  return Object.values(queue).reduce((n, item) => n + item.quantity, 0);
}
