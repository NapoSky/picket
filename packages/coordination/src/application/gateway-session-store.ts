import type { Lease } from './lease-store';

/** Resumable Gateway session (RESUME); same fields as the `@discordjs/ws` library. */
export interface GatewaySession {
  readonly resumeURL: string;
  readonly sequence: number;
  readonly sessionId: string;
  readonly shardCount: number;
  readonly shardId: number;
  /** Intents sent when identifying. Legacy sessions have no recorded mask. */
  readonly intents?: number;
}

export interface GatewaySessionStore {
  load(shardId: number): Promise<GatewaySession | null>;
  /** Fencing-token-protected write: `false` if the caller no longer holds the lease. */
  save(lease: Lease, session: GatewaySession): Promise<boolean>;
  clear(lease: Lease, shardId: number): Promise<void>;
}
