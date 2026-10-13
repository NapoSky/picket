import { createDiscordBotRest } from '@picket/discord';
import { Secret } from '@picket/kernel';
import { DashboardDiscord } from '../src';
const APP = '900000000000000001',
  U = '300000000000000001',
  V = '300000000000000002';
it('accepts all accepted Team roles, denies invitations, and refreshes removal on demand', async () => {
  const rest = createDiscordBotRest(new Secret('unused'));
  const get = jest.spyOn(rest, 'get').mockResolvedValue({
    id: APP,
    team: {
      members: [
        { membership_state: 2, role: 'read_only', user: { id: U } },
        { membership_state: 1, role: 'admin', user: { id: V } },
      ],
    },
  });
  const provider = new DashboardDiscord(APP, 'secret', 'https://stats.example/auth/callback', rest);
  expect(await provider.teamMember(U)).toBe(true);
  expect(await provider.teamMember(V)).toBe(false);
  expect(get).toHaveBeenCalledTimes(1);
  get.mockResolvedValue({ id: APP, team: { members: [] } });
  expect(await provider.teamMember(U, true)).toBe(false);
});
it('denies global administration for applications without a Team or a mismatched application', async () => {
  const rest = createDiscordBotRest(new Secret('unused'));
  const get = jest.spyOn(rest, 'get').mockResolvedValue({ id: APP, team: null });
  const provider = new DashboardDiscord(APP, 'secret', 'https://stats.example/auth/callback', rest);
  expect(await provider.teamMember(U)).toBe(false);
  get.mockResolvedValue({ id: '900000000000000002', team: { members: [] } });
  await expect(provider.teamMember(U, true)).rejects.toThrow(/differ/);
});
