import type {
  EnvironmentWorkspaceDisplayKind,
  ThreadListEntry,
} from "@bb/domain";
import { compareCodepoint } from "@/lib/codepoint-compare";
import {
  getCollapsedChildActivity,
  type CollapsedChildActivity,
} from "@/lib/thread-activity";

export interface ProjectThreadNodeStats {
  childCount: number;
  childActivity: CollapsedChildActivity;
}

export interface ProjectThreadNode {
  thread: ThreadListEntry;
  children: ProjectThreadItem[];
  depth: number;
  stats: ProjectThreadNodeStats;
}

export type EnvironmentThreadGroupNodes = [
  ProjectThreadNode,
  ProjectThreadNode,
  ...ProjectThreadNode[],
];

export interface EnvironmentThreadGroup {
  environmentId: string;
  nodes: EnvironmentThreadGroupNodes;
  stats: ProjectThreadNodeStats;
}

// A single render slot in a thread sibling list. Threads and env groups
// interleave by recency, so renderers iterate one ordered list rather than two
// parallel arrays.
export type ProjectThreadItem =
  | { kind: "thread"; node: ProjectThreadNode }
  | { kind: "environment"; group: EnvironmentThreadGroup };

// Orders sibling threads. The default keeps active rows pinned to createdAt and
// inactive rows on attention recency; chronological mode can swap in a literal
// createdAt comparator instead.
export type ThreadComparator = (
  left: ThreadListEntry,
  right: ThreadListEntry,
) => number;

type WorktreeDisplayKind = "managed-worktree" | "unmanaged-worktree";
type SidebarProjectThreadShape = Pick<
  ThreadListEntry,
  "originKind" | "childOrigin"
>;

interface BuildThreadNodeArgs {
  ancestorThreadIds: ReadonlySet<string>;
  childrenByParentId: ReadonlyMap<string, readonly ThreadListEntry[]>;
  compareThreads: ThreadComparator;
  depth: number;
  groupEnvironmentThreads: boolean;
  thread: ThreadListEntry;
  visitedThreadIds: Set<string>;
}

interface BucketWorktreeEnvironmentGroupsResult {
  environmentThreadGroups: EnvironmentThreadGroup[];
  looseNodes: ProjectThreadNode[];
}

function isWorktreeDisplayKind(
  kind: EnvironmentWorkspaceDisplayKind,
): kind is WorktreeDisplayKind {
  return kind === "managed-worktree" || kind === "unmanaged-worktree";
}

export function compareByCreatedAtDescending(
  left: ThreadListEntry,
  right: ThreadListEntry,
): number {
  const createdAtDelta = right.createdAt - left.createdAt;
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return compareCodepoint(left.id, right.id);
}

function compareByLatestAttentionAtDescending(
  left: ThreadListEntry,
  right: ThreadListEntry,
): number {
  const latestAttentionAtDelta =
    right.latestAttentionAt - left.latestAttentionAt;
  if (latestAttentionAtDelta !== 0) {
    return latestAttentionAtDelta;
  }

  return compareByCreatedAtDescending(left, right);
}

export function compareStandardThreads(
  left: ThreadListEntry,
  right: ThreadListEntry,
): number {
  // Use durable thread.status for the active bucket, not ephemeral runtime
  // display state. Active rows stream frequent updates, so pin their position
  // to createdAt; inactive rows use attention recency so read/archive metadata
  // updates do not reshuffle the sidebar.
  const leftIsActive = left.status === "active";
  const rightIsActive = right.status === "active";

  if (leftIsActive !== rightIsActive) {
    return leftIsActive ? -1 : 1;
  }

  if (leftIsActive) {
    return compareByCreatedAtDescending(left, right);
  }

  return compareByLatestAttentionAtDescending(left, right);
}

function representativeThread(item: ProjectThreadItem): ThreadListEntry {
  return item.kind === "thread" ? item.node.thread : item.group.nodes[0].thread;
}

function compareProjectThreadItems(
  left: ProjectThreadItem,
  right: ProjectThreadItem,
  compareThreads: ThreadComparator,
): number {
  return compareThreads(
    representativeThread(left),
    representativeThread(right),
  );
}

function getNodeAndDescendantThreads(
  node: ProjectThreadNode,
): ThreadListEntry[] {
  return [node.thread, ...getItemThreadDescendants(node.children)];
}

function getItemThreadDescendants(
  items: readonly ProjectThreadItem[],
): ThreadListEntry[] {
  return items.flatMap((item) =>
    item.kind === "thread"
      ? getNodeAndDescendantThreads(item.node)
      : item.group.nodes.flatMap(getNodeAndDescendantThreads),
  );
}

function buildStatsForHiddenThreads(
  threads: readonly ThreadListEntry[],
): ProjectThreadNodeStats {
  return {
    childCount: threads.length,
    childActivity: getCollapsedChildActivity(threads),
  };
}

function buildEnvironmentThreadGroup(
  environmentId: string,
  nodes: EnvironmentThreadGroupNodes,
): EnvironmentThreadGroup {
  const hiddenThreads = nodes.flatMap(getNodeAndDescendantThreads);
  return {
    environmentId,
    nodes,
    stats: buildStatsForHiddenThreads(hiddenThreads),
  };
}

