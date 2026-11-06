import {
  machineEnvironmentSetSchema,
  machineEnvironmentDeleteSchema,
  type ProjectMachineEnvironmentList,
  type MachineEnvironmentList,
} from "./api/machine-environment.js";
import {
  machineEnvironmentReplaceSchema,
  recordTelemetryEventRequestSchema,
  setAiServiceSelectionRequestSchema,
  systemProviderEnabledRequestSchema,
  testAiServiceRequestSchema,
  type SystemAiServicesResponse,
  type SystemProviderCatalogEntry,
  type TestAiServiceResponse,
} from "./api/system.js";
import {
  desktopBrowserBrokerProofRequestSchema,
  type DesktopBrowserBrokerProof,
  desktopBrowserHostRequestSchema,
  desktopBrowserScopeSchema,
  desktopBrowserCreateRequestSchema,
  desktopBrowserAcquireRequestSchema,
  desktopBrowserLeaseRequestSchema,
  desktopBrowserTabRequestSchema,
  type ExperimentalDesktopBrowserInstances,
  type ExperimentalDesktopBrowserTabs,
  type ExperimentalDesktopBrowserCreated,
  type ExperimentalDesktopBrowserLease,
  type ExperimentalDesktopBrowserConnection,
  type ExperimentalDesktopBrowserCapture,
  desktopBrowserInstanceRequestSchema,
  desktopBrowserImportCookiesRequestSchema,
  type ExperimentalDesktopBrowserImportSources,
  type ExperimentalDesktopBrowserImportOutcome,
} from "./api/desktop-browsers.js";
import type { Hono } from "hono";
import {
  type AppTheme,
  type AppSettings,
  type AppKeybindingOverrides,
  type Environment,
  type Experiments,
  type Host,
  type PendingInteraction,
  type ProjectExecutionDefaults,
  type ProjectSource,
  type ResolvedThreadExecutionOptions,
  type ThreadEventRow,
  type ThreadQueuedMessage,
  appSettingsUpdateSchema,
  appKeybindingOverridesSchema,
  appThemeSelectionSchema,
  experimentUpdatesSchema,
} from "@bb/domain";
import type { ProviderUsageResponse } from "@bb/host-daemon-contract";
import {
  binaryResponse,
  defineRoute,
  formRequest,
  jsonFieldRequest,
  jsonRequest,
  jsonResponse,
  noRequest,
  optionalQueryRequest,
  queryRequest,
  textResponse,
  type ApiSchemaFromRouteDescriptors,
} from "@bb/hono-typed-routes";
import {
  type CommandListResponse,
  type CreateHostJoinCodeResponse,
  type EditMessageResponse,
  type EnvironmentActionApiError,
  type EnvironmentActionResponse,
  type EnvironmentArchiveThreadsResponse,
  type HostDirectoryListing,
  type HostDiscoveredReposResponse,
  type HostEnrollmentCommandResponse,
  type HostReconnectResponse,
  type HostActionResponse,
  type HostCloneDefaultPathResponse,
  type HostFileListResponse,
  type HostFileReadResponse,
  type HostFileWriteResponse,
  type HostMkdirResponse,
  type HostMovePathResponse,
  type HostPathListResponse,
  type HostRemovePathResponse,
  type CreateFilePreviewResponse,
  type HostPickFolderResponse,
  type HostPathsExistResponse,
  type HostProviderCliInstallEvent,
  type HostProviderCliStatusResponse,
  type HostRetryUpdateResponse,
  type ProjectAttachmentUploadForm,
  type ProjectBranchesResponse,
  type ProjectResponse,
  type SkillListResponse,
  type SkillContentResponse,
  type SkillFilesResponse,
  type ProjectWithThreadsResponse,
  type PromptHistoryResponse,
  type PromptHistoryListResponse,
  type QueuedMessageEditHoldResponse,
  type ResolveThreadMentionsResponse,
  type RetryTurnResponse,
  type SendMessageResponse,
  type SendQueuedMessageResponse,
  type SidebarBootstrapResponse,
  type SystemAttentionResponse,
  type SystemSetupGuideResponse,
  type SystemConfigReloadResponse,
  type SystemConfigResponse,
  type SystemMobileAppReleasesResponse,
  type SystemCliSkillsStatusResponse,
  type SystemInstallCliSkillsResponse,
  type SystemExecutionOptionsResponse,
  type SystemEnvironmentProvidersResponse,
  type SystemMachineProvidersResponse,
  type SystemProviderInfo,
  type SystemProviderStatesResponse,
  type SystemAppUpdateStatus,
  type SystemCliCommandStatus,
  type SystemVersionResponse,
  type SystemVoiceTranscriptionForm,
  type SystemVoiceTranscriptionResponse,
  type TerminalListResponse,
  type ThemeCatalogResponse,
  type TerminalSession,
  type TerminalOutputResponse,
  type ThreadArchiveAllResponse,
  type ThreadChildSummaryResponse,
  type ThreadMessageResponse,
  type ThreadSectionMutationResponse,
  type ThreadSectionResponse,
  type ThreadCountResponse,
  type ThreadListResponse,
  type ThreadConversationOutlineResponse,
  type ThreadOpenResponse,
  type ThreadPaneActionResponse,
  type ThreadPendingInteractionsResponse,
  type ThreadRunningResponse,
  type ThreadQueuedMessageListResponse,
  type ThreadResponse,
  type PluginThreadMetadataListResponse,
  type ThreadAncestorsListResponse,
  type ThreadDescendantsListResponse,
  type ThreadCascadeListResponse,
  type ThreadPluginMetadataResponse,
  type ThreadSearchResponse,
  type ThreadStorageFileListResponse,
  type ThreadStorageLocationResponse,
  type ThreadStoragePathListResponse,
  type ThreadTimelineReadResponse,
  type ThreadContextResponse,
  type ThreadWithIncludesResponse,
  type TimelineTurnSummaryDetailsResponse,
  type UploadedPromptAttachment,
  type WorkspaceFileListResponse,
  type WorkspacePathListResponse,
  closeTerminalRequestSchema,
  copyProjectAttachmentsRequestSchema,
  createFilePreviewRequestSchema,
  createThreadSectionRequestSchema,
  deleteThreadSectionRequestSchema,
  createTerminalRequestSchema,
  restartTerminalRequestSchema,
  createProjectRequestSchema,
  createHostJoinCodeRequestSchema,
  createMachineRequestSchema,
  createProjectSourceRequestSchema,
  createQueuedMessageRequestSchema,
  queuedMessageListQuerySchema,
  updateQueuedMessageRequestSchema,
  createThreadRequestSchema,
  forkThreadRequestSchema,
  updateThreadPluginMetadataRequestSchema,
  pluginThreadMetadataListRequestSchema,
  threadAncestorsListRequestSchema,
  threadDescendantsListRequestSchema,
  threadCascadeListRequestSchema,
  threadPluginMetadataQuerySchema,
  deleteThreadRequestSchema,
  environmentActionRequestSchema,
  environmentPathsQuerySchema,
  hostDirectoryQuerySchema,
  hostListQuerySchema,
  hostDeleteQuerySchema,
  hostProviderCliStatusQuerySchema,
  environmentCleanupQuerySchema,
  hostCloneDefaultPathQuerySchema,
  hostFileListRequestSchema,
  hostFileReadRequestSchema,
  hostFileWriteRequestSchema,
  hostMkdirRequestSchema,
  hostMovePathRequestSchema,
  hostPathListRequestSchema,
  hostRemovePathRequestSchema,
  hostPickFolderRequestSchema,
  hostPathsExistRequestSchema,
  hostProviderCliInstallRequestSchema,
  projectAttachmentContentQuerySchema,
  projectBranchesQuerySchema,
  projectCommandsQuerySchema,
  projectDefaultExecutionOptionsQuerySchema,
  projectFilesQuerySchema,
  projectListQuerySchema,
  projectPathsQuerySchema,
  projectSkillsQuerySchema,
  deleteSkillRequestSchema,
  projectSkillContentQuerySchema,
  projectSkillFilesQuerySchema,
  updateSkillRequestSchema,
  promptHistoryQuerySchema,
  promptHistoryListQuerySchema,
  reorderPinnedThreadRequestSchema,
  reorderProjectRequestSchema,
  reorderQueuedMessageRequestSchema,
  resolvePendingInteractionRequestSchema,
  resolveThreadMentionsRequestSchema,
  respondPluginInteractionRequestSchema,
  retryTurnRequestSchema,
  sendMessageRequestSchema,
  editMessageRequestSchema,
  setQueuedMessageGroupBoundaryRequestSchema,
  sendQueuedMessageRequestSchema,
  systemExecutionOptionsQuerySchema,
  systemEnvironmentProvidersQuerySchema,
  systemProvidersQuerySchema,
  systemUsageLimitsQuerySchema,
  systemVersionQuerySchema,
  systemAppUpdateAcknowledgeRequestSchema,
  systemAppUpdateAutoRequestSchema,
  systemAppUpdateApplyRequestSchema,
  systemAppUpdateQuerySchema,
  threadEventWaitQuerySchema,
  threadEventsQuerySchema,
  threadMessageQuerySchema,
  threadGetQuerySchema,
  threadCountQuerySchema,
  threadListQuerySchema,
  threadOpenRequestSchema,
  threadPaneActionRequestSchema,
  threadSearchQuerySchema,
  threadStorageFilesQuerySchema,
  threadStoragePathsQuerySchema,
  terminalInputRequestSchema,
  terminalListQuerySchema,
  terminalOutputQuerySchema,
  terminalResizeRequestSchema,
  threadTimelineQuerySchema,
  systemCliSkillsStatusQuerySchema,
  systemInstallCliSkillsRequestSchema,
  threadConversationOutlineQuerySchema,
  timelineTurnSummaryDetailsQuerySchema,
  listEnvironmentsQuerySchema,
  updateEnvironmentRequestSchema,
  updateHostRequestSchema,
  updateHostPermissionCeilingRequestSchema,
  updateThreadSectionRequestSchema,
  updateTerminalRequestSchema,
  updateProjectRequestSchema,
  updateProjectSourceRequestSchema,
  updateThreadRequestSchema,
} from "./api-types.js";
import {
  type ThreadTabsWireResponse,
  updateThreadTabsRequestSchema,
} from "./api/thread-tabs.js";
import {
  serverMoveCheckRequestSchema,
  serverMoveStartRequestSchema,
  type DeleteOldServerCopyResponse,
  type ServerMoveCheckResponse,
  type ServerMoveStatus,
  type ServerMoveStatusResponse,
} from "./api/server-move.js";
import {
  updateUiPreferenceRequestSchema,
  type UiPreferenceResponse,
  type UiPreferencesResponse,
} from "./api/ui-preferences.js";
import type { ApiError } from "./errors.js";
import { pluginManagementRoutes } from "./api/plugin-routes.js";

