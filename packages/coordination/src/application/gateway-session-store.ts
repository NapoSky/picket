import type { Lease } from './lease-store';

/** Session Gateway reprenable (RESUME) ; mêmes champs que celle de la bibliothèque `@discordjs/ws`. */
export interface GatewaySession {
  readonly resumeURL: string;
  readonly sequence: number;
  readonly sessionId: string;
  readonly shardCount: number;
  readonly shardId: number;
}

export interface GatewaySessionStore {
  load(shardId: number): Promise<GatewaySession | null>;
  /** Écriture protégée par le jeton de fencing : `false` si le bail n'est plus celui de l'appelant. */
  save(lease: Lease, session: GatewaySession): Promise<boolean>;
  clear(lease: Lease, shardId: number): Promise<void>;
}
