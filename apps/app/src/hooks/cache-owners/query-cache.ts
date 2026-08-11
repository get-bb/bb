import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { Thread, ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import {
  applyToCachedThreadLists,
  getCachedThreadLists,
  iterateThreadListCacheEntries,
  mapThreadListCacheData,
} from "./thread-list-cache-data";
import { bumpDiffPatchEvictionGeneration } from "./environment-diff-patch-cache-owner";
import type {
  SidebarBootstrapResponse,
  ThreadResponse,
  ThreadTimelineResponse,
  TimelineRow,
} from "@bb/server-contract";
import {
  ARCHIVED_THREADS_LIST_KIND,
  ENVIRONMENT_WORK_STATUS_QUERY_KEY,
  environmentDiffFilesQueryKeyPrefix,
  environmentDiffPatchQueryKeyPrefix,
  environmentFilePreviewQueryKeyPrefix,
  environmentMergeBaseBranchesQueryKeyPrefix,
  environmentPullRequestQueryKey,
  environmentQueryKey,
  environmentWorkStatusQueryKey,
  environmentWorkStatusQueryKeyPrefix,
  allThreadQueryKeyPrefix,
  sidebarNavigationQueryKey,
  THREADS_QUERY_KEY,
  threadQueryKey,
  threadsQueryKey,
  threadTimelineQueryKeyPrefix,
  type EnvironmentWorkStatusQueryKey,
  type ArchivedThreadsListFilters,
  type ThreadListQueryFilters,
} from "../queries/query-keys";

type TimelineRowsUpdater = (
  rows: readonly TimelineRow[],
) => readonly TimelineRow[] | null;

type TimelineRowsUpdatePredicate = (queryKey: QueryKey) => boolean;

interface UpdateCachedTimelineRowsArgs {
  queryClient: QueryClient;
  shouldUpdate: TimelineRowsUpdatePredicate;
  threadId: string;
  updater: TimelineRowsUpdater;
}

export interface EnvironmentInvalidationParams {
  environmentId: string;
}

export interface EnvironmentDiffPatchRemovalParams {
  environmentId: string;
  queryClient: QueryClient;
}

export interface ProjectThreadListInvalidationParams {
  projectId: string;
  queryClient: QueryClient;
}

export interface CachedGlobalThreadListInvalidationParams {
  queryClient: QueryClient;
}

export interface RootOrderThreadListInvalidationParams {
  projectId?: string;
  queryClient: QueryClient;
}

type SidebarNavigationProject = SidebarBootstrapResponse["projects"][number];
export type CachedThreadListsAndSidebarNavigationMapper = (
  threads: ThreadListEntry[],
) => ThreadListEntry[];
type SidebarNavigationThreadMapper =
  CachedThreadListsAndSidebarNavigationMapper;

interface ApplyToCachedSidebarNavigationThreadsArgs {
  mapper: SidebarNavigationThreadMapper;
  queryClient: QueryClient;
}

export type CachedSidebarNavigationSnapshot =
  | SidebarBootstrapResponse
  | undefined;

export interface CachedThreadDetailSnapshot {
  data: ThreadWithRuntime;
  queryKey: QueryKey;
}

export function snapshotCachedThreadDetails(
  queryClient: QueryClient,
): CachedThreadDetailSnapshot[] {
  return queryClient
    .getQueriesData<ThreadWithRuntime>({
      queryKey: allThreadQueryKeyPrefix(),
    })
    .flatMap(([queryKey, data]) => (data ? [{ data, queryKey }] : []));
}

export function restoreCachedThreadDetails(
  queryClient: QueryClient,
  snapshot: readonly CachedThreadDetailSnapshot[],
): void {
  for (const { data, queryKey } of snapshot) {
    queryClient.setQueryData(queryKey, data);
  }
}

interface CachedProjectMoveThreads {
  threadIds: ReadonlySet<string>;
  threadsById: ReadonlyMap<string, ThreadWithRuntime>;
}

export function getCachedProjectMoveThreads(
  queryClient: QueryClient,
  rootThreadId: string,
): CachedProjectMoveThreads {
  const threadsById = new Map<string, ThreadWithRuntime>();
  for (const { data } of snapshotCachedThreadDetails(queryClient)) {
    threadsById.set(data.id, data);
  }
  for (const { data } of getCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  })) {
    for (const thread of iterateThreadListCacheEntries(data)) {
      threadsById.set(thread.id, thread);
    }
  }
  for (const thread of getCachedSidebarNavigationThreads(queryClient)) {
    threadsById.set(thread.id, thread);
  }

  const threadIds = new Set<string>([rootThreadId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const thread of threadsById.values()) {
      if (
        thread.parentThreadId !== null &&
        threadIds.has(thread.parentThreadId) &&
        !threadIds.has(thread.id)
      ) {
        threadIds.add(thread.id);
        changed = true;
      }
    }
  }

  return { threadIds, threadsById };
}

