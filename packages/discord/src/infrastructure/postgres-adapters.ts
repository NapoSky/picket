import type { ApplicationId, GuildId, InteractionId } from '@picket/kernel';
import type { Db } from '@picket/persistence';
import { createAppState } from '@picket/persistence';
import type { InteractionReceipts } from '../application/pipeline';
import type { DeployedHashStore } from './deploy-commands';

export class PostgresInteractionReceipts implements InteractionReceipts {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async claim(id: InteractionId, guildId: GuildId | null): Promise<boolean> {
    const inserted = await this.#db
      .insertInto('interaction_receipts')
      .values({ interaction_id: id, guild_id: guildId })
      .onConflict((conflict) => conflict.column('interaction_id').doNothing())
      .returning('interaction_id')
      .executeTakeFirst();
    return inserted !== undefined;
  }

  /** Les reçus ne servent qu'à dédoublonner les rejeux : au-delà du délai de validité d'une interaction, ils sont inutiles. */
  async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await this.#db.deleteFrom('interaction_receipts').where('received_at', '<', cutoff).executeTakeFirst();
    return Number(result.numDeletedRows);
  }
}

/** Durée de conservation des reçus d'interactions (Discord n'en rejoue pas au-delà de quelques minutes). */
export const INTERACTION_RECEIPT_RETENTION_DAYS = 7;

export class PostgresDeployedHashStore implements DeployedHashStore {
  readonly #state;
  readonly #key: string;

  constructor(db: Db, applicationId: ApplicationId) {
    this.#state = createAppState(db);
    this.#key = `commands_hash:${applicationId}`;
  }

  get(): Promise<string | null> {
    return this.#state.get(this.#key);
  }

  set(hash: string): Promise<void> {
    return this.#state.set(this.#key, hash);
  }
}