const NO_STORE = { "cache-control": "no-store" } as const;

export const publicApiRoutes = {
  ...pluginManagementRoutes,
  promptHistory: {
    list: defineRoute({
      path: "/prompt-history",
      method: "get",
      request: queryRequest(promptHistoryListQuerySchema),
      response: jsonResponse<PromptHistoryListResponse>(),
    }),
  },
  projects: {
    machineEnvironment: defineRoute({
      path: "/projects/:id/machine-environment",
      method: "get",
      request: noRequest(),
      response: jsonResponse<ProjectMachineEnvironmentList>(),
    }),
    replaceMachineEnvironment: defineRoute({
      path: "/projects/:id/machine-environment",
      method: "put",
      request: jsonRequest(machineEnvironmentReplaceSchema),
      response: jsonResponse<ProjectMachineEnvironmentList>(),
    }),
    setMachineEnvironmentVariable: defineRoute({
      path: "/projects/:id/machine-environment",
      method: "post",
      request: jsonRequest(machineEnvironmentSetSchema),
      response: jsonResponse<ProjectMachineEnvironmentList>(),
    }),
    deleteMachineEnvironmentVariable: defineRoute({
      path: "/projects/:id/machine-environment",
      method: "delete",
      request: jsonRequest(machineEnvironmentDeleteSchema),
      response: jsonResponse<ProjectMachineEnvironmentList>(),
    }),

    list: defineRoute({
      path: "/projects",
      method: "get",
      request: optionalQueryRequest(projectListQuerySchema),
      response: jsonResponse<
        ProjectResponse[] | ProjectWithThreadsResponse[]
      >(),
    }),
    create: defineRoute({
      path: "/projects",
      method: "post",
      request: jsonRequest(createProjectRequestSchema),
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
      request: noRequest(),
      response: jsonResponse<ProjectResponse>(),
    }),
    update: defineRoute({
      path: "/projects/:id",
      method: "patch",
      request: jsonRequest(updateProjectRequestSchema),
      response: jsonResponse<ProjectResponse>(),
    }),
    delete: defineRoute({
      path: "/projects/:id",
      method: "delete",
      request: noRequest(),
      response: jsonResponse<{ ok: true }>(),
    }),
    reorder: defineRoute({
      path: "/projects/:id/order",
      method: "patch",
      request: jsonRequest(reorderProjectRequestSchema),
      response: jsonResponse<ProjectResponse[]>(),
    }),
    defaultExecutionOptions: defineRoute({
      path: "/projects/:id/default-execution-options",
      method: "get",
      request: queryRequest(projectDefaultExecutionOptionsQuerySchema),
      response: jsonResponse<ProjectExecutionDefaults | null>(),
    }),
    promptHistory: defineRoute({
      path: "/projects/:id/prompt-history",
      method: "get",
      request: optionalQueryRequest(promptHistoryQuerySchema),
      response: jsonResponse<PromptHistoryResponse>(),
    }),
    createSource: defineRoute({
      path: "/projects/:id/sources",
      method: "post",
      request: jsonRequest(createProjectSourceRequestSchema),
      response: jsonResponse<ProjectSource>({ status: 201 }),
    }),
    updateSource: defineRoute({
      path: "/projects/:id/sources/:sourceId",
      method: "patch",
      request: jsonRequest(updateProjectSourceRequestSchema),
      response: jsonResponse<ProjectSource>(),
    }),
    deleteSource: defineRoute({
      path: "/projects/:id/sources/:sourceId",
      method: "delete",
      request: noRequest(),
      response: jsonResponse<{ ok: true }>(),
    }),
    files: defineRoute({
      path: "/projects/:id/files",
      method: "get",
      request: queryRequest(projectFilesQuerySchema),
      response: jsonResponse<WorkspaceFileListResponse>(),
    }),
    file: defineRoute({
      path: "/projects/:id/files/:filePath{.+}",
      method: "get",
      request: noRequest(),
      response: binaryResponse<Uint8Array>(),
    }),
    hostFile: defineRoute({
      path: "/projects/:id/hosts/:hostId/files/:filePath{.+}",
      method: "get",
      request: noRequest(),
      response: binaryResponse<Uint8Array>(),
    }),
    paths: defineRoute({
      path: "/projects/:id/paths",
      method: "get",
      request: queryRequest(projectPathsQuerySchema),
      response: jsonResponse<WorkspacePathListResponse>(),
    }),
    commands: defineRoute({
      path: "/projects/:id/commands",
      method: "get",
      request: queryRequest(projectCommandsQuerySchema),
      response: jsonResponse<CommandListResponse>(),
    }),
    skills: defineRoute({
      path: "/projects/:id/skills",
      method: "get",
      request: queryRequest(projectSkillsQuerySchema),
      response: jsonResponse<SkillListResponse>(),
    }),
    deleteSkill: defineRoute({
      path: "/projects/:id/skills",
      method: "delete",
      request: jsonRequest(deleteSkillRequestSchema),
      response: jsonResponse<{ deletedPath: string }>(),
    }),
    skillContent: defineRoute({
      path: "/projects/:id/skills/content",
      method: "get",
      request: queryRequest(projectSkillContentQuerySchema),
      response: jsonResponse<SkillContentResponse>(),
    }),
    skillFiles: defineRoute({
      path: "/projects/:id/skills/files",
      method: "get",
      request: queryRequest(projectSkillFilesQuerySchema),
      response: jsonResponse<SkillFilesResponse>(),
    }),
    updateSkill: defineRoute({
      path: "/projects/:id/skills/content",
      method: "patch",
      request: jsonRequest(updateSkillRequestSchema),
      response: jsonResponse<{ filePath: string; revision: string }>(),
    }),
    branches: defineRoute({
      path: "/projects/:id/branches",
      method: "get",
      request: queryRequest(projectBranchesQuerySchema),
      response: jsonResponse<ProjectBranchesResponse>(),
    }),
    branchOptions: defineRoute({
      path: "/projects/:id/branch-options",
      method: "get",
      request: queryRequest(projectBranchesQuerySchema),
      response: jsonResponse<ProjectBranchesResponse>(),
    }),
    uploadAttachment: defineRoute({
      path: "/projects/:id/attachments",
      method: "post",
      request: formRequest<ProjectAttachmentUploadForm>(),
      response: jsonResponse<UploadedPromptAttachment>({ status: 201 }),
    }),
    copyAttachments: defineRoute({
      path: "/projects/:id/attachments/copy",
      method: "post",
      request: jsonRequest(copyProjectAttachmentsRequestSchema),
      response: jsonResponse<{ ok: true }>(),
    }),
    attachmentContent: defineRoute({
      path: "/projects/:id/attachments/content",
      method: "get",
      request: queryRequest(projectAttachmentContentQuerySchema),
      response: binaryResponse<Uint8Array>(),
    }),
  },

  files: {
    read: defineRoute({
      path: "/files/read",
      method: "post",
      request: jsonRequest(hostFileReadRequestSchema),
      response: jsonResponse<HostFileReadResponse>(),
    }),
    write: defineRoute({
      path: "/files/write",
      method: "post",
      request: jsonRequest(hostFileWriteRequestSchema),
      response: jsonResponse<HostFileWriteResponse>(),
    }),
    list: defineRoute({
      path: "/files/list",
      method: "post",
      request: jsonRequest(hostFileListRequestSchema),
      response: jsonResponse<HostFileListResponse>(),
    }),
    listPaths: defineRoute({
      path: "/files/paths",
      method: "post",
      request: jsonRequest(hostPathListRequestSchema),
      response: jsonResponse<HostPathListResponse>(),
    }),
    mkdir: defineRoute({
      path: "/files/mkdir",
      method: "post",
      request: jsonRequest(hostMkdirRequestSchema),
      response: jsonResponse<HostMkdirResponse>(),
    }),
    move: defineRoute({
      path: "/files/move",
      method: "post",
      request: jsonRequest(hostMovePathRequestSchema),
      response: jsonResponse<HostMovePathResponse>(),
    }),
    remove: defineRoute({
      path: "/files/remove",
      method: "post",
      request: jsonRequest(hostRemovePathRequestSchema),
      response: jsonResponse<HostRemovePathResponse>(),
    }),
    createPreview: defineRoute({
      path: "/files/previews",
      method: "post",
      request: jsonRequest(createFilePreviewRequestSchema),
      response: jsonResponse<CreateFilePreviewResponse>(),
    }),
  },

  filePreviews: {
    content: defineRoute({
      path: "/file-previews/:id/:filePath{.+}",
      method: "get",
      request: noRequest(),
      response: binaryResponse<Uint8Array>(),
    }),
  },

  desktopBrowsers: {
    brokerProof: defineRoute({
      path: "/desktop-browsers/broker-proof",
      method: "post",
      request: jsonRequest(desktopBrowserBrokerProofRequestSchema),
      response: jsonResponse<DesktopBrowserBrokerProof>(),
      headers: NO_STORE,
    }),
    listInstances: defineRoute({
      path: "/desktop-browsers/instances",
      method: "post",
      request: jsonRequest(desktopBrowserHostRequestSchema),
      response: jsonResponse<ExperimentalDesktopBrowserInstances>(),
    }),
    listTabs: defineRoute({
      path: "/desktop-browsers/tabs",
      method: "post",
      request: jsonRequest(desktopBrowserScopeSchema),
      response: jsonResponse<ExperimentalDesktopBrowserTabs>(),
    }),
    createTab: defineRoute({
      path: "/desktop-browsers/create",
      method: "post",
      request: jsonRequest(desktopBrowserCreateRequestSchema),
      response: jsonResponse<ExperimentalDesktopBrowserCreated>(),
    }),
    acquireControl: defineRoute({
      path: "/desktop-browsers/acquire",
      method: "post",
      request: jsonRequest(desktopBrowserAcquireRequestSchema),
      response: jsonResponse<ExperimentalDesktopBrowserLease>(),
    }),
    openConnection: defineRoute({
      path: "/desktop-browsers/connection",
      method: "post",
      request: jsonRequest(desktopBrowserLeaseRequestSchema),
      response: jsonResponse<ExperimentalDesktopBrowserConnection>(),
      headers: NO_STORE,
    }),
    releaseControl: defineRoute({
      path: "/desktop-browsers/release",
      method: "post",
      request: jsonRequest(desktopBrowserLeaseRequestSchema),
      response: jsonResponse<{ ok: true }>(),
    }),
    closeTab: defineRoute({
      path: "/desktop-browsers/close",
      method: "post",
      request: jsonRequest(desktopBrowserTabRequestSchema),
      response: jsonResponse<{ ok: true }>(),
    }),
    revealTab: defineRoute({
      path: "/desktop-browsers/reveal",
      method: "post",
      request: jsonRequest(desktopBrowserTabRequestSchema),
      response: jsonResponse<{ ok: true }>(),
    }),
    captureTab: defineRoute({
      path: "/desktop-browsers/capture",
      method: "post",
      request: jsonRequest(desktopBrowserTabRequestSchema),
      response: jsonResponse<ExperimentalDesktopBrowserCapture>(),
      headers: NO_STORE,
    }),
    listImportSources: defineRoute({
      path: "/desktop-browsers/import-sources",
      method: "post",
      request: jsonRequest(desktopBrowserInstanceRequestSchema),
      response: jsonResponse<ExperimentalDesktopBrowserImportSources>(),
    }),
    importCookies: defineRoute({
      path: "/desktop-browsers/import-cookies",
      method: "post",
      request: jsonRequest(desktopBrowserImportCookiesRequestSchema),
      response: jsonResponse<ExperimentalDesktopBrowserImportOutcome>(),
      headers: NO_STORE,
    }),
  },

  hosts: {
    create: defineRoute({
      path: "/hosts",
      method: "post",
      request: jsonRequest(createMachineRequestSchema),
      response: jsonResponse<Host>({ status: 201 }),
    }),
    createJoinCode: defineRoute({
      path: "/hosts/join-codes",
      method: "post",
      request: jsonRequest(createHostJoinCodeRequestSchema),
      response: jsonResponse<CreateHostJoinCodeResponse>({ status: 201 }),
    }),
    list: defineRoute({
      path: "/hosts",
      method: "get",
      request: optionalQueryRequest(hostListQuerySchema),
      response: jsonResponse<Host[]>(),
    }),
    get: defineRoute({
      path: "/hosts/:id",
      method: "get",
      request: noRequest(),
      response: jsonResponse<
        Host & {
          connectMachineId: string | null;
          threadStorageRootPath: string | null;
        }
      >(),
    }),
    enrollmentCommand: defineRoute({
      path: "/hosts/:id/enrollment-command",
      method: "get",
      request: noRequest(),
      response: jsonResponse<HostEnrollmentCommandResponse>(),
    }),
    reconnect: defineRoute({
      path: "/hosts/:id/reconnect-commands",
      method: "post",
      request: noRequest(),
      response: jsonResponse<HostReconnectResponse>({ status: 201 }),
    }),
    update: defineRoute({
      path: "/hosts/:id",
      method: "patch",
      request: jsonRequest(updateHostRequestSchema),
      response: jsonResponse<Host>(),
    }),
    updatePermissionCeiling: defineRoute({
      path: "/hosts/:id/permission-ceiling",
      method: "patch",
      request: jsonRequest(updateHostPermissionCeilingRequestSchema),
      response: jsonResponse<Host>(),
    }),
    retryUpdate: defineRoute({
      path: "/hosts/:id/retry-update",
      method: "post",
      request: noRequest(),
      response: jsonResponse<HostRetryUpdateResponse>(),
    }),
    reconcile: defineRoute({
      path: "/hosts/:id/reconcile",
      method: "post",
      request: noRequest(),
      response: jsonResponse<Host, 202>({ status: 202 }),
    }),
    suspend: defineRoute({
      path: "/hosts/:id/suspend",
      method: "post",
      request: noRequest(),
      response: jsonResponse<Host, 202>({ status: 202 }),
    }),
    resume: defineRoute({
      path: "/hosts/:id/resume",
      method: "post",
      request: noRequest(),
      response: jsonResponse<Host, 202>({ status: 202 }),
    }),
    retryCleanup: defineRoute({
      path: "/hosts/:id/retry-cleanup",
      method: "post",
      request: noRequest(),
      response: jsonResponse<HostActionResponse>(),
    }),
    delete: defineRoute({
      path: "/hosts/:id",
      method: "delete",
      request: optionalQueryRequest(hostDeleteQuerySchema),
      response: jsonResponse<{ ok: true }>(),
    }),
    directory: defineRoute({
      path: "/hosts/:id/directory",
      method: "get",
      request: queryRequest(hostDirectoryQuerySchema),
      response: jsonResponse<HostDirectoryListing>(),
    }),
    discoveredRepos: defineRoute({
      path: "/hosts/:id/discovered-repos",
      method: "get",
      request: noRequest(),
      response: jsonResponse<HostDiscoveredReposResponse>(),
    }),
    file: defineRoute({
      path: "/hosts/:id/files/:filePath{.+}",
      method: "get",
      request: noRequest(),
      response: binaryResponse<Uint8Array>(),
    }),
    cloneDefaultPath: defineRoute({
      path: "/hosts/:id/clone-default-path",
      method: "get",
      request: queryRequest(hostCloneDefaultPathQuerySchema),
      response: jsonResponse<HostCloneDefaultPathResponse>(),
    }),
    pathsExist: defineRoute({
      path: "/hosts/:id/paths/exist",
      method: "post",
      request: jsonRequest(hostPathsExistRequestSchema),
      response: jsonResponse<HostPathsExistResponse>(),
    }),
    pickFolder: defineRoute({
      path: "/hosts/:id/pick-folder",
      method: "post",
      request: jsonRequest(hostPickFolderRequestSchema),
      response: jsonResponse<HostPickFolderResponse>(),
    }),
    providerCliStatus: defineRoute({
      path: "/hosts/:id/provider-clis/status",
      method: "get",
      request: optionalQueryRequest(hostProviderCliStatusQuerySchema),
      response: jsonResponse<HostProviderCliStatusResponse>(),
    }),
    providerCliInstall: defineRoute({
      path: "/hosts/:id/provider-clis/install",
      method: "post",
      request: jsonRequest(hostProviderCliInstallRequestSchema),
      response: textResponse<HostProviderCliInstallEvent>(),
    }),
    deleteOldServerCopy: defineRoute({
      path: "/hosts/:id/old-server-copy",
      method: "delete",
      request: noRequest(),
      response: jsonResponse<DeleteOldServerCopyResponse>(),
    }),
  },
  server: {
    checkMove: defineRoute({
      path: "/server/move/check",
      method: "post",
      request: jsonRequest(serverMoveCheckRequestSchema),
      response: jsonResponse<ServerMoveCheckResponse>(),
    }),
    startMove: defineRoute({
      path: "/server/move",
      method: "post",
      request: jsonRequest(serverMoveStartRequestSchema),
      response: jsonResponse<ServerMoveStatus>(),
    }),
    moveStatus: defineRoute({
      path: "/server/move",
      method: "get",
      request: noRequest(),
      response: jsonResponse<ServerMoveStatusResponse>(),
    }),
    cancelMove: defineRoute({
      path: "/server/move/cancel",
      method: "post",
      request: noRequest(),
      response: jsonResponse<ServerMoveStatus>(),
    }),
    export: defineRoute({
      path: "/server/export",
      method: "post",
      request: noRequest(),
      response: binaryResponse<Uint8Array>(),
    }),
  },

  terminals: {
    list: defineRoute({
      path: "/terminals",
      method: "get",
      request: queryRequest(terminalListQuerySchema),
      response: jsonResponse<TerminalListResponse>(),
    }),
    create: defineRoute({
      path: "/terminals",
      method: "post",
      request: jsonRequest(createTerminalRequestSchema),
      response: jsonResponse<TerminalSession>({ status: 201 }),
    }),
    get: defineRoute({
      path: "/terminals/:terminalId",
      method: "get",
      request: noRequest(),
      response: jsonResponse<TerminalSession>(),
    }),
    update: defineRoute({
      path: "/terminals/:terminalId",
      method: "patch",
      request: jsonRequest(updateTerminalRequestSchema),
      response: jsonResponse<TerminalSession>(),
    }),
    restart: defineRoute({
      path: "/terminals/:terminalId/restart",
      method: "post",
      request: jsonRequest(restartTerminalRequestSchema),
      response: jsonResponse<TerminalSession>({ status: 201 }),
    }),
    close: defineRoute({
      path: "/terminals/:terminalId/close",
      method: "post",
      request: jsonRequest(closeTerminalRequestSchema),
      response: jsonResponse<TerminalSession>(),
    }),
    input: defineRoute({
      path: "/terminals/:terminalId/input",
      method: "post",
      request: jsonRequest(terminalInputRequestSchema),
      response: jsonResponse<TerminalSession>(),
    }),
    resize: defineRoute({
      path: "/terminals/:terminalId/resize",
      method: "post",
      request: jsonRequest(terminalResizeRequestSchema),
      response: jsonResponse<TerminalSession>(),
    }),
    output: defineRoute({
      path: "/terminals/:terminalId/output",
      method: "get",
      request: optionalQueryRequest(terminalOutputQuerySchema),
      response: jsonResponse<TerminalOutputResponse>(),
    }),
  },

  environments: {
    cleanup: defineRoute({
      path: "/environments/:id/cleanup",
      method: "post",
      request: optionalQueryRequest(environmentCleanupQuerySchema),
      response: jsonResponse<{ ok: true }>(),
    }),
    list: defineRoute({
      path: "/environments",
      method: "get",
      request: optionalQueryRequest(listEnvironmentsQuerySchema),
      response: jsonResponse<Environment[]>(),
    }),
    delete: defineRoute({
      path: "/environments/:id",
      method: "delete",
      request: noRequest(),
      response: [
        jsonResponse<{ ok: true }>(),
        jsonResponse<ApiError>({ status: 404 }),
        jsonResponse<ApiError>({ status: 409 }),
      ],
    }),
    get: defineRoute({
      path: "/environments/:id",
      method: "get",
      request: noRequest(),
      response: [
        jsonResponse<Environment>(),
        jsonResponse<ApiError>({ status: 404 }),
      ],
    }),
    update: defineRoute({
      path: "/environments/:id",
      method: "patch",
      request: jsonRequest(updateEnvironmentRequestSchema),
      response: jsonResponse<Environment>(),
    }),
    paths: defineRoute({
      path: "/environments/:id/paths",
      method: "get",
      request: queryRequest(environmentPathsQuerySchema),
      response: jsonResponse<WorkspacePathListResponse>(),
    }),
    file: defineRoute({
      path: "/environments/:id/files/:filePath{.+}",
      method: "get",
      request: noRequest(),
      response: binaryResponse<Uint8Array>(),
    }),
    revisionFile: defineRoute({
      path: "/environments/:id/revisions/:ref/files/:filePath{.+}",
      method: "get",
      request: noRequest(),
      response: binaryResponse<Uint8Array>(),
    }),
    actions: defineRoute({
      path: "/environments/:id/actions",
      method: "post",
      request: jsonRequest(environmentActionRequestSchema),
      response: [
        jsonResponse<EnvironmentActionResponse>(),
        jsonResponse<EnvironmentActionApiError>({ status: 409 }),
        jsonResponse<ApiError>({ status: 404 }),
      ],
    }),
    archiveThreads: defineRoute({
      path: "/environments/:id/archive-threads",
      method: "post",
      request: noRequest(),
      response: jsonResponse<EnvironmentArchiveThreadsResponse>(),
    }),
  },

  threadSections: {
    list: defineRoute({
      path: "/thread-sections",
      method: "get",
      request: noRequest(),
      response: jsonResponse<ThreadSectionResponse[]>(),
    }),
    create: defineRoute({
      path: "/thread-sections",
      method: "post",
      request: jsonRequest(createThreadSectionRequestSchema),
      response: [
        jsonResponse<ThreadSectionResponse>({ status: 201 }),
        jsonResponse<ApiError>({ status: 409 }),
      ],
    }),
    update: defineRoute({
      path: "/thread-sections",
      method: "patch",
      request: jsonRequest(updateThreadSectionRequestSchema),
      response: [
        jsonResponse<ThreadSectionMutationResponse>(),
        jsonResponse<ApiError>({ status: 404 }),
        jsonResponse<ApiError>({ status: 409 }),
      ],
    }),
    delete: defineRoute({
      path: "/thread-sections",
      method: "delete",
      request: jsonRequest(deleteThreadSectionRequestSchema),
      response: [
        jsonResponse<ThreadSectionMutationResponse>(),
        jsonResponse<ApiError>({ status: 404 }),
      ],
    }),
  },

  threads: {
    list: defineRoute({
      path: "/threads",
      method: "get",
      request: optionalQueryRequest(threadListQuerySchema),
      response: jsonResponse<ThreadListResponse>(),
    }),
    /**
     * Grouped `SELECT count(*)` over threads. Exists because a plugin gate
     * that limits concurrency must count without loading: `threads.list`
     * would page rows into memory and still miscount past its limit.
     */
    count: defineRoute({
      path: "/threads/count",
      method: "get",
      request: optionalQueryRequest(threadCountQuerySchema),
      response: jsonResponse<ThreadCountResponse>(),
    }),
    /**
     * The threads occupying capacity right now, as rows rather than a count.
     * A limiter needs to know *which* threads are running to hold several
     * pools at once — `threads.count` answers one pool per request and cannot
     * reconcile a global limit with a per-host one from separate counts.
     */
    running: defineRoute({
      path: "/threads/running",
      method: "get",
      request: noRequest(),
      response: jsonResponse<ThreadRunningResponse>(),
    }),
    search: defineRoute({
      path: "/threads/search",
      method: "get",
      request: queryRequest(threadSearchQuerySchema),
      response: jsonResponse<ThreadSearchResponse>(),
    }),
    resolveMentions: defineRoute({
      path: "/threads/resolve-mentions",
      method: "post",
      request: jsonRequest(resolveThreadMentionsRequestSchema),
      response: jsonResponse<ResolveThreadMentionsResponse>(),
    }),
    create: defineRoute({
      path: "/threads",
      method: "post",
      request: jsonRequest(createThreadRequestSchema),
      response: jsonResponse<ThreadResponse>({ status: 201 }),
    }),
    fork: defineRoute({
      path: "/threads/fork",
      method: "post",
      request: jsonRequest(forkThreadRequestSchema),
      response: jsonResponse<ThreadResponse>({ status: 201 }),
    }),
    get: defineRoute({
      path: "/threads/:id",
      method: "get",
      request: optionalQueryRequest(threadGetQuerySchema),
      response: jsonResponse<ThreadResponse | ThreadWithIncludesResponse>(),
    }),
    update: defineRoute({
      path: "/threads/:id",
      method: "patch",
      request: jsonRequest(updateThreadRequestSchema),
      response: jsonResponse<ThreadResponse>(),
    }),
    /**
     * Each of `threadIds` (1–200) that exists, with its ancestors' ids from
     * the parent up to the root; archived and deleted threads included.
     * Unknown ids are omitted.
     */
    ancestors: defineRoute({
      path: "/threads/ancestors",
      method: "post",
      request: jsonRequest(threadAncestorsListRequestSchema),
      response: jsonResponse<ThreadAncestorsListResponse>(),
    }),
    /**
     * Each of `threadIds` (1–200) that exists and is not deleted, with the
     * ids of every thread below it, children first. Archived and hidden
     * descendants are omitted unless `includeArchived` / `includeHidden` is
     * true, but threads below them are still returned; deleted threads and
     * unknown ids are always omitted.
     */
    descendants: defineRoute({
      path: "/threads/descendants",
      method: "post",
      request: jsonRequest(threadDescendantsListRequestSchema),
      response: jsonResponse<ThreadDescendantsListResponse>(),
    }),
    /**
     * Each of `threadIds` (1–200) that exists and is not deleted, with the
     * ids of the visible threads that archiving (`action: "archive"`) or
     * deleting (`action: "delete"`) it would also affect: the same cascade
     * the archive-all and delete routes apply. Archive omits threads that
     * are already archived; delete includes them. Hidden threads, deleted
     * threads and unknown ids are omitted.
     */
    cascade: defineRoute({
      path: "/threads/cascade",
      method: "post",
      request: jsonRequest(threadCascadeListRequestSchema),
      response: jsonResponse<ThreadCascadeListResponse>(),
    }),
    pluginMetadata: {
      /**
       * `pluginId`'s metadata for each of `threadIds` (1–200) that has any,
       * archived and deleted threads included. Threads without a namespace
       * and corrupt records are omitted.
       */
      list: defineRoute({
        path: "/threads/plugin-metadata",
        method: "post",
        request: jsonRequest(pluginThreadMetadataListRequestSchema),
        response: jsonResponse<PluginThreadMetadataListResponse>(),
      }),
      get: defineRoute({
        path: "/threads/:id/plugin-metadata",
        method: "get",
        request: queryRequest(threadPluginMetadataQuerySchema),
        response: jsonResponse<ThreadPluginMetadataResponse>(),
      }),
      update: defineRoute({
        path: "/threads/:id/plugin-metadata",
        method: "patch",
        request: jsonRequest(updateThreadPluginMetadataRequestSchema),
        response: jsonResponse<ThreadPluginMetadataResponse>(),
      }),
    },
    delete: defineRoute({
      path: "/threads/:id",
      method: "delete",
      request: jsonRequest(deleteThreadRequestSchema),
      response: jsonResponse<{ ok: true }>(),
    }),
    childSummary: defineRoute({
      path: "/threads/:id/child-summary",
      method: "get",
      request: noRequest(),
      response: jsonResponse<ThreadChildSummaryResponse>(),
    }),
    send: defineRoute({
      path: "/threads/:id/send",
      method: "post",
      request: jsonRequest(sendMessageRequestSchema),
      response: jsonResponse<SendMessageResponse>(),
    }),
    editMessage: defineRoute({
      path: "/threads/:id/edit-message",
      method: "post",
      request: jsonRequest(editMessageRequestSchema),
      response: jsonResponse<EditMessageResponse>(),
    }),
    /**
     * Retry a failed turn: re-submit it by reference, as an ordinary dispatch
     * attempt. `turnRequestId` null means the thread's most recent turn, whose
     * failure is what put the thread in `error`.
     */
    retry: defineRoute({
      path: "/threads/:id/retry",
      method: "post",
      request: jsonRequest(retryTurnRequestSchema),
      response: jsonResponse<RetryTurnResponse>(),
    }),
    queuedMessages: defineRoute({
      path: "/threads/:id/queued-messages",
      method: "get",
      request: noRequest(),
      response: jsonResponse<ThreadQueuedMessageListResponse>(),
    }),
    /**
     * Create a queued message; senderThreadId preserves agent-to-agent context
     * until send time.
     */
    createQueuedMessage: defineRoute({
      path: "/threads/:id/queued-messages",
      method: "post",
      request: jsonRequest(createQueuedMessageRequestSchema),
      response: jsonResponse<ThreadQueuedMessage>({ status: 201 }),
    }),
    updateQueuedMessage: defineRoute({
      path: "/threads/:id/queued-messages/:queuedMessageId",
      method: "patch",
      request: jsonRequest(updateQueuedMessageRequestSchema),
      response: jsonResponse<ThreadQueuedMessage>(),
    }),
    sendQueuedMessage: defineRoute({
      path: "/threads/:id/queued-messages/:queuedMessageId/send",
      method: "post",
      request: jsonRequest(sendQueuedMessageRequestSchema),
      response: jsonResponse<SendQueuedMessageResponse>(),
    }),
    /**
     * Hold a queued message while someone edits it: no automatic dispatch
     * claims it, and the drainable rows behind it wait, until the hold is
     * released, a save clears it, or `leaseMs` passes without a renewal.
     * Calling it again renews the lease. Responds 409 once a dispatch has
     * claimed the row.
     */
    holdQueuedMessageForEdit: defineRoute({
      path: "/threads/:id/queued-messages/:queuedMessageId/edit-hold",
      method: "post",
      request: noRequest(),
      response: jsonResponse<QueuedMessageEditHoldResponse>(),
    }),
    /**
     * Release an edit hold without saving, letting the row dispatch as it
     * would have. Releasing a row that is not held is a no-op.
     */
    releaseQueuedMessageEditHold: defineRoute({
      path: "/threads/:id/queued-messages/:queuedMessageId/edit-hold",
      method: "delete",
      request: noRequest(),
      response: jsonResponse<{ ok: true }>(),
    }),
    reorderQueuedMessage: defineRoute({
      path: "/threads/:id/queued-messages/:queuedMessageId/order",
      method: "patch",
      request: jsonRequest(reorderQueuedMessageRequestSchema),
      response: jsonResponse<ThreadQueuedMessageListResponse>(),
    }),
    setQueuedMessageGroupBoundary: defineRoute({
      path: "/threads/:id/queued-messages/group-boundary",
      method: "patch",
      request: jsonRequest(setQueuedMessageGroupBoundaryRequestSchema),
      response: jsonResponse<ThreadQueuedMessageListResponse>(),
    }),
    promptHistory: defineRoute({
      path: "/threads/:id/prompt-history",
      method: "get",
      request: optionalQueryRequest(promptHistoryQuerySchema),
      response: jsonResponse<PromptHistoryResponse>(),
    }),
    deleteQueuedMessage: defineRoute({
      path: "/threads/:id/queued-messages/:queuedMessageId",
      method: "delete",
      request: noRequest(),
      response: jsonResponse<{ ok: true }>(),
    }),
    stop: defineRoute({
      path: "/threads/:id/stop",
      method: "post",
      request: noRequest(),
      response: jsonResponse<{ ok: true }>(),
    }),
    compact: defineRoute({
      path: "/threads/:id/compact",
      method: "post",
      request: noRequest(),
      response: jsonResponse<{ ok: true }>(),
    }),
    clearContext: defineRoute({
      path: "/threads/:id/context/clear",
      method: "post",
      request: noRequest(),
      response: jsonResponse<{ ok: true }>(),
    }),
    cancelPlan: defineRoute({
      path: "/threads/:id/plan/cancel",
      method: "post",
      request: noRequest(),
      response: jsonResponse<{ ok: true }>(),
    }),
    clearGoal: defineRoute({
      path: "/threads/:id/goal/clear",
      method: "post",
      request: noRequest(),
      response: jsonResponse<{ ok: true }>(),
    }),
    open: defineRoute({
      path: "/threads/:id/open",
      method: "post",
      request: jsonRequest(threadOpenRequestSchema),
      response: jsonResponse<ThreadOpenResponse>(),
    }),
    paneAction: defineRoute({
      path: "/threads/:id/pane-action",
      method: "post",
      request: jsonRequest(threadPaneActionRequestSchema),
      response: jsonResponse<ThreadPaneActionResponse>(),
    }),
    tabs: defineRoute({
      path: "/threads/:id/tabs",
      method: "get",
      request: noRequest(),
      response: jsonResponse<ThreadTabsWireResponse>(),
    }),
    updateTabs: defineRoute({
      path: "/threads/:id/tabs",
      method: "put",
      request: jsonRequest(updateThreadTabsRequestSchema),
      response: [
        jsonResponse<ThreadTabsWireResponse>(),
        jsonResponse<ApiError>({ status: 409 }),
      ],
    }),
    pin: defineRoute({
      path: "/threads/:id/pin",
      method: "post",
      request: noRequest(),
      response: jsonResponse<ThreadResponse>(),
    }),
    unpin: defineRoute({
      path: "/threads/:id/unpin",
      method: "post",
      request: noRequest(),
      response: jsonResponse<ThreadResponse>(),
    }),
    /**
     * Generate a new title from the thread's first task message, its latest
     * user messages, and the agent's latest replies, replacing the current
     * title unless it still fits. The title is unchanged when no title service
     * is available or generation fails, and the error says why.
     */
    regenerateTitle: defineRoute({
      path: "/threads/:id/title/regenerate",
      method: "post",
      request: noRequest(),
      response: jsonResponse<ThreadResponse>(),
    }),
    pinOrder: defineRoute({
      path: "/threads/:id/pin-order",
      method: "patch",
      request: jsonRequest(reorderPinnedThreadRequestSchema),
      response: jsonResponse<ThreadListResponse>(),
    }),
    interactions: defineRoute({
      path: "/threads/:id/interactions",
      method: "get",
      request: noRequest(),
      response: jsonResponse<ThreadPendingInteractionsResponse>(),
    }),
    interaction: defineRoute({
      path: "/threads/:id/interactions/:interactionId",
      method: "get",
      request: noRequest(),
      response: jsonResponse<PendingInteraction>(),
    }),
    resolveInteraction: defineRoute({
      path: "/threads/:id/interactions/:interactionId/resolve",
      method: "post",
      request: jsonRequest(resolvePendingInteractionRequestSchema),
      response: jsonResponse<PendingInteraction>(),
    }),
    respondToInteraction: defineRoute({
      path: "/threads/:id/interactions/:interactionId/respond",
      method: "post",
      request: jsonRequest(respondPluginInteractionRequestSchema),
      response: jsonResponse<PendingInteraction>(),
    }),
    cancelInteraction: defineRoute({
      path: "/threads/:id/interactions/:interactionId/cancel",
      method: "post",
      request: noRequest(),
      response: jsonResponse<PendingInteraction>(),
    }),
    archiveAll: defineRoute({
      path: "/threads/:id/archive-all",
      method: "post",
      request: noRequest(),
      response: jsonResponse<ThreadArchiveAllResponse>(),
    }),
    unarchive: defineRoute({
      path: "/threads/:id/unarchive",
      method: "post",
      request: noRequest(),
      response: jsonResponse<{ ok: true }>(),
    }),
    /**
     * Ask the environment provider to restore a thread's destroyed environment
     * and attach the result; the provider decides what restoring means, such
     * as checking the recorded branch out again. Sends to such a thread fail
     * until this runs. Answers
     * the thread as it now stands — `starting`, with provisioning underway —
     * and starts no turn: the thread settles back to `idle` once the workspace
     * is ready. Refused unless `canRestoreEnvironment` is true.
     */
    restoreEnvironment: defineRoute({
      path: "/threads/:id/restore-environment",
      method: "post",
      request: noRequest(),
      response: jsonResponse<ThreadResponse>(),
    }),
    read: defineRoute({
      path: "/threads/:id/read",
      method: "post",
      request: noRequest(),
      response: jsonResponse<ThreadResponse>(),
    }),
    unread: defineRoute({
      path: "/threads/:id/unread",
      method: "post",
      request: noRequest(),
      response: jsonResponse<ThreadResponse>(),
    }),
    timeline: defineRoute({
      path: "/threads/:id/timeline",
      method: "get",
      request: optionalQueryRequest(threadTimelineQuerySchema),
      response: jsonResponse<ThreadTimelineReadResponse>(),
    }),
    context: defineRoute({
      path: "/threads/:id/context",
      method: "get",
      request: noRequest(),
      response: jsonResponse<ThreadContextResponse>(),
    }),
    conversationOutline: defineRoute({
      path: "/threads/:id/conversation-outline",
      method: "get",
      request: queryRequest(threadConversationOutlineQuerySchema),
      response: jsonResponse<ThreadConversationOutlineResponse>(),
    }),
    timelineTurnSummaryDetails: defineRoute({
      path: "/threads/:id/timeline/turn-summary-details",
      method: "get",
      request: queryRequest(timelineTurnSummaryDetailsQuerySchema),
      response: jsonResponse<TimelineTurnSummaryDetailsResponse>(),
    }),
    output: defineRoute({
      path: "/threads/:id/output",
      method: "get",
      request: noRequest(),
      response: jsonResponse<{ output: string | null }>(),
    }),
    events: defineRoute({
      path: "/threads/:id/events",
      method: "get",
      request: optionalQueryRequest(threadEventsQuerySchema),
      response: jsonResponse<ThreadEventRow[]>(),
    }),
    message: defineRoute({
      path: "/threads/:id/messages/:seq",
      method: "get",
      request: optionalQueryRequest(threadMessageQuerySchema),
      response: jsonResponse<ThreadMessageResponse>(),
    }),
    eventWait: defineRoute({
      path: "/threads/:id/events/wait",
      method: "get",
      request: queryRequest(threadEventWaitQuerySchema),
      response: jsonResponse<ThreadEventRow | null>(),
    }),
    defaultExecutionOptions: defineRoute({
      path: "/threads/:id/default-execution-options",
      method: "get",
      request: noRequest(),
      response: jsonResponse<ResolvedThreadExecutionOptions | null>(),
    }),
    storageFiles: defineRoute({
      path: "/threads/:id/thread-storage/files",
      method: "get",
      request: optionalQueryRequest(threadStorageFilesQuerySchema),
      response: jsonResponse<ThreadStorageFileListResponse>(),
    }),
    storageLocation: defineRoute({
      path: "/threads/:id/thread-storage/location",
      method: "get",
      request: noRequest(),
      response: jsonResponse<ThreadStorageLocationResponse>(),
    }),
    storageFile: defineRoute({
      path: "/threads/:id/thread-storage/files/:filePath{.+}",
      method: "get",
      request: noRequest(),
      response: binaryResponse<Uint8Array>(),
    }),
    hostFile: defineRoute({
      path: "/threads/:id/host-files/:filePath{.+}",
      method: "get",
      request: noRequest(),
      response: binaryResponse<Uint8Array>(),
    }),
    storagePaths: defineRoute({
      path: "/threads/:id/thread-storage/paths",
      method: "get",
      request: queryRequest(threadStoragePathsQuerySchema),
      response: jsonResponse<ThreadStoragePathListResponse>(),
    }),
  },

  queue: {
    /**
     * Every live queued row, optionally narrowed to one thread or one
     * wait holder. Cross-thread because "what is queued right now" is a
     * whole-workspace question (`bb thread queue list` with no thread, a
     * limiter plugin's own bookkeeping, a router recovering its rows after a
     * restart) that no single thread's list can answer.
     */
    list: defineRoute({
      path: "/queued-messages",
      method: "get",
      request: optionalQueryRequest(queuedMessageListQuerySchema),
      response: jsonResponse<ThreadQueuedMessageListResponse>(),
    }),
  },

  system: {
    setMachineEnvironmentVariable: defineRoute({
      path: "/settings/machine-environment",
      method: "post",
      request: jsonRequest(machineEnvironmentSetSchema),
      response: jsonResponse<MachineEnvironmentList>(),
    }),
    deleteMachineEnvironmentVariable: defineRoute({
      path: "/settings/machine-environment",
      method: "delete",
      request: jsonRequest(machineEnvironmentDeleteSchema),
      response: jsonResponse<MachineEnvironmentList>(),
    }),

    machineEnvironment: defineRoute({
      path: "/settings/machine-environment",
      method: "get",
      request: noRequest(),
      response: jsonResponse<MachineEnvironmentList>(),
    }),
    replaceMachineEnvironment: defineRoute({
      path: "/settings/machine-environment",
      method: "put",
      request: jsonRequest(machineEnvironmentReplaceSchema),
      response: jsonResponse<MachineEnvironmentList>(),
    }),
    attention: defineRoute({
      path: "/system/attention",
      method: "get",
      request: noRequest(),
      response: jsonResponse<SystemAttentionResponse>(),
    }),
    mobileAppReleases: defineRoute({
      path: "/system/mobile-app-releases",
      method: "get",
      request: noRequest(),
      response: jsonResponse<SystemMobileAppReleasesResponse>(),
      headers: NO_STORE,
    }),
    config: defineRoute({
      path: "/system/config",
      method: "get",
      request: noRequest(),
      response: jsonResponse<SystemConfigResponse>(),
    }),
    aiServices: defineRoute({
      path: "/system/ai-services",
      method: "get",
      request: noRequest(),
      response: jsonResponse<SystemAiServicesResponse>(),
    }),
    setAiServiceSelection: defineRoute({
      path: "/system/ai-services/selection",
      method: "put",
      request: jsonRequest(setAiServiceSelectionRequestSchema),
      response: jsonResponse<SystemAiServicesResponse>(),
    }),
    testAiService: defineRoute({
      path: "/system/ai-services/test",
      method: "post",
      request: jsonRequest(testAiServiceRequestSchema),
      response: jsonResponse<TestAiServiceResponse>(),
    }),
    setupGuide: defineRoute({
      path: "/system/setup-guide",
      method: "get",
      request: noRequest(),
      response: jsonResponse<SystemSetupGuideResponse>(),
    }),
    recordTelemetryEvent: defineRoute({
      path: "/system/telemetry/events",
      method: "post",
      request: jsonRequest(recordTelemetryEventRequestSchema),
      response: jsonResponse<{ ok: true }>(),
    }),
    generalSettings: defineRoute({
      path: "/settings/general",
      method: "put",
      request: jsonRequest(appSettingsUpdateSchema),
      response: jsonResponse<
        AppSettings & { showUnhandledProviderEvents?: boolean }
      >(),
    }),
    keyboardSettings: defineRoute({
      path: "/settings/keyboard",
      method: "put",
      request: jsonFieldRequest("overrides", appKeybindingOverridesSchema),
      response: jsonResponse<AppKeybindingOverrides>(),
    }),
    experiments: defineRoute({
      path: "/settings/experiments",
      method: "put",
      request: jsonRequest(experimentUpdatesSchema),
      response: jsonResponse<Experiments>(),
    }),
    appearance: defineRoute({
      path: "/settings/appearance",
      method: "put",
      request: jsonRequest(appThemeSelectionSchema),
      response: jsonResponse<AppTheme>(),
    }),
    uiPreferences: defineRoute({
      path: "/preferences/ui",
      method: "get",
      request: noRequest(),
      response: jsonResponse<UiPreferencesResponse>(),
    }),
    updateUiPreference: defineRoute({
      path: "/preferences/ui/:key",
      method: "put",
      request: jsonRequest(updateUiPreferenceRequestSchema),
      response: [
        jsonResponse<UiPreferenceResponse>(),
        jsonResponse<ApiError>({ status: 404 }),
        jsonResponse<ApiError>({ status: 409 }),
      ],
    }),
    resetUiPreference: defineRoute({
      path: "/preferences/ui/:key",
      method: "delete",
      request: noRequest(),
      response: [
        jsonResponse<UiPreferenceResponse>(),
        jsonResponse<ApiError>({ status: 404 }),
      ],
    }),
    themes: defineRoute({
      path: "/settings/themes",
      method: "get",
      request: noRequest(),
      response: jsonResponse<ThemeCatalogResponse>(),
    }),
    /**
     * Resolve a built-in, custom, or plugin theme exactly as activating it
     * would, without persisting anything. The Settings palette hover preview
     * and `bb theme show <id>` read it; `faviconColor` echoes the stored
     * appearance because the response is a full `AppTheme`.
     */
    resolveTheme: defineRoute({
      path: "/settings/themes/:id",
      method: "get",
      request: noRequest(),
      response: jsonResponse<AppTheme>(),
    }),
    reloadConfig: defineRoute({
      path: "/system/config/reload",
      method: "post",
      request: noRequest(),
      response: jsonResponse<SystemConfigReloadResponse>(),
    }),
    cliSkillsStatus: defineRoute({
      path: "/system/cli-skills",
      method: "get",
      request: optionalQueryRequest(systemCliSkillsStatusQuerySchema),
      response: jsonResponse<SystemCliSkillsStatusResponse>(),
    }),
    installCliSkills: defineRoute({
      path: "/system/cli-skills/install",
      method: "post",
      request: jsonRequest(systemInstallCliSkillsRequestSchema),
      response: jsonResponse<SystemInstallCliSkillsResponse>(),
    }),
    executionOptions: defineRoute({
      path: "/system/execution-options",
      method: "get",
      request: optionalQueryRequest(systemExecutionOptionsQuerySchema),
      response: jsonResponse<SystemExecutionOptionsResponse>(),
    }),
    environmentProviders: defineRoute({
      path: "/system/environment-providers",
      method: "get",
      request: optionalQueryRequest(systemEnvironmentProvidersQuerySchema),
      response: jsonResponse<SystemEnvironmentProvidersResponse>(),
    }),
    machineProviders: defineRoute({
      path: "/system/machine-providers",
      method: "get",
      request: noRequest(),
      response: jsonResponse<SystemMachineProvidersResponse>(),
    }),
    providers: defineRoute({
      path: "/system/providers",
      method: "get",
      request: optionalQueryRequest(systemProvidersQuerySchema),
      response: jsonResponse<SystemProviderInfo[]>(),
    }),
    providerCatalog: defineRoute({
      path: "/system/providers/catalog",
      method: "get",
      request: noRequest(),
      response: jsonResponse<SystemProviderCatalogEntry[]>(),
    }),
    providerEnabled: defineRoute({
      path: "/system/providers/:id/enabled",
      method: "put",
      request: jsonRequest(systemProviderEnabledRequestSchema),
      response: jsonResponse<SystemProviderCatalogEntry[]>(),
    }),
    providerLogo: defineRoute({
      path: "/system/providers/:id/logo",
      method: "get",
      request: noRequest(),
      response: binaryResponse<Uint8Array>(),
    }),
    providerStates: defineRoute({
      path: "/system/providers/state",
      method: "get",
      request: optionalQueryRequest(systemProvidersQuerySchema),
      response: jsonResponse<SystemProviderStatesResponse>(),
    }),
    usageLimits: defineRoute({
      path: "/system/usage-limits",
      method: "get",
      request: optionalQueryRequest(systemUsageLimitsQuerySchema),
      response: jsonResponse<ProviderUsageResponse>(),
    }),
    voiceTranscription: defineRoute({
      path: "/system/voice-transcription",
      method: "post",
      request: formRequest<SystemVoiceTranscriptionForm>(),
      response: jsonResponse<SystemVoiceTranscriptionResponse>(),
    }),
    version: defineRoute({
      path: "/system/version",
      method: "get",
      request: optionalQueryRequest(systemVersionQuerySchema),
      response: jsonResponse<SystemVersionResponse>(),
    }),
    appUpdate: defineRoute({
      path: "/system/app-update",
      method: "get",
      request: optionalQueryRequest(systemAppUpdateQuerySchema),
      response: jsonResponse<SystemAppUpdateStatus>(),
    }),
    applyAppUpdate: defineRoute({
      path: "/system/app-update/apply",
      method: "post",
      request: jsonRequest(systemAppUpdateApplyRequestSchema),
      response: jsonResponse<SystemAppUpdateStatus>(),
    }),
    acknowledgeAppUpdate: defineRoute({
      path: "/system/app-update/acknowledge",
      method: "post",
      request: jsonRequest(systemAppUpdateAcknowledgeRequestSchema),
      response: jsonResponse<SystemAppUpdateStatus>(),
    }),
    scheduleAppUpdate: defineRoute({
      path: "/system/app-update/schedule",
      method: "post",
      request: noRequest(),
      response: jsonResponse<SystemAppUpdateStatus>(),
    }),
    cancelScheduledAppUpdate: defineRoute({
      path: "/system/app-update/schedule/cancel",
      method: "post",
      request: noRequest(),
      response: jsonResponse<SystemAppUpdateStatus>(),
    }),
    setAppUpdateAuto: defineRoute({
      path: "/system/app-update/auto",
      method: "post",
      request: jsonRequest(systemAppUpdateAutoRequestSchema),
      response: jsonResponse<SystemAppUpdateStatus>(),
    }),
    cliCommand: defineRoute({
      path: "/system/cli-command",
      method: "get",
      request: noRequest(),
      response: jsonResponse<SystemCliCommandStatus>(),
    }),
    installCliCommand: defineRoute({
      path: "/system/cli-command/install",
      method: "post",
      request: noRequest(),
      response: jsonResponse<SystemCliCommandStatus>(),
    }),
    removeCliCommand: defineRoute({
      path: "/system/cli-command/remove",
      method: "post",
      request: noRequest(),
      response: jsonResponse<SystemCliCommandStatus>(),
    }),
  },
};

export type PublicApiSchema = ApiSchemaFromRouteDescriptors<
  typeof publicApiRoutes
>;

export type PublicApiRoutes = Hono<{}, PublicApiSchema, "/">;
