import { drainBot } from '../src/shutdown';

it('withdraws readiness immediately and drains interactions while a background job is still blocked', async () => {
  const events: string[] = [];
  let finishJob!: () => void;
  let proxyRemoved!: () => void;
  const job = new Promise<void>((resolve) => { finishJob = resolve; });
  const proxy = new Promise<void>((resolve) => { proxyRemoved = resolve; });
  const closeInteractions = jest.fn(async () => { events.push('interactions closed'); });
  const closeInfrastructure = jest.fn(async () => { events.push('SQL closed'); });
  const stopped = drainBot({
    beginDrain: () => { events.push('not ready'); },
    stopBackground: async () => { events.push('stopping job'); await job; events.push('job stopped'); },
    waitForProxy: () => proxy, closeInteractions, closeInfrastructure,
  });
  expect(events).toEqual(['not ready']);
  expect(closeInteractions).not.toHaveBeenCalled();
  proxyRemoved();
  // Wait for the foreground completion, without resolving the blocked job.
  await Promise.resolve();
  await Promise.resolve();
  expect(closeInteractions).toHaveBeenCalledTimes(1);
  expect(closeInfrastructure).not.toHaveBeenCalled();
  finishJob();
  await stopped;
  expect(events).toEqual(['not ready', 'stopping job', 'interactions closed', 'job stopped', 'SQL closed']);
});

it('still drains interactions and closes SQL when stopping a worker fails', async () => {
  const closeInteractions = jest.fn(async () => undefined);
  const closeInfrastructure = jest.fn(async () => undefined);
  await expect(drainBot({
    beginDrain: () => undefined,
    stopBackground: async () => { throw new Error('worker failed to stop'); },
    waitForProxy: async () => undefined, closeInteractions, closeInfrastructure,
  })).rejects.toThrow('Bot shutdown failed');
  expect(closeInteractions).toHaveBeenCalledTimes(1);
  expect(closeInfrastructure).toHaveBeenCalledTimes(1);
});
