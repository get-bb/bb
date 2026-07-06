import type { WorkspaceDiffTarget } from "@bb/domain";
import type { ThreadListFilters, ThreadSearchFilters } from "@/lib/api";
import type { EnvironmentFilePreviewSource } from "@/lib/file-preview";
import {
  DEFAULT_THREAD_STORAGE_FILE_LIST_OPTIONS,
  type ThreadStorageFileListOptions,
} from "@/lib/thread-storage-files";
import {
  DEFAULT_FILE_ONLY_PATH_LIST_OPTIONS,
  type PathListOptions,
} from "@/lib/path-list-options";

export const HOSTS_QUERY_KEY = "hosts";
export const HOST_QUERY_KEY = "host";
export const HOST_DIRECTORY_QUERY_KEY = "hostDirectory";
export const PROJECTS_QUERY_KEY = "projects";
export const PROJECT_PATHS_QUERY_KEY = "projectPaths";
export const PROJECT_FILE_PREVIEW_QUERY_KEY = "projectFilePreview";
export const PROJECT_SOURCE_BRANCHES_QUERY_KEY = "projectSourceBranches";
export const PROJECT_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY =
  "projectDefaultExecutionOptions";
export const PROJECT_PROMPT_HISTORY_QUERY_KEY = "projectPromptHistory";
export const SIDEBAR_NAVIGATION_QUERY_KEY = "sidebarNavigation";
export const THREADS_QUERY_KEY = "threads";
export const THREAD_SEARCH_QUERY_KEY = "threadSearch";
export const THREADS_DISABLED_QUERY_KEY = "threadsDisabled";
export const THREAD_QUERY_KEY = "thread";
export const THREAD_DETAIL_BOOTSTRAP_QUERY_KEY = "threadDetailBootstrap";
export const THREAD_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY =
  "threadDefaultExecutionOptions";
export const THREAD_QUEUED_MESSAGES_QUERY_KEY = "threadQueuedMessages";
export const THREAD_PROMPT_HISTORY_QUERY_KEY = "threadPromptHistory";
export const THREAD_PENDING_INTERACTIONS_QUERY_KEY =
  "threadPendingInteractions";
export const TERMINALS_QUERY_KEY = "terminals";
export const PROJECT_COMMANDS_QUERY_KEY = "projectCommands";
export const PROJECT_COMMANDS_PAGES_QUERY_KEY = "projectCommandsPages";
export const THREAD_STORAGE_FILES_QUERY_KEY = "threadStorageFiles";
export const THREAD_STORAGE_PATHS_QUERY_KEY = "threadStoragePaths";
export const THREAD_STORAGE_FILE_PREVIEW_QUERY_KEY = "threadStorageFilePreview";
export const THREAD_HOST_FILE_PREVIEW_QUERY_KEY = "threadHostFilePreview";
export const ENVIRONMENT_QUERY_KEY = "environment";
export const ENVIRONMENT_WORK_STATUS_QUERY_KEY = "environmentWorkStatus";
export const ENVIRONMENT_PULL_REQUEST_QUERY_KEY = "environmentPullRequest";
export const ENVIRONMENT_MERGE_BASE_BRANCHES_QUERY_KEY =
  "environmentMergeBaseBranches";
export const ENVIRONMENT_DIFF_FILES_QUERY_KEY = "environmentDiffFiles";
export const ENVIRONMENT_DIFF_PATCH_QUERY_KEY = "environmentDiffPatch";
export const ENVIRONMENT_DIFF_FILE_QUERY_KEY = "environmentDiffFile";
export const ENVIRONMENT_FILE_PREVIEW_QUERY_KEY = "environmentFilePreview";
export const ENVIRONMENT_PATHS_QUERY_KEY = "environmentPaths";
export const THREAD_TIMELINE_QUERY_KEY = "threadTimeline";
export const THREAD_CONVERSATION_OUTLINE_QUERY_KEY =
  "threadConversationOutline";
export const THREAD_TIMELINE_TURN_SUMMARY_DETAILS_QUERY_KEY =
  "threadTimelineTurnSummaryDetails";
export const SYSTEM_PROVIDERS_QUERY_KEY = "systemProviders";
export const SYSTEM_CONFIG_QUERY_KEY = "systemConfig";
export const SYSTEM_EXECUTION_OPTIONS_QUERY_KEY = "systemExecutionOptions";
export const SYSTEM_VERSION_QUERY_KEY = "systemVersion";
export const HOST_PROVIDER_CLI_STATUS_QUERY_KEY = "hostProviderCliStatus";
export const SYSTEM_USAGE_LIMITS_QUERY_KEY = "systemUsageLimits";
export const HOST_PATH_EXISTENCE_QUERY_KEY = "hostPathExistence";
export interface ThreadListQueryFilters {
  projectId?: string;
  hasParent?: ThreadListFilters["hasParent"];
  parentThreadId?: string;
  sourceThreadId?: string;
  originKind?: ThreadListFilters["originKind"];
  excludeSideChats?: ThreadListFilters["excludeSideChats"];
  childOrigin?: ThreadListFilters["childOrigin"];
  archived: boolean;
  limit?: number;
}

