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
import type {
  EnvironmentCleanupMode,
  EnvironmentStatus,
  HostType,
  LifecycleOperationState,
  PendingInteractionStatus,
  PermissionMode,
  PromptHistoryScope,
  ProjectSourceType,
  ReasoningLevel,
  ServiceTier,
  TerminalSessionCloseReason,
  TerminalSessionStatus,
  ThreadDynamicContextFileStatus,
  ThreadScheduleKind,
  ThreadEventItemType,
  ThreadEventScopeKind,
  ThreadEventType,
  WorkflowRunEventType,
  WorkflowRunOperationKind,
  WorkflowRunPendingManagerNotification,
  WorkflowRunRetention,
  WorkflowRunSourceTier,
  WorkflowRunStatus,
  WorkflowSandbox,
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

/**
 * Explicit per-project workflow policy (plan M7): `sandboxCeiling` is the
 * most permissive sandbox the project's workflow launches and per-call
 * `agent({sandbox})` specs may use — raising it to "danger-full-access" IS
 * the danger-full-access allowance — and `defaultBudgetOutputTokens` fills
 * the run budget when a launch doesn't override it. Row absence means the
 * built-in policy defaults (`PROJECT_WORKFLOW_POLICY_DEFAULTS`, server-side);
 * the server resolves the effective policy once at the launch boundary.
 * Unlike `project_execution_defaults` (implicitly-remembered last selection)
 * this is an explicit, user-edited contract surface.
 */
export const projectWorkflowPolicies = sqliteTable("project_workflow_policies", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  sandboxCeiling: text("sandbox_ceiling").$type<WorkflowSandbox>().notNull(),
  /** Null = no project budget default; launches without an override run unbounded. */
  defaultBudgetOutputTokens: integer("default_budget_output_tokens"),
  createdAt: integer("created_at").notNull(),
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
    cleanupRequestedAt: integer("cleanup_requested_at"),
    cleanupMode: text("cleanup_mode").$type<EnvironmentCleanupMode>(),
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
    index("environments_cleanup_requested_idx").on(table.cleanupRequestedAt),
    index("environments_status_idx").on(table.status),
  ],
);