function buildThreadItem(node: ProjectThreadNode): ProjectThreadItem {
  return { kind: "thread", node };
}

function buildEnvironmentItem(
  group: EnvironmentThreadGroup,
): ProjectThreadItem {
  return { kind: "environment", group };
}

function buildSortedItems(
  nodes: ProjectThreadNode[],
  compareThreads: ThreadComparator,
  groupEnvironmentThreads: boolean,
): ProjectThreadItem[] {
  if (!groupEnvironmentThreads) {
    nodes.sort((left, right) => compareThreads(left.thread, right.thread));
    return nodes.map(buildThreadItem);
  }

  const { environmentThreadGroups, looseNodes } =
    bucketWorktreeEnvironmentGroups(nodes, compareThreads);
  const items = [
    ...looseNodes.map(buildThreadItem),
    ...environmentThreadGroups.map(buildEnvironmentItem),
  ];
  items.sort((left, right) =>
    compareProjectThreadItems(left, right, compareThreads),
  );
  return items;
}

function buildThreadNode({
  ancestorThreadIds,
  childrenByParentId,
  compareThreads,
  depth,
  groupEnvironmentThreads,
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
        groupEnvironmentThreads,
        thread: childThread,
        visitedThreadIds,
      }),
    );
  }

  const children = buildSortedItems(
    childNodes,
    compareThreads,
    groupEnvironmentThreads,
  );
  return {
    thread,
    children,
    depth,
    stats: buildStatsForHiddenThreads(getItemThreadDescendants(children)),
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

export function buildProjectThreadGroups(
  allProjectThreads: readonly ThreadListEntry[],
  compareThreads: ThreadComparator = compareStandardThreads,
): ProjectThreadItem[] {
  return buildThreadTreeItems(allProjectThreads, compareThreads, true);
}

function buildThreadTreeItems(
  allThreads: readonly ThreadListEntry[],
  compareThreads: ThreadComparator,
  groupEnvironmentThreads: boolean,
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
        groupEnvironmentThreads,
        thread,
        visitedThreadIds,
      }),
    );
  }

  // Cycles have no natural root. Render any remaining cycle member once at the
  // project root and cut the back-edge when the walk reaches an ancestor.
  for (const thread of projectThreads) {
    if (visitedThreadIds.has(thread.id)) continue;

    rootNodes.push(
      buildThreadNode({
        ancestorThreadIds: new Set(),
        childrenByParentId,
        compareThreads,
        depth: 0,
        groupEnvironmentThreads,
        thread,
        visitedThreadIds,
      }),
    );
  }

  return buildSortedItems(rootNodes, compareThreads, groupEnvironmentThreads);
}

// Chronological "All Threads" bucket: parent/child links still form a tree,
// but worktree grouping stays off so Group by None does not add synthetic group
// rows. Side chats are excluded to match buildProjectThreadGroups.
export function buildChronologicalThreadList(
  allThreads: readonly ThreadListEntry[],
  compareThreads: ThreadComparator = compareStandardThreads,
): ProjectThreadItem[] {
  return buildThreadTreeItems(allThreads, compareThreads, false);
}

export function isSidebarProjectThread(
  thread: SidebarProjectThreadShape,
): boolean {
  return (thread.originKind ?? thread.childOrigin) !== "side-chat";
}

// Bucket nodes by shared worktree environmentId. A bucket only becomes a group
// when >=2 sibling nodes share the environment; solo threads stay loose so we
// don't render degenerate 1-thread groups.
function bucketWorktreeEnvironmentGroups(
  nodes: ProjectThreadNode[],
  compareThreads: ThreadComparator,
): BucketWorktreeEnvironmentGroupsResult {
  const nodesByEnvironmentId = new Map<string, ProjectThreadNode[]>();
  for (const node of nodes) {
    if (node.thread.environmentId === null) continue;
    if (!isWorktreeDisplayKind(node.thread.environmentWorkspaceDisplayKind)) {
      continue;
    }
    const bucket = nodesByEnvironmentId.get(node.thread.environmentId);
    if (bucket) {
      bucket.push(node);
    } else {
      nodesByEnvironmentId.set(node.thread.environmentId, [node]);
    }
  }

  const groupedEnvironmentIds = new Set<string>();
  const environmentThreadGroups: EnvironmentThreadGroup[] = [];
  for (const [environmentId, bucket] of nodesByEnvironmentId) {
    if (!hasAtLeastTwoThreadNodes(bucket)) continue;
    bucket.sort((left, right) =>
      compareThreads(left.thread, right.thread),
    );
    groupedEnvironmentIds.add(environmentId);
    environmentThreadGroups.push(
      buildEnvironmentThreadGroup(environmentId, bucket),
    );
  }

  const looseNodes = nodes.filter(
    (node) =>
      node.thread.environmentId === null ||
      !groupedEnvironmentIds.has(node.thread.environmentId),
  );
  looseNodes.sort((left, right) =>
    compareThreads(left.thread, right.thread),
  );

  return { environmentThreadGroups, looseNodes };
}

function hasAtLeastTwoThreadNodes(
  nodes: ProjectThreadNode[],
): nodes is EnvironmentThreadGroupNodes {
  return nodes.length >= 2;
}