function getThreadListFiltersFromQueryKey(
  queryKey: QueryKey,
): ThreadListQueryFilters | undefined {
  if (queryKey[0] !== THREADS_QUERY_KEY) {
    return undefined;
  }

  const candidate = queryKey[1];
  if (candidate === undefined) {
    return undefined;
  }

  if (!isThreadListQueryFilters(candidate)) {
    return undefined;
  }

  return candidate;
}

function isThreadListQueryFilters(
  candidate: unknown,
): candidate is ThreadListQueryFilters {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    return false;
  }

  if (!("archived" in candidate) || typeof candidate.archived !== "boolean") {
    return false;
  }
  if (
    "projectId" in candidate &&
    candidate.projectId !== undefined &&
    typeof candidate.projectId !== "string"
  ) {
    return false;
  }
  if (
    "parentThreadId" in candidate &&
    candidate.parentThreadId !== undefined &&
    typeof candidate.parentThreadId !== "string"
  ) {
    return false;
  }
  if (
    "limit" in candidate &&
    candidate.limit !== undefined &&
    typeof candidate.limit !== "number"
  ) {
    return false;
  }

  return true;
}

function isArchivedThreadsListFilters(
  candidate: unknown,
): candidate is ArchivedThreadsListFilters {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    return false;
  }

  for (const key of Object.keys(candidate)) {
    if (key !== "projectId" && key !== "kind") {
      return false;
    }
  }

  if ("projectId" in candidate && candidate.projectId !== undefined) {
    if (typeof candidate.projectId !== "string") {
      return false;
    }
  }
  if (
    "kind" in candidate &&
    candidate.kind !== undefined &&
    candidate.kind !== "all" &&
    candidate.kind !== "root" &&
    candidate.kind !== "child"
  ) {
    return false;
  }

  // An empty filter object is the global archived list.
  return true;
}

function getArchivedThreadListFiltersFromQueryKey(
  queryKey: QueryKey,
): ArchivedThreadsListFilters | undefined {
  if (
    queryKey[0] !== THREADS_QUERY_KEY ||
    queryKey[1] !== ARCHIVED_THREADS_LIST_KIND
  ) {
    return undefined;
  }

  const filters = queryKey[2];
  if (!isArchivedThreadsListFilters(filters)) {
    return undefined;
  }

  return filters;
}

function getThreadListProjectIdFromQueryKey(
  queryKey: QueryKey,
): string | undefined {
  const archivedFilters = getArchivedThreadListFiltersFromQueryKey(queryKey);
  if (archivedFilters) {
    return archivedFilters.projectId;
  }

  if (queryKey[0] !== THREADS_QUERY_KEY) {
    return undefined;
  }

  return getThreadListFiltersFromQueryKey(queryKey)?.projectId;
}

export function getCachedProjectThreadListInvalidationQueryKeys({
  projectId,
  queryClient,
}: ProjectThreadListInvalidationParams): QueryKey[] {
  const queryKeys: QueryKey[] = [];
  for (const [queryKey] of queryClient.getQueriesData({
    queryKey: threadsQueryKey(),
  })) {
    if (getThreadListProjectIdFromQueryKey(queryKey) === projectId) {
      queryKeys.push(queryKey);
    }
  }
  return queryKeys;
}

