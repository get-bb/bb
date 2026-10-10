import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useStore } from "jotai";
import {
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import {
  PERSONAL_PROJECT_ID,
  type Host,
  type Thread,
  type ThreadListEntry,
} from "@bb/domain";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import type {
  PluginSdkApp,
  PluginSidebarProject,
  PluginSidebarSection,
  PluginSidebarThread,
  PluginSidebarThreadActions,
  PluginSidebarThreadDraftState,
  PluginSidebarThreadPullRequestState,
  PluginSidebarThreadRowStatus,
  PluginSidebarThreadShortcut,
  PluginSidebarThreadsState,
} from "@get-bb/plugin-sdk";
import { sdk } from "@/lib/sdk";
import { useSidebarThreadShortcut as useHostSidebarThreadShortcut } from "@/components/sidebar/sidebarThreadShortcuts";
import {
  useThreadTitleMentionResources,
  type ThreadTitleMentionResources,
} from "@/components/thread/ThreadTitleMentions";
import {
  usePromptDraftHasInput,
  usePromptDraftInputThreadIds,
} from "@/hooks/usePromptDraftStorage";
import {
  usePluginThreadRowStatus,
  usePluginThreadRowStatuses,
} from "./plugin-thread-row-status";
import { getThreadConversationCollapsedAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import { useThreadActions } from "@/components/thread/ThreadActionsProvider";
import {
  getEnvironmentPullRequestFromResponse,
  useEnvironmentPullRequest,
} from "@/hooks/queries/environment-queries";
import { useHosts } from "@/hooks/queries/host-queries";
import {
  useArchivedThreads,
  useProjectsArchivedThreads,
} from "@/hooks/queries/thread-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  archivedThreadsListQueryKeyPrefix,
  sidebarNavigationQueryKey,
  threadQueryKey,
} from "@/hooks/queries/query-keys";
import { isArchivedThreadListQueryKey } from "@/hooks/cache-owners/query-cache";
import {
  usePinThread,
  useUnpinThread,
  useUpdateThread,
} from "@/hooks/mutations/thread-state-mutations";
import { useRouteNavigate } from "@/components/ui/app-route-anchor";
import { toPluginSidebarThread } from "./plugin-sidebar-threads";
import { useSetRootComposeProjectId } from "./root-compose-selection";
import { openThreadInSplit } from "./split-layout/openThreadInSplit";
import {
  getProjectComposeRoutePath,
  getRootComposeRoutePath,
  getSettingsProjectRoutePath,
  getThreadRoutePath,
} from "./route-paths";

const EMPTY_THREADS: readonly PluginSidebarThread[] = [];
const EMPTY_PROJECTS: readonly PluginSidebarProject[] = [];
const EMPTY_SECTIONS: readonly PluginSidebarSection[] = [];
const EMPTY_ENTRIES: ReadonlyMap<string, ThreadListEntry> = new Map();
const EMPTY_HOST_NAMES: ReadonlyMap<string, string> = new Map();

const hostNamesByHosts = new WeakMap<
  readonly Host[],
  ReadonlyMap<string, string>
>();

function hostNamesFor(
  hosts: readonly Host[] | undefined,
): ReadonlyMap<string, string> {
  if (hosts === undefined) return EMPTY_HOST_NAMES;
  const cached = hostNamesByHosts.get(hosts);
  if (cached !== undefined) return cached;
  const names = new Map(hosts.map((host) => [host.id, host.name] as const));
  hostNamesByHosts.set(hosts, names);
  return names;
}

const pluginSidebarThreadByEntry = new WeakMap<
  ThreadListEntry,
  {
    hostNamesById: ReadonlyMap<string, string>;
    titleResources: ThreadTitleMentionResources;
    thread: PluginSidebarThread;
  }
>();

function toPluginSidebarThreadCached(
  entry: ThreadListEntry,
  hostNamesById: ReadonlyMap<string, string>,
  titleResources: ThreadTitleMentionResources,
): PluginSidebarThread {
  const cached = pluginSidebarThreadByEntry.get(entry);
  if (
    cached !== undefined &&
    cached.hostNamesById === hostNamesById &&
    cached.titleResources === titleResources
  ) {
    return cached.thread;
  }
  const thread = toPluginSidebarThread(entry, hostNamesById, titleResources);
  pluginSidebarThreadByEntry.set(entry, {
    hostNamesById,
    titleResources,
    thread,
  });
  return thread;
}

type SidebarThreadLifecycle = "active" | "archived";
type SidebarThreadLifecycles = readonly SidebarThreadLifecycle[];

const EMPTY_PROJECT_LIFECYCLES: Readonly<
  Record<string, SidebarThreadLifecycles>
> = {};

function includesLifecycle(
  lifecycles: SidebarThreadLifecycles | undefined,
  lifecycle: SidebarThreadLifecycle,
): boolean {
  if (lifecycle === "active" && !lifecycles?.length) return true;
  return lifecycles?.includes(lifecycle) ?? false;
}

export function useSidebarThreads(
  options?: Parameters<PluginSdkApp["experimental_useSidebarThreads"]>[0],
): PluginSidebarThreadsState {
  const lifecycles = options?.experimental_lifecycles;
  const projectLifecycles =
    options?.experimental_projectLifecycles ?? EMPTY_PROJECT_LIFECYCLES;
  const active = includesLifecycle(lifecycles, "active");
  const includeArchived = includesLifecycle(lifecycles, "archived");
  const archived = useArchivedThreads({}, { enabled: includeArchived });
  const projectArchiveIdsKey = includeArchived
    ? ""
    : Object.keys(projectLifecycles)
        .filter((projectId) =>
          includesLifecycle(projectLifecycles[projectId], "archived"),
        )
        .sort()
        .join("\n");
  const projectArchiveIds = useMemo(
    () => (projectArchiveIdsKey === "" ? [] : projectArchiveIdsKey.split("\n")),
    [projectArchiveIdsKey],
  );
  const projectArchived = useProjectsArchivedThreads(projectArchiveIds);
  const includeProjectArchived = projectArchiveIds.length > 0;
  const fetchArchivedPage = archived.fetchNextPage;
  const fetchProjectArchivedPage = projectArchived.fetchNextPage;
  const archivedHasNextPage = includeArchived && archived.hasNextPage;
  const projectArchivedHasNextPage =
    includeProjectArchived && projectArchived.hasNextPage;
  const fetchNextPage = useCallback(async () => {
    await Promise.all([
      archivedHasNextPage ? fetchArchivedPage() : null,
      projectArchivedHasNextPage ? fetchProjectArchivedPage() : null,
    ]);
  }, [
    archivedHasNextPage,
    fetchArchivedPage,
    projectArchivedHasNextPage,
    fetchProjectArchivedPage,
  ]);
  const archivedStatus = !includeArchived
    ? null
    : archived.data !== undefined
      ? "ready"
      : archived.isLoadingError
        ? "error"
        : "loading";
  const projectArchivedStatus = !includeProjectArchived
    ? null
    : projectArchived.data !== undefined
      ? "ready"
      : projectArchived.isLoadingError
        ? "error"
        : "loading";
  const isFetchingNextArchivedPage =
    (includeArchived && archived.isFetchingNextPage) ||
    (includeProjectArchived && projectArchived.isFetchingNextPage);
  const isFetchNextArchivedPageError =
    (includeArchived && archived.isFetchNextPageError) ||
    (includeProjectArchived && projectArchived.isFetchNextPageError);
  const archiveState = useMemo<
    PluginSidebarThreadsState["experimental_archived"]
  >(() => {
    if (archivedStatus === null && projectArchivedStatus === null) return null;
    return {
      status:
        archivedStatus === "error" || projectArchivedStatus === "error"
          ? "error"
          : archivedStatus === "loading" || projectArchivedStatus === "loading"
            ? "loading"
            : "ready",
      hasNextPage: archivedHasNextPage || projectArchivedHasNextPage,
      isFetchingNextPage: isFetchingNextArchivedPage,
      isFetchNextPageError: isFetchNextArchivedPageError,
      fetchNextPage,
    };
  }, [
    archivedStatus,
    projectArchivedStatus,
    archivedHasNextPage,
    projectArchivedHasNextPage,
    isFetchingNextArchivedPage,
    isFetchNextArchivedPageError,
    fetchNextPage,
  ]);
  const query = useSidebarNavigation();
  const data = query.data;
  const { data: hosts } = useHosts();
  const hostNamesById = hostNamesFor(hosts);
  const titleResources = useThreadTitleMentionResources();

  return useMemo<PluginSidebarThreadsState>(() => {
    if (data === undefined) {
      return {
        experimental_archived: archiveState,
        status: query.isError ? "error" : "loading",
        threads: EMPTY_THREADS,
        experimental_hosts: hosts ?? [],
        projects: EMPTY_PROJECTS,
        sections: EMPTY_SECTIONS,
      };
    }
    const allProjects = [...data.projects, data.personalProject];
    const shows = (thread: ThreadListEntry): boolean =>
      includesLifecycle(
        projectLifecycles[thread.projectId] ?? lifecycles,
        thread.archivedAt === null ? "active" : "archived",
      );
    const selected = new Map<string, ThreadListEntry>();
    for (const thread of [
      ...(includeArchived ? (archived.data?.pages.flat() ?? []) : []),
      ...(includeProjectArchived
        ? (projectArchived.data?.pages.flat() ?? [])
        : []),
    ]) {
      if (thread.archivedAt !== null && shows(thread)) {
        selected.set(thread.id, thread);
      }
    }
    for (const project of allProjects) {
      for (const thread of project.threads) {
        if (thread.archivedAt === null && shows(thread)) {
          selected.set(thread.id, thread);
        }
      }
    }
    return {
      experimental_archived: archiveState,
      status: !active && archivedStatus !== null ? archivedStatus : "ready",
      threads: [...selected.values()].map((thread) =>
        toPluginSidebarThreadCached(thread, hostNamesById, titleResources),
      ),
      experimental_hosts: hosts ?? [],
      projects: allProjects.map((project) => ({
        id: project.id,
        name: project.name,
        isPersonal: project.id === PERSONAL_PROJECT_ID,
        href: getProjectComposeRoutePath(project.id),
        settingsHref: getSettingsProjectRoutePath(project.id),
      })),
      sections: data.sections,
    };
  }, [
    data,
    hostNamesById,
    hosts,
    query.isError,
    titleResources,
    active,
    lifecycles,
    projectLifecycles,
    includeArchived,
    archived.data,
    archivedStatus,
    includeProjectArchived,
    projectArchived.data,
    archiveState,
  ]);
}

const threadEntryMapByPayload = new WeakMap<
  object,
  ReadonlyMap<string, ThreadListEntry>
>();

function threadEntryMapFor(
  data: ReturnType<typeof useSidebarNavigation>["data"],
): ReadonlyMap<string, ThreadListEntry> {
  if (data === undefined) return EMPTY_ENTRIES;
  const cached = threadEntryMapByPayload.get(data);
  if (cached !== undefined) return cached;
  const entries = new Map<string, ThreadListEntry>();
  for (const project of [...data.projects, data.personalProject]) {
    for (const thread of project.threads) entries.set(thread.id, thread);
  }
  threadEntryMapByPayload.set(data, entries);
  return entries;
}

type ArchivedThreadPages = InfiniteData<readonly ThreadListEntry[]>;

const EMPTY_ARCHIVED_THREAD_LISTS: readonly ArchivedThreadPages[] = [];

function cachedArchivedThreadLists(
  queryClient: QueryClient,
): readonly ArchivedThreadPages[] {
  const lists = queryClient
    .getQueriesData<ArchivedThreadPages>({
      queryKey: archivedThreadsListQueryKeyPrefix(),
    })
    .flatMap(([queryKey, data]) =>
      data !== undefined && isArchivedThreadListQueryKey(queryKey)
        ? [data]
        : [],
    );
  return lists.length === 0 ? EMPTY_ARCHIVED_THREAD_LISTS : lists;
}

function sameArchivedThreadLists(
  left: readonly ArchivedThreadPages[],
  right: readonly ArchivedThreadPages[],
): boolean {
  return (
    left.length === right.length &&
    left.every((list, index) => list === right[index])
  );
}

interface ArchivedThreadListsStore {
  subscribe(onChange: () => void): () => void;
  getSnapshot(): readonly ArchivedThreadPages[];
}

const archivedThreadListsStores = new WeakMap<
  QueryClient,
  ArchivedThreadListsStore
>();

function archivedThreadListsStoreFor(
  queryClient: QueryClient,
): ArchivedThreadListsStore {
  const existing = archivedThreadListsStores.get(queryClient);
  if (existing !== undefined) return existing;
  let snapshot = cachedArchivedThreadLists(queryClient);
  let stopWatching: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const refresh = (): boolean => {
    const next = cachedArchivedThreadLists(queryClient);
    if (sameArchivedThreadLists(next, snapshot)) return false;
    snapshot = next;
    return true;
  };
  const store: ArchivedThreadListsStore = {
    subscribe(onChange) {
      listeners.add(onChange);
      if (stopWatching === null) {
        refresh();
        stopWatching = queryClient.getQueryCache().subscribe((event) => {
          if (isArchivedThreadListQueryKey(event.query.queryKey) && refresh()) {
            for (const listener of listeners) listener();
          }
        });
      }
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0 && stopWatching !== null) {
          stopWatching();
          stopWatching = null;
        }
      };
    },
    getSnapshot() {
      if (stopWatching === null) refresh();
      return snapshot;
    },
  };
  archivedThreadListsStores.set(queryClient, store);
  return store;
}

