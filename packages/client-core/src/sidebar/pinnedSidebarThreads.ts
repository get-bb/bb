import type { ThreadListEntry } from "@bb/domain";

interface PinnedSidebarState {
  effectivePinnedThreadIds: Set<string>;
}

interface BuildPinnedSidebarStateArgs {
  threads: readonly ThreadListEntry[];
}

function addDescendantThreadIds({
  childrenByParentId,
  effectivePinnedThreadIds,
  parentThreadId,
  visitedThreadIds,
}: AddDescendantThreadIdsArgs): void {
  if (visitedThreadIds.has(parentThreadId)) return;

  visitedThreadIds.add(parentThreadId);
  for (const child of childrenByParentId.get(parentThreadId) ?? []) {
    effectivePinnedThreadIds.add(child.id);
    addDescendantThreadIds({
      childrenByParentId,
      effectivePinnedThreadIds,
      parentThreadId: child.id,
      visitedThreadIds,
    });
  }
}

interface AddDescendantThreadIdsArgs {
  childrenByParentId: ReadonlyMap<string, readonly ThreadListEntry[]>;
  effectivePinnedThreadIds: Set<string>;
  parentThreadId: string;
  visitedThreadIds: Set<string>;
}

export function buildPinnedSidebarState({
  threads,
}: BuildPinnedSidebarStateArgs): PinnedSidebarState {
  const explicitlyPinnedThreads = threads.filter(
    (thread) => thread.pinnedAt !== null,
  );
  const childrenByParentId = new Map<string, ThreadListEntry[]>();

  for (const thread of threads) {
    if (thread.parentThreadId === null) continue;

    const children = childrenByParentId.get(thread.parentThreadId);
    if (children) {
      children.push(thread);
    } else {
      childrenByParentId.set(thread.parentThreadId, [thread]);
    }
  }

  const effectivePinnedThreadIds = new Set(
    explicitlyPinnedThreads.map((thread) => thread.id),
  );
  for (const thread of explicitlyPinnedThreads) {
    addDescendantThreadIds({
      childrenByParentId,
      effectivePinnedThreadIds,
      parentThreadId: thread.id,
      visitedThreadIds: new Set(),
    });
  }

  return { effectivePinnedThreadIds };
}
