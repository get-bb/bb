import type { QueryClient } from "@tanstack/react-query";
import {
  threadTabsSchema,
  type ThreadTab,
  type ThreadTabsResponse,
} from "@bb/server-contract";
import { appToast } from "@/components/ui/app-toast";
import {
  getCachedThreadTabs,
  invalidateCachedThreadTabs,
  setCachedThreadTabs,
} from "@/hooks/cache-owners/thread-tabs-cache-owner";
import * as api from "./api";
import {
  areFixedPanelTabsEquivalent,
  type FixedPanelTabsState,
} from "./fixed-panel-tabs-state";

const THREAD_TABS_CONFLICT_RETRY_LIMIT = 3;

export interface ThreadTabsDelta {
  localOrderedTabIds: readonly string[];
  removedTabIds: ReadonlySet<string>;
  reordersExistingTabs: boolean;
  upsertedTabs: readonly ThreadTab[];
}

interface ThreadTabsSyncArgs {
  queryClient: QueryClient;
  threadId: string;
}

interface PersistThreadTabsDeltaArgs extends ThreadTabsSyncArgs {
  delta: ThreadTabsDelta;
}

interface MigrateLocalThreadTabsArgs extends ThreadTabsSyncArgs {
  tabs: readonly ThreadTab[];
}

const writeQueues = new WeakMap<QueryClient, Map<string, Promise<void>>>();
const pendingWriteCounts = new WeakMap<QueryClient, Map<string, number>>();
const attemptedLocalMigrations = new WeakMap<QueryClient, Set<string>>();

function areThreadTabListsEquivalent(
  left: readonly ThreadTab[],
  right: readonly ThreadTab[],
): boolean {
  return (
    left.length === right.length &&
    left.every((tab, index) => {
      const other = right[index];
      return other !== undefined && areFixedPanelTabsEquivalent(tab, other);
    })
  );
}

export function deriveThreadTabsDelta(
  previousTabs: readonly ThreadTab[],
  nextTabs: readonly ThreadTab[],
): ThreadTabsDelta | null {
  const previousById = new Map(previousTabs.map((tab) => [tab.id, tab]));
  const nextIds = new Set(nextTabs.map((tab) => tab.id));
  const removedTabIds = new Set(
    previousTabs.filter((tab) => !nextIds.has(tab.id)).map((tab) => tab.id),
  );
  const upsertedTabs = nextTabs.filter((tab) => {
    const previous = previousById.get(tab.id);
    return (
      previous === undefined || !areFixedPanelTabsEquivalent(previous, tab)
    );
  });
  const previousIds = new Set(previousTabs.map((tab) => tab.id));
  const localOrderedTabIds = nextTabs.map((tab) => tab.id);
  const previousSurvivingOrder = previousTabs
    .map((tab) => tab.id)
    .filter((id) => nextIds.has(id));
  const nextExistingOrder = localOrderedTabIds.filter((id) =>
    previousIds.has(id),
  );
  const reordersExistingTabs = previousSurvivingOrder.some(
    (id, index) => id !== nextExistingOrder[index],
  );
  const membershipChanged =
    removedTabIds.size > 0 || previousTabs.length !== nextTabs.length;

  if (
    !membershipChanged &&
    upsertedTabs.length === 0 &&
    !reordersExistingTabs
  ) {
    return null;
  }
  return {
    localOrderedTabIds,
    removedTabIds,
    reordersExistingTabs,
    upsertedTabs,
  };
}

