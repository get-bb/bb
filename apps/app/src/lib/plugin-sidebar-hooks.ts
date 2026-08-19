import { useCallback, useMemo } from "react";
import { useStore } from "jotai";
import {
  PERSONAL_PROJECT_ID,
  type Host,
  type ThreadListEntry,
} from "@bb/domain";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import type {
  PluginSidebarProject,
  PluginSidebarThread,
  PluginSidebarThreadActions,
  PluginSidebarThreadPullRequestState,
  PluginSidebarThreadsState,
} from "@get-bb/plugin-sdk";
import { useThreadActions } from "@/components/thread/ThreadActionsProvider";
import {
  getEnvironmentPullRequestFromResponse,
  useEnvironmentPullRequest,
} from "@/hooks/queries/environment-queries";
import { useHosts } from "@/hooks/queries/host-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useUpdateThread } from "@/hooks/mutations/thread-state-mutations";
import { useThreadSplitsEnabled } from "@/hooks/useThreadSplitsEnabled";
import { useRouteNavigate } from "@/components/ui/app-route-anchor";
import { toPluginSidebarThread } from "./plugin-sidebar-threads";
import { useSetRootComposeProjectId } from "./root-compose-selection";
import { openThreadInSplit } from "./split-layout/openThreadInSplit";
import {
  getRootComposeRoutePath,
  getProjectComposeRoutePath,
  getThreadRoutePath,
} from "./route-paths";

const EMPTY_THREADS: readonly PluginSidebarThread[] = [];
const EMPTY_PROJECTS: readonly PluginSidebarProject[] = [];
const EMPTY_ENTRIES: ReadonlyMap<string, ThreadListEntry> = new Map();
const EMPTY_HOST_NAMES: ReadonlyMap<string, string> = new Map();

/**
 * Host-name map per hosts payload. Module-level (not `useMemo`) so every
 * `useSidebarThreads` caller derives the same map object from the same React
 * Query result; a per-hook map would give two plugin lists two keys and make
 * them evict each other's entries from {@link pluginSidebarThreadByEntry}.
 */
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

/**
 * Per-entry DTO memo. React Query structurally shares the sidebar payload, so
 * an unchanged `ThreadListEntry` keeps its identity across refetches; mapping
 * it again produced a fresh DTO per thread per sidebar update, which defeats
 * `memo`/compiler bailouts in every plugin row. The DTO also depends on the
 * host-name map, so a cached DTO is reused only for the same map instance.
 */
const pluginSidebarThreadByEntry = new WeakMap<
  ThreadListEntry,
  { hostNamesById: ReadonlyMap<string, string>; thread: PluginSidebarThread }
>();

function toPluginSidebarThreadCached(
  entry: ThreadListEntry,
  hostNamesById: ReadonlyMap<string, string>,
): PluginSidebarThread {
  const cached = pluginSidebarThreadByEntry.get(entry);
  if (cached !== undefined && cached.hostNamesById === hostNamesById) {
    return cached.thread;
  }
  const thread = toPluginSidebarThread(entry, hostNamesById);
  pluginSidebarThreadByEntry.set(entry, { hostNamesById, thread });
  return thread;
}

/**
 * The sidebar's live thread view for plugin surfaces.
 *
 * Deliberately built on `useSidebarNavigation`, the same query the built-in
 * sidebar uses: it already owns the realtime subscriptions, so a plugin list
 * costs no extra request and updates on exactly the same events.
 *
 * `status` reports "error" only while there is nothing to show. Once data has
 * loaded, a failed background refresh keeps the last good list as "ready" —
 * the sidebar must not blank out because one refetch lost the network.
 */
