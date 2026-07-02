import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { threadStatusValues } from "@bb/domain/thread-status";
import {
  threadChildOriginValues,
  threadOriginKindValues,
} from "@bb/domain/thread-child-origin";
import type {
  AutomationOrigin,
  AutomationRunMode,
  AutomationRunStatus,
  AutomationRunTrigger,
  AutomationTriggerType,
  EnvironmentStatus,
  FaviconColorPreference,
  HostType,
  PendingInteractionStatus,
  PermissionMode,
  PromptHistoryScope,
  ProjectSourceType,
  ReasoningLevel,
  ServiceTier,
  TerminalSessionCloseReason,
  TerminalSessionStatus,
  ThreadDynamicContextFileStatus,
  ThreadSearchSourceKind,
  ThreadEventItemType,
  ThreadEventScopeKind,
  ThreadEventType,
  WorkspaceProvisionType,
  ProjectKind,
} from "@bb/domain";

export const authUsers = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("emailVerified", { mode: "boolean" }).notNull(),
    image: text("image"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("user_email_unique").on(table.email)],
);

export const authApiKeys = sqliteTable(
  "apikey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    start: text("start"),
    prefix: text("prefix"),
    key: text("key").notNull(),
    referenceId: text("referenceId")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    refillInterval: integer("refillInterval"),
    refillAmount: integer("refillAmount"),
    lastRefillAt: integer("lastRefillAt", { mode: "timestamp_ms" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    rateLimitEnabled: integer("rateLimitEnabled", {
      mode: "boolean",
    }).notNull(),
    rateLimitTimeWindow: integer("rateLimitTimeWindow").notNull(),
    rateLimitMax: integer("rateLimitMax").notNull(),
    requestCount: integer("requestCount").notNull(),
    remaining: integer("remaining"),
    lastRequest: integer("lastRequest", { mode: "timestamp_ms" }),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
    permissions: text("permissions"),
    metadata: text("metadata"),
    configId: text("configId").notNull(),
  },
  (table) => [
    uniqueIndex("apikey_key_unique").on(table.key),
    index("apikey_reference_id_idx").on(table.referenceId),
    index("apikey_config_id_idx").on(table.configId),
  ],
);

export const hosts = sqliteTable(
  "hosts",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").$type<HostType>().notNull(),
    destroyedAt: integer("destroyed_at"),
    lastSeenAt: integer("last_seen_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("hosts_last_seen_idx").on(table.lastSeenAt)],
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<ProjectKind>().notNull().default("standard"),
    name: text("name").notNull(),
    sortKey: text("sort_key").notNull().default("V"),
    deletedAt: integer("deleted_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("projects_updated_idx").on(table.updatedAt),
    index("projects_deleted_idx").on(table.deletedAt),
    index("projects_sort_idx").on(table.sortKey, table.id),
    uniqueIndex("projects_personal_singleton_idx")
      .on(table.kind)
      .where(sql`${table.kind} = 'personal'`),
  ],
);

export const projectExecutionDefaults = sqliteTable(
  "project_execution_defaults",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    model: text("model").notNull(),
    serviceTier: text("service_tier").$type<ServiceTier>().notNull(),
    reasoningLevel: text("reasoning_level").$type<ReasoningLevel>().notNull(),
    permissionMode: text("permission_mode").$type<PermissionMode>().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_execution_defaults_project_idx").on(table.projectId),
  ],
);

export const systemExperiments = sqliteTable("system_experiments", {
  id: text("id").primaryKey(),
  claudeCodeMockCliTraffic: integer("claude_code_mock_cli_traffic", {
    mode: "boolean",
  }).notNull(),
  popoutChat: integer("popout_chat", { mode: "boolean" }).notNull(),
  popoutChatHotkey: text("popout_chat_hotkey").notNull(),
  uiForking: integer("ui_forking", { mode: "boolean" })
    .notNull()
    .default(false),
  updatedAt: integer("updated_at").notNull(),
});

// Single-row table (id = "current") holding the app-wide appearance: the active
// palette id (a built-in theme id, or a custom theme name whose CSS lives on
// disk under `<data-dir>/theme/<name>/theme.css`) and the browser tab icon tint.
export const appTheme = sqliteTable("app_theme", {
  id: text("id").primaryKey(),
  themeId: text("theme_id").notNull(),
  faviconColor: text("favicon_color")
    .$type<FaviconColorPreference>()
    .notNull()
    .default("default"),
  updatedAt: integer("updated_at").notNull(),
});

export const projectSources = sqliteTable(
  "project_sources",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    type: text("type").$type<ProjectSourceType>().notNull(),
    hostId: text("host_id").references(() => hosts.id, { onDelete: "cascade" }),
    path: text("path"),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("project_sources_project_idx").on(table.projectId),
    index("project_sources_host_idx").on(table.hostId),
    uniqueIndex("project_sources_project_host_idx").on(
      table.projectId,
      table.hostId,
    ),
    check(
      "project_sources_shape_check",
      sql`(
        ${table.type} = 'local_path' AND ${table.hostId} IS NOT NULL AND ${table.path} IS NOT NULL
      )`,
    ),
    // NOTE: Drizzle does not support partial/filtered unique indexes.
    // The baseline migration adds the database constraint for at most one
    // default source per project.
  ],
);