export function applyThreadTabsDelta(
  remoteTabs: readonly ThreadTab[],
  delta: ThreadTabsDelta,
): readonly ThreadTab[] {
  const tabsById = new Map(remoteTabs.map((tab) => [tab.id, tab]));
  for (const tabId of delta.removedTabIds) {
    tabsById.delete(tabId);
  }
  for (const tab of delta.upsertedTabs) {
    tabsById.set(tab.id, tab);
  }

  const remoteOrderedIds = remoteTabs
    .map((tab) => tab.id)
    .filter((id) => tabsById.has(id));
  let mergedIds: string[];

  if (delta.reordersExistingTabs) {
    const localIds = new Set(delta.localOrderedTabIds);
    mergedIds = [
      ...delta.localOrderedTabIds.filter((id) => tabsById.has(id)),
      ...remoteOrderedIds.filter((id) => !localIds.has(id)),
    ];
  } else {
    // Preserve the remote order and insert only local tabs that are absent
    // from it. This keeps metadata edits, additions, and removals from
    // undoing a concurrent reorder.
    mergedIds = [...remoteOrderedIds];
    const mergedIdSet = new Set(mergedIds);
    let localIndex = 0;
    while (localIndex < delta.localOrderedTabIds.length) {
      const localId = delta.localOrderedTabIds[localIndex];
      if (localId === undefined || mergedIdSet.has(localId)) {
        localIndex += 1;
        continue;
      }

      const groupStartIndex = localIndex;
      const group: string[] = [];
      while (localIndex < delta.localOrderedTabIds.length) {
        const candidateId = delta.localOrderedTabIds[localIndex];
        if (candidateId === undefined || mergedIdSet.has(candidateId)) {
          break;
        }
        if (tabsById.has(candidateId)) {
          group.push(candidateId);
        }
        localIndex += 1;
      }
      if (group.length === 0) {
        continue;
      }

      let previousLocalId: string | undefined;
      for (
        let previousIndex = groupStartIndex - 1;
        previousIndex >= 0;
        previousIndex -= 1
      ) {
        const candidateId = delta.localOrderedTabIds[previousIndex];
        if (candidateId !== undefined && mergedIdSet.has(candidateId)) {
          previousLocalId = candidateId;
          break;
        }
      }
      const nextLocalId = delta.localOrderedTabIds
        .slice(localIndex)
        .find((id) => mergedIdSet.has(id));
      const previousIndex =
        previousLocalId === undefined ? -1 : mergedIds.indexOf(previousLocalId);
      const nextIndex =
        nextLocalId === undefined ? -1 : mergedIds.indexOf(nextLocalId);
      const insertionIndex =
        nextLocalId === undefined
          ? mergedIds.length
          : previousIndex >= 0
            ? previousIndex + 1
            : nextIndex >= 0
              ? nextIndex
              : mergedIds.length;
      mergedIds.splice(insertionIndex, 0, ...group);
      for (const id of group) {
        mergedIdSet.add(id);
      }
    }
  }

  return mergedIds.flatMap((id) => {
    const tab = tabsById.get(id);
    return tab === undefined ? [] : [tab];
  });
}

export function reconcileFixedPanelTabsState(
  current: FixedPanelTabsState,
  serverTabs: readonly ThreadTab[],
): FixedPanelTabsState {
  if (areThreadTabListsEquivalent(current.secondary.tabs, serverTabs)) {
    return current;
  }
  const activeTabId = serverTabs.some(
    (tab) => tab.id === current.secondary.activeTabId,
  )
    ? current.secondary.activeTabId
    : null;
  return {
    ...current,
    secondary: {
      ...current.secondary,
      activeTabId,
      tabs: serverTabs,
    },
  };
}

function getWriteQueue(queryClient: QueryClient): Map<string, Promise<void>> {
  let queue = writeQueues.get(queryClient);
  if (queue === undefined) {
    queue = new Map();
    writeQueues.set(queryClient, queue);
  }
  return queue;
}

function adjustPendingWriteCount(
  queryClient: QueryClient,
  threadId: string,
  adjustment: 1 | -1,
): void {
  let counts = pendingWriteCounts.get(queryClient);
  if (counts === undefined) {
    counts = new Map();
    pendingWriteCounts.set(queryClient, counts);
  }
  const nextCount = (counts.get(threadId) ?? 0) + adjustment;
  if (nextCount <= 0) {
    counts.delete(threadId);
  } else {
    counts.set(threadId, nextCount);
  }
}

export function hasPendingThreadTabsWrite(
  queryClient: QueryClient,
  threadId: string,
): boolean {
  return (pendingWriteCounts.get(queryClient)?.get(threadId) ?? 0) > 0;
}

