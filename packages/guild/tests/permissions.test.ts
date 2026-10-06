import { CommandRegistry, InteractionPipeline, type CommandEntry, type Reply } from '@picket/discord';
import { GuildId, InteractionId, RoleId, UserId, noopLogger } from '@picket/kernel';
import {
  ADMINISTRATOR_BIT,
  HandleRoleDeleted,
  PICKET_ROOT,
  ResolveAccess,
  createGuildAccessPolicy,
  defaultPermissionConfig,
  everyoneRoleId,
  type AuditActor,
  type PermissionConfig,
  type PermissionDecision,
  type PermissionRepository,
} from '@picket/guild';
import { allFeaturesEnabled, makeInteraction, noComponents, testI18n } from '@picket/testing';

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
    const entries: CommandEntry[] = [status, { path: ['picket', 'settings'], description: 'commands.picket.settings.description', level: 'admin', handler: async () => ({ kind: 'message', content: 'settings', ephemeral: true }) }];
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
    expect(text(await call(pipeline, ['picket', 'settings'], { memberPermissions: 0n }))).toContain('required level: admin');
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
