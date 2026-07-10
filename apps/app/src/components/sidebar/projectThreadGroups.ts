import type {
  EnvironmentWorkspaceDisplayKind,
  ThreadListEntry,
} from "@bb/domain";
import { compareCodepoint } from "@/lib/codepoint-compare";
import {
  getCollapsedChildActivity,
  type CollapsedChildActivity,
} from "@/lib/thread-activity";
import { buildFolderKey } from "./folderKeys";

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

type EnvironmentThreadGroupNodes = [
  ProjectThreadNode,
  ProjectThreadNode,
  ...ProjectThreadNode[],
];

export interface EnvironmentThreadGroup {
  environmentId: string;
  nodes: EnvironmentThreadGroupNodes;
  stats: ProjectThreadNodeStats;
}

export interface SidebarFolderDefinition {
  id: string;
  name: string;
}

// A flat folder node backed by a durable DB folder row.
export interface SidebarFolderGroup {
  id: string;
  key: string;
  name: string;
  items: ProjectThreadItem[];
  threadCount: number;
  activity: CollapsedChildActivity;
}

// A single render slot in a thread sibling list. Threads and env groups
// interleave by recency, so renderers iterate one ordered list rather than two
// parallel arrays. Folders join the same list only under Group by: Folder.
export type ProjectThreadItem =
  | { kind: "thread"; node: ProjectThreadNode }
  | { kind: "environment"; group: EnvironmentThreadGroup }
  | { kind: "folder"; group: SidebarFolderGroup };

// Container-id sentinel for the global folder section. It namespaces persisted
// collapse keys and dnd ids from other sidebar rows.
export const CHRONOLOGICAL_CONTAINER_ID = "chronological";

// Orders sibling threads. The default keeps active rows pinned to createdAt and
// inactive rows on attention recency; chronological mode can swap in a literal
// createdAt comparator instead.
type ThreadItemComparator = (
  left: ProjectThreadItem,
  right: ProjectThreadItem,
) => number;

export type ThreadComparator = ((
  left: ThreadListEntry,
  right: ThreadListEntry,
) => number) & {
  compareItems?: ThreadItemComparator;
};

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
  switch (item.kind) {
    case "thread":
      return item.node.thread;
    case "environment":
      return item.group.nodes[0].thread;
    case "folder":
      // Folders never reach this pre-bucket comparator path; fall back to the
      // first nested item's representative so the function stays total.
      return representativeThread(item.group.items[0]);
  }
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
  return items.flatMap((item) => {
    switch (item.kind) {
      case "thread":
        return getNodeAndDescendantThreads(item.node);
      case "environment":
        return item.group.nodes.flatMap(getNodeAndDescendantThreads);
      case "folder":
        return getItemThreadDescendants(item.group.items);
    }
  });
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
  // Project sections group worktree siblings into synthetic environment rows.
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

// Chronological "All Threads" bucket: root threads are globally ordered by the
// chosen comparator and descendants stay nested under their parent. Worktree
// grouping stays off. Side chats are excluded to match buildProjectThreadGroups.
export function buildChronologicalThreadList(
  allThreads: readonly ThreadListEntry[],
  compareThreads: ThreadComparator = compareStandardThreads,
): ProjectThreadItem[] {
  return buildThreadTreeItems(allThreads, compareThreads, false);
}

// The global Folders view uses the chronological root tree, then buckets those
// roots by their durable folder id. Descendants stay nested under their parent.
export function buildFolderThreadList(
  allThreads: readonly ThreadListEntry[],
  compareThreads: ThreadComparator = compareStandardThreads,
  folders: readonly SidebarFolderDefinition[] = [],
): ProjectThreadItem[] {
  return bucketIntoFolders(
    buildChronologicalThreadList(allThreads, compareThreads),
    CHRONOLOGICAL_CONTAINER_ID,
    compareThreads,
    folders,
  );
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
    bucket.sort((left, right) => compareThreads(left.thread, right.thread));
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
  looseNodes.sort((left, right) => compareThreads(left.thread, right.thread));

  return { environmentThreadGroups, looseNodes };
}

function hasAtLeastTwoThreadNodes(
  nodes: ProjectThreadNode[],
): nodes is EnvironmentThreadGroupNodes {
  return nodes.length >= 2;
}

// The thread that orders an item among its siblings.
function getItemOrderingThread(
  item: ProjectThreadItem,
  compareThreads: ThreadComparator,
): ThreadListEntry | null {
  switch (item.kind) {
    case "thread":
      return item.node.thread;
    case "environment":
      return item.group.nodes[0].thread;
    case "folder": {
      const descendants = getItemThreadDescendants(item.group.items);
      if (descendants.length === 0) {
        return null;
      }
      return descendants.reduce((first, thread) =>
        compareThreads(thread, first) < 0 ? thread : first,
      );
    }
  }
}

