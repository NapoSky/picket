import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>;

export interface GuildSettingsTable {
  guild_id: string;
  locale: Nullable<string>;
  timezone: Generated<string>;
  audit_channel_id: Nullable<string>;
  features: ColumnType<Record<string, boolean>, string | undefined, string>;
  emoji_overrides: ColumnType<Record<string, string>, string | undefined, string>;
  installed_at: Timestamp;
}

export interface GuildRegistryTable {
  guild_id: string;
  registered_at: Timestamp;
  inactive_since: Nullable<Date>;
  inactive_reason: Nullable<'requested' | 'left'>;
}

export interface LeasesTable {
  name: string;
  holder: string;
  token: string;
  expires_at: Timestamp;
}

export interface GatewaySessionsTable {
  shard_id: number;
  session: ColumnType<unknown, string, string>;
  lease_token: string;
  updated_at: Timestamp;
}

export interface InteractionReceiptsTable {
  interaction_id: string;
  guild_id: Nullable<string>;
  received_at: Timestamp;
}

export interface AppStateTable {
  key: string;
  value: string;
  updated_at: Timestamp;
}

export interface GuildPermissionRolesTable {
  guild_id: string;
  level: 'officer' | 'member';
  role_id: string;
}

export interface GuildAuditLogTable {
  id: Generated<string>;
  guild_id: string;
  actor_id: string;
  action: string;
  before: ColumnType<unknown, string | null | undefined, never>;
  after: ColumnType<unknown, string | null | undefined, never>;
  at: Timestamp;
}

export interface Schema {
  guild_settings: GuildSettingsTable;
  guild_registry: GuildRegistryTable;
  leases: LeasesTable;
  gateway_sessions: GatewaySessionsTable;
  guild_permission_roles: GuildPermissionRolesTable;
  guild_audit_log: GuildAuditLogTable;
  interaction_receipts: InteractionReceiptsTable;
  app_state: AppStateTable;
}
