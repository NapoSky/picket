import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS_DIR, MigrationError, migrate } from '@picket/persistence';
import { APP_ROLE, createTestDatabase, queryAsAdmin, type TestDatabase } from '@picket/testing';

describe('migrate (integration)', () => {
  let database: TestDatabase;
  let directory: string;

  beforeEach(async () => {
    database = await createTestDatabase({ migrate: false });
    directory = await mkdtemp(join(tmpdir(), 'picket-migrations-'));
  });

  afterEach(async () => {
    await database.drop();
    await rm(directory, { recursive: true, force: true });
  });

  const run = (dir = MIGRATIONS_DIR) =>
    migrate({ connectionString: database.migratorUrl, migrationsDir: dir, appRole: APP_ROLE });

  it('applies every migration once and is a no-op afterwards', async () => {
    const first = await run();
    expect(first.applied).toEqual([
      '001_init',
      '002_permissions',
      '003_guild_lifecycle',
      '004_coordination',
      '005_guild_locale_auto',
      '006_timers',
      '007_timers_activity',
      '008_journal_retention',
      '009_audit_delivery',
      '010_warlog',
      '011_warlog_perspective',
      '012_stats',
      '013_instance_overview',
      '014_stats_admin_snapshot',
      '015_timer_alert_delivery',
      '016_support_guild_events',
      '017_guild_operations',
      '018_requested_departures',
      '019_departure_acknowledgement',
      '020_ephemeral_voice',
      '021_voice_template_name',
      '022_voice_channel_number_reuse',
    ]);

    const second = await run();
    expect(second).toEqual({ applied: [], alreadyApplied: 22 });
  });

  it('serialises concurrent runs with the advisory lock', async () => {
    const results = await Promise.all([run(), run(), run()]);
    const applied = results.flatMap((result) => [...result.applied]);
    expect(applied).toEqual([
      '001_init',
      '002_permissions',
      '003_guild_lifecycle',
      '004_coordination',
      '005_guild_locale_auto',
      '006_timers',
      '007_timers_activity',
      '008_journal_retention',
      '009_audit_delivery',
      '010_warlog',
      '011_warlog_perspective',
      '012_stats',
      '013_instance_overview',
      '014_stats_admin_snapshot',
      '015_timer_alert_delivery',
      '016_support_guild_events',
      '017_guild_operations',
      '018_requested_departures',
      '019_departure_acknowledgement',
      '020_ephemeral_voice',
      '021_voice_template_name',
      '022_voice_channel_number_reuse',
    ]);
  });

  it('adds recoverable alert delivery without changing legacy rows or breaking old inserts', async () => {
    for (const file of (await readdir(MIGRATIONS_DIR)).filter((name) => /^0(?:0\d|1[0-4])_.*\.sql$/.test(name))) {
      await writeFile(join(directory, file), await readFile(join(MIGRATIONS_DIR, file)));
    }
    await run(directory);
    const guild = '700000000000000099';
    const board = '00000000-0000-4000-8000-000000000099';
    await queryAsAdmin(database, `
      INSERT INTO timer_boards(id,guild_id,channel_id,created_by) VALUES ($1,$2,'600000000000000099','500000000000000099');
    `, [board, guild]);
    await queryAsAdmin(database, `INSERT INTO timer_assets(id,board_id,guild_id,type,name,region_key,location_key,owner_user_id,direction,duration_s,started_at)
      VALUES ('legacyalert',$1,$2,'bunker','Alpha','region','place','500000000000000099','down',3600,now())`, [board, guild]);
    const insert = `INSERT INTO timer_alerts(asset_id,board_id,guild_id,due_at,threshold_min) VALUES ('legacyalert',$1,$2,now()+interval '1 hour',$3)`;
    await queryAsAdmin(database, insert, [board, guild, 120]);
    expect((await run()).applied).toEqual(['015_timer_alert_delivery', '016_support_guild_events', '017_guild_operations', '018_requested_departures', '019_departure_acknowledgement', '020_ephemeral_voice', '021_voice_template_name', '022_voice_channel_number_reuse']);
    // The previous replica knows neither the new column nor a new INSERT shape.
    await queryAsAdmin(database, insert, [board, guild, 30]);
    expect(await queryAsAdmin(database, 'SELECT delivery_pending, message_id FROM timer_alerts')).toEqual([
      { delivery_pending: false, message_id: null }, { delivery_pending: false, message_id: null },
    ]);
  });

  it('silently seeds support membership and cached names from an existing deployment', async () => {
    for (const file of (await readdir(MIGRATIONS_DIR)).filter(name => name.endsWith('.sql') && name < '016_')) {
      await writeFile(join(directory, file), await readFile(join(MIGRATIONS_DIR, file)));
    }
    await run(directory);
    await queryAsAdmin(database, `INSERT INTO guild_registry(guild_id, inactive_since, inactive_reason) VALUES
      ('700000000000000091', NULL, NULL),
      ('700000000000000092', now(), 'left'),
      ('700000000000000093', now(), 'requested')`);
    await queryAsAdmin(database, "INSERT INTO stats_settings(guild_id, guild_name) VALUES ('700000000000000091', 'ABC')");
    expect((await run()).applied).toEqual(['016_support_guild_events', '017_guild_operations', '018_requested_departures', '019_departure_acknowledgement', '020_ephemeral_voice', '021_voice_template_name', '022_voice_channel_number_reuse']);
    expect(await queryAsAdmin(database, 'SELECT guild_id, name, present FROM guild_support_presence ORDER BY guild_id')).toEqual([
      { guild_id: '700000000000000091', name: 'ABC', present: true },
      { guild_id: '700000000000000092', name: '', present: false },
      { guild_id: '700000000000000093', name: '', present: true },
    ]);
    expect(await queryAsAdmin(database, 'SELECT 1 FROM support_guild_deliveries')).toEqual([]);
    const [policy] = await queryAsAdmin(database, "SELECT relforcerowsecurity FROM pg_class WHERE relname = 'stats_settings'");
    expect(policy?.relforcerowsecurity).toBe(true);
  });

  it('upgrades existing support memberships and increments generations for legacy updates too', async () => {
    for (const file of (await readdir(MIGRATIONS_DIR)).filter(name => name.endsWith('.sql') && name < '017_')) {
      await writeFile(join(directory, file), await readFile(join(MIGRATIONS_DIR, file)));
    }
    await run(directory);
    const guild = '700000000000000097';
    await queryAsAdmin(database, 'INSERT INTO guild_registry(guild_id) VALUES ($1)', [guild]);
    await queryAsAdmin(database, "INSERT INTO guild_support_presence(guild_id, name, present) VALUES ($1, 'Legacy server', true)", [guild]);
    expect((await run()).applied).toEqual(['017_guild_operations', '018_requested_departures', '019_departure_acknowledgement', '020_ephemeral_voice', '021_voice_template_name', '022_voice_channel_number_reuse']);
    expect(await queryAsAdmin(database, 'SELECT revision FROM guild_support_presence')).toEqual([{ revision: '0' }]);
    await queryAsAdmin(database, 'UPDATE guild_support_presence SET present=false');
    await queryAsAdmin(database, "UPDATE guild_support_presence SET name='Renamed server'");
    expect(await queryAsAdmin(database, 'SELECT revision FROM guild_support_presence')).toEqual([{ revision: '1' }]);
    await queryAsAdmin(database, 'UPDATE guild_support_presence SET present=true');
    expect(await queryAsAdmin(database, 'SELECT revision FROM guild_support_presence')).toEqual([{ revision: '2' }]);
  });

  it('queues existing explicit deletion requests without changing their dates or other memberships', async () => {
    for (const file of (await readdir(MIGRATIONS_DIR)).filter(name => name.endsWith('.sql') && name < '018_')) {
      await writeFile(join(directory, file), await readFile(join(MIGRATIONS_DIR, file)));
    }
    await run(directory);
    await queryAsAdmin(database, `INSERT INTO guild_registry(guild_id, inactive_since, inactive_reason) VALUES
      ('700000000000000081', '2026-10-14T03:04:52.200Z', 'requested'),
      ('700000000000000082', now(), 'left'), ('700000000000000083', NULL, NULL)`);
    await queryAsAdmin(database, `INSERT INTO guild_support_presence(guild_id, present, revision) VALUES
      ('700000000000000081', true, 7), ('700000000000000082', false, 2), ('700000000000000083', true, 0)`);
    expect((await run()).applied).toEqual(['018_requested_departures', '019_departure_acknowledgement', '020_ephemeral_voice', '021_voice_template_name', '022_voice_channel_number_reuse']);
    expect(await queryAsAdmin(database, 'SELECT guild_id, expected_revision, requested_at, status FROM guild_departure_requests')).toEqual([
      { guild_id: '700000000000000081', expected_revision: '7', requested_at: new Date('2026-10-14T03:04:52.200Z'), status: 'pending' },
    ]);
    expect(await queryAsAdmin(database, "SELECT inactive_since FROM guild_registry WHERE guild_id='700000000000000081'"))
      .toEqual([{ inactive_since: new Date('2026-10-14T03:04:52.200Z') }]);
  });

  it('applies the retention migration to existing history, including old rows with no registry entry', async () => {
    const previous = (await readdir(MIGRATIONS_DIR)).filter((file) => /^00[1-7]_.*\.sql$/.test(file));
    for (const file of previous) await writeFile(join(directory, file), await readFile(join(MIGRATIONS_DIR, file)));
    await run(directory);
    const guild = '700000000000000001';
    await queryAsAdmin(database, `INSERT INTO guild_audit_log (guild_id, actor_id, action, at)
      VALUES ($1, 'system', 'expired', now() - interval '31 days'), ($1, 'system', 'recent', now())`, [guild]);
    await queryAsAdmin(database, `INSERT INTO timer_events (guild_id, board_id, actor_id, action, at)
      VALUES ($1, '00000000-0000-4000-8000-000000000001', 'system', 'expired', now() - interval '31 days'),
             ($1, '00000000-0000-4000-8000-000000000001', 'system', 'recent', now())`, [guild]);
    expect((await run()).applied).toEqual(['008_journal_retention', '009_audit_delivery', '010_warlog', '011_warlog_perspective', '012_stats', '013_instance_overview', '014_stats_admin_snapshot', '015_timer_alert_delivery', '016_support_guild_events', '017_guild_operations', '018_requested_departures', '019_departure_acknowledgement', '020_ephemeral_voice', '021_voice_template_name', '022_voice_channel_number_reuse']);
    expect(await queryAsAdmin(database, 'SELECT action FROM guild_audit_log')).toEqual([{ action: 'recent' }]);
    expect(await queryAsAdmin(database, 'SELECT action FROM timer_events')).toEqual([{ action: 'recent' }]);
  });

  it('refuses a migration modified after being applied', async () => {
    await writeFile(join(directory, '001_a.sql'), 'CREATE TABLE a (id int);');
    await run(directory);
    await writeFile(join(directory, '001_a.sql'), 'CREATE TABLE a (id int, extra int);');
    await expect(run(directory)).rejects.toThrow(/modified after being applied/);
  });
  it('adds a neutral perspective to existing subscriptions without changing their configuration', async () => {
    const previous = (await readdir(MIGRATIONS_DIR)).filter(file => file.endsWith('.sql') && file < '011_');
    for (const file of previous) await writeFile(join(directory, file), await readFile(join(MIGRATIONS_DIR, file)));
    await run(directory);
    const guild = '700000000000000001';
    await queryAsAdmin(database, 'INSERT INTO guild_registry(guild_id) VALUES($1)', [guild]);
    await queryAsAdmin(database, `INSERT INTO warlog_subscriptions(guild_id, channel_id, zones, paused, confirmed_war)
      VALUES($1, '600000000000000001', '["west_coast"]', false, 100)`, [guild]);
    expect((await run()).applied).toEqual(['011_warlog_perspective', '012_stats', '013_instance_overview', '014_stats_admin_snapshot', '015_timer_alert_delivery', '016_support_guild_events', '017_guild_operations', '018_requested_departures', '019_departure_acknowledgement', '020_ephemeral_voice', '021_voice_template_name', '022_voice_channel_number_reuse']);
    expect(await queryAsAdmin(database, 'SELECT perspective, channel_id, zones, paused, confirmed_war FROM warlog_subscriptions')).toEqual([
      { perspective: 'NONE', channel_id: '600000000000000001', zones: ['west_coast'], paused: false, confirmed_war: 100 },
    ]);
    await expect(queryAsAdmin(database, "UPDATE warlog_subscriptions SET perspective = 'INVALID'")).rejects.toThrow(/check constraint/);
  });

  it('rolls back a failing migration entirely and does not record it', async () => {
    await writeFile(join(directory, '001_ok.sql'), 'CREATE TABLE ok (id int);');
    await writeFile(join(directory, '002_bad.sql'), 'CREATE TABLE half_done (id int); SELECT 1/0;');

    await expect(run(directory)).rejects.toBeInstanceOf(MigrationError);

    const tables = await queryAsAdmin<{ table_name: string }>(
      database,
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    expect(tables.map((row) => row.table_name)).toEqual(expect.arrayContaining(['ok', 'schema_migrations']));
    expect(tables.map((row) => row.table_name)).not.toContain('half_done');

    const recorded = await queryAsAdmin<{ version: string }>(database, 'SELECT version FROM schema_migrations');
    expect(recorded.map((row) => row.version)).toEqual(['001_ok']);
  });

  it('ignores files that do not follow the naming convention', async () => {
    await writeFile(join(directory, '001_ok.sql'), 'SELECT 1;');
    await writeFile(join(directory, 'notes.sql'), 'DROP DATABASE postgres;');
    await writeFile(join(directory, '1_short.sql'), 'DROP DATABASE postgres;');
    expect((await run(directory)).applied).toEqual(['001_ok']);
  });

  it.each(['Robert"; DROP TABLE x;--', 'UPPER', '1abc', '', 'a'.repeat(64)])(
    'rejects the unsafe role name %p',
    async (appRole) => {
      await expect(
        migrate({ connectionString: database.migratorUrl, migrationsDir: directory, appRole }),
      ).rejects.toBeInstanceOf(MigrationError);
    },
  );
  it('enables voice for existing guilds without changing their other settings or explicit choice',async()=>{
    for(const file of(await readdir(MIGRATIONS_DIR)).filter(name=>name.endsWith('.sql')&&name<'020_'))await writeFile(join(directory,file),await readFile(join(MIGRATIONS_DIR,file)));
    await run(directory);
    await queryAsAdmin(database,`INSERT INTO guild_settings(guild_id,features) VALUES
      ('700000000000000081','{"timers":false,"future":true}'),
      ('700000000000000082','{"timers":false,"voice":false}')`);
    expect((await run()).applied).toEqual(['020_ephemeral_voice', '021_voice_template_name', '022_voice_channel_number_reuse']);
    const rows=await queryAsAdmin(database,'SELECT guild_id,features FROM guild_settings ORDER BY guild_id');
    expect(rows).toEqual([{guild_id:'700000000000000081',features:{timers:false,future:true,voice:true}},{guild_id:'700000000000000082',features:{timers:false,voice:false}}]);
  });

  it('preserves enabled statistics and their targets when upgrading several existing guilds', async () => {
    for (const file of (await readdir(MIGRATIONS_DIR)).filter(name => name.endsWith('.sql') && name < '020_')) {
      await writeFile(join(directory, file), await readFile(join(MIGRATIONS_DIR, file)));
    }
    await run(directory);
    await queryAsAdmin(database, `
      INSERT INTO guild_registry(guild_id) VALUES ('700000000000000083'), ('700000000000000084');
      INSERT INTO guild_settings(guild_id, features) VALUES
        ('700000000000000083', '{"stats":true,"timers":false}'),
        ('700000000000000084', '{"stats":true,"warlog":true}');
      INSERT INTO guild_permission_roles(guild_id, level, role_id) VALUES
        ('700000000000000083', 'member', '800000000000000083'),
        ('700000000000000084', 'member', '800000000000000084');
    `);
    const statsBefore = await queryAsAdmin(database, 'SELECT * FROM stats_settings ORDER BY guild_id');
    const rolesBefore = await queryAsAdmin(database, 'SELECT * FROM guild_permission_roles ORDER BY guild_id');

    expect((await run()).applied).toEqual(['020_ephemeral_voice', '021_voice_template_name', '022_voice_channel_number_reuse']);
    expect(await queryAsAdmin(database, 'SELECT guild_id, features FROM guild_settings ORDER BY guild_id')).toEqual([
      { guild_id: '700000000000000083', features: { stats: true, timers: false, voice: true } },
      { guild_id: '700000000000000084', features: { stats: true, warlog: true, voice: true } },
    ]);
    expect(await queryAsAdmin(database, 'SELECT * FROM stats_settings ORDER BY guild_id')).toEqual(statsBefore);
    expect(await queryAsAdmin(database, 'SELECT * FROM guild_permission_roles ORDER BY guild_id')).toEqual(rolesBefore);
  });

  it('upgrades existing templates to allow their full channel name without renaming saved templates', async () => {
    for (const file of (await readdir(MIGRATIONS_DIR)).filter(name => name.endsWith('.sql') && name < '021_')) {
      await writeFile(join(directory, file), await readFile(join(MIGRATIONS_DIR, file)));
    }
    await run(directory);
    const channelName = 'a'.repeat(90);
    await queryAsAdmin(database, "INSERT INTO guild_registry(guild_id) VALUES ('700000000000000085')");
    await queryAsAdmin(database, `INSERT INTO voice_templates(id,guild_id,name,category_id,channel_name)
      VALUES ('legacy-template','700000000000000085','Legacy name','600000000000000085',$1)`, [channelName]);

    expect((await run()).applied).toEqual(['021_voice_template_name', '022_voice_channel_number_reuse']);
    expect(await queryAsAdmin(database, 'SELECT name,channel_name FROM voice_templates')).toEqual([
      { name: 'Legacy name', channel_name: channelName },
    ]);
    expect(await queryAsAdmin(database, 'UPDATE voice_templates SET name=channel_name RETURNING name')).toEqual([
      { name: channelName },
    ]);
  });

  it('releases completed channel names on upgrade while preserving history and live uniqueness', async () => {
    for (const file of (await readdir(MIGRATIONS_DIR)).filter(name => name.endsWith('.sql') && name < '022_')) {
      await writeFile(join(directory, file), await readFile(join(MIGRATIONS_DIR, file)));
    }
    await run(directory);
    const guild = '700000000000000086';
    await queryAsAdmin(database, 'INSERT INTO guild_registry(guild_id) VALUES ($1)', [guild]);
    const insert = `INSERT INTO voice_channels(id,guild_id,batch_id,template_revision,category_id,name,capacity,idle_minutes,status)
      VALUES ($1,$2,'legacy',1,'600000000000000086',$3,99,15,$4)`;
    const statuses = ['pending', 'creating', 'active', 'uncertain', 'failed', 'deleted'];
    for (const status of statuses)
      await queryAsAdmin(database, insert, [status, guild, `Combat ${status}`, status]);
    const before = await queryAsAdmin(database, 'SELECT * FROM voice_channels ORDER BY id');
    expect((await run()).applied).toEqual(['022_voice_channel_number_reuse']);
    expect(await queryAsAdmin(database, 'SELECT * FROM voice_channels ORDER BY id')).toEqual(before);
    for (const status of statuses) {
      const create = () => queryAsAdmin(database, insert, [`new-${status}`, guild, `Combat ${status}`, 'pending']);
      if (status === 'failed' || status === 'deleted') await create();
      else await expect(create()).rejects.toThrow(/unique constraint/);
    }
    await expect(queryAsAdmin(database, insert, ['duplicate', guild, 'Combat deleted', 'pending'])).rejects.toThrow(/unique constraint/);
    expect((await run()).applied).toEqual([]);
  });

});
