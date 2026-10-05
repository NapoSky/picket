import { CommandRegistry, InteractionPipeline, type CommandEntry, type Reply } from '@picket/discord';
import { GuildId, InteractionId, RoleId, UserId, noopLogger } from '@picket/kernel';
import {
  ADMINISTRATOR_BIT,
  HandleRoleDeleted,
  PICKET_ROOT,
  ResolveAccess,
  ShowPermissions,
  UpdatePermissions,
  createGuildAccessPolicy,
  defaultPermissionConfig,
  everyoneRoleId,
  permissionsCommands,
  type AuditActor,
  type PermissionConfig,
  type PermissionDecision,
  type PermissionRepository,
} from '@picket/guild';
import { allFeaturesEnabled, englishT, makeInteraction, noComponents, testI18n } from '@picket/testing';

const guildId = GuildId.assert('700000000000000001');
const officerRole = RoleId.assert('400000000000000011');
const memberRole = RoleId.assert('400000000000000012');
const adminUser = UserId.assert('500000000000000009');

interface AuditRecord {
  readonly actor: AuditActor;
  readonly action: string;
  readonly before: PermissionConfig;
  readonly after: PermissionConfig;
}

class InMemoryPermissionRepository implements PermissionRepository {
  config = defaultPermissionConfig(guildId);
  readonly audit: AuditRecord[] = [];

  async load(): Promise<PermissionConfig> {
    return this.config;
  }

  async modify(
    _guildId: GuildId,
    actor: AuditActor,
    action: string,
    decide: (current: PermissionConfig) => PermissionDecision,
  ) {
    const before = this.config;
    const decision = decide(before);
    if (decision.kind === 'apply') {
      this.config = decision.next;
      this.audit.push({ actor, action, before, after: decision.next });
    }
    return { decision, before };
  }
}

function setup() {
  const repository = new InMemoryPermissionRepository();
  const [show, set] = permissionsCommands({
    show: new ShowPermissions(repository),
    update: new UpdatePermissions(repository),
  }) as [CommandEntry, CommandEntry];
  const run = async (entry: CommandEntry, overrides: Parameters<typeof makeInteraction>[0] = {}): Promise<string> => {
    const reply: Reply = await entry.handler({
      interaction: makeInteraction({ userId: adminUser, ...overrides }),
      guildId,
      logger: noopLogger,
      t: englishT,
    });
    return reply.kind === 'message' ? reply.content : '';
  };
  const runSet = (options: Record<string, string | boolean>) => run(set, { options });
  return { repository, show, set, run, runSet };
}

describe('/picket permissions set', () => {
  it('declares admin-only access and a closed set of choices', () => {
    const { set, show } = setup();
    expect(set.level).toBe('admin');
    expect(show.level).toBe('member');
    expect(set.options?.map((option) => [option.name, option.required === true])).toEqual([
      ['level', true],
      ['role', true],
      ['action', true],
      ['confirm', false],
    ]);
  });

  it('adds a role and records an audit entry with before and after', async () => {
    const { repository, runSet } = setup();

    const reply = await runSet({ level: 'officer', role: officerRole, action: 'add' });

    expect(reply).toBe(`<@&${officerRole}> now has the officer level.`);
    expect(repository.config.officer).toEqual([officerRole]);
    expect(repository.audit).toEqual([
      expect.objectContaining({
        actor: adminUser,
        action: 'permissions.add',
        before: defaultPermissionConfig(guildId),
        after: { officer: [officerRole], member: [guildId] },
      }),
    ]);
  });

  it('removes a role', async () => {
    const { repository, runSet } = setup();
    await runSet({ level: 'member', role: memberRole, action: 'add' });
    expect(await runSet({ level: 'member', role: memberRole, action: 'remove' })).toBe(
      `<@&${memberRole}> no longer has the member level.`,
    );
    expect(repository.config.member).toEqual([guildId]);
  });

  it('reports a no-op without writing an audit entry', async () => {
    const { repository, runSet } = setup();
    expect(await runSet({ level: 'officer', role: officerRole, action: 'remove' })).toContain('does not have the officer level');
    await runSet({ level: 'officer', role: officerRole, action: 'add' });
    expect(await runSet({ level: 'officer', role: officerRole, action: 'add' })).toContain('already has the officer level');
    expect(repository.audit).toHaveLength(1);
  });

  it('refuses @everyone as officer', async () => {
    const { repository, runSet } = setup();
    expect(await runSet({ level: 'officer', role: guildId, action: 'add', confirm: true })).toBe(
      '@everyone cannot be an officer role.',
    );
    expect(repository.audit).toHaveLength(0);
  });

  it('asks for confirmation before opening member to everyone, then applies it', async () => {
    const { repository, runSet } = setup();
    await runSet({ level: 'member', role: guildId, action: 'remove' });
    expect(repository.config.member).toEqual([]);

    expect(await runSet({ level: 'member', role: guildId, action: 'add' })).toContain('confirm:True');
    expect(repository.config.member).toEqual([]);

    expect(await runSet({ level: 'member', role: guildId, action: 'add', confirm: true })).toBe(
      '@everyone now has the member level.',
    );
    expect(repository.config.member).toEqual([guildId]);
  });

  it.each([
    ['level', { level: 'admin', role: officerRole, action: 'add' }],
    ['action', { level: 'officer', role: officerRole, action: 'toggle' }],
    ['role', { level: 'officer', role: 'not-a-role', action: 'add' }],
    ['missing options', {}],
  ])('rejects an invalid %s without touching the configuration', async (_label, options) => {
    const { repository, runSet } = setup();
    const reply = await runSet(options);
    expect(reply).toMatch(/^Invalid /);
    expect(repository.audit).toHaveLength(0);
  });
});