export interface ThreadSearchQueryFilters {
  query: ThreadSearchFilters["query"];
  limitPerGroup: NonNullable<ThreadSearchFilters["limitPerGroup"]>;
}

export type ArchivedThreadsKindFilter = "all" | "root" | "child";

export interface ArchivedThreadsListFilters {
  projectId?: string;
  folderId?: string;
  unfiled?: boolean;
}

export const ARCHIVED_THREADS_LIST_KIND = "archivedList";

export type HostsQueryKey = readonly [typeof HOSTS_QUERY_KEY];
export type HostQueryId = string | null | undefined;
export type HostQueryKey = readonly [typeof HOST_QUERY_KEY, HostQueryId];
export type AllHostQueryKeyPrefix = readonly [typeof HOST_QUERY_KEY];
export type HostDirectoryQueryKey = readonly [
  typeof HOST_DIRECTORY_QUERY_KEY,
  HostQueryId,
  string | null,
];
export type ProjectsQueryKey = readonly [typeof PROJECTS_QUERY_KEY];
export type AllProjectPathsQueryKeyPrefix = readonly [
  typeof PROJECT_PATHS_QUERY_KEY,
];
export type AllProjectSourceBranchesQueryKeyPrefix = readonly [
  typeof PROJECT_SOURCE_BRANCHES_QUERY_KEY,
];
export type ProjectSourceBranchesQueryKeyPrefix = readonly [
  typeof PROJECT_SOURCE_BRANCHES_QUERY_KEY,
  string,
];
export type ProjectDefaultExecutionOptionsQueryKey = readonly [
  typeof PROJECT_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY,
  string,
];
export type ProjectPromptHistoryQueryKeyPrefix = readonly [
  typeof PROJECT_PROMPT_HISTORY_QUERY_KEY,
];
export type ProjectPromptHistoryQueryKey = readonly [
  typeof PROJECT_PROMPT_HISTORY_QUERY_KEY,
  string | null | undefined,
];
export type ProjectPathsQueryKey = readonly [
  typeof PROJECT_PATHS_QUERY_KEY,
  string | undefined,
  string,
  number,
  boolean,
  boolean,
];
export type ProjectPathsQueryKeyPrefix = readonly [
  typeof PROJECT_PATHS_QUERY_KEY,
  string,
];
export type ProjectFilePreviewQueryKey = readonly [
  typeof PROJECT_FILE_PREVIEW_QUERY_KEY,
  string | undefined,
  string | null,
];
export type ProjectSourceBranchesQueryKey = readonly [
  typeof PROJECT_SOURCE_BRANCHES_QUERY_KEY,
  string,
  string,
  string,
  number,
  string,
];
export type SidebarNavigationQueryKey = readonly [
  typeof SIDEBAR_NAVIGATION_QUERY_KEY,
];
export type ThreadsQueryKey = readonly [typeof THREADS_QUERY_KEY];
export type ThreadListQueryKey = readonly [
  typeof THREADS_QUERY_KEY,
  ThreadListQueryFilters,
];
export type ThreadSearchQueryKey = readonly [
  typeof THREAD_SEARCH_QUERY_KEY,
  ThreadSearchQueryFilters,
];
export type ThreadSearchQueryKeyPrefix = readonly [
  typeof THREAD_SEARCH_QUERY_KEY,
];
export type ArchivedThreadsListQueryKey = readonly [
  typeof THREADS_QUERY_KEY,
  typeof ARCHIVED_THREADS_LIST_KIND,
  ArchivedThreadsListFilters,
];
export type DisabledThreadListQueryKey = readonly [
  typeof THREADS_DISABLED_QUERY_KEY,
  ThreadListQueryFilters?,
];
export type ThreadQueryKeyPrefix = readonly [typeof THREAD_QUERY_KEY];
export type ThreadQueryKey = readonly [typeof THREAD_QUERY_KEY, string];
export type ThreadDetailBootstrapQueryKeyPrefix = readonly [
  typeof THREAD_DETAIL_BOOTSTRAP_QUERY_KEY,
];
export type ThreadDetailBootstrapQueryKey = readonly [
  typeof THREAD_DETAIL_BOOTSTRAP_QUERY_KEY,
  string,
];
export type ThreadDefaultExecutionOptionsQueryKeyPrefix = readonly [
  typeof THREAD_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY,
];
export type ThreadDefaultExecutionOptionsQueryKey = readonly [
  typeof THREAD_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY,
  string,
];
export type ThreadQueuedMessagesQueryKeyPrefix = readonly [
  typeof THREAD_QUEUED_MESSAGES_QUERY_KEY,
];
export type ThreadQueuedMessagesQueryKey = readonly [
  typeof THREAD_QUEUED_MESSAGES_QUERY_KEY,
  string,
];
export type ThreadPromptHistoryQueryKeyPrefix = readonly [
  typeof THREAD_PROMPT_HISTORY_QUERY_KEY,
];
export type ThreadPromptHistoryQueryKey = readonly [
  typeof THREAD_PROMPT_HISTORY_QUERY_KEY,
  string,
];
export type ThreadPendingInteractionsQueryKeyPrefix = readonly [
  typeof THREAD_PENDING_INTERACTIONS_QUERY_KEY,
];
export type ThreadPendingInteractionsQueryKey = readonly [
  typeof THREAD_PENDING_INTERACTIONS_QUERY_KEY,
  string,
];
export type TerminalQueryScope =
  | { kind: "thread"; threadId: string }
  | { kind: "environment"; environmentId: string }
  | { kind: "host_path"; cwd?: string; hostId: string };
