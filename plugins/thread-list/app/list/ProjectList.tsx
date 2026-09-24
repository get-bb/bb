import {
  ThreadListVisibility,
  ThreadListMore,
  ThreadListVisibilityGroupScope,
  ThreadListVisibilityMenuItems,
  type ThreadListVisibilityGroup,
} from "./ThreadListVisibility.js";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { toast } from "sonner";
import type { SidebarThread } from "../model/sidebar-thread.js";
import {
  experimental_useSidebarThreadActions,
  useSdk,
  useSidebarThreadDraftIds,
} from "@get-bb/plugin-sdk/app";
import {
  SidebarRenameProvider,
  useSidebarRename,
  useSidebarRenameState,
} from "../rows/SidebarInlineRename.js";
import { AppThreadSectionMoveProvider } from "../rows/ThreadSectionMoveProvider.js";
import { useDialogState } from "../ui/useDialogState.js";
import {
  buildProjectThreadGroups,
  getProjectThreadItemDescendants,
  type ProjectThreadNode,
} from "../model/project-thread-groups.js";
import { getCollapsedChildActivity } from "../model/thread-activity.js";
import { useSectionThreadDnd } from "../dnd/useSectionThreadDnd.js";
import { useNestDropPreview } from "../dnd/useNestDropPreview.js";
import {
  getErrorCode,
  getMutationErrorMessage,
} from "../ui/mutation-errors.js";
import { cn } from "@/lib/utils";
import { ThreadSectionCreateDialog } from "./ThreadSectionCreateDialog.js";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "../ui/ConfirmDeleteDialog.js";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SidebarContentElementProvider,
  SidebarGroupContent,
  SidebarStickyStack,
} from "../ui/sidebar.js";
import {
  ChronologicalSectionThreadSections,
  ProjectThreadTree,
} from "./ProjectRow.js";
import type { ProjectThreadListState } from "./ProjectRow.js";
import { buildMachineThreadGroups } from "../model/machine-thread-groups.js";
import { buildPinnedSidebarState } from "../model/pinned-sidebar-threads.js";
import {
  CHRONOLOGICAL_CONTAINER_ID,
  compareByCreatedAtDescending,
  compareStandardThreads,
  createSidebarProjectIdResolver,
  isSidebarProjectThread,
  type ProjectThreadItem,
  type SidebarSectionDefinition,
  type ThreadComparator,
} from "../model/project-thread-groups.js";
import type {
  CollapsibleSidebarSectionId,
  SidebarSectionId,
} from "../model/sidebar-section-id.js";
import {
  buildSidebarEntitySectionId,
  insertSidebarSectionAfter,
} from "../model/sidebar-section-order.js";
import {
  SortableProjectRow,
  type ProjectListRowModel,
} from "./ProjectListProjects.js";
import {
  PinnedThreadTree,
  type PinnedThreadTreeProps,
} from "./PinnedThreadTree.js";
import {
  collapsedEnvironmentIdsAtom,
  collapsedThreadIdsAtom,
  collapsedProjectIdsAtom,
  collapsedSidebarSectionIdsAtom,
  sidebarChronologicalSortAtom,
  sidebarGroupThreadsByEnvironmentAtom,
  sidebarSortDirectionAtom,
  sidebarCollapsedMachinesAtom,
  sidebarManualSectionOrderAtom,
  sidebarOrganizationModeAtom,
} from "../preferences/atoms.js";
import type {
  ChronologicalSort as SidebarChronologicalSort,
  OrganizationMode as SidebarOrganizationMode,
  SortDirection as SidebarSortDirection,
} from "../../shared/preferences.js";
import { usePreferencesReady } from "../preferences/PreferencesSync.js";
import {
  SidebarHeaderActionsProvider,
  SidebarHeaderControls,
  SidebarSectionMenuItems,
} from "./SidebarHeaderControls.js";
import {
  renderBuiltInSidebarSection,
  SortableSidebarSection,
  type BuiltInSidebarSectionOptions,
  type BuiltInSidebarSectionOptionsById,
} from "./BuiltInSidebarSection.js";
import { ReorderableSidebarSectionOrderList } from "./ReorderableSidebarSectionOrderList.js";
import { useSidebarModeSectionOrder } from "./useSidebarModeSectionOrder.js";
import { haveSameOrder } from "../model/stored-order.js";
import {
  useSidebarData,
  useSidebarMachineHosts,
  type SidebarProject,
} from "../model/use-sidebar-data.js";

export interface ProjectListProps {
  activeThreadId: string | null;
  onProjectSelect?: () => void;
}

interface ProjectListShellProps {
  children: ReactNode;
}

interface ProjectListNavigationLoadingRowProps {
  textWidthClassName: string;
}

export { PROJECT_LIST_ACTION_BUTTON_CLASS } from "../rows/sidebarRowClasses.js";

type ThreadListStatus = "loading" | "ready" | "unavailable";

interface ProjectThreadListStateArgs {
  status: ThreadListStatus;
  threads: SidebarThread[] | undefined;
}

interface ToggleCollapsedIdListArgs {
  current: string[];
  id: string;
}

type ToggleCollapsedId = (id: string) => void;
type ToggleCollapsedSidebarSectionId = (
  id: CollapsibleSidebarSectionId,
) => void;
type OpenSidebarMenu = `displayOptions:${string}` | null;

function isCollapsibleSidebarSectionId(
  value: string,
): value is CollapsibleSidebarSectionId {
  return value === "pinned" || value === "threads";
}

const EMPTY_PROJECT_THREAD_LIST_STATE: ProjectThreadListState = {
  status: "loading",
};

const EMPTY_THREAD_LIST: SidebarThread[] = [];
const EMPTY_SECTION_DEFINITIONS: readonly SidebarSectionDefinition[] = [];

function getProjectThreadListState({
  status,
  threads,
}: ProjectThreadListStateArgs): ProjectThreadListState {
  switch (status) {
    case "ready":
      return {
        status: "ready",
        threads: threads ?? [],
      };
    case "unavailable":
      return { status: "unavailable" };
    case "loading":
      return EMPTY_PROJECT_THREAD_LIST_STATE;
  }
}

function toggleCollapsedIdList({
  current,
  id,
}: ToggleCollapsedIdListArgs): string[] {
  const next = new Set(current);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }

  return Array.from(next);
}

function normalizeCollapsedSidebarSectionIds(
  sectionIds: readonly CollapsibleSidebarSectionId[],
): CollapsibleSidebarSectionId[] {
  const seen = new Set<CollapsibleSidebarSectionId>();
  const normalized: CollapsibleSidebarSectionId[] = [];
  for (const sectionId of sectionIds) {
    if (!isCollapsibleSidebarSectionId(sectionId) || seen.has(sectionId)) {
      continue;
    }
    seen.add(sectionId);
    normalized.push(sectionId);
  }
  return normalized;
}

type ActiveRename = ReturnType<typeof useSidebarRenameState>;

function getThreadSortTitle(
  thread: SidebarThread,
  rename: ActiveRename,
): string {
  return rename?.kind === "thread" && rename.id === thread.id
    ? rename.name
    : thread.displayTitle;
}

function compareByTitleAscending(
  left: SidebarThread,
  right: SidebarThread,
  rename: ActiveRename = null,
): number {
  const titleDelta = getThreadSortTitle(left, rename).localeCompare(
    getThreadSortTitle(right, rename),
  );
  if (titleDelta !== 0) {
    return titleDelta;
  }

  return left.id.localeCompare(right.id);
}

