import type { ThreadOriginKind } from "@bb/domain";

/**
 * Mobile query key factory. Names mirror apps/app/src/hooks/queries/query-keys.ts
 * so cache invalidation semantics stay recognizable across clients. Keys are
 * not server-scoped: each server profile owns its own QueryClient. Later
 * phases add keys here as the hooks land.
 */
const SYSTEM_CONFIG_QUERY_KEY = "systemConfig";
const SYSTEM_VERSION_QUERY_KEY = "systemVersion";
const SYSTEM_PROVIDERS_QUERY_KEY = "systemProviders";
export const SYSTEM_EXECUTION_OPTIONS_QUERY_KEY = "systemExecutionOptions";
export const SIDEBAR_NAVIGATION_QUERY_KEY = "sidebarNavigation";
const PROJECTS_QUERY_KEY = "projects";
const PROJECT_PATHS_QUERY_KEY = "projectPaths";
const PROJECT_SOURCE_BRANCHES_QUERY_KEY = "projectSourceBranches";
const PROJECT_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY =
  "projectDefaultExecutionOptions";
export const THREADS_QUERY_KEY = "threads";
const THREAD_SEARCH_QUERY_KEY = "threadSearch";
export const THREAD_QUERY_KEY = "thread";
const THREAD_DETAIL_BOOTSTRAP_QUERY_KEY = "threadDetailBootstrap";
const THREAD_TIMELINE_QUERY_KEY = "threadTimeline";
const THREAD_TIMELINE_TURN_SUMMARY_DETAILS_QUERY_KEY =
  "threadTimelineTurnSummaryDetails";
const THREAD_PENDING_INTERACTIONS_QUERY_KEY = "threadPendingInteractions";
const THREAD_QUEUED_MESSAGES_QUERY_KEY = "threadQueuedMessages";
const THREAD_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY =
  "threadDefaultExecutionOptions";
const ENVIRONMENTS_QUERY_KEY = "environments";
const ENVIRONMENT_QUERY_KEY = "environment";
const ENVIRONMENT_WORK_STATUS_QUERY_KEY = "environmentWorkStatus";
const ENVIRONMENT_PULL_REQUEST_QUERY_KEY = "environmentPullRequest";
const ENVIRONMENT_MERGE_BASE_BRANCHES_QUERY_KEY =
  "environmentMergeBaseBranches";
const HOSTS_QUERY_KEY = "hosts";
const HOST_QUERY_KEY = "host";
const HOST_DIRECTORY_QUERY_KEY = "hostDirectory";
const HOST_CLONE_DEFAULT_PATH_QUERY_KEY = "hostCloneDefaultPath";

/** Second key segment of the paginated archived thread list. */
export const ARCHIVED_THREADS_LIST_KIND = "archivedList";

interface SystemProvidersQueryKeyArgs {
  environmentId?: string | null;
  hostId?: string | null;
}

interface SystemExecutionOptionsQueryKeyArgs {
  environmentId: string | null;
  hostId: string | null;
  providerId: string | null;
}

export interface ThreadListQueryFilters {
  projectId?: string;
  hasParent?: boolean;
  parentThreadId?: string;
  sourceThreadId?: string;
  originKind?: ThreadOriginKind;
  archived: boolean;
  limit?: number;
}

interface ThreadSearchQueryFilters {
  query: string;
  limitPerGroup: number;
}

export type ArchivedThreadsKindFilter = "all" | "root" | "child";

interface ArchivedThreadsListFilters {
  projectId?: string;
  kind?: ArchivedThreadsKindFilter;
}