export const environments = sqliteTable(
  "environments",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    hostId: text("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    path: text("path"),
    managed: integer("managed", { mode: "boolean" }).notNull().default(false),
    isGitRepo: integer("is_git_repo", { mode: "boolean" })
      .notNull()
      .default(false),
    isWorktree: integer("is_worktree", { mode: "boolean" })
      .notNull()
      .default(false),
    branchName: text("branch_name"),
    baseBranch: text("base_branch"),
    defaultBranch: text("default_branch"),
    mergeBaseBranch: text("merge_base_branch"),
    destroyAttemptId: text("destroy_attempt_id"),
    workspaceProvisionType: text("workspace_provision_type")
      .$type<WorkspaceProvisionType>()
      .notNull(),
    status: text("status")
      .$type<EnvironmentStatus>()
      .notNull()
      .default("provisioning"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("environments_host_path_idx").on(table.hostId, table.path),
    index("environments_project_idx").on(table.projectId),
    index("environments_status_idx").on(table.status),
  ],
);

export const threads = sqliteTable(
  "threads",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    environmentId: text("environment_id").references(() => environments.id, {
      onDelete: "set null",
    }),
    providerId: text("provider_id").notNull(),
    // Sticky, thread-level execution overrides. NULL = no override (fall back to
    // the per-turn request, then the last turn, then project defaults). Consulted
    // by resolveExecutionOptions so a change applies on the next turn without
    // sending a message. Execution config, not lifecycle state.
    modelOverride: text("model_override"),
    reasoningLevelOverride: text(
      "reasoning_level_override",
    ).$type<ReasoningLevel>(),
    title: text("title"),
    titleFallback: text("title_fallback"),
    folderId: text("folder_id").references(() => threadFolders.id, {
      onDelete: "set null",
    }),
    status: text("status", { enum: threadStatusValues })
      .notNull()
      .default("starting"),
    parentThreadId: text("parent_thread_id").references(
      (): AnySQLiteColumn => threads.id,
      { onDelete: "set null" },
    ),
    sourceThreadId: text("source_thread_id").references(
      (): AnySQLiteColumn => threads.id,
      { onDelete: "set null" },
    ),
    originKind: text("origin_kind", {
      enum: threadOriginKindValues,
    }),
    // Deprecated compatibility column for older migrated data. New fork and
    // side-chat provenance uses source_thread_id + origin_kind.
    childOrigin: text("child_origin", {
      enum: threadChildOriginValues,
    }),
    archivedAt: integer("archived_at"),
    pinnedAt: integer("pinned_at"),
    pinSortKey: text("pin_sort_key"),
    deletedAt: integer("deleted_at"),
    lastReadAt: integer("last_read_at"),
    latestAttentionAt: integer("latest_attention_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("threads_project_updated_idx").on(table.projectId, table.updatedAt),
    index("threads_project_archived_deleted_idx").on(
      table.projectId,
      table.archivedAt,
      table.deletedAt,
      table.id,
    ),
    index("threads_pin_sort_idx")
      .on(table.archivedAt, table.deletedAt, table.pinSortKey, table.id)
      .where(sql`${table.pinnedAt} IS NOT NULL`),
    index("threads_environment_idx").on(table.environmentId),
    index("threads_parent_idx").on(table.parentThreadId),
    index("threads_source_origin_idx").on(
      table.sourceThreadId,
      table.originKind,
    ),
    index("threads_folder_archived_deleted_idx").on(
      table.folderId,
      table.archivedAt,
      table.deletedAt,
      table.id,
    ),
    index("threads_archived_status_idx").on(table.archivedAt, table.status),
    index("threads_environment_archived_deleted_idx").on(
      table.environmentId,
      table.archivedAt,
      table.deletedAt,
    ),
    index("threads_active_maintenance_idx")
      .on(table.status)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const threadFolders = sqliteTable(
  "thread_folders",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("thread_folders_name_idx").on(table.name)],
);

export const threadSearchSegments = sqliteTable(
  "thread_search_segments",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind").$type<ThreadSearchSourceKind>().notNull(),
    sourceKey: text("source_key").notNull(),
    sourceSeq: integer("source_seq"),
    text: text("text").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("thread_search_segments_source_idx").on(
      table.threadId,
      table.sourceKind,
      table.sourceKey,
    ),
    index("thread_search_segments_thread_idx").on(table.threadId),
  ],
);

export const threadDynamicContextFileStates = sqliteTable(
  "thread_dynamic_context_file_states",
  {
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    fileKey: text("file_key").notNull(),
    contentStatus: text("content_status")
      .$type<ThreadDynamicContextFileStatus>()
      .notNull(),
    contentHash: text("content_hash").notNull(),
    shownAt: integer("shown_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("thread_dynamic_context_file_states_thread_file_idx").on(
      table.threadId,
      table.fileKey,
    ),
  ],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    environmentId: text("environment_id").references(() => environments.id, {
      onDelete: "set null",
    }),
    scopeKind: text("scope_kind").$type<ThreadEventScopeKind>().notNull(),
    turnId: text("turn_id"),
    providerThreadId: text("provider_thread_id"),
    sequence: integer("sequence").notNull(),
    type: text("type").$type<ThreadEventType>().notNull(),
    itemId: text("item_id"),
    itemKind: text("item_kind").$type<ThreadEventItemType>(),
    data: text("data").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("events_thread_sequence_idx").on(
      table.threadId,
      table.sequence,
    ),
    index("events_thread_type_item_kind_sequence_idx").on(
      table.threadId,
      table.type,
      table.itemKind,
      table.sequence,
    ),
    index("events_thread_type_sequence_idx").on(
      table.threadId,
      table.type,
      table.sequence,
    ),
    index("events_thread_turn_type_item_sequence_idx").on(
      table.threadId,
      table.turnId,
      table.type,
      table.itemId,
      table.sequence,
    ),
    index("events_environment_idx").on(table.environmentId),
    index("events_completed_item_truncation_idx")
      .on(table.itemKind, table.createdAt, table.id)
      .where(sql`${table.type} = 'item/completed'`),
    check(
      "events_scope_shape_check",
      sql`(
        (${table.scopeKind} = 'turn' AND ${table.turnId} IS NOT NULL)
        OR
        (${table.scopeKind} = 'thread' AND ${table.turnId} IS NULL)
      )`,
    ),
  ],
);

