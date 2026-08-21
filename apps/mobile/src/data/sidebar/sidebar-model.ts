import {
  buildMachineThreadGroups,
  buildPinnedSidebarState,
  buildProjectThreadGroups,
  buildSectionThreadList,
  buildSidebarEntitySectionId,
  compareByCreatedAtDescending,
  compareStandardThreads,
  createSidebarProjectIdResolver,
  getCollapsedChildActivity,
  getProjectThreadItemDescendants,
  isSidebarProjectThread,
  type CollapsedChildActivity,
  type ProjectThreadItem,
  type ProjectThreadNode,
  type SidebarSectionDefinition,
  type SidebarSectionId,
  type ThreadComparator,
} from "@bb/client-core";
import {
  PERSONAL_PROJECT_ID,
  type Host,
  type ThreadListEntry,
} from "@bb/domain";
import type {
  ProjectWithThreadsResponse,
  SidebarBootstrapResponse,
} from "@bb/server-contract";
import { getThreadDisplayTitle } from "../threads/thread-title";
import { sidebarThreadsFromBootstrap } from "../threads/thread-list-cache";
import type {
  SidebarOrganizeMode,
  SidebarSortMode,
} from "./sidebar-preferences";

/**
 * Pure derivation of what the sidebar renders from the bootstrap response
 * plus the display preferences (mirrors the per-mode composition in
 * apps/app/src/components/sidebar/ProjectList.tsx, on top of the shared
 * grouping/sorting from @bb/client-core). Renderers walk `pinned` then
 * `groups`; every group carries the flat `threads` it covers (for collapsed
 * activity glyphs and counts) and the nested `items` tree.
 */

export type SidebarProject = Omit<ProjectWithThreadsResponse, "threads">;

export function stripProjectThreads(
  project: ProjectWithThreadsResponse,
): SidebarProject {
  const { threads: _threads, ...rest } = project;
  return rest;
}

interface SidebarGroupBase {
  /** Top-level section identity (`project:<id>`, `machine:<key>`, …). */
  id: SidebarSectionId;
  label: string;
  items: ProjectThreadItem[];
  /** Every thread the group covers (roots and descendants), unsorted. */
  threads: ThreadListEntry[];
  activity: CollapsedChildActivity;
}

export interface SidebarProjectGroup extends SidebarGroupBase {
  kind: "project";
  project: SidebarProject;
}

export interface SidebarMachineGroup extends SidebarGroupBase {
  kind: "machine";
  /** Host id or `NO_MACHINE_GROUP_KEY`; the persisted collapse key. */
  key: string;
}

export interface SidebarSectionGroup extends SidebarGroupBase {
  kind: "section";
  section: SidebarSectionDefinition;
  /** Persisted collapse key (`buildSectionKey(CHRONOLOGICAL_CONTAINER_ID, id)`). */
  sectionKey: string;
}

/** The built-in trailing bucket: personal threads (project mode) or loose threads. */
export interface SidebarThreadsGroup extends SidebarGroupBase {
  kind: "threads";
  id: "threads";
}

export type SidebarGroup =
  | SidebarProjectGroup
  | SidebarMachineGroup
  | SidebarSectionGroup
  | SidebarThreadsGroup;

export interface SidebarPinnedGroup {
  rootNodes: ProjectThreadNode[];
  threads: ThreadListEntry[];
  effectivePinnedThreadIds: ReadonlySet<string>;
  activity: CollapsedChildActivity;
}

export interface SidebarModel {
  /** False until the bootstrap has loaded once (groups are empty). */
  isReady: boolean;
  organize: SidebarOrganizeMode;
  sort: SidebarSortMode;
  compareThreads: ThreadComparator;
  threads: ThreadListEntry[];
  threadById: ReadonlyMap<string, ThreadListEntry>;
  projects: SidebarProject[];
  personalProject: SidebarProject | null;
  sections: SidebarSectionDefinition[];
  projectNamesById: ReadonlyMap<string, string>;
  sectionNamesById: ReadonlyMap<string, string>;
  /** Null when nothing is pinned (the Pinned section is hidden). */
  pinned: SidebarPinnedGroup | null;
  groups: SidebarGroup[];
}

export interface BuildSidebarModelArgs {
  bootstrap: SidebarBootstrapResponse | undefined;
  /** Needed for machine mode labels/order; other modes ignore it. */
  hosts: readonly Host[] | undefined;
  organize: SidebarOrganizeMode;
  sort: SidebarSortMode;
  /** Threads with an unsubmitted composer draft (activity glyph). */
  draftThreadIds?: ReadonlySet<string>;
}

const EMPTY_DRAFT_THREAD_IDS: ReadonlySet<string> = new Set();

function compareByTitleAscending(
  left: ThreadListEntry,
  right: ThreadListEntry,
): number {
  const titleDelta = getThreadDisplayTitle(left).localeCompare(
    getThreadDisplayTitle(right),
  );
  if (titleDelta !== 0) return titleDelta;
  return left.id.localeCompare(right.id);
}