type SystemConfigQueryKey = readonly [typeof SYSTEM_CONFIG_QUERY_KEY];
type SystemVersionQueryKey = readonly [typeof SYSTEM_VERSION_QUERY_KEY];
type SystemProvidersQueryKey = readonly [
  typeof SYSTEM_PROVIDERS_QUERY_KEY,
  string | null,
  string | null,
];
type SystemExecutionOptionsQueryKey = readonly [
  typeof SYSTEM_EXECUTION_OPTIONS_QUERY_KEY,
  string | null,
  string | null,
  string | null,
];
type SidebarNavigationQueryKey = readonly [typeof SIDEBAR_NAVIGATION_QUERY_KEY];
type ProjectsQueryKey = readonly [typeof PROJECTS_QUERY_KEY];
type ProjectPathsQueryKey = readonly [
  typeof PROJECT_PATHS_QUERY_KEY,
  string,
  string | null,
  string | null,
  string,
  number,
  boolean,
  boolean,
];
type ProjectPathsQueryKeyPrefix = readonly [
  typeof PROJECT_PATHS_QUERY_KEY,
  string,
];
type ProjectSourceBranchesQueryKey = readonly [
  typeof PROJECT_SOURCE_BRANCHES_QUERY_KEY,
  string,
  string,
  string,
  number,
  string,
];
type ProjectSourceBranchesQueryKeyPrefix = readonly [
  typeof PROJECT_SOURCE_BRANCHES_QUERY_KEY,
  string,
];
type ProjectDefaultExecutionOptionsQueryKey = readonly [
  typeof PROJECT_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY,
  string,
];
type ThreadsQueryKey = readonly [typeof THREADS_QUERY_KEY];
type ThreadListQueryKey = readonly [
  typeof THREADS_QUERY_KEY,
  ThreadListQueryFilters,
];
type ArchivedThreadsListQueryKey = readonly [
  typeof THREADS_QUERY_KEY,
  typeof ARCHIVED_THREADS_LIST_KIND,
  ArchivedThreadsListFilters,
];
type ThreadSearchQueryKey = readonly [
  typeof THREAD_SEARCH_QUERY_KEY,
  ThreadSearchQueryFilters,
];
type ThreadSearchQueryKeyPrefix = readonly [typeof THREAD_SEARCH_QUERY_KEY];
type ThreadQueryKey = readonly [typeof THREAD_QUERY_KEY, string];
type ThreadDetailBootstrapQueryKey = readonly [
  typeof THREAD_DETAIL_BOOTSTRAP_QUERY_KEY,
  string,
];
type ThreadTimelineQueryKey = readonly [
  typeof THREAD_TIMELINE_QUERY_KEY,
  string,
];
/** Identity of one lazily loaded completed-turn detail window. */
export interface ThreadTimelineTurnSummaryDetailsQueryIdentity {
  sourceSeqEnd: number;
  sourceSeqStart: number;
  threadId: string;
  turnId: string;
}
type ThreadTimelineTurnSummaryDetailsQueryKey = readonly [
  typeof THREAD_TIMELINE_TURN_SUMMARY_DETAILS_QUERY_KEY,
  string,
  string,
  number,
  number,
];
type ThreadTimelineTurnSummaryDetailsQueryKeyPrefix = readonly [
  typeof THREAD_TIMELINE_TURN_SUMMARY_DETAILS_QUERY_KEY,
  string,
];
type ThreadPendingInteractionsQueryKey = readonly [
  typeof THREAD_PENDING_INTERACTIONS_QUERY_KEY,
  string,
];
type ThreadQueuedMessagesQueryKey = readonly [
  typeof THREAD_QUEUED_MESSAGES_QUERY_KEY,
  string,
];
type ThreadDefaultExecutionOptionsQueryKey = readonly [
  typeof THREAD_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY,
  string,
];
type EnvironmentsQueryKey = readonly [typeof ENVIRONMENTS_QUERY_KEY];
type EnvironmentQueryKey = readonly [typeof ENVIRONMENT_QUERY_KEY, string];
/** `[key, environmentId, mergeBaseBranch | null]`. */
type EnvironmentWorkStatusQueryKey = readonly [
  typeof ENVIRONMENT_WORK_STATUS_QUERY_KEY,
  string,
  string | null,
];
type EnvironmentWorkStatusQueryKeyPrefix = readonly [
  typeof ENVIRONMENT_WORK_STATUS_QUERY_KEY,
  string,
];
type EnvironmentPullRequestQueryKey = readonly [
  typeof ENVIRONMENT_PULL_REQUEST_QUERY_KEY,
  string,
];
/** `[key, environmentId, query, limit, selectedBranch]`. */
type EnvironmentMergeBaseBranchesQueryKey = readonly [
  typeof ENVIRONMENT_MERGE_BASE_BRANCHES_QUERY_KEY,
  string,
  string,
  number,
  string,
];
type EnvironmentMergeBaseBranchesQueryKeyPrefix = readonly [
  typeof ENVIRONMENT_MERGE_BASE_BRANCHES_QUERY_KEY,
  string,
];
type HostsQueryKey = readonly [typeof HOSTS_QUERY_KEY];
type HostQueryKey = readonly [typeof HOST_QUERY_KEY, string];
type HostDirectoryQueryKey = readonly [
  typeof HOST_DIRECTORY_QUERY_KEY,
  string | null,
  string | null,
];
type HostCloneDefaultPathQueryKey = readonly [
  typeof HOST_CLONE_DEFAULT_PATH_QUERY_KEY,
  string | null,
  string | null,
];

export function systemConfigQueryKey(): SystemConfigQueryKey {
  return [SYSTEM_CONFIG_QUERY_KEY];
}

export function systemVersionQueryKey(): SystemVersionQueryKey {
  return [SYSTEM_VERSION_QUERY_KEY];
}

export function systemProvidersQueryKey(
  args: SystemProvidersQueryKeyArgs = {},
): SystemProvidersQueryKey {
  return [
    SYSTEM_PROVIDERS_QUERY_KEY,
    args.environmentId ?? null,
    args.hostId ?? null,
  ];
}

export function allSystemProvidersQueryKeyPrefix(): readonly [
  typeof SYSTEM_PROVIDERS_QUERY_KEY,
] {
  return [SYSTEM_PROVIDERS_QUERY_KEY];
}

export function systemExecutionOptionsQueryKey({
  environmentId,
  hostId,
  providerId,
}: SystemExecutionOptionsQueryKeyArgs): SystemExecutionOptionsQueryKey {
  return [
    SYSTEM_EXECUTION_OPTIONS_QUERY_KEY,
    environmentId,
    hostId,
    providerId,
  ];
}

export function allSystemExecutionOptionsQueryKeyPrefix(): readonly [
  typeof SYSTEM_EXECUTION_OPTIONS_QUERY_KEY,
] {
  return [SYSTEM_EXECUTION_OPTIONS_QUERY_KEY];
}

export function sidebarNavigationQueryKey(): SidebarNavigationQueryKey {
  return [SIDEBAR_NAVIGATION_QUERY_KEY];
}

export function projectsQueryKey(): ProjectsQueryKey {
  return [PROJECTS_QUERY_KEY];
}

export function projectPathsQueryKey(
  projectId: string,
  environmentId: string | null,
  hostId: string | null,
  query: string,
  limit: number,
  includeFiles: boolean,
  includeDirectories: boolean,
): ProjectPathsQueryKey {
  return [
    PROJECT_PATHS_QUERY_KEY,
    projectId,
    environmentId,
    hostId,
    query,
    limit,
    includeFiles,
    includeDirectories,
  ];
}

export function projectPathsQueryKeyPrefix(
  projectId: string,
): ProjectPathsQueryKeyPrefix {
  return [PROJECT_PATHS_QUERY_KEY, projectId];
}