export type AllTerminalsQueryKeyPrefix = readonly [typeof TERMINALS_QUERY_KEY];
export type TerminalsQueryKey = readonly [
  typeof TERMINALS_QUERY_KEY,
  TerminalQueryScope,
];
export type ProjectCommandsQueryKey = readonly [
  typeof PROJECT_COMMANDS_QUERY_KEY,
  string | undefined,
  string | undefined,
  string | null,
  string,
  number,
  number,
];
export type ProjectCommandsPagesQueryKey = readonly [
  typeof PROJECT_COMMANDS_PAGES_QUERY_KEY,
  string | undefined,
  string | undefined,
  string | null,
  string,
  number,
];
export type ThreadStorageFilesQueryKey = readonly [
  typeof THREAD_STORAGE_FILES_QUERY_KEY,
  string,
  ThreadStorageFileListOptions,
];
export type ThreadStoragePathsQueryKey = readonly [
  typeof THREAD_STORAGE_PATHS_QUERY_KEY,
  string,
  PathListOptions,
];
export type AllThreadStorageFilesQueryKeyPrefix = readonly [
  typeof THREAD_STORAGE_FILES_QUERY_KEY,
];
export type AllThreadStoragePathsQueryKeyPrefix = readonly [
  typeof THREAD_STORAGE_PATHS_QUERY_KEY,
];
export type ThreadStorageFilesForThreadQueryKeyPrefix = readonly [
  typeof THREAD_STORAGE_FILES_QUERY_KEY,
  string,
];
export type ThreadStoragePathsForThreadQueryKeyPrefix = readonly [
  typeof THREAD_STORAGE_PATHS_QUERY_KEY,
  string,
];
export type AllThreadStorageFilePreviewQueryKeyPrefix = readonly [
  typeof THREAD_STORAGE_FILE_PREVIEW_QUERY_KEY,
];
export type ThreadStorageFilePreviewQueryKey = readonly [
  typeof THREAD_STORAGE_FILE_PREVIEW_QUERY_KEY,
  string,
  string | null,
];
export type ThreadStorageFilePreviewQueryKeyPrefix = readonly [
  typeof THREAD_STORAGE_FILE_PREVIEW_QUERY_KEY,
  string,
];
export type ThreadHostFilePreviewQueryKey = readonly [
  typeof THREAD_HOST_FILE_PREVIEW_QUERY_KEY,
  string,
  string | null | undefined,
  string | null,
];
export type AllThreadHostFilePreviewQueryKeyPrefix = readonly [
  typeof THREAD_HOST_FILE_PREVIEW_QUERY_KEY,
];
export type ThreadHostFilePreviewQueryKeyPrefix = readonly [
  typeof THREAD_HOST_FILE_PREVIEW_QUERY_KEY,
  string,
];
export type EnvironmentQueryKeyPrefix = readonly [typeof ENVIRONMENT_QUERY_KEY];
export type EnvironmentQueryKey = readonly [
  typeof ENVIRONMENT_QUERY_KEY,
  string | null | undefined,
];
export type EnvironmentWorkStatusQueryKeyRootPrefix = readonly [
  typeof ENVIRONMENT_WORK_STATUS_QUERY_KEY,
];
export type EnvironmentWorkStatusQueryKey = readonly [
  typeof ENVIRONMENT_WORK_STATUS_QUERY_KEY,
  string | null | undefined,
  string | null,
];
export type EnvironmentWorkStatusQueryKeyPrefix = readonly [
  typeof ENVIRONMENT_WORK_STATUS_QUERY_KEY,
  string,
];
export type EnvironmentPullRequestQueryKey = readonly [
  typeof ENVIRONMENT_PULL_REQUEST_QUERY_KEY,
  string | null | undefined,
];
export type EnvironmentMergeBaseBranchesQueryKeyRootPrefix = readonly [
  typeof ENVIRONMENT_MERGE_BASE_BRANCHES_QUERY_KEY,
];
export type EnvironmentMergeBaseBranchesQueryKey = readonly [
  typeof ENVIRONMENT_MERGE_BASE_BRANCHES_QUERY_KEY,
  string,
  string,
  number,
  string,
];
export type EnvironmentMergeBaseBranchesQueryKeyPrefix = readonly [
  typeof ENVIRONMENT_MERGE_BASE_BRANCHES_QUERY_KEY,
  string,
];
export type ThreadTimelineQueryKey = readonly [
  typeof THREAD_TIMELINE_QUERY_KEY,
  string,
];
export type ThreadConversationOutlineQueryKey = readonly [
  typeof THREAD_CONVERSATION_OUTLINE_QUERY_KEY,
  string,
];
export type ThreadConversationOutlineQueryKeyPrefix = readonly [
  typeof THREAD_CONVERSATION_OUTLINE_QUERY_KEY,
  string,
];
export type AllThreadConversationOutlineQueryKeyPrefix = readonly [
  typeof THREAD_CONVERSATION_OUTLINE_QUERY_KEY,
];
export interface ThreadTimelineTurnSummaryDetailsQueryIdentity {
  sourceSeqEnd: number;
  sourceSeqStart: number;
  threadId: string;
  turnId: string;
}
export type ThreadTimelineTurnSummaryDetailsQueryKey = readonly [
  typeof THREAD_TIMELINE_TURN_SUMMARY_DETAILS_QUERY_KEY,
  string,
  string,
  number,
  number,
];
export type ThreadTimelineQueryKeyPrefix = readonly [
  typeof THREAD_TIMELINE_QUERY_KEY,
  string,
];
export type AllThreadTimelineQueryKeyPrefix = readonly [
  typeof THREAD_TIMELINE_QUERY_KEY,
];
export type ThreadTimelineTurnSummaryDetailsQueryKeyPrefix = readonly [
  typeof THREAD_TIMELINE_TURN_SUMMARY_DETAILS_QUERY_KEY,
  string,
];
export type AllThreadTimelineTurnSummaryDetailsQueryKeyPrefix = readonly [
  typeof THREAD_TIMELINE_TURN_SUMMARY_DETAILS_QUERY_KEY,
];
export type EnvironmentDiffFilesQueryKey = readonly [
  typeof ENVIRONMENT_DIFF_FILES_QUERY_KEY,
  string,
  string | null,
  string | null,
];
export type EnvironmentDiffFilesQueryKeyRootPrefix = readonly [
  typeof ENVIRONMENT_DIFF_FILES_QUERY_KEY,
];
export type EnvironmentDiffFilesQueryKeyPrefix = readonly [
  typeof ENVIRONMENT_DIFF_FILES_QUERY_KEY,
  string,
];
export type EnvironmentDiffPatchQueryKey = readonly [
  typeof ENVIRONMENT_DIFF_PATCH_QUERY_KEY,
  string,
  string | null,
  string | null,
  string,
];
export type EnvironmentDiffPatchQueryKeyRootPrefix = readonly [
  typeof ENVIRONMENT_DIFF_PATCH_QUERY_KEY,
];
export type EnvironmentDiffPatchQueryKeyPrefix = readonly [
  typeof ENVIRONMENT_DIFF_PATCH_QUERY_KEY,
  string,
];
export type EnvironmentDiffFileQueryKey = readonly [
  typeof ENVIRONMENT_DIFF_FILE_QUERY_KEY,
  string,
  string,
  string | null,
  string,
  "old" | "new",
];
export type EnvironmentFilePreviewQueryKey = readonly [
  typeof ENVIRONMENT_FILE_PREVIEW_QUERY_KEY,
  string | null | undefined,
  string | null,
  EnvironmentFilePreviewSource | null,
];
export type EnvironmentFilePreviewQueryKeyRootPrefix = readonly [
  typeof ENVIRONMENT_FILE_PREVIEW_QUERY_KEY,
];
export type EnvironmentFilePreviewQueryKeyPrefix = readonly [
  typeof ENVIRONMENT_FILE_PREVIEW_QUERY_KEY,
  string,
];
export type EnvironmentPathsQueryKey = readonly [
  typeof ENVIRONMENT_PATHS_QUERY_KEY,
  string | undefined,
  string,
  number,
  boolean,
  boolean,
];
export type EnvironmentPathsQueryKeyPrefix = readonly [
  typeof ENVIRONMENT_PATHS_QUERY_KEY,
  string,
];
export type SystemProvidersQueryKey = readonly [
  typeof SYSTEM_PROVIDERS_QUERY_KEY,
];
export type SystemConfigQueryKey = readonly [typeof SYSTEM_CONFIG_QUERY_KEY];
export type SystemVersionQueryKey = readonly [typeof SYSTEM_VERSION_QUERY_KEY];
export type HostProviderCliStatusQueryKey = readonly [
  typeof HOST_PROVIDER_CLI_STATUS_QUERY_KEY,
  string | null,
];
export type SystemUsageLimitsQueryKey = readonly [
  typeof SYSTEM_USAGE_LIMITS_QUERY_KEY,
];
export type SystemExecutionOptionsQueryKey = readonly [
  typeof SYSTEM_EXECUTION_OPTIONS_QUERY_KEY,
  string | null,
  string | null,
];
export type AllSystemExecutionOptionsQueryKeyPrefix = readonly [
  typeof SYSTEM_EXECUTION_OPTIONS_QUERY_KEY,
];
export type SystemExecutionOptionsEnvironmentQueryKeyPrefix = readonly [
  typeof SYSTEM_EXECUTION_OPTIONS_QUERY_KEY,
  string | null,
];
export type HostPathExistenceQueryKey = readonly [
  typeof HOST_PATH_EXISTENCE_QUERY_KEY,
  string | null,
  readonly string[],
];
export type HostPathExistenceQueryKeyPrefix = readonly [
  typeof HOST_PATH_EXISTENCE_QUERY_KEY,
];
export interface ProjectDefaultExecutionOptionsQueryKeyArgs {
  projectId: string;
}

