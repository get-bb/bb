import type { Hono } from "hono";
import { hc } from "hono/client";
import type {
  AppTheme,
  AppThemeSelection,
  Environment,
  Experiments,
  Host,
  PendingInteraction,
  ProjectExecutionDefaults,
  ProjectSource,
  ResolvedThreadExecutionOptions,
  ThreadEventRow,
  ThreadQueuedMessage,
} from "@bb/domain";
import { appThemeSelectionSchema, experimentsSchema } from "@bb/domain";
import type { ProviderUsageResponse } from "@bb/host-daemon-contract";
import {
  binaryResponse,
  defineRoute,
  formRequest,
  jsonRequest,
  jsonResponse,
  noRequest,
  optionalQueryRequest,
  queryRequest,
  type ApiSchemaFromRouteDescriptors,
} from "@bb/hono-typed-routes";
import type {
  EmptyInput,
  PathId,
  PathProjectAutomationId,
  PathProjectId,
  PathThreadAndFilePath,
  PathThreadAndQueuedMessage,
  PathTerminal,
} from "./common.js";
import type {
  Automation,
  AutomationRunListQuery,
  AutomationRunListResponse,
  AutomationRunResponse,
  AutomationsOverviewResponse,
  CloseTerminalRequest,
  CreateAutomationRequest,
  RunAutomationRequest,
  UpdateAutomationRequest,
  CommandListResponse,
  CreateTerminalRequest,
  CreateProjectRequest,
  CreateProjectSourceRequest,
  CreateQueuedMessageRequest,
  CreateThreadRequest,
  DeleteThreadRequest,
  EnvironmentActionApiError,
  EnvironmentActionRequest,
  EnvironmentActionResponse,
  EnvironmentArchiveThreadsResponse,
  EnvironmentDiffBranchesQuery,
  EnvironmentDiffBranchesResponse,
  EnvironmentDiffFileQuery,
  EnvironmentDiffFileResponse,
  EnvironmentDiffFilesResponse,
  EnvironmentDiffPatchRequest,
  EnvironmentDiffPatchResponse,
  EnvironmentDiffQuery,
  EnvironmentDiffResponse,
  EnvironmentPathsQuery,
  EnvironmentPullRequestResponse,
  EnvironmentStatusQuery,
  EnvironmentStatusResponse,
  ProjectAttachmentContentQuery,
  ProjectAttachmentUploadForm,
  ProjectBranchesQuery,
  ProjectBranchesResponse,
  ProjectCommandsQuery,
  ProjectDefaultExecutionOptionsQuery,
  ProjectFileContentQuery,
  ProjectFilesQuery,
  ProjectListQuery,
  ProjectPathsQuery,
  ProjectResponse,
  ProjectWithThreadsResponse,
  PromptHistoryQuery,
  PromptHistoryResponse,
  ReorderPinnedThreadRequest,
  ReorderProjectRequest,
  ReorderQueuedMessageRequest,
  ResolvePendingInteractionRequest,
  SendMessageRequest,
  SendQueuedMessageRequest,
  SendQueuedMessageResponse,
  SidebarBootstrapResponse,
  SystemConfigReloadResponse,
  SystemConfigResponse,
  SystemExecutionOptionsQuery,
  SystemExecutionOptionsResponse,
  SystemProviderInfo,
  SystemVersionResponse,
  SystemVoiceTranscriptionForm,
  SystemVoiceTranscriptionResponse,
  TerminalListResponse,
  ThemeCatalogResponse,
  TerminalSession,
  TerminalInputRequest,
  TerminalListQuery,
  TerminalOutputQuery,
  TerminalOutputResponse,
  TerminalResizeRequest,
  ThreadArchiveAllResponse,
  ThreadChildSummaryResponse,
  ThreadComposerBootstrapResponse,
  ThreadEventWaitQuery,
  ThreadEventsQuery,
  ThreadFilesRawQuery,
  ThreadGetQuery,
  ThreadHostFileContentQuery,
  ThreadListQuery,
  ThreadListResponse,
  ThreadOpenRequest,
  ThreadOpenResponse,
  ThreadPendingInteractionsResponse,
  ThreadQueuedMessageListResponse,
  ThreadResponse,
  ThreadSearchQuery,
  ThreadSearchResponse,
  ThreadStorageContentQuery,
  ThreadStorageFileListResponse,
  ThreadStorageFilesQuery,
  ThreadStoragePathListResponse,
  ThreadStoragePathsQuery,
  ThreadTimelineQuery,
  ThreadTimelineResponse,
  ThreadWithIncludesResponse,
  TimelineTurnSummaryDetailsQuery,
  TimelineTurnSummaryDetailsResponse,
  UpdateEnvironmentRequest,
  UpdateTerminalRequest,
  UpdateProjectRequest,
  UpdateProjectSourceRequest,
  UpdateThreadRequest,
  UploadedPromptAttachment,
  WorkspaceFileListResponse,
  WorkspacePathListResponse,
} from "./api-types.js";
import {
  automationRunListQuerySchema,
  closeTerminalRequestSchema,
  createAutomationRequestSchema,
  runAutomationRequestSchema,
  updateAutomationRequestSchema,
  createTerminalRequestSchema,
  createProjectRequestSchema,
  createProjectSourceRequestSchema,
  createQueuedMessageRequestSchema,
  createThreadRequestSchema,
  deleteThreadRequestSchema,
  environmentActionRequestSchema,
  environmentDiffBranchesQuerySchema,
  environmentDiffFileQuerySchema,
  environmentDiffPatchRequestSchema,
  environmentDiffQuerySchema,
  environmentPathsQuerySchema,
  environmentStatusQuerySchema,
  projectAttachmentContentQuerySchema,
  projectBranchesQuerySchema,
  projectCommandsQuerySchema,
  projectDefaultExecutionOptionsQuerySchema,
  projectFileContentQuerySchema,
  projectFilesQuerySchema,
  projectListQuerySchema,
  projectPathsQuerySchema,
  promptHistoryQuerySchema,
  reorderPinnedThreadRequestSchema,
  reorderProjectRequestSchema,
  reorderQueuedMessageRequestSchema,
  resolvePendingInteractionRequestSchema,
  sendMessageRequestSchema,
  sendQueuedMessageRequestSchema,
  systemExecutionOptionsQuerySchema,
  threadEventWaitQuerySchema,
  threadEventsQuerySchema,
  threadFilesRawQuerySchema,
  threadGetQuerySchema,
  threadHostFileContentQuerySchema,
  threadListQuerySchema,
  threadOpenRequestSchema,
  threadSearchQuerySchema,
  threadStorageContentQuerySchema,
  threadStorageFilesQuerySchema,
  threadStoragePathsQuerySchema,
  terminalInputRequestSchema,
  terminalListQuerySchema,
  terminalOutputQuerySchema,
  terminalResizeRequestSchema,
  threadTimelineQuerySchema,
  timelineTurnSummaryDetailsQuerySchema,
  updateEnvironmentRequestSchema,
  updateTerminalRequestSchema,
  updateProjectRequestSchema,
  updateProjectSourceRequestSchema,
  updateThreadRequestSchema,
} from "./api-types.js";
import type { ApiError } from "./errors.js";