export function allProjectPathsQueryKeyPrefix(): readonly [
  typeof PROJECT_PATHS_QUERY_KEY,
] {
  return [PROJECT_PATHS_QUERY_KEY];
}

export function projectSourceBranchesQueryKey(
  projectId: string,
  hostId: string,
  query = "",
  limit = 50,
  selectedBranch = "",
): ProjectSourceBranchesQueryKey {
  return [
    PROJECT_SOURCE_BRANCHES_QUERY_KEY,
    projectId,
    hostId,
    query,
    limit,
    selectedBranch,
  ];
}

export function projectSourceBranchesQueryKeyPrefix(
  projectId: string,
): ProjectSourceBranchesQueryKeyPrefix {
  return [PROJECT_SOURCE_BRANCHES_QUERY_KEY, projectId];
}

export function allProjectSourceBranchesQueryKeyPrefix(): readonly [
  typeof PROJECT_SOURCE_BRANCHES_QUERY_KEY,
] {
  return [PROJECT_SOURCE_BRANCHES_QUERY_KEY];
}

export function projectDefaultExecutionOptionsQueryKey(
  projectId: string,
): ProjectDefaultExecutionOptionsQueryKey {
  return [PROJECT_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY, projectId];
}

export function allProjectDefaultExecutionOptionsQueryKeyPrefix(): readonly [
  typeof PROJECT_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY,
] {
  return [PROJECT_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY];
}

/** Prefix of every thread list variant. */
export function threadsQueryKey(): ThreadsQueryKey {
  return [THREADS_QUERY_KEY];
}

export function threadListQueryKey(
  filters: ThreadListQueryFilters,
): ThreadListQueryKey {
  return [THREADS_QUERY_KEY, filters];
}

export function archivedThreadsListQueryKey(
  filters: ArchivedThreadsListFilters,
): ArchivedThreadsListQueryKey {
  return [THREADS_QUERY_KEY, ARCHIVED_THREADS_LIST_KIND, filters];
}

export function threadSearchQueryKey(
  filters: ThreadSearchQueryFilters,
): ThreadSearchQueryKey {
  return [THREAD_SEARCH_QUERY_KEY, filters];
}

export function threadSearchQueryKeyPrefix(): ThreadSearchQueryKeyPrefix {
  return [THREAD_SEARCH_QUERY_KEY];
}

export function threadQueryKey(threadId: string): ThreadQueryKey {
  return [THREAD_QUERY_KEY, threadId];
}

export function allThreadQueryKeyPrefix(): readonly [typeof THREAD_QUERY_KEY] {
  return [THREAD_QUERY_KEY];
}

export function threadDetailBootstrapQueryKey(
  threadId: string,
): ThreadDetailBootstrapQueryKey {
  return [THREAD_DETAIL_BOOTSTRAP_QUERY_KEY, threadId];
}

export function threadTimelineQueryKey(
  threadId: string,
): ThreadTimelineQueryKey {
  return [THREAD_TIMELINE_QUERY_KEY, threadId];
}

export function threadTimelineTurnSummaryDetailsQueryKey({
  sourceSeqEnd,
  sourceSeqStart,
  threadId,
  turnId,
}: ThreadTimelineTurnSummaryDetailsQueryIdentity): ThreadTimelineTurnSummaryDetailsQueryKey {
  return [
    THREAD_TIMELINE_TURN_SUMMARY_DETAILS_QUERY_KEY,
    threadId,
    turnId,
    sourceSeqStart,
    sourceSeqEnd,
  ];
}

/** Every cached turn-detail window of one thread (history rewrites). */
export function threadTimelineTurnSummaryDetailsQueryKeyPrefix(
  threadId: string,
): ThreadTimelineTurnSummaryDetailsQueryKeyPrefix {
  return [THREAD_TIMELINE_TURN_SUMMARY_DETAILS_QUERY_KEY, threadId];
}

export function threadPendingInteractionsQueryKey(
  threadId: string,
): ThreadPendingInteractionsQueryKey {
  return [THREAD_PENDING_INTERACTIONS_QUERY_KEY, threadId];
}

export function threadQueuedMessagesQueryKey(
  threadId: string,
): ThreadQueuedMessagesQueryKey {
  return [THREAD_QUEUED_MESSAGES_QUERY_KEY, threadId];
}

/** `GET /threads/:id/default-execution-options` (the follow-up composer's defaults). */
export function threadDefaultExecutionOptionsQueryKey(
  threadId: string,
): ThreadDefaultExecutionOptionsQueryKey {
  return [THREAD_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY, threadId];
}

export function environmentsQueryKey(): EnvironmentsQueryKey {
  return [ENVIRONMENTS_QUERY_KEY];
}

export function environmentQueryKey(
  environmentId: string,
): EnvironmentQueryKey {
  return [ENVIRONMENT_QUERY_KEY, environmentId];
}

export function allEnvironmentQueryKeyPrefix(): readonly [
  typeof ENVIRONMENT_QUERY_KEY,
] {
  return [ENVIRONMENT_QUERY_KEY];
}

export function environmentWorkStatusQueryKey(
  environmentId: string,
  mergeBaseBranch: string | null,
): EnvironmentWorkStatusQueryKey {
  return [ENVIRONMENT_WORK_STATUS_QUERY_KEY, environmentId, mergeBaseBranch];
}

/** Every merge-base variant of one environment's work status. */
export function environmentWorkStatusQueryKeyPrefix(
  environmentId: string,
): EnvironmentWorkStatusQueryKeyPrefix {
  return [ENVIRONMENT_WORK_STATUS_QUERY_KEY, environmentId];
}

