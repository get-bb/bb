import type { ThreadListEntry } from "@bb/domain";
import { compareCodepoint } from "../codepoint-compare.js";
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

type EnvironmentThreadGroupNodes = [
  ProjectThreadNode,
  ProjectThreadNode,
  ...ProjectThreadNode[],
];

export interface EnvironmentThreadGroup {
  environmentId: string;
  environmentProviderId: string | null;
  nodes: EnvironmentThreadGroupNodes;
  stats: ProjectThreadNodeStats;
}

export interface SidebarSectionDefinition {
  id: string;
  name: string;
}

export type ProjectThreadItem =
  | { kind: "thread"; node: ProjectThreadNode }
  | { kind: "environment"; group: EnvironmentThreadGroup };

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
  groupEnvironmentThreads: boolean;
  thread: ThreadListEntry;
  visitedThreadIds: Set<string>;
}

interface BucketEnvironmentThreadGroupsResult {
  environmentThreadGroups: EnvironmentThreadGroup[];
  looseNodes: ProjectThreadNode[];
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
  return [node.thread, ...getProjectThreadItemDescendants(node.children)];
}

export function getProjectThreadItemDescendants(
  items: readonly ProjectThreadItem[],
): ThreadListEntry[] {
  return items.flatMap((item) => {
    switch (item.kind) {
      case "thread":
        return getNodeAndDescendantThreads(item.node);
      case "environment":
        return item.group.nodes.flatMap(getNodeAndDescendantThreads);
    }
  });
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

function buildEnvironmentThreadGroup(
  environmentId: string,
  environmentProviderId: string | null,
  nodes: EnvironmentThreadGroupNodes,
  draftThreadIds: ReadonlySet<string>,
): EnvironmentThreadGroup {
  const hiddenThreads = nodes.flatMap(getNodeAndDescendantThreads);
  return {
    environmentId,
    environmentProviderId,
    nodes,
    stats: buildStatsForHiddenThreads(hiddenThreads, draftThreadIds),
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
  draftThreadIds: ReadonlySet<string>,
): ProjectThreadItem[] {
  if (!groupEnvironmentThreads) {
    nodes.sort((left, right) => compareThreads(left.thread, right.thread));
    return nodes.map(buildThreadItem);
  }

  const { environmentThreadGroups, looseNodes } = bucketEnvironmentThreadGroups(
    nodes,
    compareThreads,
    draftThreadIds,
  );
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
  draftThreadIds,
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
        draftThreadIds,
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
    draftThreadIds,
  );
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

export function createSidebarProjectIdResolver(
  threadById: ReadonlyMap<string, ThreadListEntry>,
): (thread: ThreadListEntry) => string {
  const sidebarProjectIdByThreadId = new Map<string, string>();
  return (thread) => {
    const cached = sidebarProjectIdByThreadId.get(thread.id);
    if (cached !== undefined) {
      return cached;
    }
    const chain: ThreadListEntry[] = [thread];
    const visitedThreadIds = new Set<string>([thread.id]);
    let current = thread;
    let resolved: string | undefined;
    while (current.parentThreadId !== null) {
      const parent = threadById.get(current.parentThreadId);
      if (parent === undefined || visitedThreadIds.has(parent.id)) {
        break;
      }
      const parentResolved = sidebarProjectIdByThreadId.get(parent.id);
      if (parentResolved !== undefined) {
        resolved = parentResolved;
        break;
      }
      visitedThreadIds.add(parent.id);
      chain.push(parent);
      current = parent;
    }
    const sidebarProjectId = resolved ?? current.projectId;
    for (const member of chain) {
      sidebarProjectIdByThreadId.set(member.id, sidebarProjectId);
    }
    return sidebarProjectId;
  };
}

export function resolveSidebarProjectId(
  thread: ThreadListEntry,
  threadById: ReadonlyMap<string, ThreadListEntry>,
): string {
  return createSidebarProjectIdResolver(threadById)(thread);
}

export function buildProjectThreadGroups(
  allProjectThreads: readonly ThreadListEntry[],
  compareThreads: ThreadComparator = compareStandardThreads,
  draftThreadIds: ReadonlySet<string> = new Set(),
  groupEnvironmentThreads = true,
): ProjectThreadItem[] {
  return buildThreadTreeItems(
    allProjectThreads,
    compareThreads,
    groupEnvironmentThreads,
    draftThreadIds,
  );
}

function buildThreadTreeItems(
  allThreads: readonly ThreadListEntry[],
  compareThreads: ThreadComparator,
  groupEnvironmentThreads: boolean,
  draftThreadIds: ReadonlySet<string>,
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
        groupEnvironmentThreads,
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
        groupEnvironmentThreads,
        thread,
        visitedThreadIds,
      }),
    );
  }

  return buildSortedItems(
    rootNodes,
    compareThreads,
    groupEnvironmentThreads,
    draftThreadIds,
  );
}

export function buildChronologicalThreadList(
  allThreads: readonly ThreadListEntry[],
  compareThreads: ThreadComparator = compareStandardThreads,
  draftThreadIds: ReadonlySet<string> = new Set(),
  groupEnvironmentThreads = false,
): ProjectThreadItem[] {
  return buildThreadTreeItems(
    allThreads,
    compareThreads,
    groupEnvironmentThreads,
    draftThreadIds,
  );
}

export function isSidebarProjectThread(
  thread: SidebarProjectThreadShape,
): boolean {
  return thread.visibility !== "hidden";
}

function bucketEnvironmentThreadGroups(
  nodes: ProjectThreadNode[],
  compareThreads: ThreadComparator,
  draftThreadIds: ReadonlySet<string>,
): BucketEnvironmentThreadGroupsResult {
  const nodesByEnvironmentId = new Map<string, ProjectThreadNode[]>();
  const providerIdByEnvironmentId = new Map<string, string | null>();
  for (const node of nodes) {
    const { environmentId, environmentIsWorktree, environmentProviderId } =
      node.thread;
    if (environmentId === null || environmentIsWorktree !== true) continue;
    providerIdByEnvironmentId.set(environmentId, environmentProviderId);
    const bucket = nodesByEnvironmentId.get(environmentId);
    if (bucket) {
      bucket.push(node);
    } else {
      nodesByEnvironmentId.set(environmentId, [node]);
    }
  }

  const groupedEnvironmentIds = new Set<string>();
  const environmentThreadGroups: EnvironmentThreadGroup[] = [];
  for (const [environmentId, bucket] of nodesByEnvironmentId) {
    if (!hasAtLeastTwoThreadNodes(bucket)) continue;
    const environmentProviderId =
      providerIdByEnvironmentId.get(environmentId) ?? null;
    bucket.sort((left, right) => compareThreads(left.thread, right.thread));
    groupedEnvironmentIds.add(environmentId);
    environmentThreadGroups.push(
      buildEnvironmentThreadGroup(
        environmentId,
        environmentProviderId,
        bucket,
        draftThreadIds,
      ),
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
