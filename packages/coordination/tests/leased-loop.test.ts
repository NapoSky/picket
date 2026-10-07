import { noopLogger } from '@picket/kernel';
import { startLeasedLoop } from '@picket/coordination';

describe('startLeasedLoop', () => {
  it('runs a pass right away, then one per interval, until stopped', async () => {
    const sleeps: number[] = [];
    let release: () => void = () => undefined;
    const tick = jest.fn(async () => undefined);
    const sleep = jest.fn((ms: number, signal: AbortSignal) => {
      sleeps.push(ms);
      return new Promise<void>((resolve) => {
        release = resolve;
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    });

    const stop = startLeasedLoop({ tick, intervalMs: 15_000, logger: noopLogger, sleep });
    await Promise.resolve();
    expect(tick).toHaveBeenCalledTimes(1);

    release();
    await new Promise((resolve) => setImmediate(resolve));
    expect(tick).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([15_000, 15_000]);

    await stop();
    const calls = tick.mock.calls.length;
    await new Promise((resolve) => setImmediate(resolve));
    expect(tick).toHaveBeenCalledTimes(calls);
  });

  it('logs a failing pass and keeps going', async () => {
    const error = jest.fn();
    const logger = { ...noopLogger, error };
    let release: () => void = () => undefined;
    let failures = 0;
    const tick = jest.fn(async () => {
      failures += 1;
      if (failures === 1) throw new Error('boom');
    });
    const sleep = (_ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        release = resolve;
        signal.addEventListener('abort', () => resolve(), { once: true });
      });

    const stop = startLeasedLoop({ tick, intervalMs: 1, logger, sleep });
    await new Promise((resolve) => setImmediate(resolve));
    expect(error).toHaveBeenCalledTimes(1);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    expect(tick).toHaveBeenCalledTimes(2);
    await stop();
  });

  it('waits for the pass in progress when stopping', async () => {
    let finish: () => void = () => undefined;
    const events: string[] = [];
    const tick = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            events.push('pass done');
            resolve();
          };
        }),
    );
    const stop = startLeasedLoop({ tick, intervalMs: 1_000, logger: noopLogger, sleep: async () => undefined });
    await Promise.resolve();
    const stopped = stop().then(() => events.push('stopped'));
    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toEqual([]);
    finish();
    await stopped;
    expect(events).toEqual(['pass done', 'stopped']);
  });

  it('does not begin a long sleep when stopped during the pass', async () => {
    let finish!: () => void;
    const sleep = jest.fn(async () => undefined);
    const stop = startLeasedLoop({ tick: () => new Promise<void>((resolve) => { finish = resolve; }), intervalMs: 60_000, logger: noopLogger, sleep });
    const stopped = stop();
    finish();
    await stopped;
    expect(sleep).not.toHaveBeenCalled();
  });
});