export function allEnvironmentWorkStatusQueryKeyPrefix(): readonly [
  typeof ENVIRONMENT_WORK_STATUS_QUERY_KEY,
] {
  return [ENVIRONMENT_WORK_STATUS_QUERY_KEY];
}

export function environmentPullRequestQueryKey(
  environmentId: string,
): EnvironmentPullRequestQueryKey {
  return [ENVIRONMENT_PULL_REQUEST_QUERY_KEY, environmentId];
}

export function allEnvironmentPullRequestQueryKeyPrefix(): readonly [
  typeof ENVIRONMENT_PULL_REQUEST_QUERY_KEY,
] {
  return [ENVIRONMENT_PULL_REQUEST_QUERY_KEY];
}

export function environmentMergeBaseBranchesQueryKey(
  environmentId: string,
  query: string,
  limit: number,
  selectedBranch: string,
): EnvironmentMergeBaseBranchesQueryKey {
  return [
    ENVIRONMENT_MERGE_BASE_BRANCHES_QUERY_KEY,
    environmentId,
    query,
    limit,
    selectedBranch,
  ];
}

export function environmentMergeBaseBranchesQueryKeyPrefix(
  environmentId: string,
): EnvironmentMergeBaseBranchesQueryKeyPrefix {
  return [ENVIRONMENT_MERGE_BASE_BRANCHES_QUERY_KEY, environmentId];
}

export function allEnvironmentMergeBaseBranchesQueryKeyPrefix(): readonly [
  typeof ENVIRONMENT_MERGE_BASE_BRANCHES_QUERY_KEY,
] {
  return [ENVIRONMENT_MERGE_BASE_BRANCHES_QUERY_KEY];
}

export function hostsQueryKey(): HostsQueryKey {
  return [HOSTS_QUERY_KEY];
}

export function hostQueryKey(hostId: string): HostQueryKey {
  return [HOST_QUERY_KEY, hostId];
}

export function allHostQueryKeyPrefix(): readonly [typeof HOST_QUERY_KEY] {
  return [HOST_QUERY_KEY];
}

export function hostDirectoryQueryKey(
  hostId: string | null,
  path: string | null,
): HostDirectoryQueryKey {
  return [HOST_DIRECTORY_QUERY_KEY, hostId, path];
}

export function allHostDirectoryQueryKeyPrefix(): readonly [
  typeof HOST_DIRECTORY_QUERY_KEY,
] {
  return [HOST_DIRECTORY_QUERY_KEY];
}

export function hostCloneDefaultPathQueryKey(
  hostId: string | null,
  projectId: string | null,
): HostCloneDefaultPathQueryKey {
  return [HOST_CLONE_DEFAULT_PATH_QUERY_KEY, hostId, projectId];
}

export function allHostCloneDefaultPathQueryKeyPrefix(): readonly [
  typeof HOST_CLONE_DEFAULT_PATH_QUERY_KEY,
] {
  return [HOST_CLONE_DEFAULT_PATH_QUERY_KEY];
}

// --- Composer typeahead (Phase 4b) -------------------------------------------

const PLUGIN_CONTRIBUTIONS_QUERY_KEY = "pluginContributions";
const PLUGIN_MENTION_SEARCH_QUERY_KEY = "pluginMentionSearch";
const ENVIRONMENT_PATHS_QUERY_KEY = "environmentPaths";
const THREAD_STORAGE_PATHS_QUERY_KEY = "threadStoragePaths";
const PROJECT_COMMANDS_QUERY_KEY = "projectCommands";

type PluginContributionsQueryKey = readonly [
  typeof PLUGIN_CONTRIBUTIONS_QUERY_KEY,
];
/** `[key, trigger, query, projectId | null, threadId | null]`. */
type PluginMentionSearchQueryKey = readonly [
  typeof PLUGIN_MENTION_SEARCH_QUERY_KEY,
  string,
  string,
  string | null,
  string | null,
];
/** `[key, environmentId, query, limit, includeFiles, includeDirectories]`. */
type EnvironmentPathsQueryKey = readonly [
  typeof ENVIRONMENT_PATHS_QUERY_KEY,
  string,
  string,
  number,
  boolean,
  boolean,
];
type EnvironmentPathsQueryKeyPrefix = readonly [
  typeof ENVIRONMENT_PATHS_QUERY_KEY,
  string,
];
/** `[key, threadId, query, limit, includeFiles, includeDirectories]`. */
type ThreadStoragePathsQueryKey = readonly [
  typeof THREAD_STORAGE_PATHS_QUERY_KEY,
  string,
  string,
  number,
  boolean,
  boolean,
];
/** `[key, projectId, providerId, environmentId | null, hostId | null]`. */
type ProjectCommandsQueryKey = readonly [
  typeof PROJECT_COMMANDS_QUERY_KEY,
  string,
  string,
  string | null,
  string | null,
];

export function pluginContributionsQueryKey(): PluginContributionsQueryKey {
  return [PLUGIN_CONTRIBUTIONS_QUERY_KEY];
}

export function pluginMentionSearchQueryKey(
  trigger: string,
  query: string,
  projectId: string | null,
  threadId: string | null,
): PluginMentionSearchQueryKey {
  return [PLUGIN_MENTION_SEARCH_QUERY_KEY, trigger, query, projectId, threadId];
}

export function allPluginMentionSearchQueryKeyPrefix(): readonly [
  typeof PLUGIN_MENTION_SEARCH_QUERY_KEY,
] {
  return [PLUGIN_MENTION_SEARCH_QUERY_KEY];
}

