import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  type CSSProperties,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { ProjectResponse } from "@bb/server-contract";
import {
  findLocalPathProjectSourceForHost,
  PERSONAL_PROJECT_ID,
  type ThreadListEntry,
} from "@bb/domain";
import { useRouteState } from "@/hooks/useRouteState";
import {
  useConnectionAwareQueryState,
  type ConnectionAwareQueryStatus,
} from "@/hooks/queries/connection-aware-query-state";
import {
  stripProjectThreads,
  useSidebarNavigation,
} from "@/hooks/queries/project-queries";
import { useReorderProject } from "@/hooks/mutations/project-mutations";
import { useReorderPinnedThread } from "@/hooks/mutations/thread-state-mutations";
import {
  isLocalPathMissing,
  useLocalPathExistence,
} from "@/hooks/queries/host-path-queries";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import {
  applyNeighborReorder,
  buildNeighborReorderRequest,
} from "@/lib/neighbor-reorder";
import {
  useSetRootComposeProjectId,
} from "@/lib/root-compose-selection";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button.js";
import { CHROME_SECTION_LABEL_CLASS } from "@/components/ui/chromeStyleTokens";
import { Icon, type IconName } from "@/components/ui/icon.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import {
  SidebarGroupContent,
  SidebarStickyGroup,
  SidebarStickyStack,
  SidebarStickyTier,
} from "@/components/ui/sidebar.js";
import {
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
  COARSE_POINTER_ROW_HEIGHT_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import { ProjectThreadTree } from "./ProjectRow";
import type { ProjectThreadListState } from "./ProjectRow";
import {
  ProjectListProjects,
  type ProjectListReorderBindings,
  type ProjectListRowModel,
} from "./ProjectListProjects";
import {
  PinnedThreadTree,
  type PinnedThreadTreeProps,
} from "./PinnedThreadTree";
import { buildPinnedSidebarState } from "./pinnedSidebarThreads";
import {
  collapsedEnvironmentIdsAtom,
  collapsedThreadIdsAtom,
  collapsedProjectIdsAtom,
  collapsedSidebarSectionIdsAtom,
  DEFAULT_SIDEBAR_SECTION_ORDER,
  sidebarSectionOrderAtom,
  type CollapsibleSidebarSectionId,
  type SidebarSectionId,
} from "./sidebarCollapsedAtoms";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions.js";
import {
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  SIDEBAR_STANDARD_ROW_PADDING_CLASS,
} from "./sidebarRowClasses";
import {
  useSidebarSortable,
  type SidebarSortableDragBindings,
} from "./sortableMotion";
import { useSidebarReorderDnd } from "./useSidebarReorderDnd";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import {
  useNeighborReorderSortable,
  type UseNeighborReorderSortableArgs,
} from "./useNeighborReorderSortable";

interface ProjectListProps {
  onNewProject?: () => void;
  onProjectSelect?: () => void;
  isCreatingProject?: boolean;
}

export interface ProjectListActionButtonsProps {
  onNewChat?: () => void;
  onOpenAutomations?: () => void;
}

interface ProjectListShellProps {
  children: ReactNode;
}

interface ProjectListSectionIconButtonProps {
  ariaLabel: string;
  disabled?: boolean;
  iconName: IconName;
  onClick: () => void;
  title: string;
}

interface ProjectListProjectsSectionActionsProps {
  isCreatingProject: boolean;
  onNewProject: () => void;
}

interface ProjectListThreadsSectionActionsProps {
  onNewThread: () => void;
}

interface ProjectListNavigationLoadingRowProps {
  textWidthClassName: string;
}

interface LocalSourcePathTarget {
  path: string;
  projectId: string;
}

const PROJECT_LIST_ACTION_BUTTON_CLASS = cn(
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_STANDARD_ROW_PADDING_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  COARSE_POINTER_ROW_HEIGHT_CLASS,
  "min-w-0 justify-start overflow-hidden font-normal ring-sidebar-ring focus-visible:ring-2 disabled:opacity-70 max-md:pointer-coarse:[&_svg]:size-5",
);

const PROJECT_LIST_ACTION_TRAILING_SLOT_CLASS = cn(
  "inline-flex shrink-0 items-center justify-center",
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
);

const PROJECT_LIST_SECTION_ACTION_BUTTON_CLASS = cn(
  "inline-flex items-center justify-center rounded-md text-muted-foreground outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 disabled:opacity-50",
  "h-6 w-7",
);

interface ProjectThreadListStateArgs {
  status: ConnectionAwareQueryStatus | undefined;
  threads: ThreadListEntry[] | undefined;
}

interface ToggleCollapsedIdListArgs {
  current: string[];
  id: string;
}

type ToggleCollapsedId = (id: string) => void;
type ToggleCollapsedSidebarSectionId = (
  id: CollapsibleSidebarSectionId,
) => void;

interface TopLevelSidebarSectionProps {
  label: string;
  children: ReactNode;
  actions?: ReactNode;
  actionsAlwaysVisible?: boolean;
  collapseControl?: TopLevelSidebarSectionCollapseControl;
  dragBindings?: SidebarSortableDragBindings;
  sectionRef?: (element: HTMLDivElement | null) => void;
  sectionStyle?: CSSProperties;
  consumeClickSuppression?: ConsumeDragClickSuppression;
}

interface SortableSidebarSectionProps extends TopLevelSidebarSectionProps {
  id: SidebarSectionId;
  disabled: boolean;
}

interface TopLevelSidebarSectionCollapseControl {
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
}

function hasSameStringList(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((sectionId, index) => sectionId === right[index]);
}

function isSidebarSectionId(value: string): value is SidebarSectionId {
  return (
    value === "pinned" ||
    value === "projects" ||
    value === "threads"
  );
}

function isCollapsibleSidebarSectionId(
  value: string,
): value is CollapsibleSidebarSectionId {
  return value === "projects" || value === "threads";
}

function normalizeSidebarSectionOrder(
  order: readonly SidebarSectionId[],
): SidebarSectionId[] {
  const seen = new Set<SidebarSectionId>();
  const normalized: SidebarSectionId[] = [];
  for (const sectionId of order) {
    if (!isSidebarSectionId(sectionId) || seen.has(sectionId)) {
      continue;
    }
    seen.add(sectionId);
    normalized.push(sectionId);
  }
  if (!seen.has("pinned")) {
    seen.add("pinned");
    normalized.unshift("pinned");
  }
  for (const sectionId of DEFAULT_SIDEBAR_SECTION_ORDER) {
    if (seen.has(sectionId)) {
      continue;
    }
    normalized.push(sectionId);
  }
  return normalized;
}

const EMPTY_PROJECT_THREAD_LIST_STATE: ProjectThreadListState = {
  status: "loading",
};

const EMPTY_PROJECTS: readonly ProjectResponse[] = [];

function getProjectId(project: ProjectResponse): string {
  return project.id;
}

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
    case undefined:
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

function ProjectListSectionIconButton({
  ariaLabel,
  disabled = false,
  iconName,
  onClick,
  title,
}: ProjectListSectionIconButtonProps) {
  const handleClick = useCallback<MouseEventHandler<HTMLButtonElement>>(
    (event) => {
      event.stopPropagation();
      onClick();
    },
    [onClick],
  );

  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      className={PROJECT_LIST_SECTION_ACTION_BUTTON_CLASS}
      onClick={handleClick}
    >
      <Icon name={iconName} className={COARSE_POINTER_ICON_SIZE_CLASS} />
    </button>
  );
}