export function hostsQueryKey(): HostsQueryKey {
  return [HOSTS_QUERY_KEY];
}

export function hostQueryKey(hostId: HostQueryId): HostQueryKey {
  return [HOST_QUERY_KEY, hostId];
}

export function allHostQueryKeyPrefix(): AllHostQueryKeyPrefix {
  return [HOST_QUERY_KEY];
}

export function hostDirectoryQueryKey(
  hostId: HostQueryId,
  path: string | null,
): HostDirectoryQueryKey {
  return [HOST_DIRECTORY_QUERY_KEY, hostId, path];
}

export function projectsQueryKey(): ProjectsQueryKey {
  return [PROJECTS_QUERY_KEY];
}

export function projectPathsQueryKey(
  projectId: string | undefined,
  query: string,
  limit: number,
  includeFiles: boolean,
  includeDirectories: boolean,
): ProjectPathsQueryKey {
  return [
    PROJECT_PATHS_QUERY_KEY,
    projectId,
    query,
    limit,
    includeFiles,
    includeDirectories,
  ];
}

export function projectFilePreviewQueryKey(
  projectId: string | undefined,
  path: string | null,
): ProjectFilePreviewQueryKey {
  return [PROJECT_FILE_PREVIEW_QUERY_KEY, projectId, path];
}