export const automations = sqliteTable(
  "automations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    triggerType: text("trigger_type").notNull(),
    triggerConfig: text("trigger_config").notNull(),
    action: text("action").notNull(),
    autoArchive: integer("auto_archive", { mode: "boolean" })
      .notNull()
      .default(false),
    nextRunAt: integer("next_run_at"),
    lastRunAt: integer("last_run_at"),
    runCount: integer("run_count").notNull().default(0),
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
    automationId: text("automation_id").references(() => automations.id, {
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
    status: text("status", { enum: threadStatusValues })
      .notNull()
      .default("created"),
    parentThreadId: text("parent_thread_id").references(
      (): AnySQLiteColumn => threads.id,
      { onDelete: "set null" },
    ),
    archivedAt: integer("archived_at"),
    pinnedAt: integer("pinned_at"),
    pinSortKey: text("pin_sort_key"),
    stopRequestedAt: integer("stop_requested_at"),
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
    index("threads_automation_runtime_idx").on(
      table.automationId,
      table.archivedAt,
      table.deletedAt,
      table.status,
    ),
    index("threads_parent_idx").on(table.parentThreadId),
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

export const threadSchedules = sqliteTable(
  "thread_schedules",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    // Intentionally single-valued today; persisted as the discriminator for
    // future non-cron schedule kinds.
    kind: text("kind").$type<ThreadScheduleKind>().notNull(),
    cron: text("cron").notNull(),
    timezone: text("timezone").notNull(),
    prompt: text("prompt").notNull(),
    nextFireAt: integer("next_fire_at").notNull(),
    lastFiredAt: integer("last_fired_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("thread_schedules_due_idx").on(table.enabled, table.nextFireAt),
    index("thread_schedules_project_idx").on(table.projectId),
    uniqueIndex("thread_schedules_thread_name_idx").on(
      table.threadId,
      table.name,
    ),
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
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    environmentId: text("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
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

/**
 * A deterministic workflow run. Source, args, seed, host, workspace, and all
 * execution defaults are snapshotted as explicit columns at create time
 * (server boundary), so a run is self-contained and auditable — an edited or
 * deleted on-disk workflow file never strands it. `status` is strictly the
 * run's current state; requested/queued work lives on
 * `workflow_run_operations`.
 */
export const workflowRuns = sqliteTable(
  "workflow_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    hostId: text("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    /** The resolved checkout/cwd for non-worktree agents. */
    workspacePath: text("workspace_path").notNull(),
    /** Null has real semantics: launched outside a thread. */
    anchorThreadId: text("anchor_thread_id").references(() => threads.id, {
      onDelete: "set null",
    }),
    /**
     * Client-supplied idempotency key for POST /workflow-runs (unique;
     * replayed requests return the original run). Null = launched without
     * replay protection.
     */
    clientRequestId: text("client_request_id"),
    workflowName: text("workflow_name").notNull(),
    sourceTier: text("source_tier").$type<WorkflowRunSourceTier>().notNull(),
    scriptSource: text("script_source").notNull(),
    scriptHash: text("script_hash").notNull(),
    /** Null = launched without args (distinct from "null" JSON args). */
    argsJson: text("args_json"),
    seed: integer("seed").notNull(),
    keyVersion: text("key_version").notNull(),
    providerId: text("provider_id").notNull(),
    /** Null = no run-level model override; each provider uses its default model. */
    model: text("model"),
    effort: text("effort").$type<ReasoningLevel>().notNull(),
    sandbox: text("sandbox").$type<WorkflowSandbox>().notNull(),
    /**
     * The project's sandbox ceiling snapshotted at launch (fill-once): the
     * daemon executor enforces per-call `agent({sandbox})` specs against it,
     * and resume rebuilds `workflow.start` from the run row. The snapshot is
     * the run's UPPER bound — a later policy raise never loosens it — while
     * each command queue clamps it to the project's current effective
     * ceiling, so a revoked grant reaches held starts and resumes. The
     * column default exists only to backfill pre-M7 rows with the ceiling
     * they were launched under; the create path always writes it explicitly.
     */
    sandboxCeiling: text("sandbox_ceiling")
      .$type<WorkflowSandbox>()
      .notNull()
      .default("workspace-write"),
    concurrency: integer("concurrency").notNull(),
    maxAgents: integer("max_agents").notNull(),
    maxFanout: integer("max_fanout").notNull(),
    /** Null = no output-token ceiling. */
    budgetOutputTokens: integer("budget_output_tokens"),
    status: text("status").$type<WorkflowRunStatus>().notNull(),
    failureReason: text("failure_reason"),
    /**
     * Durable manager-notification intent for anchored runs ("paused" |
     * "settled"); null = nothing owed. Set/cleared only by the lifecycle
     * writers (internal-lifecycle): interruption sets "paused", the
     * server-side cancel settle sets "settled" (as does the best-effort
     * terminal push when a pending manager command transiently blocks it),
     * and any move out of `interrupted`, into a terminal status, or into
     * `archived` retention clears stale intent. The delivery sweep consumes
     * it once the manager's host is reachable.
     */
    pendingManagerNotification: text(
      "pending_manager_notification",
    ).$type<WorkflowRunPendingManagerNotification>(),
    /** Superseding WorkflowProgressSnapshot JSON; null until the first fold. */
    progressSnapshot: text("progress_snapshot"),
    usageInputTokens: integer("usage_input_tokens").notNull().default(0),
    usageOutputTokens: integer("usage_output_tokens").notNull().default(0),
    usageToolUses: integer("usage_tool_uses").notNull().default(0),
    usageDurationMs: integer("usage_duration_ms").notNull().default(0),
    resultJson: text("result_json"),
    retention: text("retention").$type<WorkflowRunRetention>().notNull(),
    /**
     * When the daemon confirmed the run dir (per-agent event logs, worktree
     * checkouts, journal hot cache) was pruned after archive; null = not yet
     * pruned. The durable marker the run-dir prune sweep converges on — a
     * lost RPC result or offline host leaves it null and a later sweep pass
     * retries (the daemon-side prune is idempotent).
     */
    runDirPrunedAt: integer("run_dir_pruned_at"),
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    settledAt: integer("settled_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("workflow_runs_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
    index("workflow_runs_host_status_idx").on(table.hostId, table.status),
    // The run-dir prune sweep's seek: archived-but-unpruned runs per host.
    index("workflow_runs_host_prune_idx").on(
      table.hostId,
      table.retention,
      table.runDirPrunedAt,
    ),
    index("workflow_runs_anchor_thread_idx").on(table.anchorThreadId),
    index("workflow_runs_pending_notification_idx").on(
      table.pendingManagerNotification,
    ),
    uniqueIndex("workflow_runs_client_request_id_idx").on(
      table.clientRequestId,
    ),
  ],
);

export const workflowRunOperations = sqliteTable(
  "workflow_run_operations",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    kind: text("kind").$type<WorkflowRunOperationKind>().notNull(),
    state: text("state").$type<LifecycleOperationState>().notNull(),
    payload: text("payload").notNull(),
    commandId: text("command_id"),
    requestedAt: integer("requested_at").notNull(),
    queuedAt: integer("queued_at"),
    completedAt: integer("completed_at"),
    failureReason: text("failure_reason"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("workflow_run_operations_run_kind_idx").on(
      table.runId,
      table.kind,
    ),
    index("workflow_run_operations_state_idx").on(table.state),
    index("workflow_run_operations_run_idx").on(table.runId),
  ],
);

/**
 * The authoritative durable run-event log AND resume journal (agent/completed
 * + agent/failed payloads rebuild the runner journal). Producer-idempotent
 * like `events`: duplicates re-ack with their original sequence; a reused
 * producer id with a different payload hash rejects. Deliberately a separate
 * table from `events` so the completed-item output truncation sweep can never
 * touch live journal payloads.
 */
export const workflowRunEvents = sqliteTable(
  "workflow_run_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    /** Per-run monotonic, assigned server-side at append. */
    sequence: integer("sequence").notNull(),
    type: text("type").$type<WorkflowRunEventType>().notNull(),
    /** The journal-stable display agent index, for agent-scoped events. */
    agentIndex: integer("agent_index"),
    // NOT NULL unlike `events`: every workflow run event is daemon-spooled
    // with a minted producer id — no server-authored writer exists — and
    // SQLite unique indexes permit unlimited NULLs, so nullability would
    // structurally weaken the at-least-once idempotency constraint.
    producerEventId: text("producer_event_id").notNull(),
    producerEventPayloadHash: text("producer_event_payload_hash").notNull(),
    payload: text("payload").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("workflow_run_events_run_sequence_idx").on(
      table.runId,
      table.sequence,
    ),
    uniqueIndex("workflow_run_events_producer_event_id_idx").on(
      table.producerEventId,
    ),
    index("workflow_run_events_run_agent_sequence_idx").on(
      table.runId,
      table.agentIndex,
      table.sequence,
    ),
  ],
);
