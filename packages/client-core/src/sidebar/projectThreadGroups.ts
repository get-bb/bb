import type { ThreadListEntry } from "@bb/domain";
import {
  getCollapsedChildActivity,
  type CollapsedChildActivity,
} from "../thread/thread-activity.js";

interface ProjectThreadNodeStats {
  childCount: number;
  childActivity: CollapsedChildActivity;
}

export interface ProjectThreadNode {
  thread: ThreadListEntry;
  children: ProjectThreadItem[];
  depth: number;
  stats: ProjectThreadNodeStats;
}

export interface SidebarSectionDefinition {
  id: string;
  name: string;
}

export type ProjectThreadItem = { kind: "thread"; node: ProjectThreadNode };

export const CHRONOLOGICAL_CONTAINER_ID = "chronological";

export type ThreadComparator = (
  left: ThreadListEntry,
  right: ThreadListEntry,
) => number;

type SidebarProjectThreadShape = Pick<
  ThreadListEntry,
  "originKind" | "visibility"
>;

interface BuildThreadNodeArgs {
  ancestorThreadIds: ReadonlySet<string>;
  childrenByParentId: ReadonlyMap<string, readonly ThreadListEntry[]>;
  compareThreads: ThreadComparator;
  depth: number;
  draftThreadIds: ReadonlySet<string>;
  thread: ThreadListEntry;
  visitedThreadIds: Set<string>;
}

function getNodeAndDescendantThreads(
  node: ProjectThreadNode,
): ThreadListEntry[] {
  return [node.thread, ...getProjectThreadItemDescendants(node.children)];
}

export function getProjectThreadItemDescendants(
  items: readonly ProjectThreadItem[],
): ThreadListEntry[] {
  return items.flatMap((item) => getNodeAndDescendantThreads(item.node));
}

function buildStatsForHiddenThreads(
  threads: readonly ThreadListEntry[],
  draftThreadIds: ReadonlySet<string>,
): ProjectThreadNodeStats {
  return {
    childCount: threads.length,
    childActivity: getCollapsedChildActivity(threads, draftThreadIds),
  };
}

function buildThreadItem(node: ProjectThreadNode): ProjectThreadItem {
  return { kind: "thread", node };
}

function buildSortedItems(
  nodes: ProjectThreadNode[],
  compareThreads: ThreadComparator,
): ProjectThreadItem[] {
  nodes.sort((left, right) => compareThreads(left.thread, right.thread));
  return nodes.map(buildThreadItem);
}

function buildThreadNode({
  ancestorThreadIds,
  childrenByParentId,
  compareThreads,
  depth,
  draftThreadIds,
  thread,
  visitedThreadIds,
}: BuildThreadNodeArgs): ProjectThreadNode {
  visitedThreadIds.add(thread.id);
  const nextAncestorThreadIds = new Set(ancestorThreadIds);
  nextAncestorThreadIds.add(thread.id);
  const childNodes: ProjectThreadNode[] = [];

  for (const childThread of childrenByParentId.get(thread.id) ?? []) {
    if (nextAncestorThreadIds.has(childThread.id)) continue;
    if (visitedThreadIds.has(childThread.id)) continue;

    childNodes.push(
      buildThreadNode({
        ancestorThreadIds: nextAncestorThreadIds,
        childrenByParentId,
        compareThreads,
        depth: depth + 1,
        draftThreadIds,
        thread: childThread,
        visitedThreadIds,
      }),
    );
  }

  const children = buildSortedItems(childNodes, compareThreads);
  return {
    thread,
    children,
    depth,
    stats: buildStatsForHiddenThreads(
      getProjectThreadItemDescendants(children),
      draftThreadIds,
    ),
  };
}

function isRootThread(
  thread: ThreadListEntry,
  projectThreadIds: ReadonlySet<string>,
): boolean {
  return (
    thread.parentThreadId === null ||
    !projectThreadIds.has(thread.parentThreadId)
  );
}

export function resolveSidebarProjectId(
  thread: ThreadListEntry,
  threadById: ReadonlyMap<string, ThreadListEntry>,
): string {
  const visitedThreadIds = new Set<string>([thread.id]);
  let current = thread;
  while (current.parentThreadId !== null) {
    const parent = threadById.get(current.parentThreadId);
    if (parent === undefined || visitedThreadIds.has(parent.id)) {
      break;
    }
    visitedThreadIds.add(parent.id);
    current = parent;
  }
  return current.projectId;
}

export function buildChronologicalThreadList(
  allThreads: readonly ThreadListEntry[],
  compareThreads: ThreadComparator,
  draftThreadIds: ReadonlySet<string> = new Set(),
): ProjectThreadItem[] {
  const projectThreads = allThreads.filter(isSidebarProjectThread);
  const projectThreadIds = new Set(projectThreads.map((thread) => thread.id));
  const childrenByParentId = new Map<string, ThreadListEntry[]>();

  for (const thread of projectThreads) {
    if (thread.parentThreadId === null) continue;
    if (!projectThreadIds.has(thread.parentThreadId)) continue;

    const children = childrenByParentId.get(thread.parentThreadId);
    if (children) {
      children.push(thread);
    } else {
      childrenByParentId.set(thread.parentThreadId, [thread]);
    }
  }

  const visitedThreadIds = new Set<string>();
  const rootNodes: ProjectThreadNode[] = [];

  for (const thread of projectThreads) {
    if (!isRootThread(thread, projectThreadIds)) continue;
    if (visitedThreadIds.has(thread.id)) continue;

    rootNodes.push(
      buildThreadNode({
        ancestorThreadIds: new Set(),
        childrenByParentId,
        compareThreads,
        depth: 0,
        draftThreadIds,
        thread,
        visitedThreadIds,
      }),
    );
  }

  for (const thread of projectThreads) {
    if (visitedThreadIds.has(thread.id)) continue;

    rootNodes.push(
      buildThreadNode({
        ancestorThreadIds: new Set(),
        childrenByParentId,
        compareThreads,
        depth: 0,
        draftThreadIds,
        thread,
        visitedThreadIds,
      }),
    );
  }

  return buildSortedItems(rootNodes, compareThreads);
}

export function isSidebarProjectThread(
  thread: SidebarProjectThreadShape,
): boolean {
  return thread.visibility !== "hidden";
}
