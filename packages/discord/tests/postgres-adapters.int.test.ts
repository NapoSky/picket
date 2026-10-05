import { ApplicationId, GuildId, InteractionId } from '@picket/kernel';
import { PostgresDeployedHashStore, PostgresInteractionReceipts } from '@picket/discord';
import { createTestDatabase, queryAsAdmin, type TestDatabase } from '@picket/testing';

describe('Postgres interaction adapters (integration)', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  it('claims an interaction exactly once, even under concurrency', async () => {
    const receipts = new PostgresInteractionReceipts(database.handle.db);
    const id = InteractionId.assert('900000000000000042');

    const results = await Promise.all(Array.from({ length: 10 }, () => receipts.claim(id, GuildId.assert('700000000000000001'))));

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('accepts interactions without a guild and distinct ids independently', async () => {
    const receipts = new PostgresInteractionReceipts(database.handle.db);
    expect(await receipts.claim(InteractionId.assert('900000000000000051'), null)).toBe(true);
    expect(await receipts.claim(InteractionId.assert('900000000000000052'), null)).toBe(true);
    expect(await receipts.claim(InteractionId.assert('900000000000000051'), null)).toBe(false);
  });

  it('deletes only the receipts older than the cutoff', async () => {
    const receipts = new PostgresInteractionReceipts(database.handle.db);
    const oldId = InteractionId.assert('900000000000000061');
    const recentId = InteractionId.assert('900000000000000062');
    await receipts.claim(oldId, null);
    await receipts.claim(recentId, null);
    await queryAsAdmin(database, "UPDATE interaction_receipts SET received_at = now() - interval '10 days' WHERE interaction_id = $1", [oldId]);

    const deleted = await receipts.deleteOlderThan(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await receipts.claim(oldId, null)).toBe(true);
    expect(await receipts.claim(recentId, null)).toBe(false);
  });

  it('stores the deployed commands hash per application', async () => {
    const a = new PostgresDeployedHashStore(database.handle.db, ApplicationId.assert('800000000000000001'));
    const b = new PostgresDeployedHashStore(database.handle.db, ApplicationId.assert('800000000000000002'));
    expect(await a.get()).toBeNull();
    await a.set('hash-a');
    await b.set('hash-b');
    await a.set('hash-a2');
    expect(await a.get()).toBe('hash-a2');
    expect(await b.get()).toBe('hash-b');
  });
});