export const maintenanceScanCursors = sqliteTable(
  "maintenance_scan_cursors",
  {
    id: text("id").primaryKey(),
    policy: text("policy").notNull(),
    version: integer("version").notNull(),
    itemKind: text("item_kind").$type<ThreadEventItemType>().notNull(),
    outputPath: text("output_path").notNull(),
    lastCreatedAt: integer("last_created_at").notNull().default(0),
    lastEventId: text("last_event_id").notNull().default(""),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("maintenance_scan_cursors_path_idx").on(
      table.policy,
      table.version,
      table.itemKind,
      table.outputPath,
    ),
  ],
);

export const promptHistoryEntries = sqliteTable(
  "prompt_history_entries",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    scope: text("scope").$type<PromptHistoryScope>().notNull(),
    requestSequence: integer("request_sequence").notNull(),
    input: text("input").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("prompt_history_entries_thread_request_idx").on(
      table.threadId,
      table.requestSequence,
    ),
    index("prompt_history_entries_project_scope_created_idx").on(
      table.projectId,
      table.scope,
      table.createdAt,
      table.requestSequence,
      table.id,
    ),
    index("prompt_history_entries_thread_scope_created_idx").on(
      table.threadId,
      table.scope,
      table.createdAt,
      table.requestSequence,
      table.id,
    ),
  ],
);

