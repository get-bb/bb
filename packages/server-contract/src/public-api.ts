import type { Hono } from "hono";
import { hc } from "hono/client";
import type {
  Environment,
  Host,
  PendingInteraction,
  ProjectExecutionDefaults,
  ResolvedThreadExecutionOptions,
  ThreadEventRow,
  ProjectSource,
  ThreadQueuedMessage,
} from "@bb/domain";
import type {
  EmptyInput,
  Endpoint,
  PathId,
  PathProjectAutomationId,
  PathProjectId,
  PathThreadAndQueuedMessage,
  PathThreadScheduleId,
  PathThreadAndTerminal,
} from "./common.js";
import type {
  Automation,
  AutomationsOverviewResponse,
  AppDataListQuery,
  AppDataListResponse,
  AppDataReadResponse,
  AppDataWriteRequest,
  AddAppSourceRequest,
  AppDetail,
  AppMessageRequest,
  AppSourceStatus,
  AppSummary,
  CreateAppRequest,
  SyncAppSourceRequest,
  CreateAutomationRequest,
  CreateQueuedMessageRequest,
  CreateProjectRequest,
  CreateProjectSourceRequest,
  CreateThreadScheduleRequest,
  CreateThreadTerminalRequest,
  CreateThreadRequest,
  CloseThreadTerminalRequest,
  DeleteThreadRequest,
  EnvironmentDiffBranchesQuery,
  EnvironmentDiffResponse,
  EnvironmentDiffQuery,
  EnvironmentDiffFileQuery,
  EnvironmentDiffFileResponse,
  EnvironmentDiffBranchesResponse,
  EnvironmentActionApiError,
  EnvironmentActionRequest,
  EnvironmentActionResponse,
  EnvironmentArchiveThreadsResponse,
  EnvironmentStatusQuery,
  EnvironmentStatusResponse,
  ThreadArchiveAllResponse,
  ThreadStorageContentQuery,
  ThreadHostFileContentQuery,
  ThreadStorageFilesQuery,
  ProjectAttachmentContentQuery,
  ProjectBranchesQuery,
  ProjectBranchesResponse,
  ProjectDefaultExecutionOptionsQuery,
  ProjectAttachmentUploadForm,
  ProjectFilesQuery,
  ProjectWorkflowPolicyResponse,
  UpdateProjectWorkflowPolicyRequest,
  ProjectPathsQuery,
  ProjectListQuery,
  PromptHistoryQuery,
  PromptHistoryResponse,
  ProjectResponse,
  ProjectWithThreadsResponse,
  SidebarBootstrapResponse,
  ReorderPinnedThreadRequest,
  ReorderProjectRequest,
  ReorderQueuedMessageRequest,
  SendQueuedMessageRequest,
  SendQueuedMessageResponse,
  SendMessageRequest,
  ResolvePendingInteractionRequest,
  ThreadChildSummaryResponse,
  ThreadComposerBootstrapResponse,
  ThreadQueuedMessageListResponse,
  SystemConfigReloadResponse,
  SystemConfigResponse,
  SystemExecutionOptionsQuery,
  SystemExecutionOptionsResponse,
  SystemProviderInfo,
  SystemProvidersQuery,
  SystemVersionResponse,
  SystemVoiceTranscriptionForm,
  SystemVoiceTranscriptionResponse,
  TerminalSession,
  ThreadEventWaitQuery,
  ThreadEventsQuery,
  ThreadGetQuery,
  ThreadListQuery,
  ThreadListResponse,
  ThreadPendingInteractionsResponse,
  ThreadResponse,
  ThreadSchedule,
  ThreadWithIncludesResponse,
  ThreadTerminalListResponse,
  ThreadTimelineQuery,
  ThreadTimelineResponse,
  TimelineTurnSummaryDetailsQuery,
  TimelineTurnSummaryDetailsResponse,
  UpdateAutomationRequest,
  UpdateEnvironmentRequest,
  UpdateProjectRequest,
  UpdateProjectSourceRequest,
  UpdateThreadScheduleRequest,
  UpdateThreadTerminalRequest,
  UpdateThreadRequest,
  UploadedPromptAttachment,
  ThreadStorageFileListResponse,
  ThreadStoragePathListResponse,
  ThreadStoragePathsQuery,
  WorkspaceFileListResponse,
  WorkspacePathListResponse,
  ReplayCaptureListResponse,
  ReplayRunRequest,
  ReplayRunResponse,
  CreateWorkflowRunRequest,
  WorkflowListQuery,
  WorkflowListResponse,
  WorkflowRunEventsQuery,
  WorkflowRunEventsResponse,
  WorkflowRunListQuery,
  WorkflowRunListResponse,
  WorkflowRunResponse,
  WorkflowRunWaitQuery,
} from "./api-types.js";
import type { ApiError } from "./errors.js";

