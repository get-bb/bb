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
import { BbHttpError, sdk } from "./sdk";
import {
  areFixedPanelTabsEquivalent,
  type FixedPanelTabsState,
} from "./fixed-panel-tabs-state";

interface ThreadTabsSyncArgs {
  queryClient: QueryClient;
  threadId: string;
}

interface PersistThreadTabsArgs extends ThreadTabsSyncArgs {
  tabs: readonly ThreadTab[];
}

interface MigrateLocalThreadTabsArgs extends ThreadTabsSyncArgs {
  tabs: readonly ThreadTab[];
}

const writeQueues = new WeakMap<QueryClient, Map<string, Promise<void>>>();
const pendingWriteCounts = new WeakMap<QueryClient, Map<string, number>>();
const attemptedLocalMigrations = new WeakMap<QueryClient, Set<string>>();

export function areThreadTabListsEquivalent(
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
  const response = await sdk.threads.tabs.get({ threadId });
  setCachedThreadTabs(queryClient, threadId, response);
  return response;
}

function isThreadTabsConflict(error: unknown): boolean {
  return (
    error instanceof BbHttpError &&
    error.status === 409 &&
    error.code === "thread_tabs_conflict"
  );
}

async function persistThreadTabs({
  tabs,
  queryClient,
  threadId,
}: PersistThreadTabsArgs): Promise<void> {
  const current = await readCurrentThreadTabs({ queryClient, threadId });
  if (areThreadTabListsEquivalent(current.tabs, tabs)) {
    return;
  }
  const response = await sdk.threads.tabs.update({
    expectedRevision: current.revision,
    tabs: threadTabsSchema.parse(tabs),
    threadId,
  });
  setCachedThreadTabs(queryClient, threadId, response);
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
  const response = await sdk.threads.tabs.update({
    expectedRevision: 0,
    tabs: threadTabsSchema.parse(tabs),
    threadId,
  });
  setCachedThreadTabs(queryClient, threadId, response);
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

  let didFail = false;
  void next
    .catch((error: unknown) => {
      didFail = true;
      if (!isThreadTabsConflict(error)) {
        appToast.error("Couldn’t sync tabs", {
          description:
            error instanceof Error ? error.message : "Please try again.",
        });
      }
    })
    .finally(() => {
      adjustPendingWriteCount(queryClient, threadId, -1);
      if (didFail) {
        invalidateCachedThreadTabs(queryClient, threadId);
      }
      if (queue.get(threadId) === next) {
        queue.delete(threadId);
      }
    });
}

export function scheduleThreadTabsPersistence(
  args: PersistThreadTabsArgs,
): void {
  enqueueThreadTabsWrite(args, () => persistThreadTabs(args));
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
