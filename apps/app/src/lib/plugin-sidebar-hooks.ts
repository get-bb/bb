import { useCallback, useMemo } from "react";
import { useStore } from "jotai";
import {
  PERSONAL_PROJECT_ID,
  type Host,
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
import { useArchivedThreads } from "@/hooks/queries/thread-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
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

export function useSidebarThreads(
  options?: Parameters<PluginSdkApp["experimental_useSidebarThreads"]>[0],
): PluginSidebarThreadsState {
  const lifecycles = options?.experimental_lifecycles;
  const active = !lifecycles?.length || lifecycles.includes("active");
  const includeArchived = lifecycles?.includes("archived") ?? false;
  const archived = useArchivedThreads({}, { enabled: includeArchived });
  const fetchArchivedPage = archived.fetchNextPage;
  const fetchNextPage = useCallback(async () => {
    await fetchArchivedPage();
  }, [fetchArchivedPage]);
  const archiveState = useMemo<
    PluginSidebarThreadsState["experimental_archived"]
  >(
    () =>
      includeArchived
        ? {
            status:
              archived.data !== undefined
                ? "ready"
                : archived.isLoadingError
                  ? "error"
                  : "loading",
            hasNextPage: archived.hasNextPage,
            isFetchingNextPage: archived.isFetchingNextPage,
            isFetchNextPageError: archived.isFetchNextPageError,
            fetchNextPage,
          }
        : null,
    [
      includeArchived,
      archived.data,
      archived.isLoadingError,
      archived.hasNextPage,
      archived.isFetchingNextPage,
      archived.isFetchNextPageError,
      fetchNextPage,
    ],
  );
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
    const selected = new Map<string, ThreadListEntry>();
    if (includeArchived) {
      for (const thread of archived.data?.pages.flat() ?? []) {
        if (thread.archivedAt !== null) selected.set(thread.id, thread);
      }
    }
    if (active) {
      for (const project of allProjects) {
        for (const thread of project.threads) {
          if (thread.archivedAt === null) selected.set(thread.id, thread);
        }
      }
    }
    return {
      experimental_archived: archiveState,
      status: !active && archiveState !== null ? archiveState.status : "ready",
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
    includeArchived,
    archived.data,
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

const archivedEntryMaps = new WeakMap<
  NonNullable<ReturnType<typeof useArchivedThreads>["data"]>,
  WeakMap<
    ReadonlyMap<string, ThreadListEntry>,
    ReadonlyMap<string, ThreadListEntry>
  >
>();

function useThreadEntryMap(): ReadonlyMap<string, ThreadListEntry> {
  const { data } = useSidebarNavigation();
  const archived = useArchivedThreads({}, { enabled: false });
  return useMemo(() => {
    const active = threadEntryMapFor(data);
    if (archived.data === undefined) return active;
    let maps = archivedEntryMaps.get(archived.data);
    if (maps === undefined) {
      maps = new WeakMap();
      archivedEntryMaps.set(archived.data, maps);
    }
    const cached = maps.get(active);
    if (cached !== undefined) return cached;
    const entries = new Map([
      ...archived.data.pages
        .flat()
        .map((thread) => [thread.id, thread] as const),
      ...active,
    ]);
    maps.set(active, entries);
    return entries;
  }, [data, archived.data]);
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
            },
    }),
    [environmentId, pullRequest, query.isPending],
  );
}