async function readCurrentThreadTabs({
  queryClient,
  threadId,
}: ThreadTabsSyncArgs): Promise<ThreadTabsResponse> {
  const cached = getCachedThreadTabs(queryClient, threadId);
  if (cached !== undefined) {
    return cached;
  }
  const response = await api.getThreadTabs(threadId);
  setCachedThreadTabs(queryClient, threadId, response);
  return response;
}

async function readFreshThreadTabs({
  queryClient,
  threadId,
}: ThreadTabsSyncArgs): Promise<ThreadTabsResponse> {
  const response = await api.getThreadTabs(threadId);
  setCachedThreadTabs(queryClient, threadId, response);
  return response;
}

function isThreadTabsConflict(error: unknown): boolean {
  return (
    error instanceof api.HttpError &&
    error.status === 409 &&
    error.code === "thread_tabs_conflict"
  );
}

async function persistThreadTabsDelta({
  delta,
  queryClient,
  threadId,
}: PersistThreadTabsDeltaArgs): Promise<void> {
  let current = await readCurrentThreadTabs({ queryClient, threadId });
  for (
    let attempt = 0;
    attempt < THREAD_TABS_CONFLICT_RETRY_LIMIT;
    attempt += 1
  ) {
    const mergedTabs = applyThreadTabsDelta(current.tabs, delta);
    if (areThreadTabListsEquivalent(current.tabs, mergedTabs)) {
      return;
    }
    try {
      const response = await api.updateThreadTabs(threadId, {
        expectedRevision: current.revision,
        tabs: threadTabsSchema.parse(mergedTabs),
      });
      setCachedThreadTabs(queryClient, threadId, response);
      return;
    } catch (error) {
      if (!isThreadTabsConflict(error)) {
        throw error;
      }
      current = await readFreshThreadTabs({ queryClient, threadId });
    }
  }
  throw new Error("Thread tabs kept changing while this update was saved");
}

async function migrateLocalThreadTabs({
  queryClient,
  tabs,
  threadId,
}: MigrateLocalThreadTabsArgs): Promise<void> {
  const current = await readCurrentThreadTabs({ queryClient, threadId });
  if (current.revision !== 0) {
    return;
  }
  try {
    const response = await api.updateThreadTabs(threadId, {
      expectedRevision: 0,
      tabs: threadTabsSchema.parse(tabs),
    });
    setCachedThreadTabs(queryClient, threadId, response);
  } catch (error) {
    if (!isThreadTabsConflict(error)) {
      throw error;
    }
    await readFreshThreadTabs({ queryClient, threadId });
  }
}

function enqueueThreadTabsWrite(
  { queryClient, threadId }: ThreadTabsSyncArgs,
  operation: () => Promise<void>,
): void {
  const queue = getWriteQueue(queryClient);
  const previous = queue.get(threadId) ?? Promise.resolve();
  adjustPendingWriteCount(queryClient, threadId, 1);
  const next = previous.catch(() => undefined).then(operation);
  queue.set(threadId, next);

  void next
    .catch((error: unknown) => {
      invalidateCachedThreadTabs(queryClient, threadId);
      appToast.error("Couldn’t sync tabs", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    })
    .finally(() => {
      adjustPendingWriteCount(queryClient, threadId, -1);
      if (queue.get(threadId) === next) {
        queue.delete(threadId);
      }
    });
}

export function scheduleThreadTabsDeltaPersistence(
  args: PersistThreadTabsDeltaArgs,
): void {
  enqueueThreadTabsWrite(args, () => persistThreadTabsDelta(args));
}

export function scheduleLocalThreadTabsMigration(
  args: MigrateLocalThreadTabsArgs,
): void {
  let attempted = attemptedLocalMigrations.get(args.queryClient);
  if (attempted === undefined) {
    attempted = new Set();
    attemptedLocalMigrations.set(args.queryClient, attempted);
  }
  if (attempted.has(args.threadId)) {
    return;
  }
  attempted.add(args.threadId);
  enqueueThreadTabsWrite(args, () => migrateLocalThreadTabs(args));
}
