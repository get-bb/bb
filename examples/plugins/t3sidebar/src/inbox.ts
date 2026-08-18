import type { PluginSidebarThread } from "@get-bb/plugin-sdk";

/**
 * The sort that defines this sidebar: newest thread on top, and NOTHING moves
 * it afterwards. Activity never re-orders the list, so a row holds its place
 * from creation until you park it and the screen only changes when you act.
 * Status is carried by the card, not by position.
 *
 * Ties break on id so the order is total and stable across renders.
 */
export function sortByCreatedAtDescending<
  T extends { readonly id: string; readonly createdAt: number },
>(threads: readonly T[]): T[] {
  return [...threads].sort(
    (left, right) =>
      right.createdAt - left.createdAt || left.id.localeCompare(right.id),
  );
}

export function threadDisplayTitle(thread: PluginSidebarThread): string {
  const title = thread.title?.trim();
  if (title) return title;
  const fallback = thread.titleFallback?.trim();
  return fallback ? fallback : "Untitled thread";
}

/** Substring match on the visible title only, preserving the incoming order. */
export function searchThreadsByTitle(
  threads: readonly PluginSidebarThread[],
  query: string,
): PluginSidebarThread[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return [...threads];
  return threads.filter((thread) =>
    threadDisplayTitle(thread).toLowerCase().includes(normalized),
  );
}

export interface ProjectScope {
  /** Project id, or null for "all projects". */
  id: string | null;
  name: string;
}

/** Threads in the chosen scope; every thread when the scope is null. */
export function filterByProject(
  threads: readonly PluginSidebarThread[],
  projectId: string | null,
): PluginSidebarThread[] {
  if (projectId === null) return [...threads];
  return threads.filter((thread) => thread.projectId === projectId);
}

/** Archived threads never belong in the inbox. */
export function visibleInboxThreads(
  threads: readonly PluginSidebarThread[],
): PluginSidebarThread[] {
  return threads.filter((thread) => !thread.isArchived);
}

/** Pinned first (they are the user's own ordering), then the static sort. */
export function partitionPinned(threads: readonly PluginSidebarThread[]): {
  pinned: PluginSidebarThread[];
  inbox: PluginSidebarThread[];
} {
  const pinned: PluginSidebarThread[] = [];
  const inbox: PluginSidebarThread[] = [];
  for (const thread of threads) {
    (thread.isPinned ? pinned : inbox).push(thread);
  }
  return { pinned, inbox };
}

/**
 * Child threads leave the flat list and live in their parent's header chip
 * instead — a flat inbox has nowhere to nest them.
 *
 * A child is only hidden when its parent is actually on screen. An orphan
 * (parent archived, deleted, or filtered out by the project scope) stays in
 * the list, because hiding it would make it unreachable everywhere.
 */
export function hideChildrenOfVisibleParents(
  threads: readonly PluginSidebarThread[],
): PluginSidebarThread[] {
  const visibleIds = new Set(threads.map((thread) => thread.id));
  return threads.filter(
    (thread) =>
      thread.parentThreadId === null || !visibleIds.has(thread.parentThreadId),
  );
}

/**
 * The parent of one thread, or null when the thread is a root, when the id is
 * unknown, or when the parent row is gone (deleted). The parent may be
 * archived or in another project: the flat list hides those, but the child
 * still needs a way back to them.
 */
export function parentOf(
  threads: readonly PluginSidebarThread[],
  threadId: string,
): PluginSidebarThread | null {
  const thread = threads.find((candidate) => candidate.id === threadId);
  const parentThreadId = thread?.parentThreadId;
  if (!parentThreadId) return null;
  return threads.find((candidate) => candidate.id === parentThreadId) ?? null;
}

/** The children of one thread, oldest first (the order they were spawned). */
export function childrenOf(
  threads: readonly PluginSidebarThread[],
  parentThreadId: string,
): PluginSidebarThread[] {
  return threads
    .filter((thread) => thread.parentThreadId === parentThreadId)
    .sort((left, right) => left.createdAt - right.createdAt);
}