export function getCachedGlobalThreadListInvalidationQueryKeys({
  queryClient,
}: CachedGlobalThreadListInvalidationParams): QueryKey[] {
  const queryKeys: QueryKey[] = [];
  for (const [queryKey] of queryClient.getQueriesData({
    queryKey: threadsQueryKey(),
  })) {
    const archivedFilters = getArchivedThreadListFiltersFromQueryKey(queryKey);
    if (
      archivedFilters !== undefined &&
      archivedFilters.projectId === undefined
    ) {
      queryKeys.push(queryKey);
      continue;
    }

    const filters = getThreadListFiltersFromQueryKey(queryKey);
    if (filters !== undefined && filters.projectId === undefined) {
      queryKeys.push(queryKey);
    }
  }
  return queryKeys;
}

export function getCachedRootOrderThreadListInvalidationQueryKeys({
  projectId,
  queryClient,
}: RootOrderThreadListInvalidationParams): QueryKey[] {
  const queryKeys: QueryKey[] = [];
  for (const [queryKey] of queryClient.getQueriesData({
    queryKey: threadsQueryKey(),
  })) {
    const filters = getThreadListFiltersFromQueryKey(queryKey);
    if (filters === undefined) continue;
    if (filters.projectId !== projectId) continue;
    if (filters.archived) continue;
    if (filters.parentThreadId !== undefined) continue;
    if (filters.hasParent === true) continue;
    queryKeys.push(queryKey);
  }
  return queryKeys;
}

function mapSidebarNavigationProjectThreads(
  project: SidebarNavigationProject,
  mapper: SidebarNavigationThreadMapper,
): SidebarNavigationProject {
  return {
    ...project,
    threads: mapper(project.threads),
  };
}

export function applyToCachedSidebarNavigationThreads({
  mapper,
  queryClient,
}: ApplyToCachedSidebarNavigationThreadsArgs): void {
  queryClient.setQueryData<SidebarBootstrapResponse>(
    sidebarNavigationQueryKey(),
    (currentNavigation) => {
      if (!currentNavigation) {
        return currentNavigation;
      }
      return {
        sections: currentNavigation.sections,
        projects: currentNavigation.projects.map((project) =>
          mapSidebarNavigationProjectThreads(project, mapper),
        ),
        personalProject: mapSidebarNavigationProjectThreads(
          currentNavigation.personalProject,
          mapper,
        ),
      };
    },
  );
}

export function applyToCachedThreadListsAndSidebarNavigation(
  queryClient: QueryClient,
  mapper: CachedThreadListsAndSidebarNavigationMapper,
): void {
  applyToCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
    mapper,
  });
  applyToCachedSidebarNavigationThreads({
    queryClient,
    mapper,
  });
}

export function getCachedSidebarNavigationThreads(
  queryClient: QueryClient,
): ThreadListEntry[] {
  const navigation = queryClient.getQueryData<SidebarBootstrapResponse>(
    sidebarNavigationQueryKey(),
  );
  if (!navigation) {
    return [];
  }
  return [
    ...navigation.projects.flatMap((project) => project.threads),
    ...navigation.personalProject.threads,
  ];
}

export function snapshotCachedSidebarNavigation(
  queryClient: QueryClient,
): CachedSidebarNavigationSnapshot {
  return queryClient.getQueryData<SidebarBootstrapResponse>(
    sidebarNavigationQueryKey(),
  );
}

export function restoreCachedSidebarNavigation(
  queryClient: QueryClient,
  snapshot: CachedSidebarNavigationSnapshot,
): void {
  queryClient.setQueryData(sidebarNavigationQueryKey(), snapshot);
}

