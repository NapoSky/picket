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

export interface GuildApplicationLogsTable {
  id: string;
  guild_id: string;
  record: ColumnType<Record<string, unknown>, string, never>;
  at: Timestamp;
}

export interface TimerBoardsTable {
  id: Generated<string>;
  guild_id: string;
  channel_id: string;
  locale: Nullable<string>;
  settings: ColumnType<Record<string, unknown>, string | undefined, string>;
  rev: Generated<number>;
  needs_sync: Generated<boolean>;
  sync_error: Nullable<string>;
  created_by: string;
  created_at: Timestamp;
  last_activity_at: Timestamp;
  archived_at: Nullable<Date>;
}

export interface TimerBoardMessagesTable {
  board_id: string;
  guild_id: string;
  page: number;
  message_id: string;
  content_hash: string;
}

export interface TimerAssetsTable {
  id: string;
  board_id: string;
  guild_id: string;
  type: string;
  name: string;
  code: Nullable<string>;
  region_key: string;
  location_key: string;
  owner_user_id: string;
  direction: 'down' | 'up';
  duration_s: number;
  started_at: Date | string;
  status: Generated<'active' | 'struck'>;
  struck_at: Nullable<Date>;
  frozen_at: Nullable<Date>;
  rev: Generated<number>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface TimerEventsTable {
  id: Generated<string>;
  guild_id: string;
  board_id: string;
  asset_id: Nullable<string>;
  actor_id: string;
  action: string;
  detail: ColumnType<unknown, string | null | undefined, never>;
  at: Timestamp;
}

export interface TimerAlertsTable {
  asset_id: string;
  guild_id: string;
  board_id: string;
  due_at: Date | string;
  threshold_min: number;
  message_id: Nullable<string>;
  sent_at: Timestamp;
  acked_by: Nullable<string>;
  acked_at: Nullable<Date>;
}

export interface TimerScheduleTable {
  board_id: string;
  guild_id: string;
  wake_at: Date | string;
}

export interface Schema {
  guild_settings: GuildSettingsTable;
  guild_registry: GuildRegistryTable;
  leases: LeasesTable;
  gateway_sessions: GatewaySessionsTable;
  guild_permission_roles: GuildPermissionRolesTable;
  guild_audit_log: GuildAuditLogTable;
  guild_application_logs: GuildApplicationLogsTable;
  interaction_receipts: InteractionReceiptsTable;
  app_state: AppStateTable;
  timer_boards: TimerBoardsTable;
  timer_board_messages: TimerBoardMessagesTable;
  timer_assets: TimerAssetsTable;
  timer_events: TimerEventsTable;
  timer_alerts: TimerAlertsTable;
  timer_schedule: TimerScheduleTable;
}