describe('/picket permissions show', () => {
  it('shows the effective configuration, the caller level and warnings', async () => {
    const { run, show, runSet } = setup();
    const reply = await run(show, { memberPermissions: ADMINISTRATOR_BIT });

    expect(reply).toContain('Your access level: admin');
    expect(reply).toContain('Officer roles: none (server administrators only)');
    expect(reply).toContain('Member roles: @everyone');
    expect(reply).toContain('Warning: No officer role is configured');
    expect(reply).toContain('Warning: Everyone on the server can use member commands.');

    await runSet({ level: 'officer', role: officerRole, action: 'add' });
    await runSet({ level: 'member', role: guildId, action: 'remove' });
    await runSet({ level: 'member', role: memberRole, action: 'add' });
    const restricted = await run(show, { memberRoleIds: [officerRole], memberPermissions: 0n });
    expect(restricted).toContain('Your access level: officer');
    expect(restricted).toContain(`Officer roles: <@&${officerRole}>`);
    expect(restricted).not.toContain('Warning');
  });

  it('shows "none" for a caller matching no level', async () => {
    const { run, show, runSet } = setup();
    await runSet({ level: 'member', role: guildId, action: 'remove' });
    expect(await run(show, { memberPermissions: 0n })).toContain('Your access level: none');
  });
});

describe('HandleRoleDeleted', () => {
  it('removes the role everywhere and audits it as the system', async () => {
    const repository = new InMemoryPermissionRepository();
    repository.config = { officer: [officerRole], member: [everyoneRoleId(guildId), officerRole] };

    expect(await new HandleRoleDeleted(repository).execute(guildId, officerRole)).toBe(true);
    expect(repository.config).toEqual({ officer: [], member: [guildId] });
    expect(repository.audit[0]).toMatchObject({ actor: 'system', action: 'permissions.role_deleted' });

    expect(await new HandleRoleDeleted(repository).execute(guildId, officerRole)).toBe(false);
    expect(repository.audit).toHaveLength(1);
  });
});

describe('access enforcement through the interaction pipeline (XCT-EC-05)', () => {
  function pipelineFor(repository: InMemoryPermissionRepository) {
    const status: CommandEntry = {
      path: ['picket', 'status'],
      description: 'commands.picket.status.description',
      level: 'member',
      handler: async () => ({ kind: 'message', content: 'status ok', ephemeral: true }),
    };
    const entries = [status, ...permissionsCommands({ show: new ShowPermissions(repository), update: new UpdatePermissions(repository) })];
    const seen = new Set<string>();
    return new InteractionPipeline({
      registry: new CommandRegistry([PICKET_ROOT], entries, testI18n),
      receipts: { claim: async (id) => (seen.has(id) ? false : (seen.add(id), true)) },
      access: createGuildAccessPolicy(new ResolveAccess(repository)),
      gate: { suspensionOf: async () => null },
      language: { localeOf: async () => null },
      components: noComponents,
      features: allFeaturesEnabled,
      logger: noopLogger,
    });
  }

  let counter = 0;
  const call = (pipeline: InteractionPipeline, path: string[], extra: Parameters<typeof makeInteraction>[0] = {}) =>
    pipeline.handle(
      makeInteraction({ id: InteractionId.assert(`91000000000000${String(1000 + counter++)}`), commandPath: path, ...extra }),
    );
  const text = (reply: Reply) => (reply.kind === 'message' ? reply.content : '');

  it('lets a member use status but not change permissions', async () => {
    const pipeline = pipelineFor(new InMemoryPermissionRepository());
    expect(text(await call(pipeline, ['picket', 'status'], { memberPermissions: 0n }))).toBe('status ok');
    expect(text(await call(pipeline, ['picket', 'permissions', 'set'], { memberPermissions: 0n }))).toContain('required level: admin');
  });

  it('evaluates the level at click time, not when something was created', async () => {
    const repository = new InMemoryPermissionRepository();
    const pipeline = pipelineFor(repository);
    expect(text(await call(pipeline, ['picket', 'status'], { memberPermissions: 0n }))).toBe('status ok');

    await repository.modify(guildId, adminUser, 'permissions.remove', () => ({
      kind: 'apply',
      next: { officer: [], member: [] },
    }));

    expect(text(await call(pipeline, ['picket', 'status'], { memberPermissions: 0n }))).toContain('required level: member');
  });

  it('denies an interaction without computed permissions even if @everyone is allowed', async () => {
    const pipeline = pipelineFor(new InMemoryPermissionRepository());
    expect(text(await call(pipeline, ['picket', 'status'], { memberPermissions: null }))).toContain('required level: member');
  });

  it('lets an administrator in even when no role grants member access', async () => {
    const repository = new InMemoryPermissionRepository();
    repository.config = { officer: [], member: [] };
    const pipeline = pipelineFor(repository);
    expect(text(await call(pipeline, ['picket', 'status'], { memberPermissions: ADMINISTRATOR_BIT }))).toBe('status ok');
  });
});
