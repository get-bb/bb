import type { ThreadListEntry } from "@bb/domain";
import type {
  SidebarBootstrapResponse,
  ThreadResponse,
} from "@bb/server-contract";
import type {
  InfiniteData,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";
import {
  ARCHIVED_THREADS_LIST_KIND,
  THREADS_QUERY_KEY,
  sidebarNavigationQueryKey,
  threadsQueryKey,
  type ThreadListQueryFilters,
} from "@/lib/query/query-keys";

/**
 * Cache access shared by the thread mutations, thread creation, and the
 * sidebar (mirrors apps/app/src/hooks/cache-owners/{query-cache,
 * thread-list-cache-data}.ts). Two shapes hold thread list entries: flat
 * arrays (`useThreadsList`) and `InfiniteData` pages (the archived list),
 * plus the sidebar bootstrap, which nests threads per project.
 */

export type ThreadListCacheData =
  | ThreadListEntry[]
  | InfiniteData<ThreadListEntry[]>;

export type ThreadListMapper = (list: ThreadListEntry[]) => ThreadListEntry[];

function isThreadListEntryArray(value: unknown): value is ThreadListEntry[] {
  return Array.isArray(value);
}

function isInfiniteThreadListData(
  value: unknown,
): value is InfiniteData<ThreadListEntry[]> {
  return (
    typeof value === "object" &&
    value !== null &&
    "pages" in value &&
    Array.isArray((value as { pages: unknown }).pages)
  );
}

function isThreadListCacheData(value: unknown): value is ThreadListCacheData {
  return isThreadListEntryArray(value) || isInfiniteThreadListData(value);
}

export function* iterateThreadListCacheEntries(
  data: ThreadListCacheData | undefined,
): Iterable<ThreadListEntry> {
  if (!data) return;
  if (isThreadListEntryArray(data)) {
    yield* data;
    return;
  }
  for (const page of data.pages) yield* page;
}

function mapThreadListCacheData<T extends ThreadListCacheData>(
  data: T,
  mapper: ThreadListMapper,
): T {
  if (isThreadListEntryArray(data)) {
    return mapper(data) as T;
  }
  return { ...data, pages: data.pages.map(mapper) } as T;
}

export interface CachedThreadList {
  queryKey: QueryKey;
  data: ThreadListCacheData;
}

export function getCachedThreadLists(
  queryClient: QueryClient,
): CachedThreadList[] {
  const lists: CachedThreadList[] = [];
  for (const [queryKey, data] of queryClient.getQueriesData({
    queryKey: threadsQueryKey(),
  })) {
    if (isThreadListCacheData(data)) lists.push({ queryKey, data });
  }
  return lists;
}

export function applyToCachedThreadLists(
  queryClient: QueryClient,
  mapper: ThreadListMapper,
): void {
  for (const { queryKey, data } of getCachedThreadLists(queryClient)) {
    queryClient.setQueryData(queryKey, mapThreadListCacheData(data, mapper));
  }
}

type SidebarProject = SidebarBootstrapResponse["projects"][number];

function mapSidebarProjectThreads(
  project: SidebarProject,
  mapper: ThreadListMapper,
): SidebarProject {
  return { ...project, threads: mapper(project.threads) };
}

function mapSidebarBootstrapThreads(
  bootstrap: SidebarBootstrapResponse,
  mapper: ThreadListMapper,
): SidebarBootstrapResponse {
  return {
    sections: bootstrap.sections,
    projects: bootstrap.projects.map((project) =>
      mapSidebarProjectThreads(project, mapper),
    ),
    personalProject: mapSidebarProjectThreads(
      bootstrap.personalProject,
      mapper,
    ),
  };
}

function applyToCachedSidebarThreads(
  queryClient: QueryClient,
  mapper: ThreadListMapper,
): void {
  queryClient.setQueryData<SidebarBootstrapResponse>(
    sidebarNavigationQueryKey(),
    (current) =>
      current === undefined
        ? current
        : mapSidebarBootstrapThreads(current, mapper),
  );
}

/** Apply one mapper to every cached thread list and the sidebar bootstrap. */
export function applyToCachedThreadListsAndSidebar(
  queryClient: QueryClient,
  mapper: ThreadListMapper,
): void {
  applyToCachedThreadLists(queryClient, mapper);
  applyToCachedSidebarThreads(queryClient, mapper);
}

/** Every thread the sidebar bootstrap knows about (projects + personal). */
export function sidebarThreadsFromBootstrap(
  bootstrap: SidebarBootstrapResponse,
): ThreadListEntry[] {
  const threads: ThreadListEntry[] = [];
  for (const project of bootstrap.projects) threads.push(...project.threads);
  threads.push(...bootstrap.personalProject.threads);
  return threads;
}

function getCachedSidebarBootstrap(
  queryClient: QueryClient,
): SidebarBootstrapResponse | undefined {
  return queryClient.getQueryData<SidebarBootstrapResponse>(
    sidebarNavigationQueryKey(),
  );
}

export function getCachedSidebarThreads(
  queryClient: QueryClient,
): ThreadListEntry[] {
  const bootstrap = getCachedSidebarBootstrap(queryClient);
  return bootstrap ? sidebarThreadsFromBootstrap(bootstrap) : [];
}

/** The freshest cached list entry for a thread, sidebar first. */
export function findCachedThreadListEntry(
  queryClient: QueryClient,
  threadId: string,
): ThreadListEntry | undefined {
  const sidebarMatch = getCachedSidebarThreads(queryClient).find(
    (thread) => thread.id === threadId,
  );
  if (sidebarMatch) return sidebarMatch;
  for (const { data } of getCachedThreadLists(queryClient)) {
    for (const entry of iterateThreadListCacheEntries(data)) {
      if (entry.id === threadId) return entry;
    }
  }
  return undefined;
}

export interface ThreadListCacheSnapshot {
  lists: CachedThreadList[];
  sidebar: SidebarBootstrapResponse | undefined;
}

export function snapshotThreadListCaches(
  queryClient: QueryClient,
): ThreadListCacheSnapshot {
  return {
    lists: getCachedThreadLists(queryClient),
    sidebar: getCachedSidebarBootstrap(queryClient),
  };
}

export function restoreThreadListCaches(
  queryClient: QueryClient,
  snapshot: ThreadListCacheSnapshot,
): void {
  for (const { queryKey, data } of snapshot.lists) {
    queryClient.setQueryData(queryKey, data);
  }
  queryClient.setQueryData(sidebarNavigationQueryKey(), snapshot.sidebar);
}

function getThreadListFiltersFromQueryKey(
  queryKey: QueryKey,
): ThreadListQueryFilters | undefined {
  if (queryKey[0] !== THREADS_QUERY_KEY) return undefined;
  const candidate = queryKey[1];
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    return undefined;
  }
  if (!("archived" in candidate) || typeof candidate.archived !== "boolean") {
    return undefined;
  }
  return candidate as ThreadListQueryFilters;
}