function alphaLabel(item: ProjectThreadItem): string {
  switch (item.kind) {
    case "thread":
      return getThreadDisplayTitle(item.node.thread);
    case "environment":
      return getThreadDisplayTitle(item.group.nodes[0].thread);
    case "section":
      return item.group.name;
  }
}

function compareItemsByTitleAscending(
  left: ProjectThreadItem,
  right: ProjectThreadItem,
): number {
  const labelDelta = alphaLabel(left).localeCompare(alphaLabel(right));
  if (labelDelta !== 0) return labelDelta;
  if (left.kind !== "section" && right.kind !== "section") {
    const leftThread =
      left.kind === "thread" ? left.node.thread : left.group.nodes[0].thread;
    const rightThread =
      right.kind === "thread" ? right.node.thread : right.group.nodes[0].thread;
    const idDelta = leftThread.id.localeCompare(rightThread.id);
    if (idDelta !== 0) return idDelta;
  }
  const kindDelta = left.kind.localeCompare(right.kind);
  if (kindDelta !== 0) return kindDelta;
  return left.kind === "section" && right.kind === "section"
    ? left.group.key.localeCompare(right.group.key)
    : 0;
}

/**
 * The sibling comparator for a sort mode: `updated` keeps active threads on
 * top by creation and orders the rest by attention recency (the standard
 * comparator), `created` is strict creation order, `alpha` is A→Z by display
 * title (sections included).
 */
export function getSidebarThreadComparator(
  sort: SidebarSortMode,
): ThreadComparator {
  if (sort === "alpha") {
    const comparator: ThreadComparator = compareByTitleAscending;
    comparator.compareItems = compareItemsByTitleAscending;
    return comparator;
  }
  return sort === "created"
    ? compareByCreatedAtDescending
    : compareStandardThreads;
}

function buildGroupBase(
  items: ProjectThreadItem[],
  threads: ThreadListEntry[],
  draftThreadIds: ReadonlySet<string>,
): Pick<SidebarGroupBase, "items" | "threads" | "activity"> {
  return {
    items,
    threads,
    activity: getCollapsedChildActivity(threads, draftThreadIds),
  };
}

const EMPTY_MODEL_BASE = {
  threads: [] as ThreadListEntry[],
  threadById: new Map<string, ThreadListEntry>(),
  projects: [] as SidebarProject[],
  personalProject: null,
  sections: [] as SidebarSectionDefinition[],
  projectNamesById: new Map<string, string>(),
  sectionNamesById: new Map<string, string>(),
  pinned: null,
  groups: [] as SidebarGroup[],
} as const;