export function environmentPathsQueryKey(
  environmentId: string,
  query: string,
  limit: number,
  includeFiles: boolean,
  includeDirectories: boolean,
): EnvironmentPathsQueryKey {
  return [
    ENVIRONMENT_PATHS_QUERY_KEY,
    environmentId,
    query,
    limit,
    includeFiles,
    includeDirectories,
  ];
}

export function environmentPathsQueryKeyPrefix(
  environmentId: string,
): EnvironmentPathsQueryKeyPrefix {
  return [ENVIRONMENT_PATHS_QUERY_KEY, environmentId];
}

export function threadStoragePathsQueryKey(
  threadId: string,
  query: string,
  limit: number,
  includeFiles: boolean,
  includeDirectories: boolean,
): ThreadStoragePathsQueryKey {
  return [
    THREAD_STORAGE_PATHS_QUERY_KEY,
    threadId,
    query,
    limit,
    includeFiles,
    includeDirectories,
  ];
}

export function allThreadStoragePathsQueryKeyPrefix(): readonly [
  typeof THREAD_STORAGE_PATHS_QUERY_KEY,
] {
  return [THREAD_STORAGE_PATHS_QUERY_KEY];
}

export function projectCommandsQueryKey(
  projectId: string,
  providerId: string,
  environmentId: string | null,
  hostId: string | null,
): ProjectCommandsQueryKey {
  return [
    PROJECT_COMMANDS_QUERY_KEY,
    projectId,
    providerId,
    environmentId,
    hostId,
  ];
}

export function allProjectCommandsQueryKeyPrefix(): readonly [
  typeof PROJECT_COMMANDS_QUERY_KEY,
] {
  return [PROJECT_COMMANDS_QUERY_KEY];
}

// --- Workspace panel: thread tabs (Phase 6) --------------------------------

const THREAD_TABS_QUERY_KEY = "threadTabs";

/** `GET /threads/:id/tabs` (the server-synced panel tab strip). */
type ThreadTabsQueryKey = readonly [typeof THREAD_TABS_QUERY_KEY, string];

export function threadTabsQueryKey(threadId: string): ThreadTabsQueryKey {
  return [THREAD_TABS_QUERY_KEY, threadId];
}

// --- Diff tab (Phase 6) --------------------------------------------------------

const ENVIRONMENT_DIFF_FILES_QUERY_KEY = "environmentDiffFiles";
const ENVIRONMENT_DIFF_PATCH_QUERY_KEY = "environmentDiffPatch";

/** `[key, environmentId, targetType | null, targetKey | null]`. */
type EnvironmentDiffFilesQueryKey = readonly [
  typeof ENVIRONMENT_DIFF_FILES_QUERY_KEY,
  string,
  string | null,
  string | null,
];
type EnvironmentDiffFilesQueryKeyPrefix = readonly [
  typeof ENVIRONMENT_DIFF_FILES_QUERY_KEY,
  string,
];
/** `[key, environmentId, targetType | null, targetKey | null, path]`. */
type EnvironmentDiffPatchQueryKey = readonly [
  typeof ENVIRONMENT_DIFF_PATCH_QUERY_KEY,
  string,
  string | null,
  string | null,
  string,
];
type EnvironmentDiffPatchQueryKeyPrefix = readonly [
  typeof ENVIRONMENT_DIFF_PATCH_QUERY_KEY,
  string,
];

export function environmentDiffFilesQueryKey(
  environmentId: string,
  targetType: string | null,
  targetKey: string | null,
): EnvironmentDiffFilesQueryKey {
  return [
    ENVIRONMENT_DIFF_FILES_QUERY_KEY,
    environmentId,
    targetType,
    targetKey,
  ];
}

export function environmentDiffFilesQueryKeyPrefix(
  environmentId: string,
): EnvironmentDiffFilesQueryKeyPrefix {
  return [ENVIRONMENT_DIFF_FILES_QUERY_KEY, environmentId];
}

export function allEnvironmentDiffFilesQueryKeyPrefix(): readonly [
  typeof ENVIRONMENT_DIFF_FILES_QUERY_KEY,
] {
  return [ENVIRONMENT_DIFF_FILES_QUERY_KEY];
}

export function environmentDiffPatchQueryKey(
  environmentId: string,
  targetType: string | null,
  targetKey: string | null,
  path: string,
): EnvironmentDiffPatchQueryKey {
  return [
    ENVIRONMENT_DIFF_PATCH_QUERY_KEY,
    environmentId,
    targetType,
    targetKey,
    path,
  ];
}

export function environmentDiffPatchQueryKeyPrefix(
  environmentId: string,
): EnvironmentDiffPatchQueryKeyPrefix {
  return [ENVIRONMENT_DIFF_PATCH_QUERY_KEY, environmentId];
}

// --- Files: storage browser + file previews (Phase 6) --------------------------

const THREAD_STORAGE_FILES_QUERY_KEY = "threadStorageFiles";
const ENVIRONMENT_FILE_PREVIEW_QUERY_KEY = "environmentFilePreview";
const THREAD_STORAGE_FILE_PREVIEW_QUERY_KEY = "threadStorageFilePreview";
const THREAD_HOST_FILE_PREVIEW_QUERY_KEY = "threadHostFilePreview";
const PROJECT_FILE_PREVIEW_QUERY_KEY = "projectFilePreview";

