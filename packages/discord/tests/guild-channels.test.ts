import { channelPermissions } from '@picket/discord';

describe('channel permissions for the audit publisher', () => {
  const role = (id: string, permissions: bigint) => ({ id, permissions: String(permissions) });
  const override = (id: string, type: number, allow: bigint, deny: bigint) => ({ id, type, allow: String(allow), deny: String(deny) });
  const needed = 1024n | 2048n | 16384n;
  it('requires permissions from everyone and assigned roles only', () => {
    expect(channelPermissions('guild', 'bot', ['role'], [role('guild', 1024n), role('role', 2048n), role('other', 16384n)], [])).toBe(3072n);
  });
  it('applies everyone, union of roles, then member overrides in that order', () => {
    const roles = [role('guild', needed)];
    const overrides = [override('guild', 0, 0n, 2048n), override('a', 0, 2048n, 0n), override('b', 0, 0n, 2048n)];
    expect(channelPermissions('guild', 'bot', ['a', 'b'], roles, overrides)).toBe(needed);
    expect(channelPermissions('guild', 'bot', ['a', 'b'], roles, [...overrides, override('bot', 1, 0n, 16384n)])).toBe(needed & ~16384n);
  });
  it('administrators bypass channel overrides', () => {
    expect(channelPermissions('guild', 'bot', ['admin'], [role('admin', 8n)], [override('bot', 1, 0n, needed)]) & needed).toBe(needed);
  });
});