export function buildSidebarModel({
  bootstrap,
  hosts,
  organize,
  sort,
  draftThreadIds = EMPTY_DRAFT_THREAD_IDS,
}: BuildSidebarModelArgs): SidebarModel {
  const compareThreads = getSidebarThreadComparator(sort);
  if (!bootstrap) {
    return {
      ...EMPTY_MODEL_BASE,
      isReady: false,
      organize,
      sort,
      compareThreads,
    };
  }

  const threads = sidebarThreadsFromBootstrap(bootstrap);
  const threadById = new Map(threads.map((thread) => [thread.id, thread]));
  const projects = bootstrap.projects.map(stripProjectThreads);
  const personalProject = stripProjectThreads(bootstrap.personalProject);
  const projectNamesById = new Map<string, string>(
    projects.map((project) => [project.id, project.name]),
  );
  projectNamesById.set(PERSONAL_PROJECT_ID, personalProject.name);
  const sections = bootstrap.sections.map(
    (section): SidebarSectionDefinition => ({
      id: section.id,
      name: section.name,
    }),
  );
  const sectionNamesById = new Map(
    sections.map((section) => [section.id, section.name]),
  );

  const pinnedState = buildPinnedSidebarState({ draftThreadIds, threads });
  const pinnedThreads = threads.filter(
    (thread) =>
      pinnedState.effectivePinnedThreadIds.has(thread.id) &&
      isSidebarProjectThread(thread),
  );
  const pinned: SidebarPinnedGroup | null =
    pinnedState.rootNodes.length > 0
      ? {
          rootNodes: pinnedState.rootNodes,
          threads: pinnedThreads,
          effectivePinnedThreadIds: pinnedState.effectivePinnedThreadIds,
          activity: getCollapsedChildActivity(pinnedThreads, draftThreadIds),
        }
      : null;
  const nonPinnedThreads = threads.filter(
    (thread) => !pinnedState.effectivePinnedThreadIds.has(thread.id),
  );

  const groups: SidebarGroup[] = [];
  switch (organize) {
    case "project": {
      const resolveSidebarProjectId =
        createSidebarProjectIdResolver(threadById);
      const threadsByProject = new Map<string, ThreadListEntry[]>();
      for (const thread of nonPinnedThreads) {
        // Cross-project children render under their parent's project group.
        const projectId = resolveSidebarProjectId(thread);
        const bucket = threadsByProject.get(projectId);
        if (bucket) bucket.push(thread);
        else threadsByProject.set(projectId, [thread]);
      }
      for (const project of projects) {
        const projectThreads = (threadsByProject.get(project.id) ?? []).filter(
          isSidebarProjectThread,
        );
        groups.push({
          kind: "project",
          id: buildSidebarEntitySectionId("project", project.id),
          label: project.name,
          project,
          ...buildGroupBase(
            buildProjectThreadGroups(
              projectThreads,
              compareThreads,
              draftThreadIds,
            ),
            projectThreads,
            draftThreadIds,
          ),
        });
      }
      const personalThreads = (
        threadsByProject.get(PERSONAL_PROJECT_ID) ?? []
      ).filter(isSidebarProjectThread);
      groups.push({
        kind: "threads",
        id: "threads",
        label: "Threads",
        ...buildGroupBase(
          buildProjectThreadGroups(
            personalThreads,
            compareThreads,
            draftThreadIds,
          ),
          personalThreads,
          draftThreadIds,
        ),
      });
      break;
    }
    case "machine": {
      const visibleThreads = nonPinnedThreads.filter(isSidebarProjectThread);
      const machineGroups = buildMachineThreadGroups(
        visibleThreads,
        hosts ?? [],
      );
      for (const group of machineGroups) {
        groups.push({
          kind: "machine",
          id: buildSidebarEntitySectionId("machine", group.key),
          key: group.key,
          label: group.label,
          ...buildGroupBase(
            buildProjectThreadGroups(
              group.threads,
              compareThreads,
              draftThreadIds,
            ),
            group.threads,
            draftThreadIds,
          ),
        });
      }
      if (machineGroups.length === 0) {
        groups.push({
          kind: "threads",
          id: "threads",
          label: "Threads",
          ...buildGroupBase(
            buildProjectThreadGroups(
              visibleThreads,
              compareThreads,
              draftThreadIds,
            ),
            visibleThreads,
            draftThreadIds,
          ),
        });
      }
      break;
    }
    case "manual": {
      const rootItems = buildSectionThreadList(
        nonPinnedThreads,
        compareThreads,
        sections,
        draftThreadIds,
      );
      const looseItems: ProjectThreadItem[] = [];
      for (const item of rootItems) {
        if (item.kind !== "section") {
          looseItems.push(item);
          continue;
        }
        const sectionThreads = getProjectThreadItemDescendants(
          item.group.items,
        );
        groups.push({
          kind: "section",
          id: buildSidebarEntitySectionId("section", item.group.id),
          label: item.group.name,
          section: { id: item.group.id, name: item.group.name },
          sectionKey: item.group.key,
          items: item.group.items,
          threads: sectionThreads,
          activity: item.group.activity,
        });
      }
      const looseThreads = getProjectThreadItemDescendants(looseItems);
      groups.push({
        kind: "threads",
        id: "threads",
        label: "Unorganized",
        ...buildGroupBase(looseItems, looseThreads, draftThreadIds),
      });
      break;
    }
  }

  return {
    isReady: true,
    organize,
    sort,
    compareThreads,
    threads,
    threadById,
    projects,
    personalProject,
    sections,
    projectNamesById,
    sectionNamesById,
    pinned,
    groups,
  };
}

export interface SelectedThreadSidebarExpansion {
  /** Parents to expand so the selected thread's row is reachable. */
  threadIds: string[];
  environmentIds: string[];
  projectId: string | null;
  machineKey: string | null;
  sectionKey: string | null;
  builtInSection: "pinned" | "threads" | null;
}

/**
 * What must be expanded to reveal a thread in the current model (mirrors the
 * selected-thread expansion effect in ProjectList.tsx). Hidden threads have
 * no row and yield nothing.
 */
export function getSelectedThreadSidebarExpansion(
  model: SidebarModel,
  threadId: string,
): SelectedThreadSidebarExpansion | null {
  const thread = model.threadById.get(threadId);
  if (!thread || thread.visibility === "hidden") return null;
  const threadIds: string[] = [];
  const environmentIds: string[] = [];
  let current: ThreadListEntry | undefined = thread;
  let hops = model.threadById.size;
  while (current && hops > 0) {
    if (current.environmentId !== null)
      environmentIds.push(current.environmentId);
    if (current.parentThreadId === null) break;
    const parent = model.threadById.get(current.parentThreadId);
    if (!parent) break;
    threadIds.push(parent.id);
    current = parent;
    hops -= 1;
  }
  const isPinned =
    model.pinned?.effectivePinnedThreadIds.has(threadId) ?? false;
  const containingGroup = isPinned
    ? null
    : model.groups.find((group) =>
        group.threads.some((candidate) => candidate.id === threadId),
      );
  return {
    threadIds,
    environmentIds,
    projectId:
      containingGroup?.kind === "project" ? containingGroup.project.id : null,
    machineKey:
      containingGroup?.kind === "machine" ? containingGroup.key : null,
    sectionKey:
      containingGroup?.kind === "section" ? containingGroup.sectionKey : null,
    builtInSection: isPinned
      ? "pinned"
      : containingGroup?.kind === "threads"
        ? "threads"
        : null,
  };
}