/** `[key, threadId, query, limit]` — the flat storage file list. */
type ThreadStorageFilesQueryKey = readonly [
  typeof THREAD_STORAGE_FILES_QUERY_KEY,
  string,
  string,
  number,
];
/** `[key, environmentId, path, sourceKey]` — a workspace file read through `/diff/file`. */
type EnvironmentFilePreviewQueryKey = readonly [
  typeof ENVIRONMENT_FILE_PREVIEW_QUERY_KEY,
  string,
  string,
  string,
];
type EnvironmentFilePreviewQueryKeyPrefix = readonly [
  typeof ENVIRONMENT_FILE_PREVIEW_QUERY_KEY,
  string,
];
/** `[key, threadId, path]`. */
type ThreadStorageFilePreviewQueryKey = readonly [
  typeof THREAD_STORAGE_FILE_PREVIEW_QUERY_KEY,
  string,
  string,
];
/** `[key, threadId, path]` — an absolute path on the thread's host. */
type ThreadHostFilePreviewQueryKey = readonly [
  typeof THREAD_HOST_FILE_PREVIEW_QUERY_KEY,
  string,
  string,
];
/** `[key, projectId, environmentId | null, hostId | null, path]`. */
type ProjectFilePreviewQueryKey = readonly [
  typeof PROJECT_FILE_PREVIEW_QUERY_KEY,
  string,
  string | null,
  string | null,
  string,
];
type ProjectFilePreviewQueryKeyPrefix = readonly [
  typeof PROJECT_FILE_PREVIEW_QUERY_KEY,
  string,
];

export function threadStorageFilesQueryKey(
  threadId: string,
  query: string,
  limit: number,
): ThreadStorageFilesQueryKey {
  return [THREAD_STORAGE_FILES_QUERY_KEY, threadId, query, limit];
}

export function allThreadStorageFilesQueryKeyPrefix(): readonly [
  typeof THREAD_STORAGE_FILES_QUERY_KEY,
] {
  return [THREAD_STORAGE_FILES_QUERY_KEY];
}

export function environmentFilePreviewQueryKey(
  environmentId: string,
  path: string,
  sourceKey: string,
): EnvironmentFilePreviewQueryKey {
  return [ENVIRONMENT_FILE_PREVIEW_QUERY_KEY, environmentId, path, sourceKey];
}

export function environmentFilePreviewQueryKeyPrefix(
  environmentId: string,
): EnvironmentFilePreviewQueryKeyPrefix {
  return [ENVIRONMENT_FILE_PREVIEW_QUERY_KEY, environmentId];
}

export function threadStorageFilePreviewQueryKey(
  threadId: string,
  path: string,
): ThreadStorageFilePreviewQueryKey {
  return [THREAD_STORAGE_FILE_PREVIEW_QUERY_KEY, threadId, path];
}

export function allThreadStorageFilePreviewQueryKeyPrefix(): readonly [
  typeof THREAD_STORAGE_FILE_PREVIEW_QUERY_KEY,
] {
  return [THREAD_STORAGE_FILE_PREVIEW_QUERY_KEY];
}

export function threadHostFilePreviewQueryKey(
  threadId: string,
  path: string,
): ThreadHostFilePreviewQueryKey {
  return [THREAD_HOST_FILE_PREVIEW_QUERY_KEY, threadId, path];
}

export function projectFilePreviewQueryKey(
  projectId: string,
  environmentId: string | null,
  hostId: string | null,
  path: string,
): ProjectFilePreviewQueryKey {
  return [
    PROJECT_FILE_PREVIEW_QUERY_KEY,
    projectId,
    environmentId,
    hostId,
    path,
  ];
}

export function projectFilePreviewQueryKeyPrefix(
  projectId: string,
): ProjectFilePreviewQueryKeyPrefix {
  return [PROJECT_FILE_PREVIEW_QUERY_KEY, projectId];
}

export function allProjectFilePreviewQueryKeyPrefix(): readonly [
  typeof PROJECT_FILE_PREVIEW_QUERY_KEY,
] {
  return [PROJECT_FILE_PREVIEW_QUERY_KEY];
}

// --- Terminals (Phase 6) ------------------------------------------------------

const TERMINALS_QUERY_KEY = "terminals";
const TERMINAL_SESSION_QUERY_KEY = "terminalSession";

/** What a terminal list is scoped to (mirrors the web `TerminalQueryScope`). */
export type TerminalQueryScope =
  | { kind: "thread"; threadId: string }
  | { kind: "environment"; environmentId: string }
  | { kind: "host_path"; cwd?: string; hostId: string };

/** `[key, scope]`: `GET /terminals?threadId|environmentId|hostId`. */
type TerminalsQueryKey = readonly [
  typeof TERMINALS_QUERY_KEY,
  TerminalQueryScope,
];
/** `[key, terminalId]`: `GET /terminals/:id` (one attached session). */
type TerminalSessionQueryKey = readonly [
  typeof TERMINAL_SESSION_QUERY_KEY,
  string,
];

export function terminalsQueryKey(
  scope: TerminalQueryScope,
): TerminalsQueryKey {
  return [TERMINALS_QUERY_KEY, scope];
}

export function allTerminalsQueryKeyPrefix(): readonly [
  typeof TERMINALS_QUERY_KEY,
] {
  return [TERMINALS_QUERY_KEY];
}

export function terminalSessionQueryKey(
  terminalId: string,
): TerminalSessionQueryKey {
  return [TERMINAL_SESSION_QUERY_KEY, terminalId];
}

export function allTerminalSessionQueryKeyPrefix(): readonly [
  typeof TERMINAL_SESSION_QUERY_KEY,
] {
  return [TERMINAL_SESSION_QUERY_KEY];
}

// --- Plugins, marketplaces, skills (Phase 7) -----------------------------------