export function getEnvironmentRecordInvalidationQueryKeys({
  environmentId,
}: EnvironmentInvalidationParams): QueryKey[] {
  return [environmentQueryKey(environmentId)];
}

/**
 * Invalidation targets for an environment's workspace-derived views. The
 * per-file diff PATCH cache is deliberately absent: it is an observer-less
 * imperative cache (written with `setQueryData`, read with `getQueryData`, no
 * `useQuery`/`queryFn`), so `invalidateQueries` only marks it stale and never
 * evicts or refetches — `getQueryData` would keep returning the stale patch.
 * Callers must evict patches via {@link removeEnvironmentDiffPatchQueries}
 * instead; the diff TOC ({@link environmentDiffFilesQueryKeyPrefix}) has a real
 * observer and refetches on invalidation.
 */
export function getEnvironmentWorkspaceStateInvalidationQueryKeys({
  environmentId,
}: EnvironmentInvalidationParams): QueryKey[] {
  return [
    environmentWorkStatusQueryKeyPrefix(environmentId),
    environmentPullRequestQueryKey(environmentId),
    environmentDiffFilesQueryKeyPrefix(environmentId),
    environmentFilePreviewQueryKeyPrefix(environmentId),
  ];
}

/**
 * Evict every cached per-file diff PATCH for an environment. The patch cache is
 * observer-less (see {@link getEnvironmentWorkspaceStateInvalidationQueryKeys}),
 * so it must be removed — not invalidated — for a content-only file edit to
 * surface fresh patches: eviction makes `readDiffPatchEntry` return undefined,
 * which the panel re-requests once the TOC refetch fires.
 *
 * The eviction generation is bumped synchronously here, before the async TOC
 * refetch fires. A patch fetch that started before this eviction observes the
 * stale generation when it resolves and drops its (pre-edit) write rather than
 * re-seeding the just-cleared cache — otherwise a fetch in flight at edit time
 * could leave a stale patch that nothing re-requests.
 */
export function removeEnvironmentDiffPatchQueries({
  environmentId,
  queryClient,
}: EnvironmentDiffPatchRemovalParams): void {
  bumpDiffPatchEvictionGeneration(environmentId);
  queryClient.removeQueries({
    queryKey: environmentDiffPatchQueryKeyPrefix(environmentId),
  });
}

export function getEnvironmentBranchListInvalidationQueryKeys({
  environmentId,
}: EnvironmentInvalidationParams): QueryKey[] {
  return [environmentMergeBaseBranchesQueryKeyPrefix(environmentId)];
}

function isEnvironmentWorkStatusQueryKeyForEnvironment(
  queryKey: QueryKey,
  environmentId: string,
): queryKey is EnvironmentWorkStatusQueryKey {
  return (
    queryKey[0] === ENVIRONMENT_WORK_STATUS_QUERY_KEY &&
    queryKey[1] === environmentId &&
    (typeof queryKey[2] === "string" || queryKey[2] === null)
  );
}

function isMergeBaseEnvironmentWorkStatusQueryKey(
  queryKey: QueryKey,
  environmentId: string,
): queryKey is EnvironmentWorkStatusQueryKey {
  return (
    isEnvironmentWorkStatusQueryKeyForEnvironment(queryKey, environmentId) &&
    typeof queryKey[2] === "string"
  );
}

export function getCachedEnvironmentRefWorkspaceStateInvalidationQueryKeys(
  queryClient: QueryClient,
  { environmentId }: EnvironmentInvalidationParams,
): QueryKey[] {
  const queryKeys: QueryKey[] = [];

  for (const [queryKey] of queryClient.getQueriesData({
    queryKey: environmentWorkStatusQueryKeyPrefix(environmentId),
  })) {
    if (isMergeBaseEnvironmentWorkStatusQueryKey(queryKey, environmentId)) {
      queryKeys.push(environmentWorkStatusQueryKey(environmentId, queryKey[2]));
    }
  }

  // A moved merge base affects the ref-derived (`all`/`branch_committed`) diff
  // targets, so invalidate the diff TOC cache by prefix. Mirrors the bulk
  // workspace-state path; the per-target keys are not enumerated here. The
  // observer-less patch cache is evicted separately via
  // removeEnvironmentDiffPatchQueries — invalidation is a no-op for it.
  queryKeys.push(environmentDiffFilesQueryKeyPrefix(environmentId));

  return queryKeys;
}

