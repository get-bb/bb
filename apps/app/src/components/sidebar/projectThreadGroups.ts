import type {
  EnvironmentWorkspaceDisplayKind,
  ThreadListEntry,
} from "@bb/domain";
import { compareCodepoint } from "@/lib/codepoint-compare";
import {
  getCollapsedChildActivity,
  type CollapsedChildActivity,
} from "@/lib/thread-activity";
import { buildFolderKey, splitFolderPath } from "./folderPath";
import type {
  SidebarGroupBy,
  SidebarManualOrder,
} from "./sidebarCollapsedAtoms";

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

// A folder node folded out of stored thread.folderPath metadata.
// A folder holds further items (threads, env groups, and nested folders) and
// rolls up its descendants' count + activity so a collapsed header can speak for
// them, mirroring a collapsed parent thread.
export interface SidebarFolderGroup {
  key: string; // `${containerId}::Work/Q3` — unique per project/section
  name: string; // leaf segment shown on the header ("Q3")
  path: string[]; // ["Work","Q3"]
  depth: number; // folder nesting depth (0 = first level), drives indentation
  items: ProjectThreadItem[];
  threadCount: number; // total descendant threads
  activity: CollapsedChildActivity; // rolled-up unread/working/pending
}

// A single render slot in a thread sibling list. Threads and env groups
// interleave by recency, so renderers iterate one ordered list rather than two
// parallel arrays. Folders join the same list only under Group by: Folder.
export type ProjectThreadItem =
  | { kind: "thread"; node: ProjectThreadNode }
  | { kind: "environment"; group: EnvironmentThreadGroup }
  | { kind: "folder"; group: SidebarFolderGroup };

// Folder grouping, threaded into the three assembly sites. `containerId` scopes
// folder identity to its section (a `proj_*` id, or the sentinels below). When
// groupBy is "none" each site early-returns its current output untouched — no
// folder logic runs.
export interface SidebarFolderOptions {
  groupBy: SidebarGroupBy;
  containerId: string;
  folderPaths?: readonly string[];
  manualOrder?: SidebarManualOrder;
}

// Container-id sentinels for the global (non-project) sections; project
// sections use their own `proj_*` id. These namespace folder keys and manual
// order so "Work" in one section never collides with "Work" in another.
export const CHRONOLOGICAL_CONTAINER_ID = "chronological";
export const PINNED_CONTAINER_ID = "pinned";