const PLUGINS_QUERY_KEY = "plugins";
const PLUGIN_SETTINGS_QUERY_KEY = "pluginSettings";
const PLUGIN_UPDATES_QUERY_KEY = "pluginUpdates";
const PLUGIN_LOGS_QUERY_KEY = "pluginLogs";
const PLUGIN_CATALOG_SEARCH_QUERY_KEY = "pluginCatalogSearch";
const PLUGIN_CATALOG_INSTALL_PLAN_QUERY_KEY = "pluginCatalogInstallPlan";
const PLUGIN_MARKETPLACES_QUERY_KEY = "pluginMarketplaces";
const PROJECT_SKILLS_QUERY_KEY = "projectSkills";
const SKILL_FILES_QUERY_KEY = "skillFiles";
const SKILL_CONTENT_QUERY_KEY = "skillContent";
const SKILLS_REGISTRY_QUERY_KEY = "skillsRegistry";
const SKILLS_REGISTRY_ENTRY_QUERY_KEY = "skillsRegistryEntry";
const SKILLS_REGISTRY_DETAIL_QUERY_KEY = "skillsRegistryDetail";

/** `GET /plugins` (every installed plugin). */
type PluginsQueryKey = readonly [typeof PLUGINS_QUERY_KEY];
/** `[key, pluginId]`: `GET /plugins/:id/settings`. */
type PluginSettingsQueryKey = readonly [
  typeof PLUGIN_SETTINGS_QUERY_KEY,
  string,
];
/** `GET /plugins/updates` (the last update check per plugin). */
type PluginUpdatesQueryKey = readonly [typeof PLUGIN_UPDATES_QUERY_KEY];
/** `[key, pluginId, tail]`: `GET /plugins/:id/logs?tail=`. */
type PluginLogsQueryKey = readonly [
  typeof PLUGIN_LOGS_QUERY_KEY,
  string,
  number,
];
type PluginLogsQueryKeyPrefix = readonly [typeof PLUGIN_LOGS_QUERY_KEY, string];
/** `[key, query]`: `GET /plugin-catalog/search?q=`. */
type PluginCatalogSearchQueryKey = readonly [
  typeof PLUGIN_CATALOG_SEARCH_QUERY_KEY,
  string,
];
/** `[key, entryId, marketplace | null]`: `GET /plugin-catalog/install-plan`. */
type PluginCatalogInstallPlanQueryKey = readonly [
  typeof PLUGIN_CATALOG_INSTALL_PLAN_QUERY_KEY,
  string,
  string | null,
];
/** `GET /marketplaces`. */
type PluginMarketplacesQueryKey = readonly [
  typeof PLUGIN_MARKETPLACES_QUERY_KEY,
];
/** `[key, projectId]`: `GET /projects/:id/skills` (default workspace). */
type ProjectSkillsQueryKey = readonly [typeof PROJECT_SKILLS_QUERY_KEY, string];
/** `[key, projectId, skillId]`: `GET /projects/:id/skills/files`. */
type SkillFilesQueryKey = readonly [
  typeof SKILL_FILES_QUERY_KEY,
  string,
  string,
];
/** `[key, projectId, skillId, path]`: `GET /projects/:id/skills/content`. */
type SkillContentQueryKey = readonly [
  typeof SKILL_CONTENT_QUERY_KEY,
  string,
  string,
  string,
];
/**
 * `[key, query, 0]`: `GET /skills-registry?q=&page=` as an infinite query
 * (pages live inside the one cache entry; the trailing 0 is kept so a future
 * single-page read can sit beside it).
 */
type SkillsRegistryQueryKey = readonly [
  typeof SKILLS_REGISTRY_QUERY_KEY,
  string,
  number,
];
/** `[key, registrySkillId]`: `GET /skills-registry/entry?id=`. */
type SkillsRegistryEntryQueryKey = readonly [
  typeof SKILLS_REGISTRY_ENTRY_QUERY_KEY,
  string,
];
/** `[key, source, skillId]`: `GET /skills-registry/detail`. */
type SkillsRegistryDetailQueryKey = readonly [
  typeof SKILLS_REGISTRY_DETAIL_QUERY_KEY,
  string,
  string,
];

export function pluginsQueryKey(): PluginsQueryKey {
  return [PLUGINS_QUERY_KEY];
}

export function pluginSettingsQueryKey(
  pluginId: string,
): PluginSettingsQueryKey {
  return [PLUGIN_SETTINGS_QUERY_KEY, pluginId];
}

export function allPluginSettingsQueryKeyPrefix(): readonly [
  typeof PLUGIN_SETTINGS_QUERY_KEY,
] {
  return [PLUGIN_SETTINGS_QUERY_KEY];
}

export function pluginUpdatesQueryKey(): PluginUpdatesQueryKey {
  return [PLUGIN_UPDATES_QUERY_KEY];
}

export function pluginLogsQueryKey(
  pluginId: string,
  tail: number,
): PluginLogsQueryKey {
  return [PLUGIN_LOGS_QUERY_KEY, pluginId, tail];
}

export function pluginLogsQueryKeyPrefix(
  pluginId: string,
): PluginLogsQueryKeyPrefix {
  return [PLUGIN_LOGS_QUERY_KEY, pluginId];
}

export function pluginCatalogSearchQueryKey(
  query: string,
): PluginCatalogSearchQueryKey {
  return [PLUGIN_CATALOG_SEARCH_QUERY_KEY, query];
}

export function allPluginCatalogSearchQueryKeyPrefix(): readonly [
  typeof PLUGIN_CATALOG_SEARCH_QUERY_KEY,
] {
  return [PLUGIN_CATALOG_SEARCH_QUERY_KEY];
}

export function pluginCatalogInstallPlanQueryKey(
  entryId: string,
  marketplace: string | null,
): PluginCatalogInstallPlanQueryKey {
  return [PLUGIN_CATALOG_INSTALL_PLAN_QUERY_KEY, entryId, marketplace];
}