export const queuedThreadMessages = sqliteTable(
  "queued_thread_messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    senderThreadId: text("sender_thread_id"),
    model: text("model").notNull(),
    reasoningLevel: text("reasoning_level").notNull(),
    permissionMode: text("permission_mode").$type<PermissionMode>().notNull(),
    serviceTier: text("service_tier").notNull(),
    groupWithNext: integer("group_with_next", { mode: "boolean" })
      .notNull()
      .default(false),
    claimedAt: integer("claimed_at"),
    claimToken: text("claim_token"),
    sortKey: text("sort_key").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("queued_thread_messages_thread_created_idx").on(
      table.threadId,
      table.createdAt,
      table.id,
    ),
    index("queued_thread_messages_thread_sort_idx").on(
      table.threadId,
      table.sortKey,
      table.id,
    ),
  ],
);

export const hostDaemonSessions = sqliteTable(
  "host_daemon_sessions",
  {
    id: text("id").primaryKey(),
    hostId: text("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    instanceId: text("instance_id").notNull(),
    hostName: text("host_name").notNull(),
    hostType: text("host_type").$type<HostType>().notNull(),
    dataDir: text("data_dir").notNull(),
    protocolVersion: integer("protocol_version").notNull(),
    heartbeatIntervalMs: integer("heartbeat_interval_ms").notNull(),
    leaseTimeoutMs: integer("lease_timeout_ms").notNull(),
    status: text("status").notNull(),
    leaseExpiresAt: integer("lease_expires_at").notNull(),
    closedAt: integer("closed_at"),
    closeReason: text("close_reason"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("host_daemon_sessions_host_status_idx").on(
      table.hostId,
      table.status,
    ),
    index("host_daemon_sessions_host_latest_idx").on(
      table.hostId,
      table.updatedAt,
      table.createdAt,
      table.id,
    ),
    index("host_daemon_sessions_closed_prune_idx").on(
      table.status,
      table.closedAt,
      table.id,
    ),
  ],
);

export const terminalSessions = sqliteTable(
  "terminal_sessions",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").references(() => threads.id, {
      onDelete: "cascade",
    }),
    environmentId: text("environment_id").references(() => environments.id, {
      onDelete: "cascade",
    }),
    hostId: text("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    daemonSessionId: text("daemon_session_id").references(
      () => hostDaemonSessions.id,
      { onDelete: "set null" },
    ),
    title: text("title").notNull(),
    initialCwd: text("initial_cwd").notNull(),
    cols: integer("cols").notNull(),
    rows: integer("rows").notNull(),
    status: text("status").$type<TerminalSessionStatus>().notNull(),
    exitCode: integer("exit_code"),
    closeReason: text("close_reason").$type<TerminalSessionCloseReason>(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastUserInputAt: integer("last_user_input_at"),
  },
  (table) => [
    index("terminal_sessions_thread_status_updated_idx").on(
      table.threadId,
      table.status,
      table.updatedAt,
    ),
    index("terminal_sessions_environment_status_idx").on(
      table.environmentId,
      table.status,
    ),
    index("terminal_sessions_host_status_idx").on(table.hostId, table.status),
    index("terminal_sessions_daemon_session_idx").on(table.daemonSessionId),
  ],
);