export function allProjectPathsQueryKeyPrefix(): AllProjectPathsQueryKeyPrefix {
  return [PROJECT_PATHS_QUERY_KEY];
}

export function environmentPathsQueryKey(
  environmentId: string | undefined,
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

export function projectPromptHistoryQueryKey(
  projectId: string | null | undefined,
): ProjectPromptHistoryQueryKey {
  return [PROJECT_PROMPT_HISTORY_QUERY_KEY, projectId];
}

export function projectDefaultExecutionOptionsQueryKey({
  projectId,
}: ProjectDefaultExecutionOptionsQueryKeyArgs): ProjectDefaultExecutionOptionsQueryKey {
  return [PROJECT_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY, projectId];
}

export function projectPromptHistoryQueryKeyPrefix(): ProjectPromptHistoryQueryKeyPrefix {
  return [PROJECT_PROMPT_HISTORY_QUERY_KEY];
}

export function projectPathsQueryKeyPrefix(
  projectId: string,
): ProjectPathsQueryKeyPrefix {
  return [PROJECT_PATHS_QUERY_KEY, projectId];
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

export function allProjectSourceBranchesQueryKeyPrefix(): AllProjectSourceBranchesQueryKeyPrefix {
  return [PROJECT_SOURCE_BRANCHES_QUERY_KEY];
}

export function projectSourceBranchesQueryKeyPrefix(
  projectId: string,
): ProjectSourceBranchesQueryKeyPrefix {
  return [PROJECT_SOURCE_BRANCHES_QUERY_KEY, projectId];
}

export function sidebarNavigationQueryKey(): SidebarNavigationQueryKey {
  return [SIDEBAR_NAVIGATION_QUERY_KEY];
}

export function threadsQueryKey(): ThreadsQueryKey {
  return [THREADS_QUERY_KEY];
}

export function threadListQueryKey(
  filters: ThreadListQueryFilters,
): ThreadListQueryKey {
  return [THREADS_QUERY_KEY, filters];
}

export function threadSearchQueryKey(
  filters: ThreadSearchQueryFilters,
): ThreadSearchQueryKey {
  return [THREAD_SEARCH_QUERY_KEY, filters];
}

export function threadSearchQueryKeyPrefix(): ThreadSearchQueryKeyPrefix {
  return [THREAD_SEARCH_QUERY_KEY];
}

export function archivedThreadsListQueryKey(
  filters: ArchivedThreadsListFilters,
): ArchivedThreadsListQueryKey {
  return [THREADS_QUERY_KEY, ARCHIVED_THREADS_LIST_KIND, filters];
}

export function disabledThreadListQueryKey(
  filters?: ThreadListQueryFilters,
): DisabledThreadListQueryKey {
  return filters
    ? [THREADS_DISABLED_QUERY_KEY, filters]
    : [THREADS_DISABLED_QUERY_KEY];
}

export function threadQueryKey(threadId: string): ThreadQueryKey {
  return [THREAD_QUERY_KEY, threadId];
}

export function threadDetailBootstrapQueryKey(
  threadId: string,
): ThreadDetailBootstrapQueryKey {
  return [THREAD_DETAIL_BOOTSTRAP_QUERY_KEY, threadId];
}

export function allThreadDetailBootstrapQueryKeyPrefix(): ThreadDetailBootstrapQueryKeyPrefix {
  return [THREAD_DETAIL_BOOTSTRAP_QUERY_KEY];
}

export function allThreadQueryKeyPrefix(): ThreadQueryKeyPrefix {
  return [THREAD_QUERY_KEY];
}

export function threadDefaultExecutionOptionsQueryKey(
  threadId: string,
): ThreadDefaultExecutionOptionsQueryKey {
  return [THREAD_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY, threadId];
}

export function allThreadDefaultExecutionOptionsQueryKeyPrefix(): ThreadDefaultExecutionOptionsQueryKeyPrefix {
  return [THREAD_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY];
}

export function threadQueuedMessagesQueryKey(
  threadId: string,
): ThreadQueuedMessagesQueryKey {
  return [THREAD_QUEUED_MESSAGES_QUERY_KEY, threadId];
}

export function allThreadQueuedMessagesQueryKeyPrefix(): ThreadQueuedMessagesQueryKeyPrefix {
  return [THREAD_QUEUED_MESSAGES_QUERY_KEY];
}

export function threadPromptHistoryQueryKey(
  threadId: string,
): ThreadPromptHistoryQueryKey {
  return [THREAD_PROMPT_HISTORY_QUERY_KEY, threadId];
}

export function threadPromptHistoryQueryKeyPrefix(): ThreadPromptHistoryQueryKeyPrefix {
  return [THREAD_PROMPT_HISTORY_QUERY_KEY];
}

export function threadPendingInteractionsQueryKey(
  threadId: string,
): ThreadPendingInteractionsQueryKey {
  return [THREAD_PENDING_INTERACTIONS_QUERY_KEY, threadId];
}

export function allThreadPendingInteractionsQueryKeyPrefix(): ThreadPendingInteractionsQueryKeyPrefix {
  return [THREAD_PENDING_INTERACTIONS_QUERY_KEY];
}

export function terminalsQueryKey(
  scope: TerminalQueryScope,
): TerminalsQueryKey {
  return [TERMINALS_QUERY_KEY, scope];
}

export function allTerminalsQueryKeyPrefix(): AllTerminalsQueryKeyPrefix {
  return [TERMINALS_QUERY_KEY];
}

export function projectCommandsQueryKey(
  projectId: string | undefined,
  providerId: string | undefined,
  environmentId: string | null,
  query: string,
  offset: number,
  limit: number,
): ProjectCommandsQueryKey {
  return [
    PROJECT_COMMANDS_QUERY_KEY,
    projectId,
    providerId,
    environmentId,
    query,
    offset,
    limit,
  ];
}

export function projectCommandsPagesQueryKey(
  projectId: string | undefined,
  providerId: string | undefined,
  environmentId: string | null,
  query: string,
  limit: number,
): ProjectCommandsPagesQueryKey {
  return [
    PROJECT_COMMANDS_PAGES_QUERY_KEY,
    projectId,
    providerId,
    environmentId,
    query,
    limit,
  ];
}

export function threadStorageFilesQueryKey(
  threadId: string,
  options: ThreadStorageFileListOptions = DEFAULT_THREAD_STORAGE_FILE_LIST_OPTIONS,
): ThreadStorageFilesQueryKey {
  return [THREAD_STORAGE_FILES_QUERY_KEY, threadId, options];
}

export function threadStoragePathsQueryKey(
  threadId: string,
  options: PathListOptions = DEFAULT_FILE_ONLY_PATH_LIST_OPTIONS,
): ThreadStoragePathsQueryKey {
  return [THREAD_STORAGE_PATHS_QUERY_KEY, threadId, options];
}

export function allThreadStorageFilesQueryKeyPrefix(): AllThreadStorageFilesQueryKeyPrefix {
  return [THREAD_STORAGE_FILES_QUERY_KEY];
}

export function allThreadStoragePathsQueryKeyPrefix(): AllThreadStoragePathsQueryKeyPrefix {
  return [THREAD_STORAGE_PATHS_QUERY_KEY];
}

export function threadStorageFilesForThreadQueryKeyPrefix(
  threadId: string,
): ThreadStorageFilesForThreadQueryKeyPrefix {
  return [THREAD_STORAGE_FILES_QUERY_KEY, threadId];
}

export function threadStoragePathsForThreadQueryKeyPrefix(
  threadId: string,
): ThreadStoragePathsForThreadQueryKeyPrefix {
  return [THREAD_STORAGE_PATHS_QUERY_KEY, threadId];
}

export function threadStorageFilePreviewQueryKey(
  threadId: string,
  path: string | null,
): ThreadStorageFilePreviewQueryKey {
  return [THREAD_STORAGE_FILE_PREVIEW_QUERY_KEY, threadId, path];
}

export function allThreadStorageFilePreviewQueryKeyPrefix(): AllThreadStorageFilePreviewQueryKeyPrefix {
  return [THREAD_STORAGE_FILE_PREVIEW_QUERY_KEY];
}

export function threadStorageFilePreviewQueryKeyPrefix(
  threadId: string,
): ThreadStorageFilePreviewQueryKeyPrefix {
  return [THREAD_STORAGE_FILE_PREVIEW_QUERY_KEY, threadId];
}

export function threadHostFilePreviewQueryKey(
  threadId: string,
  environmentId: string | null | undefined,
  path: string | null,
): ThreadHostFilePreviewQueryKey {
  return [THREAD_HOST_FILE_PREVIEW_QUERY_KEY, threadId, environmentId, path];
}

export function allThreadHostFilePreviewQueryKeyPrefix(): AllThreadHostFilePreviewQueryKeyPrefix {
  return [THREAD_HOST_FILE_PREVIEW_QUERY_KEY];
}

export function threadHostFilePreviewQueryKeyPrefix(
  threadId: string,
): ThreadHostFilePreviewQueryKeyPrefix {
  return [THREAD_HOST_FILE_PREVIEW_QUERY_KEY, threadId];
}

export function allEnvironmentQueryKeyPrefix(): EnvironmentQueryKeyPrefix {
  return [ENVIRONMENT_QUERY_KEY];
}

export function environmentQueryKey(
  environmentId: string | null | undefined,
): EnvironmentQueryKey {
  return [ENVIRONMENT_QUERY_KEY, environmentId];
}

export function environmentWorkStatusQueryKey(
  environmentId: string | null | undefined,
  mergeBaseBranch: string | null,
): EnvironmentWorkStatusQueryKey {
  return [ENVIRONMENT_WORK_STATUS_QUERY_KEY, environmentId, mergeBaseBranch];
}

export function allEnvironmentWorkStatusQueryKeyPrefix(): EnvironmentWorkStatusQueryKeyRootPrefix {
  return [ENVIRONMENT_WORK_STATUS_QUERY_KEY];
}

export function environmentWorkStatusQueryKeyPrefix(
  environmentId: string,
): EnvironmentWorkStatusQueryKeyPrefix {
  return [ENVIRONMENT_WORK_STATUS_QUERY_KEY, environmentId];
}

export function environmentPullRequestQueryKey(
  environmentId: string | null | undefined,
): EnvironmentPullRequestQueryKey {
  return [ENVIRONMENT_PULL_REQUEST_QUERY_KEY, environmentId];
}

export function environmentMergeBaseBranchesQueryKey(
  environmentId: string,
  query = "",
  limit = 50,
  selectedBranch = "",
): EnvironmentMergeBaseBranchesQueryKey {
  return [
    ENVIRONMENT_MERGE_BASE_BRANCHES_QUERY_KEY,
    environmentId,
    query,
    limit,
    selectedBranch,
  ];
}

export function allEnvironmentMergeBaseBranchesQueryKeyPrefix(): EnvironmentMergeBaseBranchesQueryKeyRootPrefix {
  return [ENVIRONMENT_MERGE_BASE_BRANCHES_QUERY_KEY];
}

export function environmentMergeBaseBranchesQueryKeyPrefix(
  environmentId: string,
): EnvironmentMergeBaseBranchesQueryKeyPrefix {
  return [ENVIRONMENT_MERGE_BASE_BRANCHES_QUERY_KEY, environmentId];
}

export function threadTimelineQueryKey(
  threadId: string,
): ThreadTimelineQueryKey {
  return [THREAD_TIMELINE_QUERY_KEY, threadId];
}

export function threadConversationOutlineQueryKey(
  threadId: string,
): ThreadConversationOutlineQueryKey {
  return [THREAD_CONVERSATION_OUTLINE_QUERY_KEY, threadId];
}

export function threadConversationOutlineQueryKeyPrefix(
  threadId: string,
): ThreadConversationOutlineQueryKeyPrefix {
  return [THREAD_CONVERSATION_OUTLINE_QUERY_KEY, threadId];
}

export function allThreadConversationOutlineQueryKeyPrefix(): AllThreadConversationOutlineQueryKeyPrefix {
  return [THREAD_CONVERSATION_OUTLINE_QUERY_KEY];
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

export function threadTimelineQueryKeyPrefix(
  threadId: string,
): ThreadTimelineQueryKeyPrefix {
  return [THREAD_TIMELINE_QUERY_KEY, threadId];
}

export function allThreadTimelineQueryKeyPrefix(): AllThreadTimelineQueryKeyPrefix {
  return [THREAD_TIMELINE_QUERY_KEY];
}

export function threadTimelineTurnSummaryDetailsQueryKeyPrefix(
  threadId: string,
): ThreadTimelineTurnSummaryDetailsQueryKeyPrefix {
  return [THREAD_TIMELINE_TURN_SUMMARY_DETAILS_QUERY_KEY, threadId];
}

export function allThreadTimelineTurnSummaryDetailsQueryKeyPrefix(): AllThreadTimelineTurnSummaryDetailsQueryKeyPrefix {
  return [THREAD_TIMELINE_TURN_SUMMARY_DETAILS_QUERY_KEY];
}

/**
 * The discriminating second component of a diff query key: the merge-base
 * branch for `branch_committed`/`all`, the SHA for `commit`, and `null` for
 * `uncommitted` (and for an absent target). Shared by every environment-diff
 * query family so they key off the same target identity.
 */
export function environmentDiffTargetKey(
  target: WorkspaceDiffTarget | null | undefined,
): string | null {
  switch (target?.type) {
    case "commit":
      return target.sha;
    case "branch_committed":
    case "all":
      return target.mergeBaseBranch;
    default:
      return null;
  }
}

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

export function allEnvironmentDiffFilesQueryKeyPrefix(): EnvironmentDiffFilesQueryKeyRootPrefix {
  return [ENVIRONMENT_DIFF_FILES_QUERY_KEY];
}

export function environmentDiffFilesQueryKeyPrefix(
  environmentId: string,
): EnvironmentDiffFilesQueryKeyPrefix {
  return [ENVIRONMENT_DIFF_FILES_QUERY_KEY, environmentId];
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

export function allEnvironmentDiffPatchQueryKeyPrefix(): EnvironmentDiffPatchQueryKeyRootPrefix {
  return [ENVIRONMENT_DIFF_PATCH_QUERY_KEY];
}

export function environmentDiffPatchQueryKeyPrefix(
  environmentId: string,
): EnvironmentDiffPatchQueryKeyPrefix {
  return [ENVIRONMENT_DIFF_PATCH_QUERY_KEY, environmentId];
}

export function environmentDiffFileQueryKey(
  environmentId: string,
  targetType: string,
  targetKey: string | null,
  path: string,
  side: "old" | "new",
): EnvironmentDiffFileQueryKey {
  return [
    ENVIRONMENT_DIFF_FILE_QUERY_KEY,
    environmentId,
    targetType,
    targetKey,
    path,
    side,
  ];
}

export function environmentFilePreviewQueryKey(
  environmentId: string | null | undefined,
  path: string | null,
  source: EnvironmentFilePreviewSource | null,
): EnvironmentFilePreviewQueryKey {
  return [ENVIRONMENT_FILE_PREVIEW_QUERY_KEY, environmentId, path, source];
}

export function allEnvironmentFilePreviewQueryKeyPrefix(): EnvironmentFilePreviewQueryKeyRootPrefix {
  return [ENVIRONMENT_FILE_PREVIEW_QUERY_KEY];
}

export function environmentFilePreviewQueryKeyPrefix(
  environmentId: string,
): EnvironmentFilePreviewQueryKeyPrefix {
  return [ENVIRONMENT_FILE_PREVIEW_QUERY_KEY, environmentId];
}

export function systemProvidersQueryKey(): SystemProvidersQueryKey {
  return [SYSTEM_PROVIDERS_QUERY_KEY];
}

export function systemConfigQueryKey(): SystemConfigQueryKey {
  return [SYSTEM_CONFIG_QUERY_KEY];
}

export function systemVersionQueryKey(): SystemVersionQueryKey {
  return [SYSTEM_VERSION_QUERY_KEY];
}

export function hostProviderCliStatusQueryKey(
  hostId: string | null,
): HostProviderCliStatusQueryKey {
  return [HOST_PROVIDER_CLI_STATUS_QUERY_KEY, hostId];
}

export function systemUsageLimitsQueryKey(): SystemUsageLimitsQueryKey {
  return [SYSTEM_USAGE_LIMITS_QUERY_KEY];
}

export interface SystemExecutionOptionsQueryKeyArgs {
  environmentId: string | null;
  providerId: string | null;
}

export function systemExecutionOptionsQueryKey({
  environmentId,
  providerId,
}: SystemExecutionOptionsQueryKeyArgs): SystemExecutionOptionsQueryKey {
  return [SYSTEM_EXECUTION_OPTIONS_QUERY_KEY, environmentId, providerId];
}

export function allSystemExecutionOptionsQueryKeyPrefix(): AllSystemExecutionOptionsQueryKeyPrefix {
  return [SYSTEM_EXECUTION_OPTIONS_QUERY_KEY];
}

export function systemExecutionOptionsEnvironmentQueryKeyPrefix(
  environmentId: string | null,
): SystemExecutionOptionsEnvironmentQueryKeyPrefix {
  return [SYSTEM_EXECUTION_OPTIONS_QUERY_KEY, environmentId];
}

export function hostPathExistenceQueryKey(
  hostId: string | null,
  paths: readonly string[],
): HostPathExistenceQueryKey {
  return [HOST_PATH_EXISTENCE_QUERY_KEY, hostId, paths];
}

export function hostPathExistenceQueryKeyPrefix(): HostPathExistenceQueryKeyPrefix {
  return [HOST_PATH_EXISTENCE_QUERY_KEY];
}