type PathProjectSourceId = { param: { id: string; sourceId: string } };
type PathThreadInteractionId = {
  param: { id: string; interactionId: string };
};

export const publicApiRoutes = {
  projects: {
    list: defineRoute({
      path: "/projects",
      method: "get",
      request: optionalQueryRequest<EmptyInput, ProjectListQuery>(
        projectListQuerySchema,
      ),
      response: jsonResponse<
        ProjectResponse[] | ProjectWithThreadsResponse[]
      >(),
    }),
    create: defineRoute({
      path: "/projects",
      method: "post",
      request: jsonRequest<EmptyInput, CreateProjectRequest>(
        createProjectRequestSchema,
      ),
      response: jsonResponse<ProjectResponse>({ status: 201 }),
    }),
    sidebarBootstrap: defineRoute({
      path: "/sidebar-bootstrap",
      method: "get",
      request: noRequest(),
      response: jsonResponse<SidebarBootstrapResponse>(),
    }),
    get: defineRoute({
      path: "/projects/:id",
      method: "get",
      request: noRequest<PathProjectId>(),
      response: jsonResponse<ProjectResponse>(),
    }),
    update: defineRoute({
      path: "/projects/:id",
      method: "patch",
      request: jsonRequest<PathProjectId, UpdateProjectRequest>(
        updateProjectRequestSchema,
      ),
      response: jsonResponse<ProjectResponse>(),
    }),
    delete: defineRoute({
      path: "/projects/:id",
      method: "delete",
      request: noRequest<PathProjectId>(),
      response: jsonResponse<{ ok: true }>(),
    }),
    reorder: defineRoute({
      path: "/projects/:id/order",
      method: "patch",
      request: jsonRequest<PathProjectId, ReorderProjectRequest>(
        reorderProjectRequestSchema,
      ),
      response: jsonResponse<ProjectResponse[]>(),
    }),
    defaultExecutionOptions: defineRoute({
      path: "/projects/:id/default-execution-options",
      method: "get",
      request: queryRequest<PathProjectId, ProjectDefaultExecutionOptionsQuery>(
        projectDefaultExecutionOptionsQuerySchema,
      ),
      response: jsonResponse<ProjectExecutionDefaults | null>(),
    }),
    promptHistory: defineRoute({
      path: "/projects/:id/prompt-history",
      method: "get",
      request: optionalQueryRequest<PathProjectId, PromptHistoryQuery>(
        promptHistoryQuerySchema,
      ),
      response: jsonResponse<PromptHistoryResponse>(),
    }),
    createSource: defineRoute({
      path: "/projects/:id/sources",
      method: "post",
      request: jsonRequest<PathProjectId, CreateProjectSourceRequest>(
        createProjectSourceRequestSchema,
      ),
      response: jsonResponse<ProjectSource>({ status: 201 }),
    }),
    updateSource: defineRoute({
      path: "/projects/:id/sources/:sourceId",
      method: "patch",
      request: jsonRequest<PathProjectSourceId, UpdateProjectSourceRequest>(
        updateProjectSourceRequestSchema,
      ),
      response: jsonResponse<ProjectSource>(),
    }),
    deleteSource: defineRoute({
      path: "/projects/:id/sources/:sourceId",
      method: "delete",
      request: noRequest<PathProjectSourceId>(),
      response: jsonResponse<{ ok: true }>(),
    }),
    files: defineRoute({
      path: "/projects/:id/files",
      method: "get",
      request: queryRequest<PathProjectId, ProjectFilesQuery>(
        projectFilesQuerySchema,
      ),
      response: jsonResponse<WorkspaceFileListResponse>(),
    }),
    fileContent: defineRoute({
      path: "/projects/:id/files/content",
      method: "get",
      request: queryRequest<PathProjectId, ProjectFileContentQuery>(
        projectFileContentQuerySchema,
      ),
      response: binaryResponse<Uint8Array>(),
    }),
    paths: defineRoute({
      path: "/projects/:id/paths",
      method: "get",
      request: queryRequest<PathProjectId, ProjectPathsQuery>(
        projectPathsQuerySchema,
      ),
      response: jsonResponse<WorkspacePathListResponse>(),
    }),
    commands: defineRoute({
      path: "/projects/:id/commands",
      method: "get",
      request: queryRequest<PathProjectId, ProjectCommandsQuery>(
        projectCommandsQuerySchema,
      ),
      response: jsonResponse<CommandListResponse>(),
    }),
    branches: defineRoute({
      path: "/projects/:id/branches",
      method: "get",
      request: queryRequest<PathProjectId, ProjectBranchesQuery>(
        projectBranchesQuerySchema,
      ),
      response: jsonResponse<ProjectBranchesResponse>(),
    }),
    uploadAttachment: defineRoute({
      path: "/projects/:id/attachments",
      method: "post",
      request: formRequest<PathProjectId, ProjectAttachmentUploadForm>(),
      response: jsonResponse<UploadedPromptAttachment>({ status: 201 }),
    }),
    attachmentContent: defineRoute({
      path: "/projects/:id/attachments/content",
      method: "get",
      request: queryRequest<PathProjectId, ProjectAttachmentContentQuery>(
        projectAttachmentContentQuerySchema,
      ),
      response: binaryResponse<Uint8Array>(),
    }),
  },

  hosts: {
    list: defineRoute({
      path: "/hosts",
      method: "get",
      request: noRequest(),
      response: jsonResponse<Host[]>(),
    }),
    get: defineRoute({
      path: "/hosts/:id",
      method: "get",
      request: noRequest<PathId>(),
      response: jsonResponse<Host>(),
    }),
  },

  terminals: {
    list: defineRoute({
      path: "/terminals",
      method: "get",
      request: queryRequest<EmptyInput, TerminalListQuery>(
        terminalListQuerySchema,
      ),
      response: jsonResponse<TerminalListResponse>(),
    }),
    create: defineRoute({
      path: "/terminals",
      method: "post",
      request: jsonRequest<EmptyInput, CreateTerminalRequest>(
        createTerminalRequestSchema,
      ),
      response: jsonResponse<TerminalSession>({ status: 201 }),
    }),
    update: defineRoute({
      path: "/terminals/:terminalId",
      method: "patch",
      request: jsonRequest<PathTerminal, UpdateTerminalRequest>(
        updateTerminalRequestSchema,
      ),
      response: jsonResponse<TerminalSession>(),
    }),
    close: defineRoute({
      path: "/terminals/:terminalId/close",
      method: "post",
      request: jsonRequest<PathTerminal, CloseTerminalRequest>(
        closeTerminalRequestSchema,
      ),
      response: jsonResponse<TerminalSession>(),
    }),
    input: defineRoute({
      path: "/terminals/:terminalId/input",
      method: "post",
      request: jsonRequest<PathTerminal, TerminalInputRequest>(
        terminalInputRequestSchema,
      ),
      response: jsonResponse<TerminalSession>(),
    }),
    resize: defineRoute({
      path: "/terminals/:terminalId/resize",
      method: "post",
      request: jsonRequest<PathTerminal, TerminalResizeRequest>(
        terminalResizeRequestSchema,
      ),
      response: jsonResponse<TerminalSession>(),
    }),
    output: defineRoute({
      path: "/terminals/:terminalId/output",
      method: "get",
      request: optionalQueryRequest<PathTerminal, TerminalOutputQuery>(
        terminalOutputQuerySchema,
      ),
      response: jsonResponse<TerminalOutputResponse>(),
    }),
  },

  environments: {
    get: defineRoute({
      path: "/environments/:id",
      method: "get",
      request: noRequest<PathId>(),
      response: [
        jsonResponse<Environment>(),
        jsonResponse<ApiError>({ status: 404 }),
      ],
    }),
    update: defineRoute({
      path: "/environments/:id",
      method: "patch",
      request: jsonRequest<PathId, UpdateEnvironmentRequest>(
        updateEnvironmentRequestSchema,
      ),
      response: jsonResponse<Environment>(),
    }),
    status: defineRoute({
      path: "/environments/:id/status",
      method: "get",
      request: queryRequest<PathId, EnvironmentStatusQuery>(
        environmentStatusQuerySchema,
      ),
      response: jsonResponse<EnvironmentStatusResponse>(),
    }),
    pullRequest: defineRoute({
      path: "/environments/:id/pull-request",
      method: "get",
      request: noRequest<PathId>(),
      response: jsonResponse<EnvironmentPullRequestResponse>(),
    }),
    diff: defineRoute({
      path: "/environments/:id/diff",
      method: "get",
      request: queryRequest<PathId, EnvironmentDiffQuery>(
        environmentDiffQuerySchema,
      ),
      response: jsonResponse<EnvironmentDiffResponse>(),
    }),
    diffFiles: defineRoute({
      path: "/environments/:id/diff/files",
      method: "get",
      request: queryRequest<PathId, EnvironmentDiffQuery>(
        environmentDiffQuerySchema,
      ),
      response: jsonResponse<EnvironmentDiffFilesResponse>(),
    }),
    diffPatch: defineRoute({
      path: "/environments/:id/diff/patch",
      method: "post",
      request: jsonRequest<PathId, EnvironmentDiffPatchRequest>(
        environmentDiffPatchRequestSchema,
      ),
      response: jsonResponse<EnvironmentDiffPatchResponse>(),
    }),
    diffFile: defineRoute({
      path: "/environments/:id/diff/file",
      method: "get",
      request: queryRequest<PathId, EnvironmentDiffFileQuery>(
        environmentDiffFileQuerySchema,
      ),
      response: jsonResponse<EnvironmentDiffFileResponse>(),
    }),
    diffBranches: defineRoute({
      path: "/environments/:id/diff/branches",
      method: "get",
      request: queryRequest<PathId, EnvironmentDiffBranchesQuery>(
        environmentDiffBranchesQuerySchema,
      ),
      response: jsonResponse<EnvironmentDiffBranchesResponse>(),
    }),
    paths: defineRoute({
      path: "/environments/:id/paths",
      method: "get",
      request: queryRequest<PathId, EnvironmentPathsQuery>(
        environmentPathsQuerySchema,
      ),
      response: jsonResponse<WorkspacePathListResponse>(),
    }),
    /**
     * Execute an environment action such as commit or squash_merge.
     * Returns 409 when the action is blocked by environment state.
     */
    actions: defineRoute({
      path: "/environments/:id/actions",
      method: "post",
      request: jsonRequest<PathId, EnvironmentActionRequest>(
        environmentActionRequestSchema,
      ),
      response: [
        jsonResponse<EnvironmentActionResponse>(),
        jsonResponse<EnvironmentActionApiError>({ status: 409 }),
        jsonResponse<ApiError>({ status: 404 }),
      ],
    }),
    archiveThreads: defineRoute({
      path: "/environments/:id/archive-threads",
      method: "post",
      request: noRequest<PathId>(),
      response: jsonResponse<EnvironmentArchiveThreadsResponse>(),
    }),
  },

  threads: {
    list: defineRoute({
      path: "/threads",
      method: "get",
      request: optionalQueryRequest<EmptyInput, ThreadListQuery>(
        threadListQuerySchema,
      ),
      response: jsonResponse<ThreadListResponse>(),
    }),
    search: defineRoute({
      path: "/threads/search",
      method: "get",
      request: queryRequest<EmptyInput, ThreadSearchQuery>(
        threadSearchQuerySchema,
      ),
      response: jsonResponse<ThreadSearchResponse>(),
    }),
    create: defineRoute({
      path: "/threads",
      method: "post",
      request: jsonRequest<EmptyInput, CreateThreadRequest>(
        createThreadRequestSchema,
      ),
      response: jsonResponse<ThreadResponse>({ status: 201 }),
    }),
    get: defineRoute({
      path: "/threads/:id",
      method: "get",
      request: optionalQueryRequest<PathId, ThreadGetQuery>(
        threadGetQuerySchema,
      ),
      response: jsonResponse<ThreadResponse | ThreadWithIncludesResponse>(),
    }),
    update: defineRoute({
      path: "/threads/:id",
      method: "patch",
      request: jsonRequest<PathId, UpdateThreadRequest>(
        updateThreadRequestSchema,
      ),
      response: jsonResponse<ThreadResponse>(),
    }),
    delete: defineRoute({
      path: "/threads/:id",
      method: "delete",
      request: jsonRequest<PathId, DeleteThreadRequest>(
        deleteThreadRequestSchema,
      ),
      response: jsonResponse<{ ok: true }>(),
    }),
    childSummary: defineRoute({
      path: "/threads/:id/child-summary",
      method: "get",
      request: noRequest<PathId>(),
      response: jsonResponse<ThreadChildSummaryResponse>(),
    }),
    /**
     * Send a message to a thread.
     * mode=queue-if-active queues when the thread is active; otherwise it
     * starts a turn. mode=steer-if-active steers when the thread is active;
     * otherwise it starts a turn. Legacy mode=auto starts idle threads and
     * uses the provider's auto target for active turns.
     */
    send: defineRoute({
      path: "/threads/:id/send",
      method: "post",
      request: jsonRequest<PathId, SendMessageRequest>(
        sendMessageRequestSchema,
      ),
      response: jsonResponse<{ ok: true }>(),
    }),
    composerBootstrap: defineRoute({
      path: "/threads/:id/composer-bootstrap",
      method: "get",
      request: noRequest<PathId>(),
      response: jsonResponse<ThreadComposerBootstrapResponse>(),
    }),
    queuedMessages: defineRoute({
      path: "/threads/:id/queued-messages",
      method: "get",
      request: noRequest<PathId>(),
      response: jsonResponse<ThreadQueuedMessageListResponse>(),
    }),
    /**
     * Create a queued message; senderThreadId preserves agent-to-agent context
     * until send time.
     */
    createQueuedMessage: defineRoute({
      path: "/threads/:id/queued-messages",
      method: "post",
      request: jsonRequest<PathId, CreateQueuedMessageRequest>(
        createQueuedMessageRequestSchema,
      ),
      response: jsonResponse<ThreadQueuedMessage>({ status: 201 }),
    }),
    /**
     * Send a previously queued message in the requested mode, then delete the
     * queued message.
     */
    sendQueuedMessage: defineRoute({
      path: "/threads/:id/queued-messages/:queuedMessageId/send",
      method: "post",
      request: jsonRequest<
        PathThreadAndQueuedMessage,
        SendQueuedMessageRequest
      >(sendQueuedMessageRequestSchema),
      response: jsonResponse<SendQueuedMessageResponse>(),
    }),
    reorderQueuedMessage: defineRoute({
      path: "/threads/:id/queued-messages/:queuedMessageId/order",
      method: "patch",
      request: jsonRequest<
        PathThreadAndQueuedMessage,
        ReorderQueuedMessageRequest
      >(reorderQueuedMessageRequestSchema),
      response: jsonResponse<ThreadQueuedMessageListResponse>(),
    }),
    promptHistory: defineRoute({
      path: "/threads/:id/prompt-history",
      method: "get",
      request: optionalQueryRequest<PathId, PromptHistoryQuery>(
        promptHistoryQuerySchema,
      ),
      response: jsonResponse<PromptHistoryResponse>(),
    }),
    deleteQueuedMessage: defineRoute({
      path: "/threads/:id/queued-messages/:queuedMessageId",
      method: "delete",
      request: noRequest<PathThreadAndQueuedMessage>(),
      response: jsonResponse<{ ok: true }>(),
    }),
    stop: defineRoute({
      path: "/threads/:id/stop",
      method: "post",
      request: noRequest<PathId>(),
      response: jsonResponse<{ ok: true }>(),
    }),
    open: defineRoute({
      path: "/threads/:id/open",
      method: "post",
      request: jsonRequest<PathId, ThreadOpenRequest>(threadOpenRequestSchema),
      response: jsonResponse<ThreadOpenResponse>(),
    }),
    pin: defineRoute({
      path: "/threads/:id/pin",
      method: "post",
      request: noRequest<PathId>(),
      response: jsonResponse<ThreadResponse>(),
    }),
    unpin: defineRoute({
      path: "/threads/:id/unpin",
      method: "post",
      request: noRequest<PathId>(),
      response: jsonResponse<ThreadResponse>(),
    }),
    pinOrder: defineRoute({
      path: "/threads/:id/pin-order",
      method: "patch",
      request: jsonRequest<PathId, ReorderPinnedThreadRequest>(
        reorderPinnedThreadRequestSchema,
      ),
      response: jsonResponse<ThreadListResponse>(),
    }),
    interactions: defineRoute({
      path: "/threads/:id/interactions",
      method: "get",
      request: noRequest<PathId>(),
      response: jsonResponse<ThreadPendingInteractionsResponse>(),
    }),
    interaction: defineRoute({
      path: "/threads/:id/interactions/:interactionId",
      method: "get",
      request: noRequest<PathThreadInteractionId>(),
      response: jsonResponse<PendingInteraction>(),
    }),
    resolveInteraction: defineRoute({
      path: "/threads/:id/interactions/:interactionId/resolve",
      method: "post",
      request: jsonRequest<
        PathThreadInteractionId,
        ResolvePendingInteractionRequest
      >(resolvePendingInteractionRequestSchema),
      response: jsonResponse<PendingInteraction>(),
    }),
    archive: defineRoute({
      path: "/threads/:id/archive",
      method: "post",
      request: noRequest<PathId>(),
      response: jsonResponse<{ ok: true }>(),
    }),
    archiveAll: defineRoute({
      path: "/threads/:id/archive-all",
      method: "post",
      request: noRequest<PathId>(),
      response: jsonResponse<ThreadArchiveAllResponse>(),
    }),
    unarchive: defineRoute({
      path: "/threads/:id/unarchive",
      method: "post",
      request: noRequest<PathId>(),
      response: jsonResponse<{ ok: true }>(),
    }),
    read: defineRoute({
      path: "/threads/:id/read",
      method: "post",
      request: noRequest<PathId>(),
      response: jsonResponse<ThreadResponse>(),
    }),
    unread: defineRoute({
      path: "/threads/:id/unread",
      method: "post",
      request: noRequest<PathId>(),
      response: jsonResponse<ThreadResponse>(),
    }),
    timeline: defineRoute({
      path: "/threads/:id/timeline",
      method: "get",
      request: optionalQueryRequest<PathId, ThreadTimelineQuery>(
        threadTimelineQuerySchema,
      ),
      response: jsonResponse<ThreadTimelineResponse>(),
    }),
    timelineTurnSummaryDetails: defineRoute({
      path: "/threads/:id/timeline/turn-summary-details",
      method: "get",
      request: queryRequest<PathId, TimelineTurnSummaryDetailsQuery>(
        timelineTurnSummaryDetailsQuerySchema,
      ),
      response: jsonResponse<TimelineTurnSummaryDetailsResponse>(),
    }),
    output: defineRoute({
      path: "/threads/:id/output",
      method: "get",
      request: noRequest<PathId>(),
      response: jsonResponse<{ output: string | null }>(),
    }),
    events: defineRoute({
      path: "/threads/:id/events",
      method: "get",
      request: optionalQueryRequest<PathId, ThreadEventsQuery>(
        threadEventsQuerySchema,
      ),
      response: jsonResponse<ThreadEventRow[]>(),
    }),
    eventWait: defineRoute({
      path: "/threads/:id/events/wait",
      method: "get",
      request: queryRequest<PathId, ThreadEventWaitQuery>(
        threadEventWaitQuerySchema,
      ),
      response: jsonResponse<ThreadEventRow | null>(),
    }),
    defaultExecutionOptions: defineRoute({
      path: "/threads/:id/default-execution-options",
      method: "get",
      request: noRequest<PathId>(),
      response: jsonResponse<ResolvedThreadExecutionOptions | null>(),
    }),
    storageFiles: defineRoute({
      path: "/threads/:id/thread-storage/files",
      method: "get",
      request: optionalQueryRequest<PathId, ThreadStorageFilesQuery>(
        threadStorageFilesQuerySchema,
      ),
      response: jsonResponse<ThreadStorageFileListResponse>(),
    }),
    storageFile: defineRoute({
      path: "/threads/:id/thread-storage/files/:filePath{.+}",
      method: "get",
      request: noRequest<PathThreadAndFilePath>(),
      response: binaryResponse<Uint8Array>(),
    }),
    storagePaths: defineRoute({
      path: "/threads/:id/thread-storage/paths",
      method: "get",
      request: queryRequest<PathId, ThreadStoragePathsQuery>(
        threadStoragePathsQuerySchema,
      ),
      response: jsonResponse<ThreadStoragePathListResponse>(),
    }),
    storageContent: defineRoute({
      path: "/threads/:id/thread-storage/content",
      method: "get",
      request: queryRequest<PathId, ThreadStorageContentQuery>(
        threadStorageContentQuerySchema,
      ),
      response: binaryResponse<Uint8Array>(),
    }),
    hostFileContent: defineRoute({
      path: "/threads/:id/host-files/content",
      method: "get",
      request: queryRequest<PathId, ThreadHostFileContentQuery>(
        threadHostFileContentQuerySchema,
      ),
      response: binaryResponse<Uint8Array>(),
    }),
    worktreeFile: defineRoute({
      path: "/threads/:id/worktree/files/:filePath{.+}",
      method: "get",
      request: noRequest<PathThreadAndFilePath>(),
      response: binaryResponse<Uint8Array>(),
    }),
    rawFile: defineRoute({
      path: "/threads/:id/files/raw",
      method: "get",
      request: queryRequest<PathId, ThreadFilesRawQuery>(
        threadFilesRawQuerySchema,
      ),
      response: binaryResponse<Uint8Array>(),
    }),
  },

  system: {
    config: defineRoute({
      path: "/system/config",
      method: "get",
      request: noRequest(),
      response: jsonResponse<SystemConfigResponse>(),
    }),
    experiments: defineRoute({
      path: "/settings/experiments",
      method: "put",
      request: jsonRequest<EmptyInput, Experiments>(experimentsSchema),
      response: jsonResponse<Experiments>(),
    }),
    appearance: defineRoute({
      path: "/settings/appearance",
      method: "put",
      request: jsonRequest<EmptyInput, AppThemeSelection>(
        appThemeSelectionSchema,
      ),
      response: jsonResponse<AppTheme>(),
    }),
    themes: defineRoute({
      path: "/settings/themes",
      method: "get",
      request: noRequest(),
      response: jsonResponse<ThemeCatalogResponse>(),
    }),
    reloadConfig: defineRoute({
      path: "/system/config/reload",
      method: "post",
      request: noRequest(),
      response: jsonResponse<SystemConfigReloadResponse>(),
    }),
    executionOptions: defineRoute({
      path: "/system/execution-options",
      method: "get",
      request: optionalQueryRequest<EmptyInput, SystemExecutionOptionsQuery>(
        systemExecutionOptionsQuerySchema,
      ),
      response: jsonResponse<SystemExecutionOptionsResponse>(),
    }),
    providers: defineRoute({
      path: "/system/providers",
      method: "get",
      request: noRequest(),
      response: jsonResponse<SystemProviderInfo[]>(),
    }),
    usageLimits: defineRoute({
      path: "/system/usage-limits",
      method: "get",
      request: noRequest(),
      response: jsonResponse<ProviderUsageResponse>(),
    }),
    voiceTranscription: defineRoute({
      path: "/system/voice-transcription",
      method: "post",
      request: formRequest<EmptyInput, SystemVoiceTranscriptionForm>(),
      response: jsonResponse<SystemVoiceTranscriptionResponse>(),
    }),
    version: defineRoute({
      path: "/system/version",
      method: "get",
      request: noRequest(),
      response: jsonResponse<SystemVersionResponse>(),
    }),
  },

  automations: {
    overview: defineRoute({
      path: "/automations",
      method: "get",
      request: noRequest(),
      response: jsonResponse<AutomationsOverviewResponse>(),
    }),
    list: defineRoute({
      path: "/projects/:id/automations",
      method: "get",
      request: noRequest<PathProjectId>(),
      response: jsonResponse<Automation[]>(),
    }),
    create: defineRoute({
      path: "/projects/:id/automations",
      method: "post",
      request: jsonRequest<PathProjectId, CreateAutomationRequest>(
        createAutomationRequestSchema,
      ),
      response: jsonResponse<Automation>({ status: 201 }),
    }),
    get: defineRoute({
      path: "/projects/:id/automations/:automationId",
      method: "get",
      request: noRequest<PathProjectAutomationId>(),
      response: [
        jsonResponse<Automation>(),
        jsonResponse<ApiError>({ status: 404 }),
      ],
    }),
    update: defineRoute({
      path: "/projects/:id/automations/:automationId",
      method: "patch",
      request: jsonRequest<PathProjectAutomationId, UpdateAutomationRequest>(
        updateAutomationRequestSchema,
      ),
      response: jsonResponse<Automation>(),
    }),
    pause: defineRoute({
      path: "/projects/:id/automations/:automationId/pause",
      method: "post",
      request: noRequest<PathProjectAutomationId>(),
      response: jsonResponse<Automation>(),
    }),
    resume: defineRoute({
      path: "/projects/:id/automations/:automationId/resume",
      method: "post",
      request: noRequest<PathProjectAutomationId>(),
      response: jsonResponse<Automation>(),
    }),
    delete: defineRoute({
      path: "/projects/:id/automations/:automationId",
      method: "delete",
      request: noRequest<PathProjectAutomationId>(),
      response: jsonResponse<{ ok: true }>(),
    }),
    run: defineRoute({
      path: "/projects/:id/automations/:automationId/run",
      method: "post",
      request: jsonRequest<PathProjectAutomationId, RunAutomationRequest>(
        runAutomationRequestSchema,
      ),
      response: jsonResponse<AutomationRunResponse, 202>({ status: 202 }),
    }),
    runs: defineRoute({
      path: "/projects/:id/automations/:automationId/runs",
      method: "get",
      request: queryRequest<PathProjectAutomationId, AutomationRunListQuery>(
        automationRunListQuerySchema,
      ),
      response: jsonResponse<AutomationRunListResponse>(),
    }),
  },
};

export type PublicApiSchema = ApiSchemaFromRouteDescriptors<
  typeof publicApiRoutes
>;

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