export function useSidebarThreads(): PluginSidebarThreadsState {
  const query = useSidebarNavigation();
  const data = query.data;
  // The sidebar already subscribes to host updates; this reads the same
  // cached list so a row can print a machine name instead of a host id.
  const { data: hosts } = useHosts();
  const hostNamesById = hostNamesFor(hosts);

  return useMemo<PluginSidebarThreadsState>(() => {
    if (data === undefined) {
      return {
        status: query.isError ? "error" : "loading",
        threads: EMPTY_THREADS,
        projects: EMPTY_PROJECTS,
      };
    }
    // The personal project is a real project to a plugin list; the host just
    // stores it beside the others.
    const allProjects = [...data.projects, data.personalProject];
    return {
      status: "ready",
      threads: allProjects.flatMap((project) =>
        project.threads.map((thread) =>
          toPluginSidebarThreadCached(thread, hostNamesById),
        ),
      ),
      projects: allProjects.map((project) => ({
        id: project.id,
        name: project.name,
        isPersonal: project.id === PERSONAL_PROJECT_ID,
      })),
    };
  }, [data, hostNamesById, query.isError]);
}

/** Thread id -> host entry, for O(1) lookups by id. */
export function useThreadEntryMap(): ReadonlyMap<string, ThreadListEntry> {
  const { data } = useSidebarNavigation();
  return useMemo(() => {
    if (data === undefined) return EMPTY_ENTRIES;
    const entries = new Map<string, ThreadListEntry>();
    for (const project of [...data.projects, data.personalProject]) {
      for (const thread of project.threads) entries.set(thread.id, thread);
    }
    return entries;
  }, [data]);
}

/** One host thread entry by id, or null while it is unknown. */
export function useSidebarThreadEntry(
  threadId: string,
): ThreadListEntry | null {
  return useThreadEntryMap().get(threadId) ?? null;
}

/**
 * Thread actions for plugin surfaces.
 *
 * Destructive and dialog-bearing actions route through `useThreadActions()` —
 * the host's own flow, with its confirmation dialogs, pane closing, and route
 * repair. A plugin cannot render bb's dialogs, so calling the raw mutations
 * here would delete a subtree with no confirmation and leave panes pointing at
 * dead threads.
 */
export function useSidebarThreadActions(): PluginSidebarThreadActions {
  const navigate = useRouteNavigate();
  const store = useStore();
  const isCompact = useIsCompactViewport();
  const threadSplitsEnabled = useThreadSplitsEnabled();
  const setRootComposeProjectId = useSetRootComposeProjectId();
  const hostActions = useThreadActions();
  const entriesById = useThreadEntryMap();
  // Destructure `.mutateAsync`: the mutation object's identity changes on every
  // pending flip, which would defeat the memo below.
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
          openThreadInSplit({
            store,
            navigate,
            projectId,
            threadId,
            isCompact,
            threadSplitsEnabled,
          });
          return;
        }
        navigate(getThreadRoutePath({ projectId, threadId }));
      },
      openNewThread(options) {
        const projectId = options?.projectId;
        if (projectId !== undefined) {
          // The compose screen reads its project from this stored selection,
          // and the personal project has no route of its own — without this a
          // personal-project request would create the thread in whichever
          // project the user last composed in.
          setRootComposeProjectId(projectId);
        }
        const state = options?.focusPrompt ? { focusPrompt: true } : undefined;
        navigate(
          projectId === undefined
            ? getRootComposeRoutePath()
            : getProjectComposeRoutePath(projectId),
          state ? { state } : undefined,
        );
      },
      async setPinned(threadId, pinned) {
        const entry = requireEntry(threadId);
        if ((entry.pinnedAt !== null) === pinned) return;
        hostActions.togglePin(entry);
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
        hostActions.archiveThreadAndChildren(requireEntry(threadId));
      },
      requestDelete(threadId) {
        // Opens bb's delete dialog, which counts child threads and asks. The
        // plugin requests; the user confirms.
        hostActions.requestDelete(requireEntry(threadId));
      },
    }),
    [
      entriesById,
      hostActions,
      isCompact,
      navigate,
      requireEntry,
      setRootComposeProjectId,
      store,
      threadSplitsEnabled,
      updateThreadAsync,
    ],
  );
}

/**
 * The pull request for one thread's branch.
 *
 * Deliberately per row rather than a field on `useSidebarThreads`: a PR lookup
 * hits the git host, so it must be opt-in and paid only for rows that want it.
 * The underlying query is keyed by environment, so threads sharing a worktree
 * share one lookup, and the host's own staleness and refetch rules apply (an
 * open PR with pending checks polls; a merged one does not).
 */
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
