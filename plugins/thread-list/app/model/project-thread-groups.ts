import { compareCodepoint } from "./compare-codepoint.js";
import { buildSectionKey } from "./section-keys.js";
import type { SidebarThread } from "./sidebar-thread.js";
import {
  getCollapsedChildActivity,
  type CollapsedChildActivity,
} from "./thread-activity.js";

interface ProjectThreadNodeStats {
  childCount: number;
  childActivity: CollapsedChildActivity;
}

export interface ProjectThreadNode {
  thread: SidebarThread;
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

export interface SidebarSectionGroup {
  id: string;
  key: string;
  name: string;
  items: ProjectThreadItem[];
  threadCount: number;
  activity: CollapsedChildActivity;
}

export type ProjectThreadItem =
  | { kind: "thread"; node: ProjectThreadNode }
  | { kind: "environment"; group: EnvironmentThreadGroup }
  | { kind: "section"; group: SidebarSectionGroup };

export const CHRONOLOGICAL_CONTAINER_ID = "chronological";

type ThreadItemComparator = (
  left: ProjectThreadItem,
  right: ProjectThreadItem,
) => number;

export type ThreadComparator = ((
  left: SidebarThread,
  right: SidebarThread,
) => number) & {
  compareItems?: ThreadItemComparator;
};

type SidebarProjectThreadShape = Pick<SidebarThread, "isHidden">;

interface BuildThreadNodeArgs {
  ancestorThreadIds: ReadonlySet<string>;
  childrenByParentId: ReadonlyMap<string, readonly SidebarThread[]>;
  compareThreads: ThreadComparator;
  depth: number;
  draftThreadIds: ReadonlySet<string>;
  groupEnvironmentThreads: boolean;
  thread: SidebarThread;
  visitedThreadIds: Set<string>;
}

interface BucketEnvironmentThreadGroupsResult {
  environmentThreadGroups: EnvironmentThreadGroup[];
  looseNodes: ProjectThreadNode[];
}

export function compareByCreatedAtDescending(
  left: SidebarThread,
  right: SidebarThread,
): number {
  const createdAtDelta = right.createdAt - left.createdAt;
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return compareCodepoint(left.id, right.id);
}

function compareByLatestAttentionAtDescending(
  left: SidebarThread,
  right: SidebarThread,
): number {
  const latestAttentionAtDelta =
    right.latestAttentionAt - left.latestAttentionAt;
  if (latestAttentionAtDelta !== 0) {
    return latestAttentionAtDelta;
  }

  return compareByCreatedAtDescending(left, right);
}

export function compareStandardThreads(
  left: SidebarThread,
  right: SidebarThread,
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

function representativeThread(item: ProjectThreadItem): SidebarThread {
  switch (item.kind) {
    case "thread":
      return item.node.thread;
    case "environment":
      return item.group.nodes[0].thread;
    case "section":
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

function getNodeAndDescendantThreads(node: ProjectThreadNode): SidebarThread[] {
  return [node.thread, ...getProjectThreadItemDescendants(node.children)];
}

export function getProjectThreadItemDescendants(
  items: readonly ProjectThreadItem[],
): SidebarThread[] {
  return items.flatMap((item) => {
    switch (item.kind) {
      case "thread":
        return getNodeAndDescendantThreads(item.node);
      case "environment":
        return item.group.nodes.flatMap(getNodeAndDescendantThreads);
      case "section":
        return getProjectThreadItemDescendants(item.group.items);
    }
  });
}

function buildStatsForHiddenThreads(
  threads: readonly SidebarThread[],
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
  respectSections = false,
): ProjectThreadItem[] {
  if (groupEnvironmentThreads && respectSections) {
    const nodesBySectionId = new Map<string | null, ProjectThreadNode[]>();
    for (const node of nodes) {
      const sectionId = node.thread.sectionId;
      const bucket = nodesBySectionId.get(sectionId);
      if (bucket) {
        bucket.push(node);
      } else {
        nodesBySectionId.set(sectionId, [node]);
      }
    }
    return [...nodesBySectionId.values()].flatMap((sectionNodes) =>
      buildSortedItems(sectionNodes, compareThreads, true, draftThreadIds),
    );
  }

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
  thread: SidebarThread,
  projectThreadIds: ReadonlySet<string>,
): boolean {
  return (
    thread.parentThreadId === null ||
    !projectThreadIds.has(thread.parentThreadId)
  );
}

export function createSidebarProjectIdResolver(
  threadById: ReadonlyMap<string, SidebarThread>,
): (thread: SidebarThread) => string {
  const sidebarProjectIdByThreadId = new Map<string, string>();
  return (thread) => {
    const cached = sidebarProjectIdByThreadId.get(thread.id);
    if (cached !== undefined) {
      return cached;
    }
    const chain: SidebarThread[] = [thread];
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
  thread: SidebarThread,
  threadById: ReadonlyMap<string, SidebarThread>,
): string {
  return createSidebarProjectIdResolver(threadById)(thread);
}

export function buildProjectThreadGroups(
  allProjectThreads: readonly SidebarThread[],
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
  allThreads: readonly SidebarThread[],
  compareThreads: ThreadComparator,
  groupEnvironmentThreads: boolean,
  draftThreadIds: ReadonlySet<string>,
  respectSections = false,
): ProjectThreadItem[] {
  const projectThreads = allThreads.filter(isSidebarProjectThread);
  const projectThreadIds = new Set(projectThreads.map((thread) => thread.id));
  const childrenByParentId = new Map<string, SidebarThread[]>();

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
    respectSections,
  );
}

export function buildSectionThreadList(
  allThreads: readonly SidebarThread[],
  compareThreads: ThreadComparator = compareStandardThreads,
  sections: readonly SidebarSectionDefinition[] = [],
  draftThreadIds: ReadonlySet<string> = new Set(),
  groupEnvironmentThreads = false,
): ProjectThreadItem[] {
  return bucketIntoSections(
    buildThreadTreeItems(
      allThreads,
      compareThreads,
      groupEnvironmentThreads,
      draftThreadIds,
      true,
    ),
    CHRONOLOGICAL_CONTAINER_ID,
    compareThreads,
    sections,
    draftThreadIds,
  );
}

export function isSidebarProjectThread(
  thread: SidebarProjectThreadShape,
): boolean {
  return !thread.isHidden;
}

function bucketEnvironmentThreadGroups(
  nodes: ProjectThreadNode[],
  compareThreads: ThreadComparator,
  draftThreadIds: ReadonlySet<string>,
): BucketEnvironmentThreadGroupsResult {
  const nodesByEnvironmentId = new Map<string, ProjectThreadNode[]>();
  const providerIdByEnvironmentId = new Map<string, string | null>();
  for (const node of nodes) {
    const environment = node.thread.environment;
    const environmentId = environment?.id ?? null;
    if (environmentId === null || environment?.isWorktree !== true) continue;
    providerIdByEnvironmentId.set(environmentId, environment.providerId);
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

  const looseNodes = nodes.filter((node) => {
    const environmentId = node.thread.environment?.id ?? null;
    return environmentId === null || !groupedEnvironmentIds.has(environmentId);
  });
  looseNodes.sort((left, right) => compareThreads(left.thread, right.thread));

  return { environmentThreadGroups, looseNodes };
}

function hasAtLeastTwoThreadNodes(
  nodes: ProjectThreadNode[],
): nodes is EnvironmentThreadGroupNodes {
  return nodes.length >= 2;
}

function getItemOrderingThread(
  item: ProjectThreadItem,
  compareThreads: ThreadComparator,
): SidebarThread | null {
  switch (item.kind) {
    case "thread":
      return item.node.thread;
    case "environment":
      return item.group.nodes[0].thread;
    case "section": {
      const descendants = getProjectThreadItemDescendants(item.group.items);
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
      return `environment:${item.group.nodes[0].thread.id}`;
    case "section":
      return item.group.key;
  }
}

function orderSiblingItems(
  items: readonly ProjectThreadItem[],
  compareThreads: ThreadComparator,
): ProjectThreadItem[] {
  const decorated = items.map((item) => ({
    item,
    isSection: item.kind === "section",
  }));
  decorated.sort((left, right) => {
    if (left.isSection !== right.isSection) {
      return left.isSection ? -1 : 1;
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
    case "section":
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

function buildSectionGroup(
  containerId: string,
  section: SidebarSectionDefinition,
  items: ProjectThreadItem[],
  draftThreadIds: ReadonlySet<string>,
): SidebarSectionGroup {
  const descendantThreads = getProjectThreadItemDescendants(items);
  return {
    id: section.id,
    key: buildSectionKey(containerId, section.id),
    name: section.name,
    items,
    threadCount: descendantThreads.length,
    activity: getCollapsedChildActivity(descendantThreads, draftThreadIds),
  };
}

function bucketIntoSections(
  items: readonly ProjectThreadItem[],
  containerId: string,
  compareThreads: ThreadComparator = compareStandardThreads,
  sections: readonly SidebarSectionDefinition[] = [],
  draftThreadIds: ReadonlySet<string> = new Set(),
): ProjectThreadItem[] {
  const sectionDefinitionsById = new Map<string, SidebarSectionDefinition>();
  const orderedSections: SidebarSectionDefinition[] = [];
  for (const section of sections) {
    if (sectionDefinitionsById.has(section.id)) {
      continue;
    }
    sectionDefinitionsById.set(section.id, section);
    orderedSections.push(section);
  }

  const itemsBySectionId = new Map<string, ProjectThreadItem[]>();
  for (const section of orderedSections) {
    itemsBySectionId.set(section.id, []);
  }
  const looseItems: ProjectThreadItem[] = [];

  for (const item of items) {
    const orderingThread = getItemOrderingThread(item, compareThreads);
    const sectionId = orderingThread?.sectionId;
    if (!sectionId) {
      looseItems.push(item);
      continue;
    }

    let sectionItems = itemsBySectionId.get(sectionId);
    if (!sectionItems) {
      const fallbackSection = { id: sectionId, name: "Section" };
      sectionDefinitionsById.set(sectionId, fallbackSection);
      orderedSections.push(fallbackSection);
      sectionItems = [];
      itemsBySectionId.set(sectionId, sectionItems);
    }
    sectionItems.push(item);
  }

  const sectionItemsByName = orderedSections.map(
    (section): ProjectThreadItem => {
      const children = orderSiblingItems(
        itemsBySectionId.get(section.id) ?? [],
        compareThreads,
      );
      return {
        kind: "section",
        group: buildSectionGroup(
          containerId,
          section,
          children,
          draftThreadIds,
        ),
      };
    },
  );
  const sectionItems = compareThreads.compareItems
    ? orderSiblingItems(sectionItemsByName, compareThreads)
    : sectionItemsByName;
  const orderedLooseItems = orderSiblingItems(looseItems, compareThreads);
  return [...sectionItems, ...orderedLooseItems];
}

export interface ProjectThreadItemRowCountContext {
  collapsedThreadIds: ReadonlySet<string>;
  collapsedEnvironmentIds: ReadonlySet<string>;
  collapsedSectionKeys: ReadonlySet<string>;
}

function countThreadNodeRows(
  node: ProjectThreadNode,
  context: ProjectThreadItemRowCountContext,
): number {
  if (
    node.children.length === 0 ||
    context.collapsedThreadIds.has(node.thread.id)
  ) {
    return 1;
  }
  return node.children.reduce(
    (total, child) => total + countProjectThreadItemRows(child, context),
    1,
  );
}

export function countProjectThreadItemRows(
  item: ProjectThreadItem,
  context: ProjectThreadItemRowCountContext,
): number {
  switch (item.kind) {
    case "thread":
      return countThreadNodeRows(item.node, context);
    case "environment":
      if (context.collapsedEnvironmentIds.has(item.group.environmentId)) {
        return 1;
      }
      return item.group.nodes.reduce(
        (total, node) => total + countThreadNodeRows(node, context),
        1,
      );
    case "section":
      if (context.collapsedSectionKeys.has(item.group.key)) {
        return 1;
      }
      return item.group.items.reduce(
        (total, child) => total + countProjectThreadItemRows(child, context),
        1,
      );
  }
}

export function projectThreadItemContainsThread(
  item: ProjectThreadItem,
  threadId: string,
): boolean {
  switch (item.kind) {
    case "thread":
      return (
        item.node.thread.id === threadId ||
        item.node.children.some((child) =>
          projectThreadItemContainsThread(child, threadId),
        )
      );
    case "environment":
      return item.group.nodes.some(
        (node) =>
          node.thread.id === threadId ||
          node.children.some((child) =>
            projectThreadItemContainsThread(child, threadId),
          ),
      );
    case "section":
      return item.group.items.some((child) =>
        projectThreadItemContainsThread(child, threadId),
      );
  }
}

interface ProjectThreadItemNavigationEntry {
  threadId: string;
  projectId: string;
}

function collectThreadNodeNavigationEntries(
  node: ProjectThreadNode,
  context: ProjectThreadItemRowCountContext,
  entries: ProjectThreadItemNavigationEntry[],
): void {
  entries.push({
    threadId: node.thread.id,
    projectId: node.thread.projectId,
  });
  if (
    node.children.length === 0 ||
    context.collapsedThreadIds.has(node.thread.id)
  ) {
    return;
  }
  for (const child of node.children) {
    collectProjectThreadItemNavigationEntriesInto(child, context, entries);
  }
}

function collectProjectThreadItemNavigationEntriesInto(
  item: ProjectThreadItem,
  context: ProjectThreadItemRowCountContext,
  entries: ProjectThreadItemNavigationEntry[],
): void {
  switch (item.kind) {
    case "thread":
      collectThreadNodeNavigationEntries(item.node, context, entries);
      return;
    case "environment":
      if (context.collapsedEnvironmentIds.has(item.group.environmentId)) {
        return;
      }
      for (const node of item.group.nodes) {
        collectThreadNodeNavigationEntries(node, context, entries);
      }
      return;
    case "section":
      if (context.collapsedSectionKeys.has(item.group.key)) {
        return;
      }
      for (const child of item.group.items) {
        collectProjectThreadItemNavigationEntriesInto(child, context, entries);
      }
      return;
  }
}

export function collectProjectThreadItemNavigationEntries(
  item: ProjectThreadItem,
  context: ProjectThreadItemRowCountContext,
): ProjectThreadItemNavigationEntry[] {
  const entries: ProjectThreadItemNavigationEntry[] = [];
  collectProjectThreadItemNavigationEntriesInto(item, context, entries);
  return entries;
}
