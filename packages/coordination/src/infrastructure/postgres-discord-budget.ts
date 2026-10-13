import { sql, type Db } from '@picket/persistence';

/** Shared 40 RPS budget, leaving Discord's remaining allowance for CLI tools and margin. */
export class PostgresDiscordBudget {
  constructor(private readonly db: Db, private readonly sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))) {}
  async acquire(): Promise<void> {
    for (;;) {
      const result = await sql`
        INSERT INTO discord_request_budget(id, window_at, requests)
        VALUES(1, clock_timestamp() + interval '25 milliseconds', 1)
        ON CONFLICT(id) DO UPDATE SET window_at = clock_timestamp() + interval '25 milliseconds', requests = 1
        WHERE discord_request_budget.window_at <= clock_timestamp()
        RETURNING requests`.execute(this.db);
      if (result.rows.length) return;
      await this.sleep(50);
    }
  }
}
