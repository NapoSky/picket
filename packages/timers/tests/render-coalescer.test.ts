import { GuildId } from '@picket/kernel';
import { RenderCoalescer, type BoardMaintenance, type MaintenanceOutcome } from '@picket/timers';

const guild = GuildId.assert('700000000000000001');
const ok: MaintenanceOutcome = { kind: 'ok' };

/** Faux entretien : chaque appel attend qu'on le termine à la main. */
function fakeMaintenance() {
  const runs: { board: string; finish: (outcome?: MaintenanceOutcome) => void; fail: (error: unknown) => void }[] = [];
  const maintenance = {
    run: jest.fn(
      (_guild: GuildId, board: string) =>
        new Promise<MaintenanceOutcome>((resolve, reject) => {
          runs.push({ board, finish: (outcome = ok) => resolve(outcome), fail: reject });
        }),
    ),
  };
  return { runs, maintenance, coalescer: new RenderCoalescer(maintenance as unknown as BoardMaintenance) };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('RenderCoalescer', () => {
  it('starts a render at once for a quiet board', async () => {
    const { runs, coalescer } = fakeMaintenance();
    const result = coalescer.request(guild, 'board-1');
    expect(runs).toHaveLength(1);
    runs[0]?.finish();
    await expect(result).resolves.toEqual(ok);
  });

  it('TIM-RQ-02: a burst of requests during a render shares one single follow-up render', async () => {
    const { runs, maintenance, coalescer } = fakeMaintenance();
    const first = coalescer.request(guild, 'board-1');
    const burst = Array.from({ length: 20 }, () => coalescer.request(guild, 'board-1'));
    expect(maintenance.run).toHaveBeenCalledTimes(1);

    runs[0]?.finish();
    await first;
    await tick();
    expect(maintenance.run).toHaveBeenCalledTimes(2);

    runs[1]?.finish({ kind: 'retry', reason: 'rate_limited', retryAt: new Date(0) });
    const results = await Promise.all(burst);
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toMatchObject({ kind: 'retry' });
    await tick();
    expect(maintenance.run).toHaveBeenCalledTimes(2);
  });

  it('never runs two renders of the same board at once, but runs different boards side by side', async () => {
    const { runs, maintenance, coalescer } = fakeMaintenance();
    void coalescer.request(guild, 'board-1');
    void coalescer.request(guild, 'board-2');
    void coalescer.request(guild, 'board-1');
    expect(maintenance.run).toHaveBeenCalledTimes(2);
    expect(runs.map((run) => run.board)).toEqual(['board-1', 'board-2']);
    runs[0]?.finish();
    await tick();
    expect(maintenance.run).toHaveBeenCalledTimes(3);
  });

  it('gives the error to the caller and recovers: the next request starts a fresh render', async () => {
    const { runs, maintenance, coalescer } = fakeMaintenance();
    const failing = coalescer.request(guild, 'board-1');
    const waiting = coalescer.request(guild, 'board-1');
    const failure = new Error('database down');
    runs[0]?.fail(failure);
    await expect(failing).rejects.toBe(failure);
    await tick();
    expect(maintenance.run).toHaveBeenCalledTimes(2);
    runs[1]?.finish();
    await expect(waiting).resolves.toEqual(ok);

    await tick();
    const next = coalescer.request(guild, 'board-1');
    expect(maintenance.run).toHaveBeenCalledTimes(3);
    runs[2]?.finish();
    await expect(next).resolves.toEqual(ok);
  });
});