function threadMatchesListFilters(
  thread: ThreadResponse,
  filters: ThreadListQueryFilters,
): boolean {
  if (filters.archived !== (thread.archivedAt !== null)) return false;
  if (
    filters.projectId !== undefined &&
    thread.projectId !== filters.projectId
  ) {
    return false;
  }
  if (
    filters.parentThreadId !== undefined &&
    thread.parentThreadId !== filters.parentThreadId
  ) {
    return false;
  }
  if (
    filters.hasParent !== undefined &&
    (thread.parentThreadId !== null) !== filters.hasParent
  ) {
    return false;
  }
  if (
    filters.sourceThreadId !== undefined &&
    thread.sourceThreadId !== filters.sourceThreadId
  ) {
    return false;
  }
  if (
    filters.originKind !== undefined &&
    thread.originKind !== filters.originKind
  ) {
    return false;
  }
  return thread.visibility !== "hidden";
}

/**
 * Turn a single-thread response into a list entry. Activity/environment
 * columns are unknown until the next list fetch, so they take their neutral
 * values (the same lift the web app performs after thread creation).
 */
function threadResponseToListEntry(thread: ThreadResponse): ThreadListEntry {
  return {
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
    hasPendingInteraction: false,
    pinSortKey: null,
    environmentWorkspaceDisplayKind: "other",
  };
}

/**
 * Optimistically insert a freshly created thread at the top of every cached
 * flat list whose filters it matches, and into its project's sidebar rows.
 * The archived (paginated) list is skipped: a new thread is never archived.
 */
export function insertThreadIntoCachedLists(
  queryClient: QueryClient,
  thread: ThreadResponse,
): void {
  const entry = threadResponseToListEntry(thread);
  for (const { queryKey, data } of getCachedThreadLists(queryClient)) {
    if (!Array.isArray(data)) continue;
    if (queryKey[1] === ARCHIVED_THREADS_LIST_KIND) continue;
    const filters = getThreadListFiltersFromQueryKey(queryKey);
    if (!filters || !threadMatchesListFilters(thread, filters)) continue;
    if (data.some((candidate) => candidate.id === thread.id)) continue;
    queryClient.setQueryData<ThreadListEntry[]>(queryKey, [entry, ...data]);
  }
  if (thread.archivedAt !== null || thread.visibility === "hidden") return;
  queryClient.setQueryData<SidebarBootstrapResponse>(
    sidebarNavigationQueryKey(),
    (current) => {
      if (!current) return current;
      const insert = (project: SidebarProject): SidebarProject =>
        project.id !== thread.projectId ||
        project.threads.some((candidate) => candidate.id === thread.id)
          ? project
          : { ...project, threads: [entry, ...project.threads] };
      return {
        sections: current.sections,
        projects: current.projects.map(insert),
        personalProject: insert(current.personalProject),
      };
    },
  );
}
