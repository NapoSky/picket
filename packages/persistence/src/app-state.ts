import type { Db } from './database';

export interface AppState {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export function createAppState(db: Db): AppState {
  return {
    async get(key) {
      const row = await db.selectFrom('app_state').select('value').where('key', '=', key).executeTakeFirst();
      return row?.value ?? null;
    },
    async set(key, value) {
      await db
        .insertInto('app_state')
        .values({ key, value })
        .onConflict((conflict) => conflict.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
    },
  };
}
