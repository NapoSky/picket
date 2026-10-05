import { GuildId, RoleId } from '@picket/kernel';
import {
  ADMINISTRATOR_BIT,
  decidePermissionChange,
  defaultPermissionConfig,
  everyoneRoleId,
  permissionWarnings,
  removeRoleFromConfig,
  resolveAccessLevel,
  type PermissionConfig,
} from '@picket/guild';

const guildId = GuildId.assert('700000000000000001');
const everyone = everyoneRoleId(guildId);
const role = (n: number) => RoleId.assert(`4000000000000000${String(10 + n)}`);
const [r1, r2, r3] = [role(1), role(2), role(3)] as const;

const config = (overrides: Partial<PermissionConfig> = {}): PermissionConfig => ({
  officer: [],
  member: [],
  ...overrides,
});

describe('resolveAccessLevel', () => {
  const resolve = (roleIds: readonly RoleId[], permissions: bigint | null, cfg: PermissionConfig) =>
    resolveAccessLevel({ guildId, roleIds, permissions, config: cfg });

  it('grants admin to the Administrator permission (which Discord also gives to the owner), whatever the roles', () => {
    expect(resolve([], ADMINISTRATOR_BIT, config())).toBe('admin');
    expect(resolve([r1], ADMINISTRATOR_BIT | 0x800n, config({ officer: [r1] }))).toBe('admin');
  });

  it('grants officer from an officer role', () => {
    expect(resolve([r1], 0n, config({ officer: [r1] }))).toBe('officer');
  });

  it('grants member from a member role', () => {
    expect(resolve([r2], 0n, config({ member: [r2] }))).toBe('member');
  });

  it('XCT-EC-04: @everyone in the member list gives member to a user without any role', () => {
    expect(resolve([], 0n, config({ member: [everyone] }))).toBe('member');
  });

  it('XCT-EC-03: the highest level wins when a user holds roles of both levels', () => {
    expect(resolve([r1, r2], 0n, config({ officer: [r1], member: [r2] }))).toBe('officer');
  });

  it('XCT-EC-02: with no officer role, officer access stays reserved to administrators', () => {
    expect(resolve([r1], 0n, config({ member: [r1] }))).toBe('member');
    expect(resolve([r1], ADMINISTRATOR_BIT, config({ member: [r1] }))).toBe('admin');
  });

  it('denies a user matching nothing', () => {
    expect(resolve([r3], 0n, config({ officer: [r1], member: [r2] }))).toBeNull();
    expect(resolve([], 0n, config({ member: [r2] }))).toBeNull();
  });

  it('XCT-EC-06: never authorizes a partial interaction (permissions unknown), even for @everyone', () => {
    expect(resolve([r1], null, config({ officer: [r1], member: [everyone] }))).toBeNull();
  });

  it('does not treat @everyone in the officer list as an officer grant (defense in depth)', () => {
    expect(resolve([], 0n, config({ officer: [everyone] }))).toBeNull();
  });

  it('does not let other permission bits stand in for Administrator', () => {
    expect(resolve([], 0x20n | 0x10n, config())).toBeNull();
  });
});

describe('defaultPermissionConfig', () => {
  it('opens member to @everyone only, with no officer', () => {
    expect(defaultPermissionConfig(guildId)).toEqual({ officer: [], member: [everyone] });
  });
});

describe('decidePermissionChange', () => {
  const change = (current: PermissionConfig, level: 'officer' | 'member', roleId: RoleId, action: 'add' | 'remove', confirmed = false) =>
    decidePermissionChange(guildId, current, { level, roleId, action, confirmed });

  it('adds a role, keeping the list sorted and unique', () => {
    expect(change(config({ officer: [r2] }), 'officer', r1, 'add')).toEqual({
      kind: 'apply',
      next: { officer: [r1, r2], member: [] },
    });
  });

  it('removes a role', () => {
    expect(change(config({ member: [r1, r2] }), 'member', r1, 'remove')).toEqual({
      kind: 'apply',
      next: { officer: [], member: [r2] },
    });
  });

  it('is idempotent: re-adding or re-removing changes nothing', () => {
    expect(change(config({ member: [r1] }), 'member', r1, 'add')).toEqual({ kind: 'unchanged', reason: 'already_present' });
    expect(change(config(), 'member', r1, 'remove')).toEqual({ kind: 'unchanged', reason: 'not_present' });
  });

  it('rejects @everyone as an officer role, with or without confirmation', () => {
    for (const confirmed of [false, true]) {
      expect(change(config(), 'officer', everyone, 'add', confirmed)).toEqual({
        kind: 'rejected',
        reason: 'everyone_not_allowed_for_officer',
      });
    }
  });

  it('requires an explicit confirmation to open member to @everyone', () => {
    expect(change(config(), 'member', everyone, 'add')).toEqual({ kind: 'confirmation_required', reason: 'opens_to_everyone' });
    expect(change(config(), 'member', everyone, 'add', true)).toEqual({
      kind: 'apply',
      next: { officer: [], member: [everyone] },
    });
  });

  it('does not ask confirmation for narrowing access or for ordinary roles', () => {
    expect(change(config({ member: [everyone] }), 'member', everyone, 'remove').kind).toBe('apply');
    expect(change(config(), 'member', r1, 'add').kind).toBe('apply');
  });

  it('does not mutate its input', () => {
    const current = config({ officer: [r1], member: [r2] });
    const snapshot = JSON.stringify(current);
    change(current, 'officer', r3, 'add');
    change(current, 'member', r2, 'remove');
    expect(JSON.stringify(current)).toBe(snapshot);
  });
});

describe('removeRoleFromConfig (XCT-EC-01: deleted role)', () => {
  it('removes the role from every level', () => {
    expect(removeRoleFromConfig(config({ officer: [r1, r2], member: [r1] }), r1)).toEqual({
      kind: 'apply',
      next: { officer: [r2], member: [] },
    });
  });

  it('does nothing for an unknown role', () => {
    expect(removeRoleFromConfig(config({ officer: [r1] }), r3)).toEqual({ kind: 'unchanged', reason: 'not_present' });
  });
});

describe('permissionWarnings', () => {
  it('warns when there is no officer role and when member is open to everyone', () => {
    expect(permissionWarnings(guildId, defaultPermissionConfig(guildId))).toEqual(['no_officer_role', 'member_open_to_everyone']);
  });

  it('is silent for a restricted configuration with an officer role', () => {
    expect(permissionWarnings(guildId, config({ officer: [r1], member: [r2] }))).toEqual([]);
  });
});