function ProjectListProjectsSectionActions({
  isCreatingProject,
  onNewProject,
}: ProjectListProjectsSectionActionsProps) {
  return (
    <ProjectListSectionIconButton
      ariaLabel="New project"
      title="New project"
      disabled={isCreatingProject}
      iconName="FolderPlus"
      onClick={onNewProject}
    />
  );
}

function ProjectListThreadsSectionActions({
  onNewThread,
}: ProjectListThreadsSectionActionsProps) {
  return (
    <ProjectListSectionIconButton
      ariaLabel="New thread"
      title="New thread"
      iconName="MessageSquarePlus"
      onClick={onNewThread}
    />
  );
}

export function ProjectListNavigationLoadingState() {
  return (
    <div
      aria-label="Loading sidebar navigation"
      className="space-y-1.5 px-2 pt-1 group-data-[collapsible=icon]:hidden"
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

function TopLevelSidebarSection({
  label,
  children,
  actions,
  actionsAlwaysVisible = false,
  collapseControl,
  dragBindings,
  sectionRef,
  sectionStyle,
  consumeClickSuppression,
}: TopLevelSidebarSectionProps) {
  const handleClickCapture = useCallback<MouseEventHandler<HTMLDivElement>>(
    (event) => {
      if (!consumeClickSuppression?.()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [consumeClickSuppression],
  );
  const handleCollapseControlClick = useCallback<
    MouseEventHandler<HTMLButtonElement>
  >(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      collapseControl?.onToggleCollapsed();
    },
    [collapseControl],
  );
  const stopCollapseControlPointerDown = useCallback<
    PointerEventHandler<HTMLButtonElement>
  >((event) => {
    event.stopPropagation();
  }, []);
  const stopCollapseControlKeyDown = useCallback<
    KeyboardEventHandler<HTMLButtonElement>
  >((event) => {
    event.stopPropagation();
  }, []);

  return (
    <SidebarStickyGroup
      ref={sectionRef}
      style={sectionStyle}
      className="group/sidebar-section min-w-0"
      onClickCapture={handleClickCapture}
    >
      <SidebarStickyTier
        ref={dragBindings?.setActivatorNodeRef}
        tier="label"
        className={cn(
          SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
          CHROME_SECTION_LABEL_CLASS,
          "rounded-md pr-1 transition-colors",
          dragBindings &&
            !dragBindings.disabled &&
            "select-none cursor-grab active:cursor-grabbing",
        )}
        title={label}
        {...dragBindings?.attributes}
        {...(dragBindings?.listeners ?? {})}
      >
        <span
          className={cn(
            "relative z-10 flex min-w-0 flex-1 items-center gap-1 text-left",
            actions && "pr-14",
          )}
        >
          <span className="min-w-0 truncate">{label}</span>
          {collapseControl ? (
            <button
              type="button"
              aria-expanded={!collapseControl.isCollapsed}
              aria-label={
                collapseControl.isCollapsed
                  ? `Expand ${label} section`
                  : `Collapse ${label} section`
              }
              title={
                collapseControl.isCollapsed
                  ? `Expand ${label}`
                  : `Collapse ${label}`
              }
              className={cn(
                SIDEBAR_HOVER_ACTIONS_CLASS,
                "relative z-20 inline-flex size-5 shrink-0 items-center justify-center rounded-md text-subtle-foreground outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2",
              )}
              onClick={handleCollapseControlClick}
              onPointerDown={stopCollapseControlPointerDown}
              onKeyDown={stopCollapseControlKeyDown}
            >
              <Icon
                name="ChevronRight"
                className={cn(
                  "size-3 transition-transform duration-150",
                  !collapseControl.isCollapsed && "rotate-90",
                )}
                aria-hidden="true"
              />
            </button>
          ) : null}
        </span>
        {actions ? (
          <span className="absolute right-0 top-1/2 z-20 inline-flex -translate-y-1/2 items-center">
            <span
              className={cn(
                "inline-flex shrink-0 items-center",
                !actionsAlwaysVisible && SIDEBAR_HOVER_ACTIONS_CLASS,
              )}
            >
              {actions}
            </span>
          </span>
        ) : null}
      </SidebarStickyTier>
      {collapseControl?.isCollapsed ? null : (
        <div className="mt-1">{children}</div>
      )}
    </SidebarStickyGroup>
  );
}

const SortableSidebarSection = memo(function SortableSidebarSection({
  id,
  disabled,
  ...props
}: SortableSidebarSectionProps) {
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id,
    disabled,
  });

  return (
    <TopLevelSidebarSection
      {...props}
      dragBindings={dragBindings}
      sectionRef={setNodeRef}
      sectionStyle={style}
    />
  );
});

export function ProjectListActionButtons({
  onNewChat,
  onOpenAutomations,
}: ProjectListActionButtonsProps) {
  const isNewChatDisabled = !onNewChat;
  const newChatTitle = isNewChatDisabled ? "Start a new thread" : "New thread";

  return (
    <div className="space-y-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={PROJECT_LIST_ACTION_BUTTON_CLASS}
        onClick={onNewChat}
        disabled={isNewChatDisabled}
        title={newChatTitle}
      >
        <Icon name="MessageSquarePlus" />
        <span className="min-w-0 flex-1 truncate text-left">New thread</span>
        <span
          className={PROJECT_LIST_ACTION_TRAILING_SLOT_CLASS}
          aria-hidden="true"
        />
      </Button>
      {onOpenAutomations ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={PROJECT_LIST_ACTION_BUTTON_CLASS}
          onClick={onOpenAutomations}
          title="Automations"
        >
          <Icon name="Clock" />
          <span className="min-w-0 flex-1 truncate text-left">Automations</span>
          <span
            className={PROJECT_LIST_ACTION_TRAILING_SLOT_CLASS}
            aria-hidden="true"
          />
        </Button>
      ) : null}
    </div>
  );
}

