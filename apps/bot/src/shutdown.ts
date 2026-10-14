/** Stop accepting traffic independently of slow background jobs; keep SQL open
 * until both existing interactions and workers have finished using it. The
 * entry point bounds the whole shutdown with its final process-exit timer.
 */
export async function drainBot(options: {
  readonly beginDrain: () => void;
  readonly stopBackground: () => Promise<void>;
  readonly waitForProxy: () => Promise<void>;
  readonly closeInteractions: () => Promise<void>;
  readonly closeInfrastructure: () => Promise<void>;
}): Promise<void> {
  options.beginDrain();
  const results = await Promise.allSettled([
    // Schedule both paths even if a stop throws synchronously.
    Promise.resolve().then(options.stopBackground),
    (async () => {
      await options.waitForProxy();
      await options.closeInteractions();
    })(),
  ]);
  await options.closeInfrastructure();
  const errors = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
  if (errors.length) throw new AggregateError(errors, 'Bot shutdown failed');
}