function getProjectThreadItemAlphaLabel(
  item: ProjectThreadItem,
  rename: ActiveRename = null,
): string {
  switch (item.kind) {
    case "thread":
      return getThreadSortTitle(item.node.thread, rename);
    case "environment":
      return getThreadSortTitle(item.group.nodes[0].thread, rename);
    case "section":
      return rename?.kind === "section" && rename.id === item.group.id
        ? rename.name
        : item.group.name;
  }
}

function compareProjectThreadItemsByTitleAscending(
  left: ProjectThreadItem,
  right: ProjectThreadItem,
  rename: ActiveRename = null,
): number {
  const labelDelta = getProjectThreadItemAlphaLabel(left, rename).localeCompare(
    getProjectThreadItemAlphaLabel(right, rename),
  );
  if (labelDelta !== 0) {
    return labelDelta;
  }

  if (left.kind !== "section" && right.kind !== "section") {
    const leftThread =
      left.kind === "thread" ? left.node.thread : left.group.nodes[0].thread;
    const rightThread =
      right.kind === "thread" ? right.node.thread : right.group.nodes[0].thread;
    const threadIdDelta = leftThread.id.localeCompare(rightThread.id);
    if (threadIdDelta !== 0) {
      return threadIdDelta;
    }
  }

  const kindDelta = left.kind.localeCompare(right.kind);
  if (kindDelta !== 0) {
    return kindDelta;
  }

  return left.kind === "section" && right.kind === "section"
    ? left.group.key.localeCompare(right.group.key)
    : 0;
}

export function getSidebarThreadComparator(
  sort: SidebarChronologicalSort,
  direction: SidebarSortDirection = "default",
  rename: ActiveRename = null,
): ThreadComparator {
  const normalizedSort = sort === "none" ? "updated" : sort;

  const multiplier =
    direction === "default" ||
    direction === (normalizedSort === "alpha" ? "ascending" : "descending")
      ? 1
      : -1;
  if (normalizedSort === "alpha") {
    const comparator: ThreadComparator = (left, right) =>
      multiplier * compareByTitleAscending(left, right, rename);
    comparator.compareItems = (left, right) =>
      multiplier *
      compareProjectThreadItemsByTitleAscending(left, right, rename);
    return comparator;
  }
  const base =
    normalizedSort === "created"
      ? compareByCreatedAtDescending
      : compareStandardThreads;
  return (left, right) => {
    const comparison = base(left, right);
    if (
      normalizedSort === "updated" &&
      (left.status === "active") !== (right.status === "active")
    ) {
      return comparison;
    }
    return multiplier * comparison;
  };
}

function getSectionMutationErrorMessage(
  error: unknown,
  fallbackMessage: string,
): string {
  if (getErrorCode(error) === "section_name_conflict") {
    return "Section name already exists.";
  }
  return getMutationErrorMessage({ error, fallbackMessage });
}

export function ProjectListNavigationLoadingState() {
  return (
    <div
      aria-label="Loading sidebar navigation"
      className="space-y-1.5 px-2 pt-1"
    >
      <ProjectListNavigationLoadingRow textWidthClassName="w-2/3" />
      <ProjectListNavigationLoadingRow textWidthClassName="w-1/2" />
    </div>
  );
}

function ProjectListNavigationLoadingRow({
  textWidthClassName,
}: ProjectListNavigationLoadingRowProps) {
  return (
    <div
      data-sidebar="navigation-loading-row"
      className="flex h-7 items-center gap-2 rounded-md"
    >
      <Skeleton className="size-4 shrink-0 rounded-md bg-sidebar-border/60" />
      <Skeleton
        className={cn(
          "h-3 rounded-sm bg-sidebar-border/50",
          textWidthClassName,
        )}
      />
    </div>
  );
}

export function ProjectListShell({ children }: ProjectListShellProps) {
  return (
    <SidebarContentElementProvider>
      <SidebarStickyStack data-sidebar-sticky-density="compact-actions">
        <SidebarGroupContent>{children}</SidebarGroupContent>
      </SidebarStickyStack>
    </SidebarContentElementProvider>
  );
}

function ProjectListSectionMoveScope({
  children,
  sections,
}: ProjectListShellProps & {
  sections: readonly SidebarSectionDefinition[];
}) {
  return (
    <AppThreadSectionMoveProvider sections={sections}>
      <ProjectListShell>{children}</ProjectListShell>
    </AppThreadSectionMoveProvider>
  );
}

interface BuiltInSectionRenderState {
  collapsedSectionIds: ReadonlySet<CollapsibleSidebarSectionId>;
  onToggleCollapsed: (id: CollapsibleSidebarSectionId) => void;
  showPinnedSection: boolean;
}

interface ActiveSidebarModeSectionsProps {
  mode: SidebarOrganizationMode;
  renderChronological: () => ReactNode;
  renderMachine: () => ReactNode;
  renderProject: () => ReactNode;
}

export function ActiveSidebarModeSections({
  mode,
  renderChronological,
  renderMachine,
  renderProject,
}: ActiveSidebarModeSectionsProps) {
  if (mode === "machine") return renderMachine();
  if (mode === "chronological") return renderChronological();
  return renderProject();
}

interface GroupedModePinnedProps {
  pinnedReorderPending: boolean;
  pinnedRootItems: readonly ProjectThreadItem[];
  pinnedRootNodes: readonly ProjectThreadNode[];
  pinnedThreads: readonly SidebarThread[];
  onReorderPinnedThread: NonNullable<
    PinnedThreadTreeProps["onReorderPinnedRoot"]
  >;
}

function buildGroupSectionItem(
  id: string,
  key: SidebarSectionId,
  name: string,
  threads: readonly SidebarThread[],
  compareThreads: ThreadComparator,
  draftThreadIds: ReadonlySet<string>,
  groupThreadsByEnvironment: boolean,
): Extract<ProjectThreadItem, { kind: "section" }> {
  const items = buildProjectThreadGroups(
    threads,
    compareThreads,
    draftThreadIds,
    groupThreadsByEnvironment,
  );
  return {
    kind: "section",
    group: {
      id,
      key,
      name,
      items,
      threadCount: getProjectThreadItemDescendants(items).length,
      activity: getCollapsedChildActivity(threads, draftThreadIds),
    },
  };
}

function useGroupedModeThreadDnd({
  collapsedThreadIds,
  compareThreads,
  draftThreadIds,
  onToggleThreadCollapsed,
  order,
  onOrderChange,
  pinned,
  rootItems,
  threads,
}: {
  collapsedThreadIds: Set<string>;
  compareThreads: ThreadComparator;
  draftThreadIds: ReadonlySet<string>;
  onToggleThreadCollapsed: ToggleCollapsedId;
  order: readonly SidebarSectionId[];
  onOrderChange: (order: SidebarSectionId[]) => void;
  pinned: GroupedModePinnedProps;
  rootItems: readonly ProjectThreadItem[];
  threads: readonly SidebarThread[];
}) {
  const expandThread = useCallback(
    (threadId: string) => {
      if (collapsedThreadIds.has(threadId)) {
        onToggleThreadCollapsed(threadId);
      }
    },
    [collapsedThreadIds, onToggleThreadCollapsed],
  );
  const threadDnd = useSectionThreadDnd({
    containerId: CHRONOLOGICAL_CONTAINER_ID,
    enabled: true,
    rootItems,
    topLevelSectionOrder: order,
    onTopLevelSectionOrderChange: onOrderChange,
    onExpandThread: expandThread,
    groups: true,
    pinnedReorderPending: pinned.pinnedReorderPending,
    pinnedThreads: pinned.pinnedThreads,
    pinnedRootItems: pinned.pinnedRootItems,
    pinnedRootNodes: pinned.pinnedRootNodes,
    onReorderPinnedThread: pinned.onReorderPinnedThread,
  });
  return useNestDropPreview({
    compareThreads,
    draftThreadIds,
    pinnedRootNodes: pinned.pinnedRootNodes,
    sectionDnd: threadDnd,
    sections: EMPTY_SECTION_DEFINITIONS,
    threads,
  });
}

