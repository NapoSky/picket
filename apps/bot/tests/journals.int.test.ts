import { GuildId, type GuildApplicationLog } from '@picket/kernel';
import { ExportGuildData, PostgresGuildDataExportRepository } from '@picket/guild';
import { createGuildLogDestination, createLogger } from '@picket/observability';
import { PostgresGuildApplicationLogs, purgeExpiredJournals, purgeGuildData, sql, withTenant } from '@picket/persistence';
import { createTestDatabase, queryAsAdmin, type TestDatabase } from '@picket/testing';

const GUILD_A = GuildId.assert('700000000000000001');
const GUILD_B = GuildId.assert('700000000000000002');
const BOARD = '00000000-0000-4000-8000-000000000001';
const ACTOR = '500000000000000001';
const DAY = 24 * 60 * 60 * 1000;

describe('journal retention and application logs (PostgreSQL)', () => {
  let database: TestDatabase;
  let logs: PostgresGuildApplicationLogs;
  beforeEach(async () => {
    database = await createTestDatabase();
    logs = new PostgresGuildApplicationLogs(database.handle.db);
    await queryAsAdmin(database, 'INSERT INTO guild_registry (guild_id) VALUES ($1), ($2)', [GUILD_A, GUILD_B]);
  });
  afterEach(async () => { await database.drop(); });

  const entry = (guildId = GUILD_A): GuildApplicationLog => ({
    id: BOARD, guildId, at: new Date(), record: { guild_id: guildId, user_id: ACTOR, msg: 'todolist tick' },
  });

  it('physically deletes all three journals at the 30-day boundary across active guilds and preserves newer records', async () => {
    const cutoff = await withTenant(database.handle.db, GUILD_A, async (trx) => {
      const { rows: [row] } = await sql<{ cutoff: Date }>`SELECT CURRENT_TIMESTAMP - INTERVAL '30 days' AS cutoff`.execute(trx);
      const cutoff = row!.cutoff;
      let id = 1;
      for (const guild of [GUILD_A, GUILD_B]) {
        for (const delta of [-1, 0, 1, DAY]) {
          const at = new Date(cutoff.getTime() + delta);
          await queryAsAdmin(database, 'INSERT INTO guild_audit_log (guild_id, actor_id, action, at) VALUES ($1, $2, $3, $4)', [guild, ACTOR, String(delta), at]);
          await queryAsAdmin(database, 'INSERT INTO timer_events (guild_id, board_id, actor_id, action, at) VALUES ($1, $2, $3, $4, $5)', [guild, BOARD, ACTOR, String(delta), at]);
          await queryAsAdmin(database, 'INSERT INTO guild_application_logs (id, guild_id, record, at) VALUES ($1, $2, $3, $4)', [`00000000-0000-4000-8000-${String(id++).padStart(12, '0')}`, guild, JSON.stringify({ delta }), at]);
        }
      }
      expect(await purgeExpiredJournals(trx)).toEqual({ auditDeleted: 4, timerEventsDeleted: 4, applicationLogsDeleted: 4 });
      return cutoff;
    });
    for (const table of ['guild_audit_log', 'timer_events', 'guild_application_logs']) {
      const remaining = await queryAsAdmin<{ guild_id: string; at: Date }>(database, `SELECT guild_id, at FROM ${table}`);
      expect(remaining).toHaveLength(4);
      expect(remaining.every((row) => row.at > cutoff)).toBe(true);
      expect(new Set(remaining.map((row) => row.guild_id))).toEqual(new Set([GUILD_A, GUILD_B]));
    }
  });

  it('isolates stored logs between guilds, remains fail-closed, and forbids direct log updates or deletion', async () => {
    await logs.append([entry(), { ...entry(GUILD_B), id: '00000000-0000-4000-8000-000000000002' }]);
    expect(await database.handle.db.selectFrom('guild_application_logs').selectAll().execute()).toEqual([]);
    const seen = await withTenant(database.handle.db, GUILD_A, (trx) => trx.selectFrom('guild_application_logs').selectAll().execute());
    expect(seen).toHaveLength(1);
    expect(seen[0]?.guild_id).toBe(GUILD_A);
    await expect(withTenant(database.handle.db, GUILD_A, (trx) => trx.insertInto('guild_application_logs').values({ id: '00000000-0000-4000-8000-000000000003', guild_id: GUILD_B, record: '{}' }).execute())).rejects.toThrow(/row-level security/);
    for (const table of ['guild_audit_log', 'timer_events', 'guild_application_logs'] as const) {
      await expect(withTenant(database.handle.db, GUILD_A, (trx) => trx.deleteFrom(table).execute())).rejects.toThrow(/permission denied/);
    }
    await expect(withTenant(database.handle.db, GUILD_A, (trx) => trx.updateTable('guild_application_logs').set({ at: new Date() }).execute())).rejects.toThrow(/permission denied/);
    expect(await purgeExpiredJournals(database.handle.db)).toEqual({ auditDeleted: 0, timerEventsDeleted: 0, applicationLogsDeleted: 0 });
  });

  it('is idempotent on retries and never recreates logs after a guild purge', async () => {
    const item = entry();
    await logs.append([item]);
    await logs.append([item]);
    expect(await queryAsAdmin(database, 'SELECT id FROM guild_application_logs')).toEqual([{ id: item.id }]);
    await purgeGuildData(database.handle.db, GUILD_A);
    await logs.append([item]);
    expect(await queryAsAdmin(database, 'SELECT id FROM guild_application_logs')).toEqual([]);
    expect(await queryAsAdmin(database, 'SELECT guild_id FROM guild_registry WHERE guild_id = $1', [GUILD_A])).toEqual([]);
  });

  it('does not persist an already expired record after a delayed retry', async () => {
    await logs.append([{ ...entry(), at: new Date(Date.now() - 31 * DAY) }]);
    expect(await queryAsAdmin(database, 'SELECT id FROM guild_application_logs')).toEqual([]);
  });

  it('flushes pending redacted application logs before exporting every stored field for only the selected guild', async () => {
    const diagnostics = { write: jest.fn() };
    const destination = createGuildLogDestination({ append: (batch) => logs.append(batch), diagnostics });
    const logger = createLogger({ level: 'info', service: 'picket', destination: destination.destination });
    logger.child({ guild_id: GUILD_A, interaction_id: '900000000000000001' }).info({ user_id: ACTOR, channel_id: '600000000000000001', token: 'PRIVATE-TOKEN' }, 'todolist created');
    logger.child({ guild_id: GUILD_B }).info({}, 'other server');
    const exporter = new ExportGuildData(new PostgresGuildDataExportRepository(database.handle.db, () => destination.flush()), { now: () => new Date() });
    const result = await exporter.execute(GUILD_A);
    if (result.kind !== 'exported') throw new Error('Expected full export');
    const text = new TextDecoder().decode(result.bytes);
    const payload = JSON.parse(text);
    const stored = await queryAsAdmin(database, 'SELECT * FROM guild_application_logs WHERE guild_id = $1', [GUILD_A]);
    expect(payload.data.guild_application_logs).toEqual(JSON.parse(JSON.stringify(stored)));
    expect(payload.data.guild_application_logs).toHaveLength(1);
    expect(payload.data.guild_application_logs[0].record).toMatchObject({ guild_id: GUILD_A, user_id: ACTOR, msg: 'todolist created', token: '[REDACTED]' });
    expect(text).not.toContain('PRIVATE-TOKEN');
    expect(text).not.toContain(GUILD_B);
    expect(diagnostics.write).not.toHaveBeenCalled();
  });

  it('cleans expired journals before exporting, including when the periodic worker was stopped', async () => {
    await queryAsAdmin(database, "INSERT INTO guild_audit_log (guild_id, actor_id, action, at) VALUES ($1, $2, 'other server', now() - interval '31 days')", [GUILD_B, ACTOR]);
    await queryAsAdmin(database, "INSERT INTO guild_audit_log (guild_id, actor_id, action, at) VALUES ($1, $2, 'old', now() - interval '31 days')", [GUILD_A, ACTOR]);
    await queryAsAdmin(database, "INSERT INTO timer_events (guild_id, board_id, actor_id, action, at) VALUES ($1, $2, $3, 'old', now() - interval '31 days')", [GUILD_A, BOARD, ACTOR]);
    await queryAsAdmin(database, "INSERT INTO guild_application_logs (id, guild_id, record, at) VALUES ($1, $2, '{}', now() - interval '31 days')", [BOARD, GUILD_A]);
    const data = await new PostgresGuildDataExportRepository(database.handle.db).read(GUILD_A, 10 * 1024 * 1024);
    expect(data?.guild_audit_log).toEqual([]);
    expect(data?.timer_events).toEqual([]);
    expect(data?.guild_application_logs).toEqual([]);
    expect(await queryAsAdmin(database, 'SELECT guild_id, action FROM guild_audit_log')).toEqual([{ guild_id: GUILD_B, action: 'other server' }]);
    expect(await queryAsAdmin(database, 'SELECT * FROM timer_events')).toEqual([]);
    expect(await queryAsAdmin(database, 'SELECT * FROM guild_application_logs')).toEqual([]);
  });
});
