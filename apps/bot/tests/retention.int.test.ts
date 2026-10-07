import { noopLogger, systemClock } from '@picket/kernel';
import { createTestDatabase, queryAsAdmin, testI18n, type TestDatabase } from '@picket/testing';
import { buildJobRunner, buildNightlyRetentionJob, buildRetentionJob } from '../src/composition';

const GUILD = '700000000000000001';
const ACTOR = '500000000000000001';
const options = { clock: systemClock, guildRetentionDays: 30, i18n: testI18n };

describe('automatic retention job (PostgreSQL)', () => {
  let database: TestDatabase;
  beforeEach(async () => {
    database = await createTestDatabase();
    await queryAsAdmin(database, 'INSERT INTO guild_registry (guild_id) VALUES ($1)', [GUILD]);
    await queryAsAdmin(database, "INSERT INTO guild_audit_log (guild_id, actor_id, action, at) VALUES ($1, $2, 'expired', now() - interval '31 days'), ($1, $2, 'recent', now())", [GUILD, ACTOR]);
    await queryAsAdmin(database, "INSERT INTO interaction_receipts (interaction_id, guild_id, received_at) VALUES ('900000000000000001', $1, now() - interval '8 days'), ('900000000000000002', $1, now())", [GUILD]);
  });
  afterEach(async () => { await database.drop(); });

  it('cleans expired journals and seven-day receipts even if the log flush fails', async () => {
    const result = await buildRetentionJob(database.handle.db, noopLogger, { ...options, flushGuildLogs: async () => { throw new Error('unavailable'); } }).execute();
    expect(result).toMatchObject({ auditDeleted: 1, receiptsDeleted: 1, purged: [], failed: [] });
    expect(await queryAsAdmin(database, 'SELECT action FROM guild_audit_log')).toEqual([{ action: 'recent' }]);
    expect(await queryAsAdmin(database, 'SELECT interaction_id FROM interaction_receipts')).toEqual([{ interaction_id: '900000000000000002' }]);
  });

  it('catches up an unprocessed nightly deadline on job leadership, without any external cron', async () => {
    let cleanupObserved!: () => void;
    const cleaned = new Promise<void>((resolve) => { cleanupObserved = resolve; });
    // Le flush marque le début de la passe ; stop() attend ensuite sa fin effective.
    const runner = buildJobRunner(database.handle.db, noopLogger, { ...options, holder: 'retention-test', flushGuildLogs: async () => cleanupObserved() });
    try {
      await runner.step();
      await cleaned;
    } finally { await runner.stop(); }
    expect(await queryAsAdmin(database, 'SELECT action FROM guild_audit_log')).toEqual([{ action: 'recent' }]);
    expect(await queryAsAdmin(database, 'SELECT interaction_id FROM interaction_receipts')).toEqual([{ interaction_id: '900000000000000002' }]);
  });

  it('runs once per nightly deadline and shares completion with a restarted or replacement replica', async () => {
    let now = new Date('2026-10-07T01:05:00Z'); // 3 h 05 à Paris.
    const scheduledOptions = { ...options, clock: { now: () => now } };
    const first = buildNightlyRetentionJob(database.handle.db, noopLogger, scheduledOptions);
    expect(await first.execute()).toMatchObject({ auditDeleted: 1 });
    await queryAsAdmin(database, "INSERT INTO guild_audit_log (guild_id, actor_id, action, at) VALUES ($1, $2, 'next purge', now() - interval '31 days')", [GUILD, ACTOR]);
    expect(await first.execute()).toBeNull();
    const replacement = buildNightlyRetentionJob(database.handle.db, noopLogger, scheduledOptions);
    now = new Date('2026-10-08T00:59:59Z');
    expect(await replacement.execute()).toBeNull();
    expect(await queryAsAdmin(database, "SELECT action FROM guild_audit_log WHERE action = 'next purge'")).toHaveLength(1);
    now = new Date('2026-10-08T01:00:00Z');
    expect(await replacement.execute()).toMatchObject({ auditDeleted: 1 });
    expect(await replacement.execute()).toBeNull();
  });

  it('catches up several missed nights with a single pass rather than replaying each missed day', async () => {
    await queryAsAdmin(database, "INSERT INTO app_state (key, value) VALUES ('retention:last_successful_schedule', '2026-10-01T01:00:00.000Z')");
    const job = buildNightlyRetentionJob(database.handle.db, noopLogger, { ...options, clock: { now: () => new Date('2026-10-07T12:00:00Z') } });
    expect(await job.execute()).toMatchObject({ auditDeleted: 1 });
    expect(await job.execute()).toBeNull();
    expect(await queryAsAdmin(database, "SELECT value FROM app_state WHERE key = 'retention:last_successful_schedule'")).toEqual([{ value: '2026-10-07T01:00:00.000Z' }]);
  });

  it('retries a failed purge during the same nightly deadline instead of marking it complete', async () => {
    await queryAsAdmin(database, "UPDATE guild_registry SET inactive_since = now() - interval '31 days', inactive_reason = 'requested' WHERE guild_id = $1", [GUILD]);
    await queryAsAdmin(database, `CREATE FUNCTION block_purge() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'temporary purge failure'; END; $$;
      CREATE TRIGGER fail_purge BEFORE DELETE ON guild_registry FOR EACH ROW EXECUTE FUNCTION block_purge();`);
    const job = buildNightlyRetentionJob(database.handle.db, noopLogger, options);
    expect(await job.execute()).toMatchObject({ failed: [GUILD] });
    expect(await queryAsAdmin(database, "SELECT * FROM app_state WHERE key = 'retention:last_successful_schedule'")).toEqual([]);
    await queryAsAdmin(database, 'DROP TRIGGER fail_purge ON guild_registry');
    expect(await job.execute()).toMatchObject({ purged: [GUILD], failed: [] });
    expect(await job.execute()).toBeNull();
  });

  it('also purges inactive guilds after the configured delay', async () => {
    await queryAsAdmin(database, "UPDATE guild_registry SET inactive_since = now() - interval '31 days', inactive_reason = 'requested' WHERE guild_id = $1", [GUILD]);
    const result = await buildRetentionJob(database.handle.db, noopLogger, options).execute();
    expect(result.purged).toEqual([GUILD]);
    expect(await queryAsAdmin(database, 'SELECT * FROM guild_registry')).toEqual([]);
    expect(await queryAsAdmin(database, 'SELECT * FROM guild_audit_log')).toEqual([]);
    expect(await queryAsAdmin(database, 'SELECT * FROM interaction_receipts')).toEqual([]);
  });
});