interface ProjectModeSectionsProps
  extends BuiltInSectionRenderState, GroupedModePinnedProps {
  collapsedEnvironmentIds: Set<string>;
  collapsedThreadIds: Set<string>;
  compareThreads: ThreadComparator;
  draftThreadIds: ReadonlySet<string>;
  effectivePinnedThreadIds: ReadonlySet<string>;
  onCreateProjectThread: (projectId: string) => void;
  onProjectSelect?: () => void;
  onToggleEnvironmentCollapsed: ToggleCollapsedId;
  onToggleThreadCollapsed: ToggleCollapsedId;
  personalProjectId: string | null;
  pinnedSection: BuiltInSidebarSectionOptions;
  projects: readonly SidebarProject[];
  selectedThreadId?: string;
  status: ThreadListStatus;
  threads: SidebarThread[];
  threadsSection: Omit<BuiltInSidebarSectionOptions, "content">;
}

function ProjectModeSections({
  collapsedEnvironmentIds,
  collapsedSectionIds,
  collapsedThreadIds,
  compareThreads,
  draftThreadIds,
  effectivePinnedThreadIds,
  onCreateProjectThread,
  onProjectSelect,
  onToggleCollapsed,
  onToggleEnvironmentCollapsed,
  onToggleThreadCollapsed,
  pinnedReorderPending,
  pinnedRootItems,
  pinnedRootNodes,
  pinnedSection,
  pinnedThreads,
  onReorderPinnedThread,
  personalProjectId,
  projects,
  selectedThreadId,
  showPinnedSection,
  status,
  threads,
  threadsSection,
}: ProjectModeSectionsProps) {
  const groupThreadsByEnvironment = useAtomValue(
    sidebarGroupThreadsByEnvironmentAtom,
  );
  const [collapsedProjectIdList, setCollapsedProjectIdList] = useAtom(
    collapsedProjectIdsAtom,
  );
  const collapsedProjectIds = useMemo(
    () => new Set(collapsedProjectIdList),
    [collapsedProjectIdList],
  );
  const toggleProjectCollapsed = useCallback<ToggleCollapsedId>(
    (projectId) => {
      setCollapsedProjectIdList((current) =>
        toggleCollapsedIdList({ current, id: projectId }),
      );
    },
    [setCollapsedProjectIdList],
  );
  const threadsByProject = useMemo(() => {
    const grouped = new Map<string, SidebarThread[]>();
    const resolveSidebarProjectId = createSidebarProjectIdResolver(
      new Map(threads.map((thread) => [thread.id, thread])),
    );
    for (const thread of threads) {
      if (effectivePinnedThreadIds.has(thread.id)) continue;
      const sidebarProjectId = resolveSidebarProjectId(thread);
      const existing = grouped.get(sidebarProjectId);
      if (existing) {
        existing.push(thread);
      } else {
        grouped.set(sidebarProjectId, [thread]);
      }
    }
    return grouped;
  }, [effectivePinnedThreadIds, threads]);
  const projectRows = useMemo<ProjectListRowModel[]>(
    () =>
      projects
        .filter((project) => !project.isPersonal)
        .map((project) => ({
          project,
          threadListState: getProjectThreadListState({
            status,
            threads: threadsByProject.get(project.id),
          }),
          isActive: false,
        })),
    [projects, status, threadsByProject],
  );
  const projectSectionIds = useMemo(
    () =>
      projectRows.map((row) =>
        buildSidebarEntitySectionId("project", row.project.id),
      ),
    [projectRows],
  );
  const projectRowsBySectionId = useMemo(() => {
    const rows = new Map<SidebarSectionId, ProjectListRowModel>();
    for (const row of projectRows) {
      rows.set(buildSidebarEntitySectionId("project", row.project.id), row);
    }
    return rows;
  }, [projectRows]);
  const personalThreads = useMemo(() => {
    if (personalProjectId === null) return EMPTY_THREAD_LIST;
    return (
      threadsByProject.get(personalProjectId)?.filter(isSidebarProjectThread) ??
      EMPTY_THREAD_LIST
    );
  }, [personalProjectId, threadsByProject]);
  const { onOrderChange, order, persistedOrder } = useSidebarModeSectionOrder({
    mode: "project",
    entitySectionIds: projectSectionIds,
    hasThreadsSection: personalThreads.length > 0 || projectRows.length === 0,
    showPinnedSection,
  });
  const reorderDisabled = order.length < 2;
  const personalItems = useMemo(
    () =>
      buildProjectThreadGroups(
        personalThreads,
        compareThreads,
        draftThreadIds,
        groupThreadsByEnvironment,
      ),
    [
      compareThreads,
      draftThreadIds,
      groupThreadsByEnvironment,
      personalThreads,
    ],
  );
  const projectGroups = useMemo(
    () =>
      projectRows.map((row) =>
        buildGroupSectionItem(
          row.project.id,
          buildSidebarEntitySectionId("project", row.project.id),
          row.project.name,
          row.threadListState.status === "ready"
            ? row.threadListState.threads
            : EMPTY_THREAD_LIST,
          compareThreads,
          draftThreadIds,
          groupThreadsByEnvironment,
        ),
      ),
    [compareThreads, draftThreadIds, groupThreadsByEnvironment, projectRows],
  );
  const projectItemsByProjectId = useMemo(
    () =>
      new Map(
        projectGroups.map((group) => [group.group.id, group.group.items]),
      ),
    [projectGroups],
  );
  const groupRootItems = useMemo<ProjectThreadItem[]>(
    () => [...personalItems, ...projectGroups],
    [personalItems, projectGroups],
  );
  const nonPinnedThreads = useMemo(
    () => threads.filter((thread) => !effectivePinnedThreadIds.has(thread.id)),
    [effectivePinnedThreadIds, threads],
  );
  const threadDnd = useGroupedModeThreadDnd({
    collapsedThreadIds,
    compareThreads,
    draftThreadIds,
    onToggleThreadCollapsed,
    order,
    onOrderChange,
    pinned: {
      pinnedReorderPending,
      pinnedRootItems,
      pinnedRootNodes,
      pinnedThreads,
      onReorderPinnedThread,
    },
    rootItems: groupRootItems,
    threads: nonPinnedThreads,
  });
  const builtInSections: BuiltInSidebarSectionOptionsById = {
    pinned: pinnedSection,
    threads: {
      ...threadsSection,
      activity: getCollapsedChildActivity(personalThreads, draftThreadIds),
      collapsedThreads: personalThreads,
      content: (
        <ProjectThreadTree
          projectId={personalProjectId ?? undefined}
          dndParentKey={CHRONOLOGICAL_CONTAINER_ID}
          rootItems={personalItems}
          threadListState={getProjectThreadListState({
            status,
            threads: personalThreads,
          })}
          selectedThreadId={selectedThreadId}
          collapsedThreadIds={collapsedThreadIds}
          collapsedEnvironmentIds={collapsedEnvironmentIds}
          compareThreads={compareThreads}
          variant="section"
          onProjectSelect={onProjectSelect}
          onToggleThreadCollapsed={onToggleThreadCollapsed}
          onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
        />
      ),
    },
  };

  const visibilityGroups: ThreadListVisibilityGroup[] = [
    {
      id: "threads",
      title: "Threads",
      threads: personalThreads,
      onNewThread:
        personalProjectId === null
          ? undefined
          : () => onCreateProjectThread(personalProjectId),
      renderContent: (close: () => void) => (
        <ProjectThreadTree
          projectId={personalProjectId ?? undefined}
          rootItems={personalItems}
          threadListState={getProjectThreadListState({
            status,
            threads: personalThreads,
          })}
          selectedThreadId={selectedThreadId}
          collapsedThreadIds={collapsedThreadIds}
          collapsedEnvironmentIds={collapsedEnvironmentIds}
          compareThreads={compareThreads}
          variant="section"
          onProjectSelect={() => {
            close();
            onProjectSelect?.();
          }}
          onToggleThreadCollapsed={onToggleThreadCollapsed}
          onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
        />
      ),
    },
    ...projectRows.map((row) => {
      const id = buildSidebarEntitySectionId("project", row.project.id);
      const items = projectItemsByProjectId.get(row.project.id) ?? [];
      return {
        id,
        title: row.project.name,
        threads: getProjectThreadItemDescendants(items),
        onNewThread: () => onCreateProjectThread(row.project.id),
        renderContent: (close: () => void) => (
          <ProjectThreadTree
            projectId={row.project.id}
            rootItems={items}
            threadListState={row.threadListState}
            selectedThreadId={selectedThreadId}
            collapsedThreadIds={collapsedThreadIds}
            collapsedEnvironmentIds={collapsedEnvironmentIds}
            compareThreads={compareThreads}
            variant="section"
            onProjectSelect={() => {
              close();
              onProjectSelect?.();
            }}
            onToggleThreadCollapsed={onToggleThreadCollapsed}
            onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
          />
        ),
      };
    }),
  ];

  return (
    <ThreadListVisibility
      groups={visibilityGroups}
      order={persistedOrder}
      onOrderChange={onOrderChange}
      label="Projects"
      selectedThreadId={selectedThreadId}
    >
      <ReorderableSidebarSectionOrderList order={order} threadDnd={threadDnd}>
        {(sectionId, consumeClickSuppression) => {
          const builtInSection = renderBuiltInSidebarSection({
            sectionId,
            sections: builtInSections,
            disabled: reorderDisabled,
            collapsedSectionIds,
            onToggleCollapsed,
            consumeClickSuppression,
            showPinnedSection,
          });
          if (builtInSection !== undefined) {
            return sectionId === "threads" ? (
              <ThreadListVisibilityGroupScope key={sectionId} id={sectionId}>
                {builtInSection}
              </ThreadListVisibilityGroupScope>
            ) : (
              builtInSection
            );
          }
          const row = projectRowsBySectionId.get(sectionId);
          if (!row) return null;
          return (
            <ThreadListVisibilityGroupScope key={sectionId} id={sectionId}>
              <SortableProjectRow
                sortableId={sectionId}
                project={row.project}
                rootItems={projectItemsByProjectId.get(row.project.id)}
                threadListState={row.threadListState}
                selectedThreadId={selectedThreadId}
                isActive={row.isActive}
                isCollapsed={collapsedProjectIds.has(row.project.id)}
                collapsedThreadIds={collapsedThreadIds}
                collapsedEnvironmentIds={collapsedEnvironmentIds}
                compareThreads={compareThreads}
                onProjectSelect={onProjectSelect}
                onCreateProjectThread={onCreateProjectThread}
                onToggleProjectCollapsed={toggleProjectCollapsed}
                onToggleThreadCollapsed={onToggleThreadCollapsed}
                onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
                reorderDisabled={reorderDisabled}
                consumeProjectClickSuppression={consumeClickSuppression}
              />
            </ThreadListVisibilityGroupScope>
          );
        }}
      </ReorderableSidebarSectionOrderList>
      <ThreadListMore />
    </ThreadListVisibility>
  );
}