type PathProjectSourceId = { param: { id: string; sourceId: string } };
type PathApplicationApp = { param: { applicationId: string } };
type PathAppSourceName = { param: { name: string } };
type PathWorkflowRunAgentIndex = { param: { id: string; index: string } };

export type PublicApiSchema = {
  // ─── Development Only ────────────────────────────────────────────────

  "/development-only/replay/captures": {
    $get: Endpoint<EmptyInput, ReplayCaptureListResponse>;
  };
  "/development-only/replay/captures/:id": {
    $delete: Endpoint<PathId, { ok: true }>;
  };
  "/development-only/replay/captures/:id/runs": {
    $post: Endpoint<
      PathId & { json: ReplayRunRequest },
      ReplayRunResponse,
      201
    >;
  };

  // ─── Apps ────────────────────────────────────────────────────────────

  "/apps": {
    /** List global local-host apps by scanning valid manifests in the app root. */
    $get: Endpoint<EmptyInput, AppSummary[]>;
    /** Create one global local-host app with a slug applicationId, derived from name when omitted. */
    $post: Endpoint<{ json: CreateAppRequest }, AppDetail, 201>;
  };
  "/apps/:applicationId": {
    /** Resolve one global app manifest and canonical storage paths. */
    $get: Endpoint<PathApplicationApp, AppDetail>;
    /** Delete one global app folder, including assets and data. */
    $delete: Endpoint<PathApplicationApp, { ok: true }>;
  };
  "/apps/:applicationId/data": {
    /** List JSON value files at or below an app data prefix. */
    $get: Endpoint<
      PathApplicationApp & { query?: AppDataListQuery },
      AppDataListResponse
    >;
  };
  "/apps/:applicationId/data/*": {
    /**
     * Read, write, or delete one app data JSON file. The wildcard suffix is
     * validated by the route because hono-typed-routes only types named params.
     */
    $get: Endpoint<PathApplicationApp, AppDataReadResponse>;
    $put: Endpoint<
      PathApplicationApp & { json: AppDataWriteRequest },
      AppDataReadResponse
    >;
    $delete: Endpoint<PathApplicationApp, { ok: true }>;
  };
  "/apps/:applicationId/message": {
    /** Send a message from a global app to an explicit thread target context. */
    $post: Endpoint<
      PathApplicationApp & { json: AppMessageRequest },
      { ok: true },
      202
    >;
  };
  "/apps/:applicationId/detach": {
    /**
     * Detach a source-managed app into local management: removes the
     * provenance marker so the owning source stops syncing it (it reports a
     * conflict for the id from then on) and the app delete guard lifts.
     */
    $post: Endpoint<PathApplicationApp, { ok: true }>;
  };

  // ─── App Sources ─────────────────────────────────────────────────────

  "/app-sources": {
    $get: Endpoint<EmptyInput, AppSourceStatus[]>;
    /**
     * Register a git repo (or local path) of apps and run its first sync
     * inline, so the response reports which apps were installed. A failed
     * first sync still registers the source, with lastError set.
     */
    $post: Endpoint<{ json: AddAppSourceRequest }, AppSourceStatus, 201>;
  };
  "/app-sources/:name": {
    /**
     * Remove the source, its checkout, and its managed apps. App data stays
     * in the app-data root and reattaches if the apps are reinstalled.
     */
    $delete: Endpoint<PathAppSourceName, { ok: true }>;
  };
  "/app-sources/:name/sync": {
    /**
     * Fetch the origin and reconcile installed apps. Coalesces with an
     * in-flight sync; `force: true` re-materializes diverged apps,
     * discarding local edits.
     */
    $post: Endpoint<
      PathAppSourceName & { json: SyncAppSourceRequest },
      AppSourceStatus
    >;
  };

  // ─── Automations ─────────────────────────────────────────────────────

  "/automations": {
    /** List all project automations and thread schedules visible to the user. */
    $get: Endpoint<EmptyInput, AutomationsOverviewResponse>;
  };

  // ─── Projects ────────────────────────────────────────────────────────

  "/projects": {
    $get: Endpoint<
      { query?: ProjectListQuery },
      ProjectResponse[] | ProjectWithThreadsResponse[]
    >;
    $post: Endpoint<{ json: CreateProjectRequest }, ProjectResponse, 201>;
  };
  "/sidebar-bootstrap": {
    $get: Endpoint<EmptyInput, SidebarBootstrapResponse>;
  };
  "/projects/:id": {
    $get: Endpoint<PathProjectId, ProjectResponse>;
    $patch: Endpoint<
      PathProjectId & { json: UpdateProjectRequest },
      ProjectResponse
    >;
    /** Also cleans up attachment files for the project. */
    $delete: Endpoint<PathProjectId, { ok: true }>;
  };
  "/projects/:id/order": {
    $patch: Endpoint<
      PathProjectId & { json: ReorderProjectRequest },
      ProjectResponse[]
    >;
  };
  "/projects/:id/default-execution-options": {
    /** Returns the last remembered provider and execution options for the project and thread type. */
    $get: Endpoint<
      PathProjectId & { query: ProjectDefaultExecutionOptionsQuery },
      ProjectExecutionDefaults | null
    >;
  };
  "/projects/:id/prompt-history": {
    $get: Endpoint<
      PathProjectId & { query?: PromptHistoryQuery },
      PromptHistoryResponse
    >;
  };
  "/projects/:id/sources": {
    $post: Endpoint<
      PathProjectId & { json: CreateProjectSourceRequest },
      ProjectSource,
      201
    >;
  };
  "/projects/:id/sources/:sourceId": {
    $patch: Endpoint<
      PathProjectSourceId & { json: UpdateProjectSourceRequest },
      ProjectSource
    >;
    $delete: Endpoint<PathProjectSourceId, { ok: true }>;
  };
  "/projects/:id/workflow-policy": {
    /** Effective policy: built-in defaults when the project has never set one. */
    $get: Endpoint<PathProjectId, ProjectWorkflowPolicyResponse>;
    /** Full replace; applies to future launches only (runs snapshot their ceiling). */
    $put: Endpoint<
      PathProjectId & { json: UpdateProjectWorkflowPolicyRequest },
      ProjectWorkflowPolicyResponse
    >;
  };
  "/projects/:id/automations": {
    $get: Endpoint<PathProjectId, Automation[]>;
    $post: Endpoint<
      PathProjectId & { json: CreateAutomationRequest },
      Automation,
      201
    >;
  };
  "/projects/:id/automations/:automationId": {
    $patch: Endpoint<
      PathProjectAutomationId & { json: UpdateAutomationRequest },
      Automation
    >;
    $delete: Endpoint<PathProjectAutomationId, { ok: true }>;
  };
  "/projects/:id/files": {
    /**
     * Search files in the project. Used for file mentions in the prompt box.
     * Proxies to `host.list_files` against the path of the environment
     * identified by `environmentId` (e.g. a worktree) when provided, falling
     * back to the project's default source path when `environmentId` is null.
     */
    $get: Endpoint<
      PathProjectId & { query: ProjectFilesQuery },
      WorkspaceFileListResponse
    >;
  };
  "/projects/:id/paths": {
    /**
     * Search files and/or folders in the project. Proxies to `host.list_paths`
     * against the path of the environment identified by `environmentId` when
     * provided, falling back to the project's default source path when
     * `environmentId` is null.
     */
    $get: Endpoint<
      PathProjectId & { query: ProjectPathsQuery },
      WorkspacePathListResponse
    >;
  };
  "/projects/:id/branches": {
    /**
     * List a bounded page of local and remote-tracking branches available on
     * the project's local-path source for the given host. Used to populate the
     * new-thread branch picker before any environment exists. Dispatches
     * `host.list_branches` against the source's path — no provisioning, no env
     * created.
     */
    $get: Endpoint<
      PathProjectId & { query: ProjectBranchesQuery },
      ProjectBranchesResponse
    >;
  };
  "/projects/:id/attachments": {
    /**
     * Upload a file attachment for prompt input.
     *
     * Use the returned object directly as a `localFile` or `localImage` prompt
     * part. Relative `localFile`/`localImage` paths are upload references from
     * this route; they are not workspace-relative file paths.
     */
    $post: Endpoint<
      PathProjectId & { form: ProjectAttachmentUploadForm },
      UploadedPromptAttachment,
      201
    >;
  };
  "/projects/:id/attachments/content": {
    /**
     * Serve an uploaded attachment's content. Used to render attachment previews.
     * The `path` query value must be a path returned by the attachment upload
     * route for this project.
     *
     * Returns raw binary with the appropriate `Content-Type` header.
     * The handler constructs a `Response` directly (bypasses `context.json()`),
     * so the output type here is nominal — the actual body is a `Uint8Array`.
     */
    $get: Endpoint<
      PathProjectId & { query: ProjectAttachmentContentQuery },
      Uint8Array,
      200,
      "binary"
    >;
  };
  // ─── Hosts ───────────────────────────────────────────────────────────

  /** Host `status` is derived at query time from the `host_daemon_sessions` table. */
  "/hosts": {
    $get: Endpoint<EmptyInput, Host[]>;
  };
  "/hosts/:id": {
    $get: Endpoint<PathId, Host>;
  };

  // ─── Environments ────────────────────────────────────────────────────

  "/environments/:id": {
    $get: Endpoint<PathId, Environment, 200> | Endpoint<PathId, ApiError, 404>;
    $patch: Endpoint<PathId & { json: UpdateEnvironmentRequest }, Environment>;
  };
  "/environments/:id/status": {
    /** Get workspace status (git state) for an environment. Proxies to `workspace.status`. */
    $get: Endpoint<
      PathId & { query: EnvironmentStatusQuery },
      EnvironmentStatusResponse
    >;
  };
  "/environments/:id/diff": {
    /** Get git diff for an environment's workspace. Proxies to `workspace.diff`. */
    $get: Endpoint<
      PathId & { query: EnvironmentDiffQuery },
      EnvironmentDiffResponse
    >;
  };
  "/environments/:id/diff/file": {
    /**
     * Read a single file's contents at one side of the same diff target.
     * Used to feed `<FileDiff>`'s `oldFile`/`newFile` props so the diff
     * renderer can light up its built-in expand-context buttons.
     * Proxies to `host.read_file` (with `ref` for committed sides, omitted
     * for the working tree).
     */
    $get: Endpoint<
      PathId & { query: EnvironmentDiffFileQuery },
      EnvironmentDiffFileResponse
    >;
  };
  "/environments/:id/diff/branches": {
    /** List a bounded page of local and remote-tracking branches for merge-base selection. */
    $get: Endpoint<
      PathId & { query: EnvironmentDiffBranchesQuery },
      EnvironmentDiffBranchesResponse
    >;
  };
  "/environments/:id/actions": {
    /**
     * Execute an environment action (commit, squash_merge).
     * Returns 409 if blocked by environment state.
     */
    $post:
      | Endpoint<
          PathId & { json: EnvironmentActionRequest },
          EnvironmentActionResponse,
          200
        >
      | Endpoint<
          PathId & { json: EnvironmentActionRequest },
          EnvironmentActionApiError,
          409
        >
      | Endpoint<PathId & { json: EnvironmentActionRequest }, ApiError, 404>;
  };
  "/environments/:id/archive-threads": {
    /**
     * Archive every live thread attached to a worktree environment. For managed
     * environments, safe cleanup is requested after the last live thread is
     * archived and still waits on shutdown, dirty-worktree, and host safety
     * checks.
     */
    $post: Endpoint<PathId, EnvironmentArchiveThreadsResponse>;
  };

  // ─── Threads ─────────────────────────────────────────────────────────

  "/threads": {
    /**
     * List threads. Supports filters: projectId, parentThreadId, hasParent, archived.
     * Omitting archived intentionally returns both active and archived threads.
     */
    $get: Endpoint<{ query?: ThreadListQuery }, ThreadListResponse>;
    /**
     * Create a thread with environment provisioning.
     *
     * Environment type determines the flow:
     * - "reuse": attaches to an existing environment.
     * - "host" + unmanaged/managed-worktree: provisions a new environment.
     *
     * If input is provided, the thread starts automatically after provisioning.
     * A title is generated asynchronously if not provided.
     */
    $post: Endpoint<{ json: CreateThreadRequest }, ThreadResponse, 201>;
  };
  "/threads/:id": {
    $get: Endpoint<
      PathId & { query?: ThreadGetQuery },
      ThreadResponse | ThreadWithIncludesResponse
    >;
    /** Update thread metadata. If the title changes, also notifies providers that support `thread.rename`. */
    $patch: Endpoint<PathId & { json: UpdateThreadRequest }, ThreadResponse>;
    /**
     * Delete a thread. Also destroys its environment if one exists. Threads
     * with child threads require explicit confirmation.
     */
    $delete: Endpoint<PathId & { json: DeleteThreadRequest }, { ok: true }>;
  };
  "/threads/:id/child-summary": {
    /** Count non-deleted child threads via parentThreadId. Archived child threads are included. */
    $get: Endpoint<PathId, ThreadChildSummaryResponse>;
  };
  "/threads/:id/schedules": {
    /** List schedules that wake this existing thread later. */
    $get: Endpoint<PathId, ThreadSchedule[]>;
    /** Create a cron schedule that submits its prompt to this existing thread when due. */
    $post: Endpoint<
      PathId & { json: CreateThreadScheduleRequest },
      ThreadSchedule,
      201
    >;
  };
  "/threads/:id/schedules/:scheduleId": {
    /** Update schedule config or enabled state. */
    $patch: Endpoint<
      PathThreadScheduleId & { json: UpdateThreadScheduleRequest },
      ThreadSchedule
    >;
    $delete: Endpoint<PathThreadScheduleId, { ok: true }>;
  };
  "/threads/:id/send": {
    /**
     * Send a message to a thread.
     * mode=queue-if-active queues when the thread is active, otherwise starts a new turn.
     * mode=steer-if-active steers when the thread is active, otherwise starts a new turn.
     * Legacy mode=auto starts idle threads and sends to active turns with the provider's auto target.
     * Legacy mode=start only starts idle threads; legacy mode=steer steers active threads and starts idle threads.
     * senderThreadId marks agent-to-agent CLI messages so the server can add reply guidance.
     */
    $post: Endpoint<PathId & { json: SendMessageRequest }, { ok: true }>;
  };
  "/threads/:id/composer-bootstrap": {
    /** Load initial composer state and prime the canonical composer query caches. */
    $get: Endpoint<PathId, ThreadComposerBootstrapResponse>;
  };
  "/threads/:id/queued-messages": {
    $get: Endpoint<PathId, ThreadQueuedMessageListResponse>;
    /** Create a queued message. senderThreadId preserves agent-to-agent context until the queued message sends. */
    $post: Endpoint<
      PathId & { json: CreateQueuedMessageRequest },
      ThreadQueuedMessage,
      201
    >;
  };
  "/threads/:id/queued-messages/:queuedMessageId/send": {
    /** Send a previously created queued message in the requested mode, then delete the queued message. */
    $post: Endpoint<
      PathThreadAndQueuedMessage & { json: SendQueuedMessageRequest },
      SendQueuedMessageResponse
    >;
  };
  "/threads/:id/queued-messages/:queuedMessageId/order": {
    /** Reposition a queued message between its nullable previous and next queued-message neighbors. */
    $patch: Endpoint<
      PathThreadAndQueuedMessage & { json: ReorderQueuedMessageRequest },
      ThreadQueuedMessageListResponse
    >;
  };
  "/threads/:id/prompt-history": {
    $get: Endpoint<
      PathId & { query?: PromptHistoryQuery },
      PromptHistoryResponse
    >;
  };
  "/threads/:id/queued-messages/:queuedMessageId": {
    $delete: Endpoint<PathThreadAndQueuedMessage, { ok: true }>;
  };
  "/threads/:id/stop": {
    $post: Endpoint<PathId, { ok: true }>;
  };
  "/threads/:id/pin": {
    /** Pin a thread into the global sidebar Pinned section. */
    $post: Endpoint<PathId, ThreadResponse>;
  };
  "/threads/:id/unpin": {
    /** Clear a thread's pinned state and pinned order key. */
    $post: Endpoint<PathId, ThreadResponse>;
  };
  "/threads/:id/pin-order": {
    /** Reposition a visible pinned root between global pinned root neighbors. */
    $patch: Endpoint<
      PathId & { json: ReorderPinnedThreadRequest },
      ThreadListResponse
    >;
  };
  "/threads/:id/interactions": {
    /** List pending interactions owned by a thread. */
    $get: Endpoint<PathId, ThreadPendingInteractionsResponse>;
  };
  "/threads/:id/interactions/:interactionId": {
    /** Get a single pending interaction owned by a thread. */
    $get: Endpoint<
      { param: { id: string; interactionId: string } },
      PendingInteraction
    >;
  };
  "/threads/:id/interactions/:interactionId/resolve": {
    /** Resolve a pending interaction and return its updated lifecycle record. */
    $post: Endpoint<
      {
        param: { id: string; interactionId: string };
        json: ResolvePendingInteractionRequest;
      },
      PendingInteraction
    >;
  };
  "/threads/:id/archive": {
    /**
     * Archive a thread. Stops the thread if active. If its managed environment
     * now has zero non-archived threads, asynchronously requests safe
     * environment cleanup; cleanup waits when the workspace has uncommitted or
     * unmerged work.
     */
    $post: Endpoint<PathId, { ok: true }>;
  };
  "/threads/:id/archive-all": {
    /**
     * Archive a thread and every live child thread assigned to it. Child
     * threads are archived before the parent so archived child ownership is
     * preserved, and cleanup is requested for each affected managed environment
     * once it has no live threads.
     */
    $post: Endpoint<PathId, ThreadArchiveAllResponse>;
  };
  "/threads/:id/unarchive": {
    /** Unarchive a thread and cancel any still-pending cleanup for its environment. */
    $post: Endpoint<PathId, { ok: true }>;
  };
  "/threads/:id/read": {
    $post: Endpoint<PathId, ThreadResponse>;
  };
  "/threads/:id/unread": {
    $post: Endpoint<PathId, ThreadResponse>;
  };
  "/threads/:id/terminals": {
    /** List terminal sessions owned by this thread. */
    $get: Endpoint<PathId, ThreadTerminalListResponse>;
    /** Start a new interactive terminal session in the thread workspace. */
    $post: Endpoint<
      PathId & { json: CreateThreadTerminalRequest },
      TerminalSession,
      201
    >;
  };
  "/threads/:id/terminals/:terminalId": {
    /** Rename a terminal session tab. */
    $patch: Endpoint<
      PathThreadAndTerminal & { json: UpdateThreadTerminalRequest },
      TerminalSession
    >;
  };
  "/threads/:id/terminals/:terminalId/close": {
    /** Close a terminal session owned by this thread. */
    $post: Endpoint<
      PathThreadAndTerminal & { json: CloseThreadTerminalRequest },
      TerminalSession
    >;
  };
  "/threads/:id/timeline": {
    /** Get thread timeline for UI rendering. Events transformed via `@bb/thread-view`. */
    $get: Endpoint<
      PathId & { query?: ThreadTimelineQuery },
      ThreadTimelineResponse
    >;
  };
  "/threads/:id/timeline/turn-summary-details": {
    /** Get nested turn-summary rows for a turn. Used by the UI to lazy-load expanded timeline detail. */
    $get: Endpoint<
      PathId & { query: TimelineTurnSummaryDetailsQuery },
      TimelineTurnSummaryDetailsResponse
    >;
  };
  "/threads/:id/output": {
    $get: Endpoint<PathId, { output: string | null }>;
  };
  "/threads/:id/events": {
    /** Get raw thread events. Supports `afterSeq` and `limit` pagination. */
    $get: Endpoint<PathId & { query?: ThreadEventsQuery }, ThreadEventRow[]>;
  };
  "/threads/:id/events/wait": {
    /**
     * Long-poll for a thread event matching `type`. Returns the first matching
     * event (200) or 204 if none appears within `waitMs`.
     */
    $get: Endpoint<
      PathId & { query: ThreadEventWaitQuery },
      ThreadEventRow | null
    >;
  };
  "/threads/:id/default-execution-options": {
    /** Returns the last used options for the thread for use as defaults in the UI. */
    $get: Endpoint<PathId, ResolvedThreadExecutionOptions | null>;
  };
  "/threads/:id/thread-storage/files": {
    /**
     * List files in the durable thread storage for a thread environment.
     * Resolves the thread storage root from the active host session `dataDir`
     * and proxies to `host.list_files`.
     */
    $get: Endpoint<
      PathId & { query?: ThreadStorageFilesQuery },
      ThreadStorageFileListResponse
    >;
  };
  "/threads/:id/thread-storage/paths": {
    /**
     * List files and/or folders in durable thread storage for a thread
     * environment. Resolves the thread storage root from the active host
     * session `dataDir` and proxies to `host.list_paths`.
     */
    $get: Endpoint<
      PathId & { query: ThreadStoragePathsQuery },
      ThreadStoragePathListResponse
    >;
  };
  "/threads/:id/thread-storage/content": {
    /**
     * Serve thread storage file content as raw bytes with `Content-Type`.
     * Resolves the thread storage root from the active host session `dataDir`
     * and proxies to `host.read_file`.
     */
    $get: Endpoint<
      PathId & { query: ThreadStorageContentQuery },
      Uint8Array,
      200,
      "binary"
    >;
  };
  "/threads/:id/host-files/content": {
    /**
     * Serve one explicit absolute file path from the thread environment host
     * as raw bytes with `Content-Type`. Proxies to rootless `host.read_file`.
     */
    $get: Endpoint<
      PathId & { query: ThreadHostFileContentQuery },
      Uint8Array,
      200,
      "binary"
    >;
  };

  // ─── Workflows ───────────────────────────────────────────────────────

  "/workflows": {
    /**
     * List workflow definitions visible from the project's resolved source
     * root, across the registry tiers (project > user > builtin), via the
     * daemon `workflow.list` RPC. Host offline → 502 `host_unavailable`.
     */
    $get: Endpoint<{ query: WorkflowListQuery }, WorkflowListResponse>;
  };
  "/workflow-runs": {
    /**
     * List workflow runs, newest first (`limit` caps the page). `projectId`
     * scopes to one project; omitted = all projects. User-archived and
     * user-deleted runs are always excluded.
     */
    $get: Endpoint<{ query: WorkflowRunListQuery }, WorkflowRunListResponse>;
    /**
     * Launch a workflow run: validate/resolve the source, snapshot it with
     * all defaults filled at the boundary, insert the run, and request the
     * start. Honors `clientRequestId` idempotency (a replay returns the
     * original run; a replay of a still-`created` run re-requests its start).
     * Inline source validates with no host round-trip (422 on findings);
     * named source resolution requires the host online (404 unknown name).
     * Launch target: explicit `hostId` wins; anchored launches without one
     * inherit the anchor thread environment's `{hostId, workspacePath}`;
     * unanchored launches resolve the project's default source.
     */
    $post: Endpoint<{ json: CreateWorkflowRunRequest }, WorkflowRunResponse, 201>;
  };
  "/workflow-runs/:id": {
    $get: Endpoint<PathId, WorkflowRunResponse>;
    /**
     * Soft-delete a settled run: it disappears from lists and 404s by id;
     * the retention sweeps still clean up journal payloads and the daemon
     * run dir. Active runs 409 `workflow_run_not_settled` (cancel first).
     */
    $delete: Endpoint<PathId, { ok: true }>;
  };
  "/workflow-runs/:id/archive": {
    /**
     * Hide a settled run from list surfaces (it stays reachable by id).
     * Idempotent. Active runs 409 `workflow_run_not_settled` (cancel first).
     * Distinct from journal-payload retention, which the sweep owns.
     */
    $post: Endpoint<PathId, { ok: true }>;
  };
  "/workflow-runs/:id/events": {
    /** Get durable run events with parsed payloads. `afterSeq` returns strictly-greater sequences. */
    $get: Endpoint<
      PathId & { query?: WorkflowRunEventsQuery },
      WorkflowRunEventsResponse
    >;
  };
  "/workflow-runs/:id/wait": {
    /**
     * Long-poll until the run reaches a terminal status
     * (`completed|failed|cancelled`). Returns the terminal run (200) or 204
     * when it stays unsettled within `waitMs` (capped at 60s) — `interrupted`
     * is not terminal (a resume may still revive it), so callers loop.
     */
    $get: Endpoint<
      PathId & { query?: WorkflowRunWaitQuery },
      WorkflowRunResponse | null
    >;
  };
  "/workflow-runs/:id/cancel": {
    /**
     * Request cancellation. Terminal runs no-op; `created`/`interrupted`
     * runs settle `cancelled` server-side; live runs get a durable
     * `workflow.cancel`; archived runs 409 `workflow_run_archived`.
     */
    $post: Endpoint<PathId, { ok: true }>;
  };
  "/workflow-runs/:id/resume": {
    /**
     * Request an explicit resume. Gated to `interrupted` runs only (409
     * `workflow_run_not_resumable` otherwise, 409 `workflow_run_archived`
     * for archived runs); the completed journal prefix replays free.
     */
    $post: Endpoint<PathId, { ok: true }>;
  };
  "/workflow-runs/:id/agents/:index/events": {
    /**
     * Per-agent provider-event log (the bb thread-timeline event rows the
     * workflow agent emitted), proxied from the run dir on the run's host
     * via `host.read_file_relative`. 404 when the log does not exist on the
     * host; 502 `host_unavailable` when the daemon is offline.
     */
    $get: Endpoint<PathWorkflowRunAgentIndex, ThreadEventRow[]>;
  };

  // ─── System ──────────────────────────────────────────────────────────

  "/system/config": {
    $get: Endpoint<EmptyInput, SystemConfigResponse>;
  };
  "/system/config/reload": {
    /** Rereads the server's local bb-app config file and applies supported runtime config. */
    $post: Endpoint<EmptyInput, SystemConfigReloadResponse>;
  };
  "/system/execution-options": {
    /** List provider metadata and models for execution controls in one host lookup flow. */
    $get: Endpoint<
      { query?: SystemExecutionOptionsQuery },
      SystemExecutionOptionsResponse
    >;
  };
  "/system/providers": {
    /** List available providers. Proxies to `provider.list`; default lookup uses persistent hosts only. */
    $get: Endpoint<{ query?: SystemProvidersQuery }, SystemProviderInfo[]>;
  };
  "/system/voice-transcription": {
    /** Transcribe audio to text. Accepts audio file and optional prompt context. */
    $post: Endpoint<
      { form: SystemVoiceTranscriptionForm },
      SystemVoiceTranscriptionResponse
    >;
  };
  "/system/version": {
    /**
     * Compares the running bb-app package version against the latest published
     * npm version. Skips the network lookup in dev mode and on cached failure.
     * Used by the frontend to show an update-available toast.
     */
    $get: Endpoint<EmptyInput, SystemVersionResponse>;
  };
};

export type PublicApiRoutes = Hono<{}, PublicApiSchema, "/">;

/** Omit the options object to use global fetch; provide it to override fetch. */
export interface PublicApiClientOptions {
  fetch: typeof fetch;
}

export function createPublicApiClient(
  baseUrl: string,
  options?: PublicApiClientOptions,
) {
  return hc<PublicApiRoutes>(`${baseUrl}/api/v1`, options);
}

export function createApiClient(
  baseUrl: string,
  options?: PublicApiClientOptions,
) {
  const apiClient = createPublicApiClient(baseUrl, options);
  return {
    api: {
      v1: apiClient,
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
