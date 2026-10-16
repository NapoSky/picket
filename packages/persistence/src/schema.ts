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
  delivery_pending: Generated<boolean>;
  sent_at: Timestamp;
  acked_by: Nullable<string>;
  acked_at: Nullable<Date>;
}

export interface TimerScheduleTable {
  board_id: string;
  guild_id: string;
  wake_at: Date | string;
}

export interface VoiceSettingsTable { guild_id:string; deployment_limit:Generated<number> }
export interface VoiceTemplatesTable { id:string;guild_id:string;name:string;category_id:string;channel_name:string;capacity:Generated<number>;idle_minutes:Generated<number>;revision:Generated<number> }
export interface VoiceSessionsTable { id:string;guild_id:string;user_id:string;state:ColumnType<unknown,string,string>;revision:Generated<number>;expires_at:Timestamp }
export interface VoiceChannelsTable { id:string;guild_id:string;batch_id:string;template_id:Nullable<string>;template_revision:number;category_id:string;name:string;capacity:number;idle_minutes:number;channel_id:Nullable<string>;status:Generated<'pending'|'creating'|'active'|'uncertain'|'failed'|'deleted'>;completed_at:Nullable<Date>;attempted_at:Nullable<Date>;created_at:Timestamp;empty_since:Nullable<Date>;delete_after:Nullable<Date>;last_verified_at:Nullable<Date>;retry_at:Timestamp;needs_check:Generated<boolean> }
export interface VoicePresenceTable { guild_id:string;user_id:string;channel_id:string }
export interface VoiceRuntimeTable { guild_id:string;lease_name:string;lease_token:string;ready:Generated<boolean> }

export interface Schema {
  voice_settings:VoiceSettingsTable;
  voice_templates:VoiceTemplatesTable;
  voice_sessions:VoiceSessionsTable;
  voice_channels:VoiceChannelsTable;
  voice_presence:VoicePresenceTable;
  voice_runtime:VoiceRuntimeTable;
  guild_support_presence: GuildSupportPresenceTable;
  support_guild_deliveries: SupportGuildDeliveriesTable;
  stats_settings:StatsSettingsTable;
  stats_privacy:StatsPrivacyTable;
  stats_users:StatsUsersTable;
  stats_channels:StatsChannelsTable;
  stats_voice_events:StatsVoiceEventsTable;
  stats_voice_segments:StatsVoiceSegmentsTable;
  stats_voice_presence:StatsVoicePresenceTable;
  warlog_subscriptions: WarLogSubscriptionsTable;
  warlog_deliveries: WarLogDeliveriesTable;
  warlog_hooks: WarLogHooksTable;
  warlog_hook_jobs: WarLogHookJobsTable;
  warlog_schedule: WarLogScheduleTable;
  guild_audit_delivery: GuildAuditDeliveryTable;
  guild_audit_schedule: GuildAuditScheduleTable;
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

export interface GuildSupportPresenceTable {
  revision: Generated<string>;
  guild_id: string;
  name: string;
  present: boolean;
}

export interface SupportGuildDeliveriesTable {
  id: Generated<string>;
  channel_id: string;
  content: string;
  next_attempt_at: Timestamp;
  attempts: Generated<number>;
  last_error: Nullable<string>;
}

export interface StatsSettingsTable {guild_id:string;excluded_channels:ColumnType<string[],string|undefined,string>;afk_channel_id:Nullable<string>;guild_name:Generated<string>;changed_at:Timestamp;enabled_at:Timestamp|null;observed_through:Nullable<Date>;interrupted_at:Nullable<Date>}
export interface StatsPrivacyTable {guild_id:string;user_id:string;opted_out:Generated<boolean>;erased_before:Timestamp}
export interface StatsUsersTable {guild_id:string;user_id:string;name:string;last_seen_at:Timestamp}
export interface StatsChannelsTable {guild_id:string;channel_id:string;name:string;last_seen_at:Timestamp}
export interface StatsVoiceEventsTable {event_key:string;guild_id:string;user_id:string;channel_id:Nullable<string>;previous_channel_id:Nullable<string>;at:Timestamp;kind:string;quality:string}
export interface StatsVoiceSegmentsTable {id:string;guild_id:string;user_id:string;channel_id:string;shard_id:number;started_at:Timestamp;ended_at:Nullable<Date>;confirmed_through:Timestamp;current_roles:ColumnType<string[],string|undefined,string>;end_reason:Nullable<string>;quality:string}
export interface StatsVoicePresenceTable {guild_id:string;user_id:string;channel_id:string;roles:ColumnType<string[],string,string>;shard_id:number;seen_at:Timestamp}

export interface WarLogSubscriptionsTable {
  guild_id: string;
  perspective: Generated<'NONE' | 'WARDENS' | 'COLONIALS'>;
  channel_id: Nullable<string>;
  zones: ColumnType<string[], string | undefined, string>;
  locale: Nullable<string>;
  paused: Generated<boolean>;
  confirmed_war: Nullable<number>;
  enabled_at: Nullable<Date>;
  revision: Generated<number>;
  failure_reason: Nullable<string>;
}
export interface WarLogDeliveriesTable {
  id: Generated<string>; guild_id: string; event_key: string; war_number: number; channel_id: string;
  generation: string; revision: number; payload: ColumnType<unknown, string, string>; locale: Nullable<string>;
  notice: Generated<boolean>; queued_at: Timestamp; next_attempt_at: Timestamp; attempts: Generated<number>;
  claimed_until: Nullable<Date>; completed_at: Nullable<Date>; message_id: Nullable<string>; last_error: Nullable<string>;
}
export interface WarLogHooksTable { guild_id: string; war_number: number; board_id: string; completed_at: Timestamp }
export interface WarLogHookJobsTable { guild_id: string; war_number: number; started_at: Timestamp; completed_at: Nullable<Date> }
export interface WarLogScheduleTable { guild_id: string; wake_at: Nullable<Date>; last_served_at: Timestamp; hook_pending: Generated<boolean> }

export interface GuildAuditDeliveryTable {
  id: Generated<string>;
  guild_id: string;
  channel_id: string;
  audit_id: Nullable<string>;
  timer_event_id: Nullable<string>;
  queued_at: Timestamp;
  next_attempt_at: Timestamp;
  attempts: Generated<number>;
  completed_at: Nullable<Date>;
  message_id: Nullable<string>;
  last_error: Nullable<string>;
}

export interface GuildAuditScheduleTable {
  guild_id: string;
  wake_at: Nullable<Date>;
  failure_reason: Nullable<string>;
  failed_at: Nullable<Date>;
}