interface SectionModeSectionsProps extends BuiltInSectionRenderState {
  collapsedEnvironmentIds: Set<string>;
  collapsedThreadIds: Set<string>;
  compareThreads: ThreadComparator;
  sections: readonly SidebarSectionDefinition[];
  onCreateThread: () => void;
  onCreateThreadInSection: (sectionId: string) => void;
  onProjectSelect?: () => void;
  onRemoveSection: (section: SidebarSectionDefinition) => void;
  onToggleEnvironmentCollapsed: ToggleCollapsedId;
  onToggleThreadCollapsed: ToggleCollapsedId;
  pinnedSection: BuiltInSidebarSectionOptions;
  pinnedReorderPending: boolean;
  pinnedRootItems: readonly ProjectThreadItem[];
  pinnedRootNodes: readonly ProjectThreadNode[];
  pinnedThreads: readonly SidebarThread[];
  onReorderPinnedThread: NonNullable<
    PinnedThreadTreeProps["onReorderPinnedRoot"]
  >;
  selectedThreadId?: string;
  status: ThreadListStatus;
  threads: SidebarThread[];
  threadsSection: Omit<BuiltInSidebarSectionOptions, "content">;
  effectivePinnedThreadIds: ReadonlySet<string>;
}

function SectionModeSections({
  collapsedEnvironmentIds,
  collapsedSectionIds,
  collapsedThreadIds,
  compareThreads,
  effectivePinnedThreadIds,
  sections,
  onCreateThread,
  onCreateThreadInSection,
  onProjectSelect,
  onRemoveSection,
  onToggleCollapsed,
  onToggleEnvironmentCollapsed,
  onToggleThreadCollapsed,
  pinnedSection,
  pinnedReorderPending,
  pinnedRootItems,
  pinnedRootNodes,
  pinnedThreads,
  onReorderPinnedThread,
  selectedThreadId,
  showPinnedSection,
  status,
  threads,
  threadsSection,
}: SectionModeSectionsProps) {
  const nonPinnedThreads = useMemo(
    () => threads.filter((thread) => !effectivePinnedThreadIds.has(thread.id)),
    [effectivePinnedThreadIds, threads],
  );
  const threadListState = getProjectThreadListState({
    status,
    threads: nonPinnedThreads,
  });
  const threadSectionIds = useMemo(
    () =>
      sections.map((section) =>
        buildSidebarEntitySectionId("section", section.id),
      ),
    [sections],
  );
  const { onOrderChange, order, persistedOrder } = useSidebarModeSectionOrder({
    mode: "chronological",
    entitySectionIds: threadSectionIds,
    showPinnedSection,
  });

  return (
    <ChronologicalSectionThreadSections
      threadListState={threadListState}
      compareThreads={compareThreads}
      sections={sections}
      selectedThreadId={selectedThreadId}
      collapsedThreadIds={collapsedThreadIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      onProjectSelect={onProjectSelect}
      onCreateThread={onCreateThread}
      onCreateThreadInSection={onCreateThreadInSection}
      onRemoveSection={onRemoveSection}
      onToggleThreadCollapsed={onToggleThreadCollapsed}
      onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
      fullSectionOrder={persistedOrder}
      topLevelSectionOrder={order}
      onTopLevelSectionOrderChange={onOrderChange}
      pinnedReorderPending={pinnedReorderPending}
      pinnedRootItems={pinnedRootItems}
      pinnedRootNodes={pinnedRootNodes}
      pinnedThreads={pinnedThreads}
      onReorderPinnedThread={onReorderPinnedThread}
      builtInSections={{
        pinned: pinnedSection,
        threads: threadsSection,
        collapsedSectionIds,
        onToggleCollapsed,
      }}
    />
  );
}

interface MachineModeSectionsProps
  extends BuiltInSectionRenderState, GroupedModePinnedProps {
  collapsedEnvironmentIds: Set<string>;
  collapsedThreadIds: Set<string>;
  compareThreads: ThreadComparator;
  draftThreadIds: ReadonlySet<string>;
  effectivePinnedThreadIds: ReadonlySet<string>;
  onCreateThread?: () => void;
  onProjectSelect?: () => void;
  onToggleEnvironmentCollapsed: ToggleCollapsedId;
  onToggleThreadCollapsed: ToggleCollapsedId;
  pinnedSection: BuiltInSidebarSectionOptions;
  renderSectionDisplayOptions: (
    sectionId: SidebarSectionId,
    label: string,
    renameActions?: {
      onRename: () => void;
      onCloseAutoFocus: (event: Event) => void;
    },
  ) => ReactNode;
  isSectionDisplayOptionsOpen: (sectionId: SidebarSectionId) => boolean;
  selectedThreadId?: string;
  status: ThreadListStatus;
  threads: SidebarThread[];
  threadsSection: Omit<BuiltInSidebarSectionOptions, "content">;
}

function MachineSidebarSection({
  hostId,
  canRename,
  renderActions,
  ...props
}: ComponentProps<typeof SortableSidebarSection> & {
  hostId: string;
  canRename: boolean;
  renderActions: MachineModeSectionsProps["renderSectionDisplayOptions"];
}) {
  const sdk = useSdk();
  const rename = useSidebarRename({
    kind: "machine",
    id: hostId,
    ownerKey: `machine:${hostId}`,
    name: props.label,
    label: "Machine name",
    maxLength: 100,
    onSave: (name) => sdk.hosts.update({ hostId, name }),
  });
  if (!canRename) return <SortableSidebarSection {...props} />;
  return (
    <SortableSidebarSection
      {...props}
      disabled={props.disabled || rename.isEditing}
      labelEditor={rename.editor}
      onRename={rename.startEditing}
      actions={renderActions(props.id, props.label, {
        onRename: rename.startEditingFromMenu,
        onCloseAutoFocus: rename.onCloseAutoFocus,
      })}
    />
  );
}

export function MachineModeSections({
  collapsedEnvironmentIds,
  collapsedSectionIds,
  collapsedThreadIds,
  compareThreads,
  draftThreadIds,
  effectivePinnedThreadIds,
  isSectionDisplayOptionsOpen,
  onCreateThread,
  onProjectSelect,
  onToggleCollapsed,
  onToggleEnvironmentCollapsed,
  onToggleThreadCollapsed,
  pinnedReorderPending,
  pinnedRootItems,
  pinnedRootNodes,
  pinnedSection,
  pinnedThreads,
  onReorderPinnedThread,
  renderSectionDisplayOptions,
  selectedThreadId,
  showPinnedSection,
  status,
  threads,
  threadsSection,
}: MachineModeSectionsProps) {
  const groupThreadsByEnvironment = useAtomValue(
    sidebarGroupThreadsByEnvironmentAtom,
  );
  const { hostsById } = useSidebarData();
  const hosts = useSidebarMachineHosts(hostsById);
  const [collapsedMachineKeyList, setCollapsedMachineKeyList] = useAtom(
    sidebarCollapsedMachinesAtom,
  );
  const collapsedMachineKeys = useMemo(
    () => new Set(collapsedMachineKeyList),
    [collapsedMachineKeyList],
  );
  const toggleMachineCollapsed = useCallback<ToggleCollapsedId>(
    (machineKey) => {
      setCollapsedMachineKeyList((current) =>
        toggleCollapsedIdList({ current, id: machineKey }),
      );
    },
    [setCollapsedMachineKeyList],
  );
  const nonPinnedThreads = useMemo(
    () =>
      threads.filter(
        (thread) =>
          !effectivePinnedThreadIds.has(thread.id) &&
          isSidebarProjectThread(thread),
      ),
    [effectivePinnedThreadIds, threads],
  );
  const allThreadsListState = getProjectThreadListState({
    status,
    threads: nonPinnedThreads,
  });
  const machineSections = useMemo(
    () =>
      buildMachineThreadGroups(nonPinnedThreads, hosts).map((group) => ({
        activity: getCollapsedChildActivity(group.threads, draftThreadIds),
        key: group.key,
        label: group.label,
        threadListState: {
          status: "ready",
          threads: group.threads,
        } satisfies ProjectThreadListState,
      })),
    [draftThreadIds, hosts, nonPinnedThreads],
  );
  const machineSectionIds = useMemo(
    () =>
      machineSections.map((section) =>
        buildSidebarEntitySectionId("machine", section.key),
      ),
    [machineSections],
  );
  const machineSectionsById = useMemo(
    () =>
      new Map(
        machineSections.map((section) => [
          buildSidebarEntitySectionId("machine", section.key),
          section,
        ]),
      ),
    [machineSections],
  );
  const { onOrderChange, order, persistedOrder } = useSidebarModeSectionOrder({
    mode: "machine",
    entitySectionIds: machineSectionIds,
    hasThreadsSection: machineSections.length === 0,
    showPinnedSection,
  });
  const reorderDisabled = order.length < 2;
  const allThreadItems = useMemo(
    () =>
      machineSections.length === 0
        ? buildProjectThreadGroups(
            nonPinnedThreads,
            compareThreads,
            draftThreadIds,
            groupThreadsByEnvironment,
          )
        : [],
    [
      compareThreads,
      draftThreadIds,
      groupThreadsByEnvironment,
      machineSections.length,
      nonPinnedThreads,
    ],
  );
  const machineGroups = useMemo(
    () =>
      machineSections.map((section) =>
        buildGroupSectionItem(
          section.key,
          buildSidebarEntitySectionId("machine", section.key),
          section.label,
          section.threadListState.threads,
          compareThreads,
          draftThreadIds,
          groupThreadsByEnvironment,
        ),
      ),
    [
      compareThreads,
      draftThreadIds,
      groupThreadsByEnvironment,
      machineSections,
    ],
  );
  const machineItemsBySectionId = useMemo(
    () =>
      new Map(
        machineGroups.map((group) => [group.group.key, group.group.items]),
      ),
    [machineGroups],
  );
  const groupRootItems = useMemo<ProjectThreadItem[]>(
    () => [...allThreadItems, ...machineGroups],
    [allThreadItems, machineGroups],
  );
  const threadDnd = useGroupedModeThreadDnd({
    collapsedThreadIds,
    compareThreads,
    draftThreadIds,
    onToggleThreadCollapsed,
    order,
    onOrderChange,
    pinned: {
      pinnedReorderPending,
      pinnedRootItems,
      pinnedRootNodes,
      pinnedThreads,
      onReorderPinnedThread,
    },
    rootItems: groupRootItems,
    threads: nonPinnedThreads,
  });
  const builtInSections: BuiltInSidebarSectionOptionsById = {
    pinned: pinnedSection,
    threads: {
      ...threadsSection,
      activity: getCollapsedChildActivity(nonPinnedThreads, draftThreadIds),
      collapsedThreads: nonPinnedThreads,
      content: (
        <ProjectThreadTree
          dndParentKey={CHRONOLOGICAL_CONTAINER_ID}
          rootItems={allThreadItems}
          threadListState={allThreadsListState}
          compareThreads={compareThreads}
          variant="section"
          selectedThreadId={selectedThreadId}
          collapsedThreadIds={collapsedThreadIds}
          collapsedEnvironmentIds={collapsedEnvironmentIds}
          onProjectSelect={onProjectSelect}
          onToggleThreadCollapsed={onToggleThreadCollapsed}
          onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
        />
      ),
    },
  };

  const visibilityGroups: ThreadListVisibilityGroup[] = [
    {
      id: "threads",
      title: "Threads",
      threads: nonPinnedThreads,
      onNewThread: onCreateThread,
      renderContent: (close: () => void) => (
        <ProjectThreadTree
          dndParentKey={CHRONOLOGICAL_CONTAINER_ID}
          rootItems={allThreadItems}
          threadListState={allThreadsListState}
          compareThreads={compareThreads}
          variant="section"
          selectedThreadId={selectedThreadId}
          collapsedThreadIds={collapsedThreadIds}
          collapsedEnvironmentIds={collapsedEnvironmentIds}
          onProjectSelect={() => {
            close();
            onProjectSelect?.();
          }}
          onToggleThreadCollapsed={onToggleThreadCollapsed}
          onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
        />
      ),
    },
    ...machineSections.map((section) => {
      const id = buildSidebarEntitySectionId("machine", section.key);
      const items = machineItemsBySectionId.get(id) ?? [];
      return {
        id,
        title: section.label,
        threads: getProjectThreadItemDescendants(items),
        renderContent: (close: () => void) => (
          <ProjectThreadTree
            rootItems={items}
            threadListState={section.threadListState}
            selectedThreadId={selectedThreadId}
            collapsedThreadIds={collapsedThreadIds}
            collapsedEnvironmentIds={collapsedEnvironmentIds}
            compareThreads={compareThreads}
            variant="section"
            onProjectSelect={() => {
              close();
              onProjectSelect?.();
            }}
            onToggleThreadCollapsed={onToggleThreadCollapsed}
            onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
          />
        ),
      };
    }),
  ];

  return (
    <ThreadListVisibility
      groups={visibilityGroups}
      order={persistedOrder}
      onOrderChange={onOrderChange}
      label="Machines"
      selectedThreadId={selectedThreadId}
    >
      <ReorderableSidebarSectionOrderList order={order} threadDnd={threadDnd}>
        {(sectionId, consumeClickSuppression) => {
          const builtInSection = renderBuiltInSidebarSection({
            sectionId,
            sections: builtInSections,
            disabled: reorderDisabled,
            collapsedSectionIds,
            onToggleCollapsed,
            consumeClickSuppression,
            showPinnedSection,
          });
          if (builtInSection !== undefined) {
            return sectionId === "threads" ? (
              <ThreadListVisibilityGroupScope key={sectionId} id={sectionId}>
                {builtInSection}
              </ThreadListVisibilityGroupScope>
            ) : (
              builtInSection
            );
          }
          const section = machineSectionsById.get(sectionId);
          if (!section) return null;
          return (
            <ThreadListVisibilityGroupScope key={sectionId} id={sectionId}>
              <MachineSidebarSection
                hostId={section.key}
                canRename={hostsById.has(section.key)}
                renderActions={renderSectionDisplayOptions}
                id={sectionId}
                label={section.label}
                disabled={reorderDisabled}
                actions={renderSectionDisplayOptions(sectionId, section.label)}
                actionsOpen={isSectionDisplayOptionsOpen(sectionId)}
                actionsMobileAlways
                collapsedActivity={section.activity}
                collapsedThreads={section.threadListState.threads}
                collapseControl={{
                  isCollapsed: collapsedMachineKeys.has(section.key),
                  onToggleCollapsed: () => toggleMachineCollapsed(section.key),
                }}
                consumeClickSuppression={consumeClickSuppression}
                dropParentKey={sectionId}
              >
                <ProjectThreadTree
                  dndParentKey={sectionId}
                  rootItems={machineItemsBySectionId.get(sectionId)}
                  threadListState={section.threadListState}
                  compareThreads={compareThreads}
                  variant="section"
                  selectedThreadId={selectedThreadId}
                  collapsedThreadIds={collapsedThreadIds}
                  collapsedEnvironmentIds={collapsedEnvironmentIds}
                  onProjectSelect={onProjectSelect}
                  onToggleThreadCollapsed={onToggleThreadCollapsed}
                  onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
                />
              </MachineSidebarSection>
            </ThreadListVisibilityGroupScope>
          );
        }}
      </ReorderableSidebarSectionOrderList>
      <ThreadListMore />
    </ThreadListVisibility>
  );
}

function toThreadListStatus(
  status: ReturnType<typeof useSidebarData>["status"],
): ThreadListStatus {
  return status === "error" ? "unavailable" : status;
}

function ProjectListComponent({
  activeThreadId,
  onProjectSelect,
}: ProjectListProps) {
  const sdk = useSdk();
  const sidebarActions = experimental_useSidebarThreadActions();
  const { status, sections, projects, personalProject, archived } =
    useSidebarData();
  const personalProjectId = personalProject?.id ?? null;
  const threads = useMemo<SidebarThread[]>(
    () => projects.flatMap((project) => project.threads),
    [projects],
  );
  const draftThreadIds = useSidebarThreadDraftIds();
  const preferencesReady = usePreferencesReady();
  const threadListStatus = toThreadListStatus(status);
  const selectedThreadId = activeThreadId ?? undefined;
  const [isPinnedReorderPending, setIsPinnedReorderPending] = useState(false);
  const [isCreateThreadSectionPending, setIsCreateThreadSectionPending] =
    useState(false);
  const [isDeleteThreadSectionPending, setIsDeleteThreadSectionPending] =
    useState(false);
  const handleReorderPinnedRoot = useCallback<
    NonNullable<PinnedThreadTreeProps["onReorderPinnedRoot"]>
  >(
    (request, callbacks) => {
      setIsPinnedReorderPending(true);
      void sdk.threads
        .reorderPinned({
          threadId: request.itemId,
          previousThreadId: request.previousItemId,
          nextThreadId: request.nextItemId,
        })
        .catch((error: unknown) => {
          toast.error(
            getMutationErrorMessage({
              error,
              fallbackMessage: "Failed to reorder pinned thread.",
            }),
          );
        })
        .finally(() => {
          setIsPinnedReorderPending(false);
          callbacks.onSettled();
        });
    },
    [sdk],
  );
  const openRootComposeForProject = useCallback(
    (projectId: string | null, sectionId?: string) => {
      onProjectSelect?.();
      sidebarActions.openNewThread({
        ...(projectId !== null ? { projectId } : {}),
        ...(sectionId ? { sectionId } : {}),
        focusPrompt: true,
      });
    },
    [onProjectSelect, sidebarActions],
  );
  const handleCreateProjectThread = useCallback(
    (projectId: string) => {
      openRootComposeForProject(projectId);
    },
    [openRootComposeForProject],
  );
  const handleCreateProjectlessThread = useCallback(() => {
    openRootComposeForProject(personalProjectId);
  }, [openRootComposeForProject, personalProjectId]);
  const handleCreateThreadInSection = useCallback(
    (sectionId: string) => {
      openRootComposeForProject(null, sectionId);
    },
    [openRootComposeForProject],
  );
  const [isSectionCreateDialogOpen, setIsSectionCreateDialogOpen] =
    useState(false);
  const [sectionCreateErrorMessage, setSectionCreateErrorMessage] = useState<
    string | null
  >(null);
  const [sectionCreateAnchorId, setSectionCreateAnchorId] =
    useState<SidebarSectionId | null>(null);
  const sectionDeleteDialog = useDialogState<SidebarSectionDefinition>();
  const setManualSectionOrder = useSetAtom(sidebarManualSectionOrderAtom);
  const handleOpenCreateSectionDialog = useCallback(
    (anchorSectionId?: SidebarSectionId) => {
      setSectionCreateErrorMessage(null);
      setSectionCreateAnchorId(anchorSectionId ?? null);
      setIsSectionCreateDialogOpen(true);
    },
    [],
  );
  const handleCreateSectionDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setSectionCreateErrorMessage(null);
      setIsSectionCreateDialogOpen(false);
    }
  }, []);
  const placeCreatedSectionNextToAnchor = useCallback(
    (createdSectionId: string) => {
      const anchorSectionId = sectionCreateAnchorId;
      if (!anchorSectionId) {
        return;
      }
      const sectionId = buildSidebarEntitySectionId(
        "section",
        createdSectionId,
      );
      setManualSectionOrder(
        (current) =>
          insertSidebarSectionAfter({
            storedOrder: current,
            entitySectionIds: sections.map((section) =>
              buildSidebarEntitySectionId("section", section.id),
            ),
            legacyEntityAnchor: "sections",
            anchorSectionId,
            sectionId,
          }) ?? current,
      );
    },
    [sectionCreateAnchorId, sections, setManualSectionOrder],
  );
  const handleCreateThreadSection = useCallback(
    (name: string) => {
      setSectionCreateErrorMessage(null);
      setIsCreateThreadSectionPending(true);
      void sdk.threadSections
        .create({ name })
        .then((section) => {
          placeCreatedSectionNextToAnchor(section.id);
          setIsSectionCreateDialogOpen(false);
        })
        .catch((error: unknown) =>
          setSectionCreateErrorMessage(
            getSectionMutationErrorMessage(error, "Failed to create section."),
          ),
        )
        .finally(() => setIsCreateThreadSectionPending(false));
    },
    [placeCreatedSectionNextToAnchor, sdk],
  );
  const handleRemoveThreadSection = useCallback(
    (section: SidebarSectionDefinition) => {
      sectionDeleteDialog.onOpen(section);
    },
    [sectionDeleteDialog],
  );
  const handleConfirmRemoveThreadSection = useCallback(() => {
    const section = sectionDeleteDialog.target;
    if (!section) {
      return;
    }
    setIsDeleteThreadSectionPending(true);
    void sdk.threadSections
      .delete({ id: section.id })
      .then(() => sectionDeleteDialog.onClose())
      .catch((error: unknown) => {
        toast.error(
          getSectionMutationErrorMessage(error, "Failed to remove section."),
        );
      })
      .finally(() => setIsDeleteThreadSectionPending(false));
  }, [sdk, sectionDeleteDialog]);
  const handleSectionDeleteDialogOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        return;
      }
      sectionDeleteDialog.onClose();
    },
    [sectionDeleteDialog],
  );
  const [collapsedThreadIdList, setCollapsedThreadIdList] = useAtom(
    collapsedThreadIdsAtom,
  );
  const [collapsedEnvironmentIdList, setCollapsedEnvironmentIdList] = useAtom(
    collapsedEnvironmentIdsAtom,
  );
  const [collapsedSidebarSectionIdList, setCollapsedSidebarSectionIdList] =
    useAtom(collapsedSidebarSectionIdsAtom);
  const [openSidebarMenu, setOpenSidebarMenu] = useState<OpenSidebarMenu>(null);
  const setSidebarMenuOpen = useCallback(
    (menu: Exclude<OpenSidebarMenu, null>, open: boolean) => {
      setOpenSidebarMenu((current) =>
        open ? menu : current === menu ? null : current,
      );
    },
    [],
  );
  const renderSectionDisplayOptions = (
    sectionId: SidebarSectionId,
    label: string,
    renameActions?: {
      onRename: () => void;
      onCloseAutoFocus: (event: Event) => void;
    },
  ) => {
    const menuId = `displayOptions:${sectionId}` as const;
    return (
      <SidebarHeaderControls
        label={label}
        sectionId={sectionId}
        onNewThread={handleCreateProjectlessThread}
        open={openSidebarMenu === menuId}
        onOpenChange={(open) => setSidebarMenuOpen(menuId, open)}
        onCloseAutoFocus={renameActions?.onCloseAutoFocus}
      >
        {renameActions ? (
          <SidebarSectionMenuItems onRename={renameActions.onRename} />
        ) : (
          <ThreadListVisibilityMenuItems leadingSeparator={false} />
        )}
      </SidebarHeaderControls>
    );
  };
  const isSectionDisplayOptionsOpen = (sectionId: SidebarSectionId) =>
    openSidebarMenu === `displayOptions:${sectionId}`;
  const organizationMode = useAtomValue(sidebarOrganizationModeAtom);
  const groupThreadsByEnvironment = useAtomValue(
    sidebarGroupThreadsByEnvironmentAtom,
  );
  const [chronologicalSort, setChronologicalSort] = useAtom(
    sidebarChronologicalSortAtom,
  );
  const sortDirection = useAtomValue(sidebarSortDirectionAtom);
  const activeRename = useSidebarRenameState();
  const sidebarThreadComparator = useMemo<ThreadComparator>(
    () =>
      getSidebarThreadComparator(
        chronologicalSort,
        sortDirection,
        activeRename,
      ),
    [chronologicalSort, sortDirection, activeRename],
  );
  const collapsedThreadIds = useMemo(
    () => new Set(collapsedThreadIdList),
    [collapsedThreadIdList],
  );
  const collapsedEnvironmentIds = useMemo(
    () => new Set(collapsedEnvironmentIdList),
    [collapsedEnvironmentIdList],
  );
  const normalizedCollapsedSidebarSectionIds = useMemo(
    () => normalizeCollapsedSidebarSectionIds(collapsedSidebarSectionIdList),
    [collapsedSidebarSectionIdList],
  );
  const collapsedSidebarSectionIds = useMemo(
    () => new Set(normalizedCollapsedSidebarSectionIds),
    [normalizedCollapsedSidebarSectionIds],
  );
  useEffect(() => {
    if (
      haveSameOrder(
        collapsedSidebarSectionIdList,
        normalizedCollapsedSidebarSectionIds,
      )
    ) {
      return;
    }
    setCollapsedSidebarSectionIdList(normalizedCollapsedSidebarSectionIds);
  }, [
    collapsedSidebarSectionIdList,
    normalizedCollapsedSidebarSectionIds,
    setCollapsedSidebarSectionIdList,
  ]);
  useEffect(() => {
    if (chronologicalSort === "none") {
      setChronologicalSort("updated");
    }
  }, [chronologicalSort, setChronologicalSort]);
  const pinnedSidebarState = useMemo(
    () =>
      buildPinnedSidebarState({
        draftThreadIds,
        groupEnvironmentThreads: groupThreadsByEnvironment,
        threads,
      }),
    [draftThreadIds, groupThreadsByEnvironment, threads],
  );
  const pinnedRootThreads = useMemo(
    () => pinnedSidebarState.rootNodes.map((node) => node.thread),
    [pinnedSidebarState.rootNodes],
  );
  const hasPinnedSection = pinnedSidebarState.rootNodes.length > 0;
  const toggleThreadCollapsed = useCallback<ToggleCollapsedId>(
    (threadId) => {
      setCollapsedThreadIdList((current) => {
        return toggleCollapsedIdList({ current, id: threadId });
      });
    },
    [setCollapsedThreadIdList],
  );

  const toggleEnvironmentCollapsed = useCallback<ToggleCollapsedId>(
    (environmentId) => {
      setCollapsedEnvironmentIdList((current) => {
        return toggleCollapsedIdList({ current, id: environmentId });
      });
    },
    [setCollapsedEnvironmentIdList],
  );

  const toggleSidebarSectionCollapsed =
    useCallback<ToggleCollapsedSidebarSectionId>(
      (sectionId) => {
        setCollapsedSidebarSectionIdList((current) => {
          return toggleCollapsedIdList({ current, id: sectionId }).filter(
            isCollapsibleSidebarSectionId,
          );
        });
      },
      [setCollapsedSidebarSectionIdList],
    );

  const pinnedSectionContent = (
    <PinnedThreadTree
      rootItems={pinnedSidebarState.rootItems}
      rootNodes={pinnedSidebarState.rootNodes}
      selectedThreadId={selectedThreadId}
      collapsedThreadIds={collapsedThreadIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      onProjectSelect={onProjectSelect}
      onToggleThreadCollapsed={toggleThreadCollapsed}
      onToggleEnvironmentCollapsed={toggleEnvironmentCollapsed}
      isPinnedReorderPending={isPinnedReorderPending}
      onReorderPinnedRoot={handleReorderPinnedRoot}
    />
  );
  const pinnedSectionThreads = threads.filter(
    (thread) =>
      pinnedSidebarState.effectivePinnedThreadIds.has(thread.id) &&
      isSidebarProjectThread(thread),
  );
  const pinnedSection: BuiltInSidebarSectionOptions = {
    activity: getCollapsedChildActivity(pinnedSectionThreads, draftThreadIds),
    collapsedThreads: pinnedSectionThreads,
    label: "Pinned",
    content: pinnedSectionContent,
    actions: renderSectionDisplayOptions("pinned", "Pinned"),
    actionsOpen: isSectionDisplayOptionsOpen("pinned"),
  };
  const threadsSection = {
    label: "Threads",
    actions: renderSectionDisplayOptions("threads", "Threads"),
    actionsOpen: isSectionDisplayOptionsOpen("threads"),
  } satisfies Omit<BuiltInSidebarSectionOptions, "content">;
  const sectionCreateDialog = (
    <ThreadSectionCreateDialog
      errorMessage={sectionCreateErrorMessage}
      open={isSectionCreateDialogOpen}
      pending={isCreateThreadSectionPending}
      onOpenChange={handleCreateSectionDialogOpenChange}
      onCreate={handleCreateThreadSection}
    />
  );
  const sectionDeleteDialogContent = (
    <ConfirmDeleteDialog
      open={sectionDeleteDialog.target !== null}
      onOpenChange={handleSectionDeleteDialogOpenChange}
    >
      {sectionDeleteDialog.target ? (
        <ConfirmDeleteDialogContent
          title="Remove section?"
          description="Threads in this section will move back to Threads."
          confirmLabel="Remove section"
          pending={isDeleteThreadSectionPending}
          onConfirm={handleConfirmRemoveThreadSection}
          onCancel={sectionDeleteDialog.onClose}
        />
      ) : null}
    </ConfirmDeleteDialog>
  );

  if (threadListStatus === "loading" || !preferencesReady) {
    return (
      <ProjectListShell>
        <ProjectListNavigationLoadingState />
      </ProjectListShell>
    );
  }

  return (
    <SidebarHeaderActionsProvider
      value={{
        onNewSection: handleOpenCreateSectionDialog,
        isCreatingSection: isCreateThreadSectionPending,
      }}
    >
      <ProjectListSectionMoveScope sections={sections}>
        <ActiveSidebarModeSections
          mode={organizationMode}
          renderMachine={() => (
            <MachineModeSections
              threads={threads}
              draftThreadIds={draftThreadIds}
              effectivePinnedThreadIds={
                pinnedSidebarState.effectivePinnedThreadIds
              }
              status={threadListStatus}
              showPinnedSection={hasPinnedSection}
              pinnedSection={pinnedSection}
              pinnedReorderPending={isPinnedReorderPending}
              pinnedRootItems={pinnedSidebarState.rootItems}
              pinnedRootNodes={pinnedSidebarState.rootNodes}
              pinnedThreads={pinnedRootThreads}
              onReorderPinnedThread={handleReorderPinnedRoot}
              threadsSection={threadsSection}
              selectedThreadId={selectedThreadId}
              collapsedSectionIds={collapsedSidebarSectionIds}
              collapsedThreadIds={collapsedThreadIds}
              collapsedEnvironmentIds={collapsedEnvironmentIds}
              compareThreads={sidebarThreadComparator}
              renderSectionDisplayOptions={renderSectionDisplayOptions}
              isSectionDisplayOptionsOpen={isSectionDisplayOptionsOpen}
              onCreateThread={handleCreateProjectlessThread}
              onProjectSelect={onProjectSelect}
              onToggleCollapsed={toggleSidebarSectionCollapsed}
              onToggleThreadCollapsed={toggleThreadCollapsed}
              onToggleEnvironmentCollapsed={toggleEnvironmentCollapsed}
            />
          )}
          renderChronological={() => (
            <SectionModeSections
              threads={threads}
              effectivePinnedThreadIds={
                pinnedSidebarState.effectivePinnedThreadIds
              }
              status={threadListStatus}
              showPinnedSection={hasPinnedSection}
              sections={sections}
              pinnedSection={pinnedSection}
              pinnedReorderPending={isPinnedReorderPending}
              pinnedRootItems={pinnedSidebarState.rootItems}
              pinnedRootNodes={pinnedSidebarState.rootNodes}
              pinnedThreads={pinnedRootThreads}
              onReorderPinnedThread={handleReorderPinnedRoot}
              threadsSection={threadsSection}
              selectedThreadId={selectedThreadId}
              collapsedSectionIds={collapsedSidebarSectionIds}
              collapsedThreadIds={collapsedThreadIds}
              collapsedEnvironmentIds={collapsedEnvironmentIds}
              compareThreads={sidebarThreadComparator}
              onProjectSelect={onProjectSelect}
              onCreateThread={handleCreateProjectlessThread}
              onCreateThreadInSection={handleCreateThreadInSection}
              onRemoveSection={handleRemoveThreadSection}
              onToggleCollapsed={toggleSidebarSectionCollapsed}
              onToggleThreadCollapsed={toggleThreadCollapsed}
              onToggleEnvironmentCollapsed={toggleEnvironmentCollapsed}
            />
          )}
          renderProject={() => (
            <ProjectModeSections
              personalProjectId={personalProjectId}
              projects={projects}
              threads={threads}
              draftThreadIds={draftThreadIds}
              effectivePinnedThreadIds={
                pinnedSidebarState.effectivePinnedThreadIds
              }
              status={threadListStatus}
              showPinnedSection={hasPinnedSection}
              pinnedSection={pinnedSection}
              pinnedReorderPending={isPinnedReorderPending}
              pinnedRootItems={pinnedSidebarState.rootItems}
              pinnedRootNodes={pinnedSidebarState.rootNodes}
              pinnedThreads={pinnedRootThreads}
              onReorderPinnedThread={handleReorderPinnedRoot}
              threadsSection={threadsSection}
              selectedThreadId={selectedThreadId}
              collapsedSectionIds={collapsedSidebarSectionIds}
              collapsedThreadIds={collapsedThreadIds}
              collapsedEnvironmentIds={collapsedEnvironmentIds}
              compareThreads={sidebarThreadComparator}
              onProjectSelect={onProjectSelect}
              onCreateProjectThread={handleCreateProjectThread}
              onToggleCollapsed={toggleSidebarSectionCollapsed}
              onToggleThreadCollapsed={toggleThreadCollapsed}
              onToggleEnvironmentCollapsed={toggleEnvironmentCollapsed}
            />
          )}
        />
        {archived !== null && (
          <>
            {status === "ready" && archived.status !== "ready" && (
              <div role="status">
                {archived.status === "error"
                  ? "Archived threads unavailable"
                  : "Loading archived threads…"}
              </div>
            )}
            {archived.hasNextPage && (
              <Button
                variant="ghost"
                size="sm"
                disabled={archived.isFetchingNextPage}
                onClick={() => void archived.fetchNextPage()}
                aria-label="Load more archived threads"
              >
                {archived.isFetchingNextPage
                  ? "Loading…"
                  : archived.isFetchNextPageError
                    ? "Retry loading"
                    : "Show more"}
              </Button>
            )}
          </>
        )}
      </ProjectListSectionMoveScope>
      {sectionCreateDialog}
      {sectionDeleteDialogContent}
    </SidebarHeaderActionsProvider>
  );
}

export const ProjectList = memo(function ProjectList(props: ProjectListProps) {
  return (
    <SidebarRenameProvider>
      <ProjectListComponent {...props} />
    </SidebarRenameProvider>
  );
});
