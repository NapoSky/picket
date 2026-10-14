import { instrumentRestOptions } from '@picket/discord';
import type { OperationalMetrics } from '@picket/kernel';

it('counts actual REST 429 responses, network failures and budget waits without route or token labels', async () => {
  const metrics: OperationalMetrics = { record: jest.fn(), set: jest.fn() };
  const makeRequest = jest.fn().mockResolvedValueOnce(new Response('{}', { status: 429 }))
    .mockRejectedValueOnce(new Error('network failed'));
  const budget = { acquire: jest.fn().mockResolvedValue(undefined) };
  const options = instrumentRestOptions({ makeRequest }, metrics, 'bot', budget);
  const call = () => options.makeRequest!('https://discord.com/api/webhooks/123/SECRET', { method: 'POST' });
  expect((await call()).status).toBe(429);
  await expect(call()).rejects.toThrow('network failed');
  expect(metrics.record).toHaveBeenCalledWith('discord_rest', expect.any(Number), 'limited', 'bot');
  expect(metrics.record).toHaveBeenCalledWith('discord_rest', expect.any(Number), 'error', 'bot');
  expect(metrics.record).toHaveBeenCalledWith('discord_budget', expect.any(Number), 'success', 'bot');
  expect(JSON.stringify((metrics.record as jest.Mock).mock.calls)).not.toMatch(/SECRET|webhooks|123/);
});