// Orders sibling threads. The default keeps active rows pinned to createdAt and
// inactive rows on attention recency; chronological mode can swap in a literal
// createdAt comparator instead.
export type ThreadItemComparator = (
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
  folderOptions?: SidebarFolderOptions,
): ProjectThreadItem[] {
  const rootItems = buildThreadTreeItems(
    allProjectThreads,
    compareThreads,
    true,
  );
  // Group by: None — return today's output untouched unless an internal test
  // path explicitly supplied a manual order for this section.
  if (folderOptions?.groupBy !== "folder") {
    if (folderOptions?.manualOrder) {
      return orderSiblingItems(
        rootItems,
        folderOptions.containerId,
        compareThreads,
        {
          manualOrder: folderOptions.manualOrder,
        },
      );
    }
    return rootItems;
  }
  return bucketIntoFolders(
    rootItems,
    folderOptions.containerId,
    compareThreads,
    folderOptions.manualOrder,
    folderOptions.folderPaths,
  );
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
  folderOptions?: SidebarFolderOptions,
): ProjectThreadItem[] {
  // Folder grouping (and the test-only manual-order path) need a flat,
  // globally-sorted list; everything else keeps main's parent/child tree.
  if (folderOptions?.groupBy === "folder" || folderOptions?.manualOrder) {
    const items = allThreads
      .filter(isSidebarProjectThread)
      .sort(compareThreads)
      .map(
        (thread): ProjectThreadItem => ({
          kind: "thread",
          node: {
            thread,
            children: [],
            depth: 0,
            stats: buildStatsForHiddenThreads([]),
          },
        }),
      );
    if (folderOptions.groupBy === "folder") {
      return bucketIntoFolders(
        items,
        folderOptions.containerId,
        compareThreads,
        folderOptions.manualOrder,
        folderOptions.folderPaths,
      );
    }
    return orderSiblingItems(items, folderOptions.containerId, compareThreads, {
      manualOrder: folderOptions.manualOrder,
    });
  }
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

// ---------------------------------------------------------------------------
// Folder bucketing
//
// A pure layer that folds an already-built top-level item list into a nested
// folder tree derived from each top-level thread's stored folderPath. Only
// top-level items form folders; a thread's own children and env groups keep
// nesting under it exactly as today. The active comparator still drives order:
// folders render as a block above loose items, and folders, their contents, and
// the loose block are each sorted recursively by the same comparator.
// ---------------------------------------------------------------------------

interface FolderBucket {
  subfolders: Map<string, FolderBucket>;
  items: ProjectThreadItem[];
}

interface ManualOrderSiblingOptions {
  manualOrder?: SidebarManualOrder;
}

function createFolderBucket(): FolderBucket {
  return { subfolders: new Map(), items: [] };
}

// The thread that orders an item among its siblings, and whose folderPath
// decides its folder path: a thread/env item keeps today's representative; a folder
// uses the descendant thread that sorts first under the active comparator.
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

export function getManualOrderItemKey(item: ProjectThreadItem): string {
  switch (item.kind) {
    case "thread":
      return item.node.thread.id;
    case "environment":
      return item.group.nodes[0].thread.id;
    case "folder":
      return item.group.key;
  }
}

export function pruneManualOrderForChildren(
  storedOrder: readonly string[] | undefined,
  childKeys: ReadonlySet<string>,
): string[] {
  if (!storedOrder) {
    return [];
  }

  const seen = new Set<string>();
  const pruned: string[] = [];
  for (const key of storedOrder) {
    if (!childKeys.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    pruned.push(key);
  }
  return pruned;
}

function orderItemsByManualOrder(
  items: readonly ProjectThreadItem[],
  parentKey: string,
  compareThreads: ThreadComparator,
  manualOrder: SidebarManualOrder,
): ProjectThreadItem[] {
  const itemsByKey = new Map<string, ProjectThreadItem>();
  for (const item of items) {
    itemsByKey.set(getManualOrderItemKey(item), item);
  }

  const childKeys = new Set(itemsByKey.keys());
  const prunedOrder = pruneManualOrderForChildren(
    manualOrder[parentKey],
    childKeys,
  );
  const orderedKeys = new Set(prunedOrder);
  const unorderedItems = items
    .filter((item) => !orderedKeys.has(getManualOrderItemKey(item)))
    .sort((left, right) => compareSiblingItems(left, right, compareThreads));
  const orderedItems = prunedOrder.flatMap((key) => {
    const item = itemsByKey.get(key);
    return item ? [item] : [];
  });

  return [...unorderedItems, ...orderedItems];
}

// The one sibling-ordering hook. It orders folders-first, each block by the
// active comparator. Internal manual-order tests can still supply a stored
// per-parent order; missing child keys stay at the top in fallback order.
function orderSiblingItems(
  items: readonly ProjectThreadItem[],
  parentKey: string,
  compareThreads: ThreadComparator,
  options: ManualOrderSiblingOptions = {},
): ProjectThreadItem[] {
  if (options.manualOrder) {
    return orderItemsByManualOrder(
      items,
      parentKey,
      compareThreads,
      options.manualOrder,
    );
  }

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
      return item.group.path.join("/");
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
  path: string[],
  items: ProjectThreadItem[],
): SidebarFolderGroup {
  const descendantThreads = getItemThreadDescendants(items);
  return {
    key: buildFolderKey(containerId, path),
    name: path[path.length - 1],
    path,
    depth: path.length - 1,
    items,
    threadCount: descendantThreads.length,
    activity: getCollapsedChildActivity(descendantThreads),
  };
}

function buildFolderLevelItems(
  bucket: FolderBucket,
  containerId: string,
  parentPath: readonly string[],
  compareThreads: ThreadComparator,
  manualOrder?: SidebarManualOrder,
): ProjectThreadItem[] {
  const folderItems: ProjectThreadItem[] = [];
  for (const [name, subBucket] of bucket.subfolders) {
    const path = [...parentPath, name];
    const childItems = buildFolderLevelItems(
      subBucket,
      containerId,
      path,
      compareThreads,
      manualOrder,
    );
    folderItems.push({
      kind: "folder",
      group: buildFolderGroup(containerId, path, childItems),
    });
  }
  const parentKey =
    parentPath.length === 0
      ? containerId
      : buildFolderKey(containerId, parentPath);
  return orderSiblingItems(
    [...folderItems, ...bucket.items],
    parentKey,
    compareThreads,
    { manualOrder },
  );
}

// Fold a top-level item list into a nested folder tree. Items whose
// representative thread has no folderPath stay loose at the top level; the rest
// nest into the deepest folder of their path. Explicit folder paths can create
// empty folder nodes so new folders exist before their first thread is dropped.
export function bucketIntoFolders(
  items: readonly ProjectThreadItem[],
  containerId: string,
  compareThreads: ThreadComparator = compareStandardThreads,
  manualOrder?: SidebarManualOrder,
  folderPaths: readonly string[] = [],
): ProjectThreadItem[] {
  const root = createFolderBucket();
  for (const folderPath of folderPaths) {
    const folders = splitFolderPath(folderPath);
    let bucket = root;
    for (const segment of folders) {
      let next = bucket.subfolders.get(segment);
      if (!next) {
        next = createFolderBucket();
        bucket.subfolders.set(segment, next);
      }
      bucket = next;
    }
  }
  for (const item of items) {
    const orderingThread = getItemOrderingThread(item, compareThreads);
    if (!orderingThread) {
      continue;
    }
    const folders = splitFolderPath(orderingThread.folderPath);
    let bucket = root;
    for (const segment of folders) {
      let next = bucket.subfolders.get(segment);
      if (!next) {
        next = createFolderBucket();
        bucket.subfolders.set(segment, next);
      }
      bucket = next;
    }
    bucket.items.push(item);
  }
  return buildFolderLevelItems(
    root,
    containerId,
    [],
    compareThreads,
    manualOrder,
  );
}
