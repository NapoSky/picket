import { ExportGuildData, GUILD_EXPORT_TABLES, MAX_GUILD_EXPORT_BYTES, PostgresGuildDataExportRepository } from '@picket/guild';
import { GuildId } from '@picket/kernel';
import { withTenant } from '@picket/persistence';
import { createTestDatabase, queryAsAdmin, type TestDatabase } from '@picket/testing';

const GUILD_A = GuildId.assert('700000000000000001');
const GUILD_B = GuildId.assert('700000000000000002');
const BOARD_A = '00000000-0000-4000-8000-000000000001';
const BOARD_B = '00000000-0000-4000-8000-000000000002';
const ACTOR = '500000000000000001';
const clock = { now: () => new Date('2026-10-07T12:00:00Z') };

describe('guild data export (PostgreSQL integration)', () => {
  let database: TestDatabase;
  let repository: PostgresGuildDataExportRepository;

  beforeAll(async () => {
    database = await createTestDatabase();
    repository = new PostgresGuildDataExportRepository(database.handle.db);
    for (const [guildId, boardId, assetId] of [[GUILD_A, BOARD_A, 'assetaaa'], [GUILD_B, BOARD_B, 'assetbbb']]) {
      await queryAsAdmin(database, `INSERT INTO guild_settings (guild_id, features, emoji_overrides)
        VALUES ($1, '{"timers":true,"todolists":true,"warlog":false,"future":true}', '{"custom":"🏗️"}')`, [guildId]);
      await queryAsAdmin(database, 'INSERT INTO guild_registry (guild_id) VALUES ($1)', [guildId]);
      await queryAsAdmin(database, 'INSERT INTO guild_application_logs (id, guild_id, record) VALUES ($1, $2, $3)', [boardId, guildId, JSON.stringify({ guild_id: guildId, user_id: ACTOR, msg: 'todolist created' })]);
      await queryAsAdmin(database, "INSERT INTO guild_permission_roles (guild_id, level, role_id) VALUES ($1, 'member', $1)", [guildId]);
      await queryAsAdmin(database, "INSERT INTO guild_audit_log (guild_id, actor_id, action, before, after) VALUES ($1, $2, 'settings.language', NULL, '{\"locale\":\"fr\"}')", [guildId, ACTOR]);
      await queryAsAdmin(database, "INSERT INTO timer_boards (id, guild_id, channel_id, created_by) VALUES ($1, $2, '600000000000000001', $3)", [boardId, guildId, ACTOR]);
      await queryAsAdmin(database, "INSERT INTO timer_board_messages (board_id, guild_id, page, message_id, content_hash) VALUES ($1, $2, 0, '910000000000000001', 'hash')", [boardId, guildId]);
      await queryAsAdmin(database, `INSERT INTO timer_assets (id, board_id, guild_id, type, name, region_key, location_key, owner_user_id, direction, duration_s, started_at)
        VALUES ($1, $2, $3, 'bunker', 'Béton 🏗️', 'region', 'location', $4, 'down', 3600, now())`, [assetId, boardId, guildId, ACTOR]);
      await queryAsAdmin(database, "INSERT INTO timer_events (guild_id, board_id, asset_id, actor_id, action, detail) VALUES ($1, $2, $3, $4, 'asset.added', '{\"name\":\"Béton 🏗️\"}')", [guildId, boardId, assetId, ACTOR]);
      await queryAsAdmin(database, "INSERT INTO timer_alerts (asset_id, guild_id, board_id, due_at, threshold_min, acked_by) VALUES ($1, $2, $3, now() + interval '1 hour', 5, $4)", [assetId, guildId, boardId, ACTOR]);
      await queryAsAdmin(database, 'INSERT INTO timer_schedule (board_id, guild_id, wake_at) VALUES ($1, $2, now())', [boardId, guildId]);
      await queryAsAdmin(database, 'INSERT INTO interaction_receipts (interaction_id, guild_id) VALUES ($1, $1)', [guildId]);
    }
    await queryAsAdmin(database, "INSERT INTO app_state (key, value) VALUES ('secret', 'SECRET-DO-NOT-EXPORT')");
    await queryAsAdmin(database, "INSERT INTO gateway_sessions (shard_id, session, lease_token) VALUES (0, '{\"secret\":\"SECRET-DO-NOT-EXPORT\"}', 1)");
  });

  afterAll(async () => { await database.drop(); });

  it('exports all current guild tables and columns, including future settings, but no other server or global secrets', async () => {
    const current = await queryAsAdmin<{ table_name: string }>(database, "SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'guild_id' ORDER BY table_name");
    expect(Object.keys(GUILD_EXPORT_TABLES).sort()).toEqual(current.map((row) => row.table_name));
    const result = await new ExportGuildData(repository, clock).execute(GUILD_A);
    if (result.kind !== 'exported') throw new Error('Expected complete export');
    const json = new TextDecoder().decode(result.bytes);
    expect(json).not.toContain(GUILD_B);
    expect(json).not.toContain('SECRET-DO-NOT-EXPORT');
    const exported = JSON.parse(json);
    expect(exported.guildId).toBe(GUILD_A);
    expect(Object.keys(exported.data).sort()).toEqual(current.map((row) => row.table_name));
    for (const table of Object.keys(GUILD_EXPORT_TABLES)) {
      const expected = await queryAsAdmin(database, `SELECT * FROM ${table} WHERE guild_id = $1`, [GUILD_A]);
      expect(exported.data[table]).toEqual(JSON.parse(JSON.stringify(expected)));
    }
    expect(exported.data.guild_settings[0]).toMatchObject({ features: { future: true }, emoji_overrides: { custom: '🏗️' } });
    expect(exported.data.timer_assets[0]).toMatchObject({ name: 'Béton 🏗️', owner_user_id: ACTOR });
    expect(exported.data.timer_alerts[0].acked_by).toBe(ACTOR);
    expect(exported.data.guild_application_logs[0].record).toMatchObject({ guild_id: GUILD_A, user_id: ACTOR, msg: 'todolist created' });
  });

  it('reads beyond a batch without losing, duplicating or rounding audit identifiers', async () => {
    await queryAsAdmin(database, `INSERT INTO guild_audit_log (guild_id, actor_id, action)
      SELECT $1, $2, 'test.export' FROM generate_series(1, 250)`, [GUILD_A, ACTOR]);
    await queryAsAdmin(database, "INSERT INTO guild_audit_log (id, guild_id, actor_id, action) OVERRIDING SYSTEM VALUE VALUES (9007199254740993, $1, $2, 'test.bigint')", [GUILD_A, ACTOR]);
    const data = await repository.read(GUILD_A, MAX_GUILD_EXPORT_BYTES);
    const expected = await queryAsAdmin(database, 'SELECT * FROM guild_audit_log WHERE guild_id = $1 ORDER BY id', [GUILD_A]);
    expect(data?.guild_audit_log).toEqual(expected);
    expect(data?.guild_audit_log).toHaveLength(252);
    expect(data?.guild_audit_log?.at(-1)).toMatchObject({ id: '9007199254740993' });
  });

  it('stops an oversized read without returning a partial snapshot or modifying records', async () => {
    const before = await queryAsAdmin(database, 'SELECT count(*) FROM guild_audit_log');
    expect(await repository.read(GUILD_A, 10)).toBeNull();
    expect(await queryAsAdmin(database, 'SELECT count(*) FROM guild_audit_log')).toEqual(before);
  });

  it('exports suspension metadata and does not reschedule or cancel deletion', async () => {
    await queryAsAdmin(database, "UPDATE guild_registry SET inactive_since = $2, inactive_reason = 'requested' WHERE guild_id = $1", [GUILD_A, clock.now()]);
    const data = await repository.read(GUILD_A, MAX_GUILD_EXPORT_BYTES);
    expect(data?.guild_registry).toEqual([expect.objectContaining({ inactive_since: clock.now(), inactive_reason: 'requested' })]);
    expect(await queryAsAdmin(database, 'SELECT inactive_since, inactive_reason FROM guild_registry WHERE guild_id = $1', [GUILD_A])).toEqual([{ inactive_since: clock.now(), inactive_reason: 'requested' }]);
  });

  it('holds a read-only, repeatable snapshot and releases the tenant context afterward', async () => {
    await withTenant(database.handle.db, GUILD_A, async (trx) => {
      const before = await trx.selectFrom('guild_settings').select('locale').executeTakeFirstOrThrow();
      await queryAsAdmin(database, "UPDATE guild_settings SET locale = 'fr' WHERE guild_id = $1", [GUILD_A]);
      expect(await trx.selectFrom('guild_settings').select('locale').executeTakeFirstOrThrow()).toEqual(before);
    }, { readOnlySnapshot: true });
    await expect(withTenant(database.handle.db, GUILD_A, (trx) => trx.updateTable('guild_settings').set({ locale: 'en' }).execute(), { readOnlySnapshot: true })).rejects.toThrow(/read.only/);
    expect(await database.handle.db.selectFrom('guild_settings').selectAll().execute()).toEqual([]);
  });
});
