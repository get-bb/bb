import {
  matchQuery,
  type Query,
  type QueryCacheNotifyEvent,
  type QueryClient,
} from "@tanstack/react-query";
import type { ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import {
  sidebarNavigationQueryKey,
  threadQueryKey,
  threadsQueryKey,
} from "../queries/query-keys";
import { applyToCachedThreadListsAndSidebarNavigation } from "./query-cache";

export type ThreadMetadataPatch = Partial<
  Pick<
    ThreadListEntry,
    "parentThreadId" | "pinnedAt" | "pinSortKey" | "sectionId" | "title"
  >
>;

type ThreadPatches = ReadonlyMap<string, ThreadMetadataPatch>;

interface PendingThreadPatchHold {
  patches: ThreadPatches;
}

interface PendingThreadPatchRegistry {
  holds: Set<PendingThreadPatchHold>;
  unsubscribe: () => void;
}

const registries = new WeakMap<QueryClient, PendingThreadPatchRegistry>();

function isPatchApplied<T extends object>(
  value: T,
  patch: Partial<T>,
): boolean {
  return Object.entries(patch).every(
    ([key, patchValue]) => value[key as keyof T] === patchValue,
  );
}

function patchThreadList(
  list: ThreadListEntry[],
  patches: ThreadPatches,
): ThreadListEntry[] {
  if (
    list.every((thread) => {
      const patch = patches.get(thread.id);
      return !patch || isPatchApplied(thread, patch);
    })
  ) {
    return list;
  }
  return list.map((thread) => {
    const patch = patches.get(thread.id);
    return patch ? { ...thread, ...patch } : thread;
  });
}

export function applyThreadPatches(
  queryClient: QueryClient,
  patches: ThreadPatches,
): void {
  for (const [threadId, { pinSortKey: _pinSortKey, ...patch }] of patches) {
    queryClient.setQueryData<ThreadWithRuntime>(
      threadQueryKey(threadId),
      (thread) =>
        thread && !isPatchApplied(thread, patch)
          ? { ...thread, ...patch }
          : thread,
    );
  }
  applyToCachedThreadListsAndSidebarNavigation(queryClient, (list) =>
    patchThreadList(list, patches),
  );
}

function mergeHeldPatches(
  holds: ReadonlySet<PendingThreadPatchHold>,
): Map<string, ThreadMetadataPatch> {
  const merged = new Map<string, ThreadMetadataPatch>();
  for (const { patches } of holds) {
    for (const [threadId, patch] of patches) {
      merged.set(threadId, { ...merged.get(threadId), ...patch });
    }
  }
  return merged;
}

function isFetchedQueryData(
  event: QueryCacheNotifyEvent,
): event is Extract<QueryCacheNotifyEvent, { type: "updated" }> {
  return (
    event.type === "updated" &&
    event.action.type === "success" &&
    !event.action.manual
  );
}

function holdsThreadData(
  query: Query,
  patches: ThreadPatches,
): boolean {
  return (
    matchQuery({ queryKey: threadsQueryKey() }, query) ||
    matchQuery({ queryKey: sidebarNavigationQueryKey(), exact: true }, query) ||
    [...patches.keys()].some((threadId) =>
      matchQuery({ queryKey: threadQueryKey(threadId), exact: true }, query),
    )
  );
}

export function holdPendingThreadPatches(
  queryClient: QueryClient,
  patches: ThreadPatches,
): () => void {
  let registry = registries.get(queryClient);
  if (!registry) {
    const holds = new Set<PendingThreadPatchHold>();
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (!isFetchedQueryData(event)) return;
      const merged = mergeHeldPatches(holds);
      if (holdsThreadData(event.query, merged)) {
        applyThreadPatches(queryClient, merged);
      }
    });
    registry = { holds, unsubscribe };
    registries.set(queryClient, registry);
  }
  const activeRegistry = registry;
  const hold: PendingThreadPatchHold = { patches };
  activeRegistry.holds.add(hold);
  return () => {
    if (!activeRegistry.holds.delete(hold)) return;
    if (activeRegistry.holds.size === 0) {
      activeRegistry.unsubscribe();
      registries.delete(queryClient);
    }
  };
}