export const pendingInteractions = sqliteTable(
  "pending_interactions",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    turnId: text("turn_id").notNull(),
    providerId: text("provider_id").notNull(),
    providerThreadId: text("provider_thread_id").notNull(),
    providerRequestId: text("provider_request_id").notNull(),
    status: text("status").$type<PendingInteractionStatus>().notNull(),
    payload: text("payload").notNull(),
    resolution: text("resolution"),
    statusReason: text("status_reason"),
    createdAt: integer("created_at").notNull(),
    resolvedAt: integer("resolved_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("pending_interactions_provider_request_idx").on(
      table.providerId,
      table.providerThreadId,
      table.providerRequestId,
    ),
    index("pending_interactions_thread_created_idx").on(
      table.threadId,
      table.createdAt,
    ),
    index("pending_interactions_thread_status_created_idx").on(
      table.threadId,
      table.status,
      table.createdAt,
    ),
    index("pending_interactions_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
  ],
);

export const automations = sqliteTable(
  "automations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Reuse/re-prompt an existing thread (agent mode). NULL => spawn a new thread
    // per run. On thread deletion the automation is DISABLED at the app layer;
    // set null is the hard-delete backstop.
    targetThreadId: text("target_thread_id").references(() => threads.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    triggerType: text("trigger_type").$type<AutomationTriggerType>().notNull(),
    // JSON-as-text: schedule { cron, timezone } or once { runAt }
    triggerConfig: text("trigger_config").notNull(),
    runMode: text("run_mode").$type<AutomationRunMode>().notNull(),
    // JSON-as-text; shape depends on run_mode (agent: prompt/provider/model/
    // permissionMode; script: scriptFile/interpreter/timeoutMs/env). Script
    // content lives on disk under <dataDir>/automation-scripts/<id>/.
    execution: text("execution").notNull(),
    // JSON-as-text: serialized EnvironmentArgs (both modes).
    environment: text("environment").notNull(),
    autoArchive: integer("auto_archive", { mode: "boolean" })
      .notNull()
      .default(false),
    origin: text("origin").$type<AutomationOrigin>().notNull(),
    createdByThreadId: text("created_by_thread_id"),
    nextRunAt: integer("next_run_at"),
    lastRunAt: integer("last_run_at"),
    runCount: integer("run_count").notNull().default(0),
    lastRunStatus: text("last_run_status").$type<AutomationRunStatus>(),
    lastRunThreadId: text("last_run_thread_id"),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("automations_project_idx").on(table.projectId),
    index("automations_due_idx").on(
      table.enabled,
      table.triggerType,
      table.nextRunAt,
    ),
    index("automations_target_thread_idx").on(table.targetThreadId),
  ],
);

export const automationRuns = sqliteTable(
  "automation_runs",
  {
    id: text("id").primaryKey(),
    automationId: text("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    runMode: text("run_mode").$type<AutomationRunMode>().notNull(),
    // Spawned/continued thread for agent runs; null for script runs and skips.
    threadId: text("thread_id").references(() => threads.id, {
      onDelete: "set null",
    }),
    status: text("status").$type<AutomationRunStatus>().notNull(),
    trigger: text("trigger").$type<AutomationRunTrigger>().notNull(),
    skipReason: text("skip_reason"),
    error: text("error"),
    // Captured stdout for script runs (capped + redacted); null for agent runs.
    output: text("output"),
    exitCode: integer("exit_code"),
    idempotencyKey: text("idempotency_key"),
    scheduledFor: integer("scheduled_for").notNull(),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (table) => [
    index("automation_runs_automation_started_idx").on(
      table.automationId,
      table.startedAt,
    ),
    index("automation_runs_thread_idx").on(table.threadId),
  ],
);