export function getEnvironmentActionInvalidationQueryKeys({
  environmentId,
}: EnvironmentInvalidationParams): QueryKey[] {
  return [
    ...getEnvironmentWorkspaceStateInvalidationQueryKeys({ environmentId }),
    ...getEnvironmentBranchListInvalidationQueryKeys({ environmentId }),
    threadsQueryKey(),
  ];
}

export function getCachedThreadListPlaceholder(
  queryClient: QueryClient,
  threadId: string,
): ThreadWithRuntime | undefined {
  if (!threadId) {
    return undefined;
  }

  for (const { data } of getCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  })) {
    for (const thread of iterateThreadListCacheEntries(data)) {
      if (thread.id === threadId) {
        return thread;
      }
    }
  }

  return undefined;
}

export function getCachedThreadListEntryPlaceholder(
  queryClient: QueryClient,
  threadId: string,
): ThreadListEntry | undefined {
  for (const { data } of getCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  })) {
    for (const thread of iterateThreadListCacheEntries(data)) {
      if (thread.id === threadId) {
        return thread;
      }
    }
  }

  return getCachedSidebarNavigationThreads(queryClient).find(
    (thread) => thread.id === threadId,
  );
}

export function updateCachedThread(
  queryClient: QueryClient,
  threadId: string,
  updater: (thread: ThreadResponse) => ThreadResponse,
): void {
  queryClient.setQueryData<ThreadResponse>(
    threadQueryKey(threadId),
    (thread) => {
      if (!thread) {
        return thread;
      }

      return updater(thread);
    },
  );
}

export function threadMatchesListFilters(
  thread: Thread,
  filters: ThreadListQueryFilters | undefined,
): boolean {
  if (!filters) {
    return false;
  }
  if (filters.archived && thread.archivedAt == null) {
    return false;
  }
  if (!filters.archived && thread.archivedAt != null) {
    return false;
  }
  if (filters?.projectId && thread.projectId !== filters.projectId) {
    return false;
  }
  if (
    filters?.hasParent !== undefined &&
    (thread.parentThreadId !== null) !== filters.hasParent
  ) {
    return false;
  }
  if (
    filters?.parentThreadId !== undefined &&
    thread.parentThreadId !== filters.parentThreadId
  ) {
    return false;
  }
  if (
    filters?.sourceThreadId !== undefined &&
    thread.sourceThreadId !== filters.sourceThreadId
  ) {
    return false;
  }
  if (
    filters?.originKind !== undefined &&
    (thread.originKind ?? thread.childOrigin) !== filters.originKind
  ) {
    return false;
  }
  if (
    filters?.childOrigin !== undefined &&
    (thread.originKind ?? thread.childOrigin) !== filters.childOrigin
  ) {
    return false;
  }
  // Mirror the server default: hidden threads stay out of list caches —
  // otherwise realtime inserts leak them into surfaces (sidebar, recents)
  // whose fetches exclude them.
  if (thread.visibility === "hidden") {
    return false;
  }

  return true;
}

function threadMatchesArchivedListFilters(
  thread: Thread,
  filters: ArchivedThreadsListFilters | undefined,
): boolean {
  if (!filters || thread.archivedAt === null) {
    return false;
  }
  if (
    filters.projectId !== undefined &&
    thread.projectId !== filters.projectId
  ) {
    return false;
  }
  if (filters.kind === "root" && thread.parentThreadId !== null) {
    return false;
  }
  if (filters.kind === "child" && thread.parentThreadId === null) {
    return false;
  }
  return true;
}

