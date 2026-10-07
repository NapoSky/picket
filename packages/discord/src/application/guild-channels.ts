import type { ChannelId, GuildId } from '@picket/kernel';

export type AuditChannelFailure = 'unknown_channel' | 'missing_access' | 'missing_permissions' | 'wrong_guild' | 'unsupported_channel';
export type AuditChannelAccess = { readonly kind: 'ready'; readonly locale: string | null }
  | { readonly kind: 'blocked'; readonly reason: AuditChannelFailure };
export interface GuildChannels {
  inspect(guildId: GuildId, channelId: ChannelId): Promise<AuditChannelAccess>;
}

/** Algorithme Discord : base, everyone, union des rôles, puis surcharge du membre. */
export function channelPermissions(
  guildId: string, userId: string, memberRoles: readonly string[],
  roles: readonly { readonly id: string; readonly permissions: string }[],
  overwrites: readonly { readonly id: string; readonly type: number; readonly allow: string; readonly deny: string }[],
): bigint {
  let permissions = roles.filter((role) => role.id === guildId || memberRoles.includes(role.id)).reduce((all, role) => all | BigInt(role.permissions), 0n);
  if ((permissions & 8n) !== 0n) return ~0n;
  const apply = (allow: bigint, deny: bigint) => { permissions = (permissions & ~deny) | allow; };
  const everyone = overwrites.find((overwrite) => overwrite.id === guildId && overwrite.type === 0);
  if (everyone) apply(BigInt(everyone.allow), BigInt(everyone.deny));
  const roleOverrides = overwrites.filter((overwrite) => overwrite.type === 0 && overwrite.id !== guildId && memberRoles.includes(overwrite.id));
  apply(roleOverrides.reduce((all, value) => all | BigInt(value.allow), 0n), roleOverrides.reduce((all, value) => all | BigInt(value.deny), 0n));
  const member = overwrites.find((overwrite) => overwrite.id === userId && overwrite.type === 1);
  if (member) apply(BigInt(member.allow), BigInt(member.deny));
  return permissions;
}