export function pluginMarketplacesQueryKey(): PluginMarketplacesQueryKey {
  return [PLUGIN_MARKETPLACES_QUERY_KEY];
}

export function projectSkillsQueryKey(
  projectId: string,
): ProjectSkillsQueryKey {
  return [PROJECT_SKILLS_QUERY_KEY, projectId];
}

export function allProjectSkillsQueryKeyPrefix(): readonly [
  typeof PROJECT_SKILLS_QUERY_KEY,
] {
  return [PROJECT_SKILLS_QUERY_KEY];
}

export function skillFilesQueryKey(
  projectId: string,
  skillId: string,
): SkillFilesQueryKey {
  return [SKILL_FILES_QUERY_KEY, projectId, skillId];
}

export function allSkillFilesQueryKeyPrefix(): readonly [
  typeof SKILL_FILES_QUERY_KEY,
] {
  return [SKILL_FILES_QUERY_KEY];
}

export function skillContentQueryKey(
  projectId: string,
  skillId: string,
  path: string,
): SkillContentQueryKey {
  return [SKILL_CONTENT_QUERY_KEY, projectId, skillId, path];
}

export function allSkillContentQueryKeyPrefix(): readonly [
  typeof SKILL_CONTENT_QUERY_KEY,
] {
  return [SKILL_CONTENT_QUERY_KEY];
}

export function skillsRegistryQueryKey(
  query: string,
  page: number,
): SkillsRegistryQueryKey {
  return [SKILLS_REGISTRY_QUERY_KEY, query, page];
}

export function skillsRegistryEntryQueryKey(
  registrySkillId: string,
): SkillsRegistryEntryQueryKey {
  return [SKILLS_REGISTRY_ENTRY_QUERY_KEY, registrySkillId];
}

export function skillsRegistryDetailQueryKey(
  source: string,
  skillId: string,
): SkillsRegistryDetailQueryKey {
  return [SKILLS_REGISTRY_DETAIL_QUERY_KEY, source, skillId];
}

// --- Settings, machines, updates (Phase 7) ------------------------------------

const SYSTEM_USAGE_LIMITS_QUERY_KEY = "systemUsageLimits";
const SYSTEM_CLI_SKILLS_QUERY_KEY = "systemCliSkills";
const HOST_PROVIDER_CLI_STATUS_QUERY_KEY = "hostProviderCliStatus";
const THEME_CATALOG_QUERY_KEY = "themeCatalog";
const SERVER_PROTOCOL_VERSION_QUERY_KEY = "serverProtocolVersion";

/** `[key, hostId]`: `GET /system/usage-limits?hostId=` (null = primary host). */
type SystemUsageLimitsQueryKey = readonly [
  typeof SYSTEM_USAGE_LIMITS_QUERY_KEY,
  string | null,
];
/** `GET /system/cli-skills` (every enrolled machine). */
type SystemCliSkillsQueryKey = readonly [typeof SYSTEM_CLI_SKILLS_QUERY_KEY];
/** `[key, hostId]`: `GET /hosts/:id/provider-clis/status`. */
type HostProviderCliStatusQueryKey = readonly [
  typeof HOST_PROVIDER_CLI_STATUS_QUERY_KEY,
  string,
];
/** `GET /settings/themes`. */
type ThemeCatalogQueryKey = readonly [typeof THEME_CATALOG_QUERY_KEY];
/** `GET /install/version`: the server's host-daemon protocol version. */
type ServerProtocolVersionQueryKey = readonly [
  typeof SERVER_PROTOCOL_VERSION_QUERY_KEY,
];

export function systemUsageLimitsQueryKey(
  hostId: string | null,
): SystemUsageLimitsQueryKey {
  return [SYSTEM_USAGE_LIMITS_QUERY_KEY, hostId];
}

export function allSystemUsageLimitsQueryKeyPrefix(): readonly [
  typeof SYSTEM_USAGE_LIMITS_QUERY_KEY,
] {
  return [SYSTEM_USAGE_LIMITS_QUERY_KEY];
}

export function systemCliSkillsQueryKey(): SystemCliSkillsQueryKey {
  return [SYSTEM_CLI_SKILLS_QUERY_KEY];
}

export function hostProviderCliStatusQueryKey(
  hostId: string,
): HostProviderCliStatusQueryKey {
  return [HOST_PROVIDER_CLI_STATUS_QUERY_KEY, hostId];
}

export function allHostProviderCliStatusQueryKeyPrefix(): readonly [
  typeof HOST_PROVIDER_CLI_STATUS_QUERY_KEY,
] {
  return [HOST_PROVIDER_CLI_STATUS_QUERY_KEY];
}

export function themeCatalogQueryKey(): ThemeCatalogQueryKey {
  return [THEME_CATALOG_QUERY_KEY];
}

export function serverProtocolVersionQueryKey(): ServerProtocolVersionQueryKey {
  return [SERVER_PROTOCOL_VERSION_QUERY_KEY];
}

/**
 * `[key, absoluteUrl]`: a server-served SVG asset read as text (plugin icons
 * `GET /plugins/:id/assets/icon?h=`, provider logos `GET
 * /system/providers/:id/logo`). Hashed / branding assets never change under
 * one URL, so no realtime message invalidates this key.
 */
const SERVER_SVG_ASSET_QUERY_KEY = "serverSvgAsset";
type ServerSvgAssetQueryKey = readonly [
  typeof SERVER_SVG_ASSET_QUERY_KEY,
  string,
];
export function serverSvgAssetQueryKey(url: string): ServerSvgAssetQueryKey {
  return [SERVER_SVG_ASSET_QUERY_KEY, url];
}