interface OptimisticallyMoveThreadToProjectArgs {
  listEntry: ThreadListEntry | undefined;
  queryClient: QueryClient;
  thread: ThreadWithRuntime;
  movedThreadIds?: ReadonlySet<string>;
  movedThreads?: ReadonlyMap<string, ThreadWithRuntime>;
}

export function optimisticallyMoveThreadToProject({
  listEntry,
  queryClient,
  thread,
  movedThreadIds = new Set([thread.id]),
  movedThreads = new Map([[thread.id, thread]]),
}: OptimisticallyMoveThreadToProjectArgs): void {
  const cachedListEntry =
    listEntry ?? getCachedThreadListEntryPlaceholder(queryClient, thread.id);
  const cachedListEntries = new Map<string, ThreadListEntry>();
  for (const { data } of getCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  })) {
    for (const entry of iterateThreadListCacheEntries(data)) {
      cachedListEntries.set(entry.id, entry);
    }
  }
  for (const entry of getCachedSidebarNavigationThreads(queryClient)) {
    cachedListEntries.set(entry.id, entry);
  }
  if (cachedListEntry) {
    cachedListEntries.set(thread.id, cachedListEntry);
  }

  const movedListEntries = [...movedThreadIds].flatMap((threadId) => {
    const cachedEntry = cachedListEntries.get(threadId);
    const movedThread = movedThreads.get(threadId);
    if (!cachedEntry || !movedThread) {
      return [];
    }
    return [{ ...cachedEntry, ...movedThread, projectId: thread.projectId }];
  });

  for (const [queryKey, data] of queryClient.getQueriesData<ThreadWithRuntime>({
    queryKey: allThreadQueryKeyPrefix(),
  })) {
    if (!data || !movedThreadIds.has(data.id)) {
      continue;
    }
    const movedThread = movedThreads.get(data.id);
    if (movedThread) {
      queryClient.setQueryData(queryKey, {
        ...data,
        ...movedThread,
        projectId: thread.projectId,
      });
    }
  }

  for (const { data, queryKey } of getCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  })) {
    const activeFilters = getThreadListFiltersFromQueryKey(queryKey);
    const archivedFilters = getArchivedThreadListFiltersFromQueryKey(queryKey);

    if (Array.isArray(data)) {
      const remaining = data.filter(
        (candidate) => !movedThreadIds.has(candidate.id),
      );
      if (activeFilters) {
        const movedEntries = movedListEntries.filter((entry) =>
          threadMatchesListFilters(entry, activeFilters),
        );
        remaining.unshift(...movedEntries);
      }
      queryClient.setQueryData(queryKey, remaining);
      continue;
    }

    let isFirstPage = true;
    const nextData = mapThreadListCacheData(data, (page) => {
      const remaining = page.filter(
        (candidate) => !movedThreadIds.has(candidate.id),
      );
      if (isFirstPage && archivedFilters) {
        const movedEntries = movedListEntries.filter((entry) =>
          threadMatchesArchivedListFilters(entry, archivedFilters),
        );
        remaining.unshift(...movedEntries);
      }
      isFirstPage = false;
      return remaining;
    });
    queryClient.setQueryData(queryKey, nextData);
  }

  if (movedListEntries.length === 0) {
    return;
  }

  let shouldRefetchSidebar = false;
  queryClient.setQueryData<SidebarBootstrapResponse>(
    sidebarNavigationQueryKey(),
    (currentNavigation) => {
      if (!currentNavigation) {
        return currentNavigation;
      }

      const targetProjectKnown =
        currentNavigation.personalProject.id === thread.projectId ||
        currentNavigation.projects.some(
          (project) => project.id === thread.projectId,
        );
      if (!targetProjectKnown) {
        // A stale sidebar snapshot may not know about a project created in
        // another tab. Keep the source row visible until the refetch resolves
        // instead of dropping it with nowhere to insert it.
        shouldRefetchSidebar = true;
        return currentNavigation;
      }

      const movedEntries = movedListEntries;
      const updateProject = (project: SidebarNavigationProject) => {
        const withoutMovedThreads = project.threads.filter(
          (candidate) => !movedThreadIds.has(candidate.id),
        );
        if (project.id !== thread.projectId) {
          return withoutMovedThreads.length === project.threads.length
            ? project
            : { ...project, threads: withoutMovedThreads };
        }

        return {
          ...project,
          threads: [...movedEntries, ...withoutMovedThreads],
        };
      };

      return {
        sections: currentNavigation.sections,
        projects: currentNavigation.projects.map(updateProject),
        personalProject: updateProject(currentNavigation.personalProject),
      };
    },
  );
  if (shouldRefetchSidebar) {
    queryClient.invalidateQueries({ queryKey: sidebarNavigationQueryKey() });
  }
}