function useCachedArchivedThreadLists(): readonly ArchivedThreadPages[] {
  const store = archivedThreadListsStoreFor(useQueryClient());
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

const archivedEntryMaps = new WeakMap<
  readonly ArchivedThreadPages[],
  WeakMap<
    ReadonlyMap<string, ThreadListEntry>,
    ReadonlyMap<string, ThreadListEntry>
  >
>();

function useThreadEntryMap(): ReadonlyMap<string, ThreadListEntry> {
  const { data } = useSidebarNavigation();
  const archivedLists = useCachedArchivedThreadLists();
  return useMemo(() => {
    const active = threadEntryMapFor(data);
    if (archivedLists.length === 0) return active;
    let maps = archivedEntryMaps.get(archivedLists);
    if (maps === undefined) {
      maps = new WeakMap();
      archivedEntryMaps.set(archivedLists, maps);
    }
    const cached = maps.get(active);
    if (cached !== undefined) return cached;
    const entries = new Map([
      ...archivedLists
        .flatMap((list) => list.pages.flat())
        .map((thread) => [thread.id, thread] as const),
      ...active,
    ]);
    maps.set(active, entries);
    return entries;
  }, [data, archivedLists]);
}

export function lookupCachedThread(
  queryClient: QueryClient,
  threadId: string,
): Thread | null {
  const detail = queryClient.getQueryData<Thread>(threadQueryKey(threadId));
  if (detail !== undefined) return detail;
  const active = threadEntryMapFor(
    queryClient.getQueryData<ReturnType<typeof useSidebarNavigation>["data"]>(
      sidebarNavigationQueryKey(),
    ),
  ).get(threadId);
  if (active !== undefined) return active;
  for (const list of cachedArchivedThreadLists(queryClient)) {
    for (const page of list.pages) {
      const thread = page.find((candidate) => candidate.id === threadId);
      if (thread !== undefined) return thread;
    }
  }
  return null;
}

export async function resolveThread(
  queryClient: QueryClient,
  threadId: string,
): Promise<Thread> {
  return (
    lookupCachedThread(queryClient, threadId) ??
    (await sdk.threads.get({ threadId }))
  );
}

export function useSidebarThreadEntry(
  threadId: string,
): ThreadListEntry | null {
  return useThreadEntryMap().get(threadId) ?? null;
}

export function useSidebarThreadActions(): PluginSidebarThreadActions {
  const navigate = useRouteNavigate();
  const store = useStore();
  const isCompact = useIsCompactViewport();
  const setRootComposeProjectId = useSetRootComposeProjectId();
  const hostActions = useThreadActions();
  const entriesById = useThreadEntryMap();
  const { mutateAsync: pinThreadAsync } = usePinThread();
  const { mutateAsync: unpinThreadAsync } = useUnpinThread();
  const { mutateAsync: updateThreadAsync } = useUpdateThread();

  const requireEntry = useCallback(
    (threadId: string): ThreadListEntry => {
      const entry = entriesById.get(threadId);
      if (entry === undefined) {
        throw new Error(`Unknown thread: ${threadId}`);
      }
      return entry;
    },
    [entriesById],
  );

  return useMemo<PluginSidebarThreadActions>(
    () => ({
      open(threadId, options) {
        const entry = entriesById.get(threadId);
        if (entry === undefined) return;
        const { projectId } = entry;
        if (options?.split) {
          store.set(getThreadConversationCollapsedAtom(threadId), false);
          openThreadInSplit({
            store,
            navigate,
            projectId,
            threadId,
            isCompact,
          });
          return;
        }
        store.set(getThreadConversationCollapsedAtom(threadId), false);
        navigate(getThreadRoutePath({ projectId, threadId }));
      },
      openNewThread(options) {
        const projectId = options?.projectId;
        if (projectId !== undefined) {
          setRootComposeProjectId(projectId);
        }
        const state = {
          placement: options?.experimental_placement ?? {
            sectionId: options?.sectionId ?? null,
            pinned: false,
          },
          ...(options?.focusPrompt ? { focusPrompt: true } : {}),
          ...(options?.sectionId !== undefined
            ? { sectionId: options.sectionId }
            : {}),
          ...(options?.environmentId !== undefined
            ? { reuseEnvironmentId: options.environmentId }
            : {}),
          ...(typeof options?.hostId === "string" &&
          options.hostId.trim().length > 0
            ? { newEnvironmentHostId: options.hostId.trim() }
            : {}),
        };
        navigate(
          getRootComposeRoutePath(),
          Object.keys(state).length > 0 ? { state } : undefined,
        );
      },
      async setPinned(threadId, pinned) {
        const entry = requireEntry(threadId);
        if ((entry.pinnedAt !== null) === pinned) return;
        if (pinned) {
          await pinThreadAsync({ id: threadId });
        } else {
          await unpinThreadAsync({ id: threadId });
        }
      },
      async setRead(threadId, read) {
        const entry = requireEntry(threadId);
        const isRead = (entry.lastReadAt ?? 0) >= entry.latestAttentionAt;
        if (isRead === read) return;
        hostActions.toggleRead(entry);
      },
      async rename(threadId, title) {
        await updateThreadAsync({ id: threadId, title });
      },
      archive(threadId) {
        hostActions.requestArchive(requireEntry(threadId));
      },
      experimental_archiveEnvironmentThreads(environmentId) {
        return hostActions.archiveEnvironmentThreads(environmentId);
      },
      requestDelete(threadId) {
        hostActions.requestDelete(requireEntry(threadId));
      },
    }),
    [
      entriesById,
      hostActions,
      isCompact,
      navigate,
      pinThreadAsync,
      requireEntry,
      setRootComposeProjectId,
      store,
      unpinThreadAsync,
      updateThreadAsync,
    ],
  );
}

const NO_DRAFT: PluginSidebarThreadDraftState = Object.freeze({
  hasUnsubmittedDraft: false,
});
const HAS_DRAFT: PluginSidebarThreadDraftState = Object.freeze({
  hasUnsubmittedDraft: true,
});
const EMPTY_DRAFT_IDS: ReadonlySet<string> = new Set();

export function useSidebarThreadDraft(
  threadId: string,
): PluginSidebarThreadDraftState {
  const entry = useSidebarThreadEntry(threadId);
  const hasDraft = usePromptDraftHasInput({
    kind: "thread",
    projectId: entry?.projectId ?? "",
    threadId,
  });
  return entry !== null && hasDraft ? HAS_DRAFT : NO_DRAFT;
}

export function useSidebarThreadDraftIds(): ReadonlySet<string> {
  const entries = useThreadEntryMap();
  const refs = useMemo(() => [...entries.values()], [entries]);
  const ids = usePromptDraftInputThreadIds(refs);
  return ids.size === 0 ? EMPTY_DRAFT_IDS : ids;
}

export function useSidebarThreadRowStatus(
  threadId: string,
): PluginSidebarThreadRowStatus | null {
  return usePluginThreadRowStatus(threadId);
}

export function useSidebarThreadRowStatuses(): ReadonlyMap<
  string,
  PluginSidebarThreadRowStatus
> {
  return usePluginThreadRowStatuses();
}

export function useSidebarThreadShortcut(
  threadId: string,
): PluginSidebarThreadShortcut | null {
  return useHostSidebarThreadShortcut(threadId) ?? null;
}

export function useSidebarThreadPullRequest(
  threadId: string,
): PluginSidebarThreadPullRequestState {
  const entry = useSidebarThreadEntry(threadId);
  const environmentId = entry?.environmentId ?? null;
  const query = useEnvironmentPullRequest(environmentId);
  const pullRequest = getEnvironmentPullRequestFromResponse(query.data);

  return useMemo<PluginSidebarThreadPullRequestState>(
    () => ({
      isLoading: environmentId !== null && query.isPending,
      pullRequest:
        pullRequest === null
          ? null
          : {
              number: pullRequest.number,
              title: pullRequest.title,
              url: pullRequest.url,
              state: pullRequest.state,
              attention: pullRequest.attention,
              experimental_autoMerge: pullRequest.autoMerge,
              experimental_inMergeQueue: pullRequest.inMergeQueue,
              experimental_checks: { state: pullRequest.checks.state },
              experimental_review: { state: pullRequest.review.state },
              experimental_mergeability: {
                state: pullRequest.mergeability.state,
              },
            },
    }),
    [environmentId, pullRequest, query.isPending],
  );
}