export function getSidebarDndItemId(item: ProjectThreadItem): string {
  switch (item.kind) {
    case "thread":
      return item.node.thread.id;
    case "environment":
      return item.group.nodes[0].thread.id;
    case "folder":
      return item.group.key;
  }
}

// Orders folders first, then each block by the active comparator.
function orderSiblingItems(
  items: readonly ProjectThreadItem[],
  compareThreads: ThreadComparator,
): ProjectThreadItem[] {
  const decorated = items.map((item) => ({
    item,
    isFolder: item.kind === "folder",
  }));
  decorated.sort((left, right) => {
    if (left.isFolder !== right.isFolder) {
      return left.isFolder ? -1 : 1;
    }
    return compareSiblingItems(left.item, right.item, compareThreads);
  });
  return decorated.map((entry) => entry.item);
}

function getItemFallbackSortLabel(item: ProjectThreadItem): string {
  switch (item.kind) {
    case "thread":
      return item.node.thread.id;
    case "environment":
      return item.group.environmentId;
    case "folder":
      return item.group.name;
  }
}

function compareSiblingItems(
  left: ProjectThreadItem,
  right: ProjectThreadItem,
  compareThreads: ThreadComparator,
): number {
  if (compareThreads.compareItems) {
    return compareThreads.compareItems(left, right);
  }

  const leftThread = getItemOrderingThread(left, compareThreads);
  const rightThread = getItemOrderingThread(right, compareThreads);
  if (leftThread && rightThread) {
    return compareThreads(leftThread, rightThread);
  }
  if (leftThread || rightThread) {
    return leftThread ? -1 : 1;
  }
  return compareCodepoint(
    getItemFallbackSortLabel(left),
    getItemFallbackSortLabel(right),
  );
}

function buildFolderGroup(
  containerId: string,
  folder: SidebarFolderDefinition,
  items: ProjectThreadItem[],
): SidebarFolderGroup {
  const descendantThreads = getItemThreadDescendants(items);
  return {
    id: folder.id,
    key: buildFolderKey(containerId, folder.id),
    name: folder.name,
    items,
    threadCount: descendantThreads.length,
    activity: getCollapsedChildActivity(descendantThreads),
  };
}

// Fold a top-level item list into flat DB-backed folders plus loose items.
function bucketIntoFolders(
  items: readonly ProjectThreadItem[],
  containerId: string,
  compareThreads: ThreadComparator = compareStandardThreads,
  folders: readonly SidebarFolderDefinition[] = [],
): ProjectThreadItem[] {
  const folderDefinitionsById = new Map<string, SidebarFolderDefinition>();
  const orderedFolders: SidebarFolderDefinition[] = [];
  for (const folder of folders) {
    if (folderDefinitionsById.has(folder.id)) {
      continue;
    }
    folderDefinitionsById.set(folder.id, folder);
    orderedFolders.push(folder);
  }

  const itemsByFolderId = new Map<string, ProjectThreadItem[]>();
  for (const folder of orderedFolders) {
    itemsByFolderId.set(folder.id, []);
  }
  const looseItems: ProjectThreadItem[] = [];

  for (const item of items) {
    const orderingThread = getItemOrderingThread(item, compareThreads);
    const folderId = orderingThread?.folderId;
    if (!folderId) {
      looseItems.push(item);
      continue;
    }

    let folderItems = itemsByFolderId.get(folderId);
    if (!folderItems) {
      const fallbackFolder = { id: folderId, name: "Folder" };
      folderDefinitionsById.set(folderId, fallbackFolder);
      orderedFolders.push(fallbackFolder);
      folderItems = [];
      itemsByFolderId.set(folderId, folderItems);
    }
    folderItems.push(item);
  }

  const folderItemsByName = orderedFolders.map((folder): ProjectThreadItem => {
    const children = orderSiblingItems(
      itemsByFolderId.get(folder.id) ?? [],
      compareThreads,
    );
    return {
      kind: "folder",
      group: buildFolderGroup(containerId, folder, children),
    };
  });
  const folderItems = compareThreads.compareItems
    ? orderSiblingItems(folderItemsByName, compareThreads)
    : folderItemsByName;
  const orderedLooseItems = orderSiblingItems(looseItems, compareThreads);
  return [...folderItems, ...orderedLooseItems];
}