export function ProjectListShell({ children }: ProjectListShellProps) {
  return (
    <SidebarStickyStack data-sidebar-sticky-density="compact-actions">
      <SidebarGroupContent>{children}</SidebarGroupContent>
    </SidebarStickyStack>
  );
}

function ProjectListComponent({
  onNewProject,
  onProjectSelect,
  isCreatingProject = false,
}: ProjectListProps) {
  const navigate = useNavigate();
  const setRootComposeProjectId = useSetRootComposeProjectId();
  const sidebarNavigationQuery = useSidebarNavigation();
  const sidebarNavigation = sidebarNavigationQuery.data;
  const projects = useMemo(
    () => sidebarNavigation?.projects.map(stripProjectThreads),
    [sidebarNavigation],
  );
  const threads = useMemo(() => {
    if (!sidebarNavigation) {
      return [];
    }
    const sidebarThreads: ThreadListEntry[] = [];
    for (const project of sidebarNavigation.projects) {
      sidebarThreads.push(...project.threads);
    }
    sidebarThreads.push(...sidebarNavigation.personalProject.threads);
    return sidebarThreads;
  }, [sidebarNavigation]);
  const projectsState = useConnectionAwareQueryState({
    hasResolvedData: projects !== undefined,
    isFetching: sidebarNavigationQuery.isFetching,
    isLoadingError: sidebarNavigationQuery.isLoadingError,
  });
  const { localDaemonHostId } = useHostDaemon();
  const { threadId: selectedThreadId } = useRouteState();

  const localSourceTargets = useMemo(() => {
    if (!localDaemonHostId || !projects) return [];
    const targets: LocalSourcePathTarget[] = [];
    for (const project of projects) {
      const source = findLocalPathProjectSourceForHost(
        project.sources,
        localDaemonHostId,
      );
      if (source) {
        targets.push({
          path: source.path,
          projectId: project.id,
        });
      }
    }
    return targets;
  }, [localDaemonHostId, projects]);

  const localSourcePathsByProjectId = useMemo(() => {
    const pathsByProjectId = new Map<string, string>();
    for (const target of localSourceTargets) {
      pathsByProjectId.set(target.projectId, target.path);
    }
    return pathsByProjectId;
  }, [localSourceTargets]);

  const localPaths = useMemo(() => {
    if (!localDaemonHostId) return [];
    return localSourceTargets.map((target) => target.path);
  }, [localDaemonHostId, localSourceTargets]);
  const pathExistence = useLocalPathExistence(localPaths);
  const { isPending: isProjectReorderPending, mutate: reorderProjectMutate } =
    useReorderProject();
  const {
    isPending: isPinnedReorderPending,
    mutate: reorderPinnedThreadMutate,
  } = useReorderPinnedThread();
  const projectItems = projects ?? EMPTY_PROJECTS;
  const handleReorderProject = useCallback<
    UseNeighborReorderSortableArgs<ProjectResponse>["onReorder"]
  >(
    (request, callbacks) => {
      reorderProjectMutate(
        {
          projectId: request.itemId,
          previousProjectId: request.previousItemId,
          nextProjectId: request.nextItemId,
        },
        {
          onSettled: callbacks.onSettled,
        },
      );
    },
    [reorderProjectMutate],
  );
  const projectReorderDisabled =
    isProjectReorderPending || projectItems.length < 2;
  const {
    handleDragEnd: handleSortableProjectDragEnd,
    itemIds: renderedProjectIds,
    renderedItems: renderedProjects,
  } = useNeighborReorderSortable({
    disabled: projectReorderDisabled,
    getId: getProjectId,
    items: projectItems,
    onReorder: handleReorderProject,
  });
  const {
    dndContextProps: projectDndContextProps,
    consumeClickSuppression: consumeProjectClickSuppression,
  } = useSidebarReorderDnd({ onDragEnd: handleSortableProjectDragEnd });
  const handleReorderPinnedRoot = useCallback<
    NonNullable<PinnedThreadTreeProps["onReorderPinnedRoot"]>
  >(
    (request, callbacks) => {
      reorderPinnedThreadMutate(
        {
          id: request.itemId,
          previousThreadId: request.previousItemId,
          nextThreadId: request.nextItemId,
        },
        {
          onSettled: callbacks.onSettled,
        },
      );
    },
    [reorderPinnedThreadMutate],
  );
  const openRootComposeForProject = useCallback(
    (projectId: string) => {
      setRootComposeProjectId(projectId);
      onProjectSelect?.();
      navigate(getRootComposeRoutePath(), {
        state: { focusPrompt: true },
      });
    },
    [navigate, onProjectSelect, setRootComposeProjectId],
  );
  const handleCreateProjectThread = useCallback(
    (projectId: string) => {
      openRootComposeForProject(projectId);
    },
    [openRootComposeForProject],
  );
  const handleCreateProjectlessThread = useCallback(() => {
    openRootComposeForProject(PERSONAL_PROJECT_ID);
  }, [openRootComposeForProject]);
  const [collapsedProjectIdList, setCollapsedProjectIdList] = useAtom(
    collapsedProjectIdsAtom,
  );
  const [collapsedThreadIdList, setCollapsedThreadIdList] = useAtom(
    collapsedThreadIdsAtom,
  );
  const [collapsedEnvironmentIdList, setCollapsedEnvironmentIdList] = useAtom(
    collapsedEnvironmentIdsAtom,
  );
  const [collapsedSidebarSectionIdList, setCollapsedSidebarSectionIdList] =
    useAtom(collapsedSidebarSectionIdsAtom);
  const [sidebarSectionOrderList, setSidebarSectionOrderList] = useAtom(
    sidebarSectionOrderAtom,
  );
  const collapsedProjectIds = useMemo(
    () => new Set(collapsedProjectIdList),
    [collapsedProjectIdList],
  );
  const collapsedThreadIds = useMemo(
    () => new Set(collapsedThreadIdList),
    [collapsedThreadIdList],
  );
  const collapsedEnvironmentIds = useMemo(
    () => new Set(collapsedEnvironmentIdList),
    [collapsedEnvironmentIdList],
  );
  const sidebarSectionOrder = useMemo(
    () => normalizeSidebarSectionOrder(sidebarSectionOrderList),
    [sidebarSectionOrderList],
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
    if (hasSameStringList(sidebarSectionOrderList, sidebarSectionOrder)) {
      return;
    }
    setSidebarSectionOrderList(sidebarSectionOrder);
  }, [
    setSidebarSectionOrderList,
    sidebarSectionOrder,
    sidebarSectionOrderList,
  ]);
  useEffect(() => {
    if (
      hasSameStringList(
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
  const pinnedSidebarState = useMemo(
    () => buildPinnedSidebarState({ threads }),
    [threads],
  );
  const hasPinnedSection = pinnedSidebarState.rootNodes.length > 0;
  const visibleSidebarSectionOrder = useMemo(
    () =>
      sidebarSectionOrder.filter((sectionId) => {
        if (sectionId === "pinned") return hasPinnedSection;
        return true;
      }),
    [hasPinnedSection, sidebarSectionOrder],
  );
  const threadsByProject = useMemo(() => {
    const grouped = new Map<string, ThreadListEntry[]>();

    for (const thread of threads) {
      if (pinnedSidebarState.effectivePinnedThreadIds.has(thread.id)) {
        continue;
      }
      const existing = grouped.get(thread.projectId);
      if (existing) {
        existing.push(thread);
      } else {
        grouped.set(thread.projectId, [thread]);
      }
    }

    return grouped;
  }, [pinnedSidebarState.effectivePinnedThreadIds, threads]);

  // Pre-build per-project list state once per inputs so each ProjectRow can
  // bail out of memo when none of its data changed.
  const threadListStatesByProjectId = useMemo(() => {
    const map = new Map<string, ProjectThreadListState>();
    for (const project of renderedProjects) {
      const projectThreads = threadsByProject.get(project.id);
      map.set(
        project.id,
        getProjectThreadListState({
          status: projectsState.status,
          threads: projectThreads,
        }),
      );
    }
    return map;
  }, [projectsState.status, renderedProjects, threadsByProject]);

  const projectRows = useMemo<ProjectListRowModel[]>(
    () =>
      renderedProjects.map((project) => ({
        project,
        threadListState:
          threadListStatesByProjectId.get(project.id) ??
          EMPTY_PROJECT_THREAD_LIST_STATE,
        isActive: false,
        isLocalPathInvalid: isLocalPathMissing(
          pathExistence,
          localSourcePathsByProjectId.get(project.id),
        ),
      })),
    [
      localSourcePathsByProjectId,
      pathExistence,
      renderedProjects,
      threadListStatesByProjectId,
    ],
  );

  const projectReorder = useMemo<ProjectListReorderBindings>(
    () => ({
      dndContextProps: projectDndContextProps,
      itemIds: renderedProjectIds,
      disabled: projectReorderDisabled,
      consumeClickSuppression: consumeProjectClickSuppression,
    }),
    [
      consumeProjectClickSuppression,
      projectDndContextProps,
      projectReorderDisabled,
      renderedProjectIds,
    ],
  );

  const toggleProjectCollapsed = useCallback<ToggleCollapsedId>(
    (projectId) => {
      setCollapsedProjectIdList((current) => {
        return toggleCollapsedIdList({ current, id: projectId });
      });
    },
    [setCollapsedProjectIdList],
  );

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

  const handleReorderSidebarSection = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (
        !over ||
        typeof active.id !== "string" ||
        typeof over.id !== "string" ||
        !isSidebarSectionId(active.id) ||
        !isSidebarSectionId(over.id)
      ) {
        return;
      }
      const request = buildNeighborReorderRequest({
        activeId: active.id,
        overId: over.id,
        items: visibleSidebarSectionOrder.map((id) => ({ id })),
      });
      if (!request) {
        return;
      }
      const nextOrder = applyNeighborReorder({
        items: visibleSidebarSectionOrder.map((id) => ({ id })),
        request,
      });
      setSidebarSectionOrderList(
        nextOrder.map((item) => item.id).filter(isSidebarSectionId),
      );
    },
    [setSidebarSectionOrderList, visibleSidebarSectionOrder],
  );
  const {
    dndContextProps: sidebarSectionDndContextProps,
    consumeClickSuppression: consumeSidebarSectionClickSuppression,
  } = useSidebarReorderDnd({ onDragEnd: handleReorderSidebarSection });

  const projectlessThreadListState = getProjectThreadListState({
    status: projectsState.status,
    threads: threadsByProject.get(PERSONAL_PROJECT_ID),
  });

  const pinnedSectionContent = (
    <PinnedThreadTree
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
  const projectsSectionContent = (
    <ProjectListProjects
      status={projectsState.status}
      rows={projectRows}
      selectedThreadId={selectedThreadId}
      collapsedProjectIds={collapsedProjectIds}
      collapsedThreadIds={collapsedThreadIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      onProjectSelect={onProjectSelect}
      onCreateProjectThread={handleCreateProjectThread}
      onToggleProjectCollapsed={toggleProjectCollapsed}
      onToggleThreadCollapsed={toggleThreadCollapsed}
      onToggleEnvironmentCollapsed={toggleEnvironmentCollapsed}
      reorder={projectReorder}
    />
  );
  const threadsSectionContent = (
    <ProjectThreadTree
      projectId={PERSONAL_PROJECT_ID}
      threadListState={projectlessThreadListState}
      selectedThreadId={selectedThreadId}
      collapsedThreadIds={collapsedThreadIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      variant="section"
      onProjectSelect={onProjectSelect}
      onToggleThreadCollapsed={toggleThreadCollapsed}
      onToggleEnvironmentCollapsed={toggleEnvironmentCollapsed}
    />
  );
  const projectsSectionActions = onNewProject ? (
    <ProjectListProjectsSectionActions
      onNewProject={onNewProject}
      isCreatingProject={isCreatingProject}
    />
  ) : undefined;
  const projectsSectionActionsAlwaysVisible =
    projectsState.status === "ready" && renderedProjects.length === 0;
  const threadsSectionActions = (
    <ProjectListThreadsSectionActions
      onNewThread={handleCreateProjectlessThread}
    />
  );

  if (projectsState.status === "loading") {
    return (
      <ProjectListShell>
        <ProjectListNavigationLoadingState />
      </ProjectListShell>
    );
  }

  return (
    <ProjectListShell>
      <DndContext {...sidebarSectionDndContextProps}>
        <SortableContext
          items={visibleSidebarSectionOrder}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-4">
            {visibleSidebarSectionOrder.map((sectionId) =>
              sectionId === "pinned" ? (
                <SortableSidebarSection
                  key={sectionId}
                  id={sectionId}
                  label="Pinned"
                  disabled={visibleSidebarSectionOrder.length < 2}
                  consumeClickSuppression={
                    consumeSidebarSectionClickSuppression
                  }
                >
                  {pinnedSectionContent}
                </SortableSidebarSection>
              ) : sectionId === "projects" ? (
                <SortableSidebarSection
                  key={sectionId}
                  id={sectionId}
                  label="Projects"
                  disabled={visibleSidebarSectionOrder.length < 2}
                  actions={projectsSectionActions}
                  actionsAlwaysVisible={projectsSectionActionsAlwaysVisible}
                  collapseControl={{
                    isCollapsed: collapsedSidebarSectionIds.has("projects"),
                    onToggleCollapsed: () =>
                      toggleSidebarSectionCollapsed("projects"),
                  }}
                  consumeClickSuppression={
                    consumeSidebarSectionClickSuppression
                  }
                >
                  {projectsSectionContent}
                </SortableSidebarSection>
              ) : sectionId === "threads" ? (
                <SortableSidebarSection
                  key={sectionId}
                  id={sectionId}
                  label="Threads"
                  disabled={visibleSidebarSectionOrder.length < 2}
                  actions={threadsSectionActions}
                  collapseControl={{
                    isCollapsed: collapsedSidebarSectionIds.has("threads"),
                    onToggleCollapsed: () =>
                      toggleSidebarSectionCollapsed("threads"),
                  }}
                  consumeClickSuppression={
                    consumeSidebarSectionClickSuppression
                  }
                >
                  {threadsSectionContent}
                </SortableSidebarSection>
              ) : null,
            )}
          </div>
        </SortableContext>
      </DndContext>
    </ProjectListShell>
  );
}

export const ProjectList = memo(ProjectListComponent);