export function optimisticallyInsertThread(
  queryClient: QueryClient,
  thread: ThreadWithRuntime,
): void {
  // Only inserts into flat-array list caches (`useThreads`). The paginated
  // archived view uses `InfiniteData` and only displays threads with an
  // archivedAt — newly created threads can't belong to it.
  for (const { queryKey, data } of getCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  })) {
    if (!Array.isArray(data)) {
      continue;
    }

    const filters = getThreadListFiltersFromQueryKey(queryKey);
    if (!threadMatchesListFilters(thread, filters)) {
      continue;
    }
    if (data.some((candidate) => candidate.id === thread.id)) {
      continue;
    }

    queryClient.setQueryData<ThreadListEntry[]>(queryKey, [
      {
        ...thread,
        activity: {
          activeWorkflowCount: 0,
          activeBackgroundAgentCount: 0,
          activeBackgroundCommandCount: 0,
          activePlanModeCount: 0,
          activeGoalCount: 0,
        },
        environmentBranchName: null,
        environmentHostId: null,
        environmentName: null,
        runtime: thread.runtime,
        hasPendingInteraction: false,
        pinSortKey: null,
        environmentWorkspaceDisplayKind: "other",
      },
      ...data,
    ]);
  }
}

const updateEveryTimelineQuery: TimelineRowsUpdatePredicate = () => true;

function updateCachedTimelineRows({
  queryClient,
  shouldUpdate,
  threadId,
  updater,
}: UpdateCachedTimelineRowsArgs): void {
  const timelineQueries = queryClient.getQueriesData<ThreadTimelineResponse>({
    queryKey: threadTimelineQueryKeyPrefix(threadId),
  });

  for (const [queryKey, response] of timelineQueries) {
    if (!response) {
      continue;
    }
    if (!shouldUpdate(queryKey)) {
      continue;
    }

    const nextRows = updater(response.rows);
    if (nextRows === null) {
      continue;
    }

    queryClient.setQueryData<ThreadTimelineResponse>(queryKey, {
      ...response,
      rows: [...nextRows],
    });
  }
}

export function insertOptimisticTimelineRow(
  queryClient: QueryClient,
  threadId: string,
  row: TimelineRow,
): void {
  updateCachedTimelineRows({
    queryClient,
    shouldUpdate: updateEveryTimelineQuery,
    threadId,
    updater: (rows) => [...rows, row],
  });
}

export function removeOptimisticTimelineRow(
  queryClient: QueryClient,
  threadId: string,
  rowId: string,
): void {
  updateCachedTimelineRows({
    queryClient,
    shouldUpdate: updateEveryTimelineQuery,
    threadId,
    updater: (rows) => {
      const nextRows = rows.filter((row) => row.id !== rowId);
      return nextRows.length === rows.length ? null : nextRows;
    },
  });
}

export function updateCachedThreadListPendingInteractionState(
  queryClient: QueryClient,
  threadId: string,
  hasPendingInteraction: boolean,
): void {
  applyToCachedThreadListsAndSidebarNavigation(queryClient, (list) => {
    if (!list.some((thread) => thread.id === threadId)) {
      return list;
    }
    return list.map((thread) =>
      thread.id === threadId ? { ...thread, hasPendingInteraction } : thread,
    );
  });
}
