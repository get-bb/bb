import { createDebouncedCallbackScheduler } from "@bb/domain";
import type {
  ChangedMessage,
  SidebarBootstrapResponse,
  ThreadChangedMessage,
  ThreadChangeKind,
  ThreadResponse,
} from "@bb/server-contract";
import {
  hashKey,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import type { MobileRealtime } from "../realtime/mobile-realtime";
import {
  disposeTrailingActiveRefetches,
  invalidateTimelineQueryKeyPaced,
  invalidateTimelineQueryKeyTerminal,
} from "./timeline-refetch-pacing";
import {
  removeAllDiffPatchQueries,
  removeEnvironmentDiffPatchQueries,
} from "./diff-patch-cache";
import {
  allEnvironmentDiffFilesQueryKeyPrefix,
  allEnvironmentMergeBaseBranchesQueryKeyPrefix,
  allEnvironmentPullRequestQueryKeyPrefix,
  allEnvironmentQueryKeyPrefix,
  allEnvironmentWorkStatusQueryKeyPrefix,
  allHostCloneDefaultPathQueryKeyPrefix,
  allHostDirectoryQueryKeyPrefix,
  allHostProviderCliStatusQueryKeyPrefix,
  allHostQueryKeyPrefix,
  allSystemUsageLimitsQueryKeyPrefix,
  hostProviderCliStatusQueryKey,
  systemCliSkillsQueryKey,
  themeCatalogQueryKey,
  allPluginMentionSearchQueryKeyPrefix,
  allProjectCommandsQueryKeyPrefix,
  allProjectDefaultExecutionOptionsQueryKeyPrefix,
  allProjectPathsQueryKeyPrefix,
  allProjectSourceBranchesQueryKeyPrefix,
  allSystemExecutionOptionsQueryKeyPrefix,
  allSystemProvidersQueryKeyPrefix,
  pluginContributionsQueryKey,
  pluginsQueryKey,
  allPluginSettingsQueryKeyPrefix,
  pluginUpdatesQueryKey,
  allPluginCatalogSearchQueryKeyPrefix,
  allProjectSkillsQueryKeyPrefix,
  environmentDiffFilesQueryKeyPrefix,
  environmentMergeBaseBranchesQueryKeyPrefix,
  environmentPathsQueryKeyPrefix,
  environmentPullRequestQueryKey,
  environmentQueryKey,
  environmentsQueryKey,
  environmentWorkStatusQueryKeyPrefix,
  hostQueryKey,
  hostsQueryKey,
  projectsQueryKey,
  sidebarNavigationQueryKey,
  systemConfigQueryKey,
  threadDefaultExecutionOptionsQueryKey,
  threadDetailBootstrapQueryKey,
  threadPendingInteractionsQueryKey,
  threadQueryKey,
  threadQueuedMessagesQueryKey,
  threadSearchQueryKeyPrefix,
  allTerminalsQueryKeyPrefix,
  allTerminalSessionQueryKeyPrefix,
  threadTabsQueryKey,
  allThreadStoragePathsQueryKeyPrefix,
  allThreadStorageFilesQueryKeyPrefix,
  allThreadStorageFilePreviewQueryKeyPrefix,
  allProjectFilePreviewQueryKeyPrefix,
  environmentFilePreviewQueryKeyPrefix,
  projectFilePreviewQueryKeyPrefix,
  threadTimelineQueryKey,
  threadTimelineTurnSummaryDetailsQueryKeyPrefix,
  threadsQueryKey,
} from "./query-keys";

const INVALIDATION_DEBOUNCE_MS = 50;
const INVALIDATION_MAX_WAIT_MS = 200;

/**
 * Thread change kinds that alter what a thread list / sidebar shows. Timeline
 * streaming (`events-appended`) deliberately is not one of them.
 */
const THREAD_LIST_AFFECTING_KINDS: ReadonlySet<ThreadChangeKind> =
  new Set<ThreadChangeKind>([
    "thread-created",
    "thread-deleted",
    "interactions-changed",
    "status-changed",
    "title-changed",
    "archived-changed",
    "pin-state-changed",
    "parent-changed",
    "environment-changed",
    "read-state-changed",
    "order-changed",
  ]);

/** Every cached view of "which threads exist, in what state and order". */
function threadListQueryKeys(): QueryKey[] {
  return [
    threadsQueryKey(),
    sidebarNavigationQueryKey(),
    threadSearchQueryKeyPrefix(),
  ];
}

/**
 * Coarse query keys to invalidate for one realtime message: per-entity keys
 * plus the lists an entity change can reorder. Coarser than the web app's
 * realtime-cache-registry (the reference) — mobile keeps far fewer queries
 * mounted, so a prefix invalidation is cheap.
 */
export function queryKeysForChangedMessage(
  message: ChangedMessage,
): readonly QueryKey[] {
  switch (message.entity) {
    case "thread": {
      const keys: QueryKey[] = [];
      const id = message.id;
      if (id === undefined) {
        // Global thread change (bulk archive, reorder): every list is suspect.
        return threadListQueryKeys();
      }
      const kinds = new Set(message.changes);
      if (
        message.changes.some((kind) => kind !== "events-appended") ||
        message.metadata?.backgroundActivityChanged === true
      ) {
        // The record's own fields travel under dedicated kinds (status, title,
        // archive, ...); a pure `events-appended` batch is timeline streaming
        // and only touches the record when the server flags a
        // background-activity change. Re-issuing (and cancelling) the detail
        // GET on every ~200 ms flush would starve it for the whole turn on a
        // slow link.
        keys.push(threadQueryKey(id));
      }
      if (kinds.has("events-appended") || kinds.has("history-rewritten")) {
        keys.push(threadTimelineQueryKey(id));
      }
      if (kinds.has("history-rewritten")) {
        keys.push(
          threadDetailBootstrapQueryKey(id),
          // Completed-turn detail windows are immutable except across a
          // rewrite (edit/fork/compaction).
          threadTimelineTurnSummaryDetailsQueryKeyPrefix(id),
        );
      }
      if (kinds.has("interactions-changed")) {
        keys.push(threadPendingInteractionsQueryKey(id));
      }
      if (kinds.has("queue-changed")) {
        keys.push(threadQueuedMessagesQueryKey(id));
      }
      if (kinds.has("terminals-changed")) {
        // A terminal of this thread was created / renamed / closed / exited
        // (including by another client); the per-session record follows.
        // Mobile keeps at most a couple of terminal lists mounted, so the
        // prefix is cheaper than rebuilding every scope a session appears in.
        keys.push(
          allTerminalsQueryKeyPrefix(),
          allTerminalSessionQueryKeyPrefix(),
        );
      }
      if (kinds.has("tabs-changed")) {
        // Another client wrote the panel tab strip (`PUT /threads/:id/tabs`).
        keys.push(threadTabsQueryKey(id));
      }
      if (kinds.has("environment-changed") || kinds.has("history-rewritten")) {
        // The environment routes the model probe and the inherited defaults;
        // a rewrite replays the last accepted run's options.
        keys.push(threadDefaultExecutionOptionsQueryKey(id));
      }
      if (
        message.changes.some((kind) => THREAD_LIST_AFFECTING_KINDS.has(kind))
      ) {
        keys.push(...threadListQueryKeys());
      }
      return keys;
    }
    case "project": {
      const kinds = new Set(message.changes);
      const keys: QueryKey[] = [projectsQueryKey(), ...threadListQueryKeys()];
      if (kinds.has("project-sources-changed")) {
        // Sources back path suggestions, branch pickers, the resolved
        // thread-creation defaults, and the "path still exists" probe.
        keys.push(
          allProjectPathsQueryKeyPrefix(),
          allProjectSourceBranchesQueryKeyPrefix(),
          allProjectDefaultExecutionOptionsQueryKeyPrefix(),
          allProjectCommandsQueryKeyPrefix(),
          // Project file previews read through the (changed) source root.
          message.id === undefined
            ? allProjectFilePreviewQueryKeyPrefix()
            : projectFilePreviewQueryKeyPrefix(message.id),
        );
      }
      return keys;
    }
    case "environment": {
      const kinds = new Set(message.changes);
      if (message.id === undefined) {
        // Global environment change: every record and workspace view is suspect.
        return [
          environmentsQueryKey(),
          allEnvironmentQueryKeyPrefix(),
          allEnvironmentWorkStatusQueryKeyPrefix(),
          allEnvironmentPullRequestQueryKeyPrefix(),
          allEnvironmentMergeBaseBranchesQueryKeyPrefix(),
          allEnvironmentDiffFilesQueryKeyPrefix(),
        ];
      }
      const id = message.id;
      const keys: QueryKey[] = [environmentsQueryKey()];
      // Work-status and git-ref changes are workspace facts (the daemon's
      // file watcher); the record only changes with metadata/status kinds.
      const workspaceOnly =
        message.changes.length > 0 &&
        message.changes.every(
          (kind) =>
            kind === "work-status-changed" || kind === "git-refs-changed",
        );
      if (!workspaceOnly) {
        // The pull request is remote state: a local file edit or ref move
        // cannot change it, so workspace-only changes deliberately leave it
        // alone (`turn/completed` — see
        // `threadPullRequestQueryKeysForCompletedTurn` — and the pending-check
        // poll cover it). Lifecycle and metadata changes can change whether
        // and how the lookup resolves.
        keys.push(environmentQueryKey(id), environmentPullRequestQueryKey(id));
      }
      // Any change can move the working tree (a status change makes it
      // available; metadata can change how the request resolves).
      keys.push(
        environmentWorkStatusQueryKeyPrefix(id),
        // The diff tab's table of contents and the per-side file reads follow
        // the working tree (work status) and the merge base (git refs); the
        // observer-less patch cache is evicted separately
        // (`diffPatchEvictionForChangedMessage`).
        environmentDiffFilesQueryKeyPrefix(id),
      );
      if (kinds.has("work-status-changed")) {
        // Files appeared / vanished / changed in the worktree: path mentions
        // re-query and open workspace file previews re-read.
        keys.push(
          environmentPathsQueryKeyPrefix(id),
          environmentFilePreviewQueryKeyPrefix(id),
        );
      }
      if (kinds.has("thread-storage-changed")) {
        // Storage lists / previews use thread-scoped keys; mobile does not
        // index threads by environment, so every cached storage view refreshes.
        keys.push(
          allThreadStoragePathsQueryKeyPrefix(),
          allThreadStorageFilesQueryKeyPrefix(),
          allThreadStorageFilePreviewQueryKeyPrefix(),
        );
      }
      if (!kinds.has("work-status-changed") || kinds.size > 1) {
        // Refs, metadata, and lifecycle changes can add/remove/rename the
        // merge-base candidates; a file edit cannot.
        keys.push(environmentMergeBaseBranchesQueryKeyPrefix(id));
      }
      if (kinds.has("metadata-changed")) {
        // Sidebar/worktree rows and search rows project environment labels
        // (name, branch) from thread list entries.
        keys.push(...threadListQueryKeys());
      }
      return keys;
    }
    case "host":
      return [
        hostsQueryKey(),
        ...(message.id === undefined
          ? [allHostQueryKeyPrefix()]
          : [hostQueryKey(message.id)]),
        // Host presence changes which providers/execution options resolve,
        // whether project sources are reachable, and whether the daemon-backed
        // path browser / existence probes can answer at all.
        allSystemProvidersQueryKeyPrefix(),
        allSystemExecutionOptionsQueryKeyPrefix(),
        allProjectDefaultExecutionOptionsQueryKeyPrefix(),
        systemConfigQueryKey(),
        sidebarNavigationQueryKey(),
        allHostDirectoryQueryKeyPrefix(),
        allHostCloneDefaultPathQueryKeyPrefix(),
        // A (re)connected daemon can answer the provider-CLI / CLI-skills /
        // usage probes again (and an offline one no longer can).
        message.id === undefined
          ? allHostProviderCliStatusQueryKeyPrefix()
          : hostProviderCliStatusQueryKey(message.id),
        systemCliSkillsQueryKey(),
        allSystemUsageLimitsQueryKeyPrefix(),
      ];
    case "system": {
      const kinds = new Set(message.changes);
      const keys: QueryKey[] = [systemConfigQueryKey()];
      if (
        kinds.has("config-changed") ||
        kinds.has("provider-registrations-changed") ||
        kinds.has("plugins-changed")
      ) {
        // Settings writes (default provider/model, permission policy) and
        // provider plugins change the roster and the resolved defaults.
        keys.push(
          allSystemProvidersQueryKeyPrefix(),
          allSystemExecutionOptionsQueryKeyPrefix(),
          allProjectDefaultExecutionOptionsQueryKeyPrefix(),
        );
      }
      if (kinds.has("plugins-changed")) {
        // Plugin mention providers / skills come and go with plugins.
        keys.push(
          pluginContributionsQueryKey(),
          allPluginMentionSearchQueryKeyPrefix(),
          allProjectCommandsQueryKeyPrefix(),
          // The management surfaces: the installed list (status / enabled /
          // version), every settings view (a reload re-runs the factory), the
          // update results, the catalog's `installed` flags, and bundled
          // plugin skills in the skills library.
          pluginsQueryKey(),
          allPluginSettingsQueryKeyPrefix(),
          pluginUpdatesQueryKey(),
          allPluginCatalogSearchQueryKeyPrefix(),
          allProjectSkillsQueryKeyPrefix(),
        );
      }
      if (kinds.has("config-changed") || kinds.has("plugins-changed")) {
        // Custom themes on disk and plugin palettes feed the palette picker.
        keys.push(themeCatalogQueryKey());
      }
      return keys;
    }
    default:
      return [];
  }
}

/**
 * Diff-patch cache evictions for one realtime message. Patches are
 * observer-less (see `diff-patch-cache.ts`), so an invalidation would never
 * refetch them: a workspace change removes them and bumps the eviction
 * generation, and the diff list re-requests the visible paths once its own
 * table-of-contents query refetches. `"all"` for a global environment change.
 */
function diffPatchEvictionForChangedMessage(
  message: ChangedMessage,
): "all" | string | null {
  if (message.entity !== "environment") return null;
  return message.id === undefined ? "all" : message.id;
}

/** The cached environment of a thread: its record first, then the sidebar. */
function cachedThreadEnvironmentId(
  queryClient: QueryClient,
  threadId: string,
): string | null {
  const thread = queryClient.getQueryData<ThreadResponse>(
    threadQueryKey(threadId),
  );
  if (thread !== undefined) return thread.environmentId;
  const sidebar = queryClient.getQueryData<SidebarBootstrapResponse>(
    sidebarNavigationQueryKey(),
  );
  if (sidebar === undefined) return null;
  for (const project of [...sidebar.projects, sidebar.personalProject]) {
    const entry = project.threads.find((row) => row.id === threadId);
    if (entry !== undefined) return entry.environmentId;
  }
  return null;
}

/**
 * Cache-derived keys for one realtime message (mirrors the web registry's
 * `dirtyThreadPullRequestQueryForCompletedTurn`): a completed turn may have
 * created or updated a remote pull request without changing the workspace, so
 * it refetches the PR of the thread's environment. The PR query is only
 * mounted from the thread screen, where the thread record is cached; the
 * sidebar covers a cached-but-unobserved PR of another thread.
 */
export function threadPullRequestQueryKeysForCompletedTurn(
  queryClient: QueryClient,
  message: ChangedMessage,
): readonly QueryKey[] {
  if (
    message.entity !== "thread" ||
    message.id === undefined ||
    !message.changes.includes("events-appended") ||
    !message.metadata?.eventTypes?.includes("turn/completed")
  ) {
    return [];
  }
  const environmentId = cachedThreadEnvironmentId(queryClient, message.id);
  return environmentId === null
    ? []
    : [environmentPullRequestQueryKey(environmentId)];
}

/**
 * How one queued invalidation is applied on flush. The timeline window is the
 * only query with a streaming producer, so it is the only one that gets the
 * non-cancelling paced path (see `timeline-refetch-pacing.ts`).
 */
export type TimelineInvalidationPolicy =
  | "default"
  | "timeline-paced"
  | "timeline-terminal";

const INVALIDATION_POLICY_RANK: Record<TimelineInvalidationPolicy, number> = {
  "timeline-paced": 0,
  default: 1,
  "timeline-terminal": 2,
};

function isTimelineQueryKey(queryKey: QueryKey): boolean {
  return queryKey[0] === threadTimelineQueryKey("")[0];
}

/**
 * Policy for the timeline window key of one thread change. Appends (the
 * streaming producer) never cancel the active read; a `turn/completed`
 * append is terminal and replaces it; every other change (history rewrite,
 * deletion) takes the default cancel-and-refetch path.
 */
export function timelineInvalidationPolicyForMessage(
  message: ThreadChangedMessage,
): TimelineInvalidationPolicy {
  const kinds = new Set(message.changes);
  if (!kinds.has("events-appended") || kinds.has("history-rewritten")) {
    return "default";
  }
  return message.metadata?.eventTypes?.includes("turn/completed")
    ? "timeline-terminal"
    : "timeline-paced";
}

function invalidationPolicyForKey(
  message: ChangedMessage,
  queryKey: QueryKey,
): TimelineInvalidationPolicy {
  if (message.entity !== "thread" || !isTimelineQueryKey(queryKey)) {
    return "default";
  }
  return timelineInvalidationPolicyForMessage(message);
}

function strongerInvalidationPolicy(
  left: TimelineInvalidationPolicy,
  right: TimelineInvalidationPolicy,
): TimelineInvalidationPolicy {
  return INVALIDATION_POLICY_RANK[right] > INVALIDATION_POLICY_RANK[left]
    ? right
    : left;
}

interface PendingInvalidation {
  queryKey: QueryKey;
  policy: TimelineInvalidationPolicy;
}

/**
 * Reconnect catch-up (mirrors `invalidateRealtimeQueriesAfterServerReconnect`
 * in apps/app/src/hooks/cache-owners/system-cache-effects.ts). Queries whose
 * data landed after `disconnectedAt` were fetched while the old socket was
 * still delivering changes and are left alone; everything older — including
 * never-loaded and errored queries, whose `dataUpdatedAt` is 0 — is refetched.
 * On a phone every app switch reconnects the socket while the focus refetch is
 * already loading the visible screen, so a blanket invalidate with the default
 * `cancelRefetch: true` would abort those partially downloaded responses and
 * start every one over.
 */
function invalidateQueriesStaleSince(
  queryClient: QueryClient,
  disconnectedAt: number,
): void {
  void queryClient.invalidateQueries(
    { predicate: (query) => query.state.dataUpdatedAt < disconnectedAt },
    // A fetch already in flight resolves to post-reconnect data; keep it.
    { cancelRefetch: false },
  );
}

export interface RealtimeInvalidationHandle {
  /** Invalidate everything queued so far without waiting for the debounce. */
  flush(): void;
  dispose(): void;
}

/**
 * Bridge realtime `changed` messages into TanStack invalidations for one
 * profile's QueryClient. Invalidations are coalesced (50 ms debounce, 200 ms
 * max wait) so a streaming turn does not restart the same refetch on every
 * frame. A reconnect (including resume from background) catches up from the
 * socket's watermark: the server has no resume cursor, so every query whose
 * data predates the moment the previous socket was last known healthy is
 * invalidated (see `invalidateQueriesStaleSince`) and the observer-less diff
 * patch cache is evicted.
 */
export function installRealtimeInvalidation(
  queryClient: QueryClient,
  realtime: MobileRealtime,
): RealtimeInvalidationHandle {
  const pending = new Map<string, PendingInvalidation>();
  let pendingPatchEvictions: Set<string> | "all" = new Set<string>();
  const scheduler = createDebouncedCallbackScheduler({
    debounceMs: INVALIDATION_DEBOUNCE_MS,
    maxWaitMs: INVALIDATION_MAX_WAIT_MS,
    onFlush: () => {
      const entries = Array.from(pending.values());
      pending.clear();
      // Evict before invalidating: the generation bump must precede the TOC
      // refetch that makes the diff list re-request its visible patches.
      const evictions = pendingPatchEvictions;
      pendingPatchEvictions = new Set<string>();
      if (evictions === "all") {
        removeAllDiffPatchQueries(queryClient);
      } else {
        for (const environmentId of evictions) {
          removeEnvironmentDiffPatchQueries(queryClient, environmentId);
        }
      }
      for (const { queryKey, policy } of entries) {
        switch (policy) {
          case "timeline-paced":
            invalidateTimelineQueryKeyPaced(queryClient, queryKey);
            break;
          case "timeline-terminal":
            invalidateTimelineQueryKeyTerminal(queryClient, queryKey);
            break;
          case "default":
            void queryClient.invalidateQueries({ queryKey });
            break;
        }
      }
    },
  });

  const unsubscribeChanged = realtime.onChanged((message) => {
    const eviction = diffPatchEvictionForChangedMessage(message);
    if (eviction === "all") {
      pendingPatchEvictions = "all";
    } else if (eviction !== null && pendingPatchEvictions !== "all") {
      pendingPatchEvictions.add(eviction);
    }
    const keys = [
      ...queryKeysForChangedMessage(message),
      ...threadPullRequestQueryKeysForCompletedTurn(queryClient, message),
    ];
    if (keys.length === 0 && eviction === null) return;
    for (const queryKey of keys) {
      const hash = hashKey(queryKey);
      const policy = invalidationPolicyForKey(message, queryKey);
      const current = pending.get(hash);
      pending.set(hash, {
        queryKey,
        policy: current
          ? strongerInvalidationPolicy(current.policy, policy)
          : policy,
      });
    }
    scheduler.schedule();
  });
  const unsubscribeConnected = realtime.onConnected((event) => {
    if (!event.reconnected) return;
    // The observer-less patch cache is never refetched by an invalidation, and
    // the workspace changes that would have evicted it were missed while the
    // socket was down (suspended in the background): remove it, bumping every
    // environment's generation so a patch fetch in flight across the
    // reconnect drops its stale write. The TOC refetch below re-requests the
    // visible paths (mirrors the web's system-cache-effects reconnect path).
    removeAllDiffPatchQueries(queryClient);
    invalidateQueriesStaleSince(queryClient, event.disconnectedAt);
  });

  return {
    flush: () => {
      if (
        pending.size > 0 ||
        pendingPatchEvictions === "all" ||
        pendingPatchEvictions.size > 0
      ) {
        scheduler.flush();
      }
    },
    dispose: () => {
      unsubscribeChanged();
      unsubscribeConnected();
      scheduler.dispose();
      disposeTrailingActiveRefetches(queryClient);
      pending.clear();
    },
  };
}
