import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import {
  sortableKeyboardCoordinates,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { AppSummary, ProjectResponse } from "@bb/server-contract";
import {
  findLocalPathProjectSourceForHost,
  PERSONAL_PROJECT_ID,
  type ThreadListEntry,
} from "@bb/domain";
import { useAppRoute } from "@/hooks/useAppRoute";
import { useApps } from "@/hooks/queries/thread-queries";
import {
  useConnectionAwareQueryState,
  type ConnectionAwareQueryStatus,
} from "@/hooks/queries/connection-aware-query-state";
import {
  stripProjectThreads,
  useSidebarNavigation,
} from "@/hooks/queries/project-queries";
import {
  useReorderProject,
  useReorderProjectManager,
} from "@/hooks/mutations/project-mutations";
import { useReorderPinnedThread } from "@/hooks/mutations/thread-state-mutations";
import {
  isLocalPathMissing,
  useLocalPathExistence,
} from "@/hooks/queries/host-path-queries";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { getRootComposeRoutePath } from "@/lib/app-route-paths";
import {
  applyNeighborReorder,
  buildNeighborReorderRequest,
} from "@/lib/neighbor-reorder";
import {
  useSetRootComposeMode,
  useSetRootComposeProjectId,
  type RootComposeMode,
} from "@/lib/root-compose-selection";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button.js";
import { EmptyState } from "@/components/ui/empty-state.js";
import { Icon, type IconName } from "@/components/ui/icon.js";
import {
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarStickyStack,
  SidebarStickyTier,
} from "@/components/ui/sidebar.js";
import {
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
  COARSE_POINTER_ROW_HEIGHT_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import { ProjectRow, ProjectThreadTree } from "./ProjectRow";
import { SidebarAppsSection } from "./SidebarAppsSection";
import type {
  ProjectRowDragBindings,
  ProjectRowProps,
  ProjectThreadListState,
} from "./ProjectRow";
import {
  PinnedThreadTree,
  type PinnedThreadTreeProps,
} from "./PinnedThreadTree";
import { buildPinnedSidebarState } from "./pinnedSidebarThreads";
import {
  collapsedEnvironmentIdsAtom,
  collapsedManagerIdsAtom,
  collapsedProjectIdsAtom,
  DEFAULT_SIDEBAR_SECTION_ORDER,
  sidebarSectionOrderAtom,
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
import { SIDEBAR_SORTABLE_TRANSITION } from "./sortableMotion";
import {
  useDragClickSuppression,
  type ConsumeDragClickSuppression,
} from "./useDragClickSuppression";

interface ProjectListProps {
  onNewProject?: () => void;
  onProjectSelect?: () => void;
  isCreatingProject?: boolean;
}

export interface ProjectListActionButtonsProps {
  onNewChat?: () => void;
  onNewManager?: () => void;
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
  onNewManager: () => void;
  onNewThread: () => void;
}

interface LocalSourcePathTarget {
  path: string;
  projectId: string;
}

interface OpenRootComposeForProjectArgs {
  projectId: string;
  mode: RootComposeMode;
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

interface SortableProjectRowProps extends ProjectRowProps {
  reorderDisabled: boolean;
}

interface SidebarSectionDragBindings {
  attributes: DraggableAttributes;
  disabled: boolean;
  listeners: DraggableSyntheticListeners;
  setActivatorNodeRef: (element: HTMLDivElement | null) => void;
}

interface TopLevelSidebarSectionProps {
  label: string;
  children: ReactNode;
  actions?: ReactNode;
  actionsAlwaysVisible?: boolean;
  dragBindings?: SidebarSectionDragBindings;
  sectionRef?: (element: HTMLDivElement | null) => void;
  sectionStyle?: CSSProperties;
  consumeClickSuppression?: ConsumeDragClickSuppression;
}

interface SortableSidebarSectionProps extends TopLevelSidebarSectionProps {
  id: SidebarSectionId;
  disabled: boolean;
}

interface ItemOrderEntry {
  id: string;
}

function hasSameItemOrder(
  left: readonly ItemOrderEntry[],
  right: readonly ItemOrderEntry[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item.id === right[index]?.id);
}

function hasSameSidebarSectionOrder(
  left: readonly SidebarSectionId[],
  right: readonly SidebarSectionId[],
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
    value === "threads" ||
    value === "apps"
  );
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

const EMPTY_APPS: readonly AppSummary[] = [];

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
  onNewManager,
  onNewThread,
}: ProjectListThreadsSectionActionsProps) {
  return (
    <>
      <ProjectListSectionIconButton
        ariaLabel="New manager"
        title="New manager"
        iconName="UserRoundPlus"
        onClick={onNewManager}
      />
      <ProjectListSectionIconButton
        ariaLabel="New thread"
        title="New thread"
        iconName="MessageSquarePlus"
        onClick={onNewThread}
      />
    </>
  );
}

function TopLevelSidebarSection({
  label,
  children,
  actions,
  actionsAlwaysVisible = false,
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
  return (
    <div
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
          "rounded-md pr-1 text-muted-foreground transition-colors",
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
            "relative z-10 min-w-0 flex-1 truncate text-left",
            actions && "pr-14",
          )}
        >
          {label}
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
      <div className="mt-1">{children}</div>
    </div>
  );
}

// The sidebar sections have wildly different heights (the Threads list is far
// taller than the Projects list). `closestCenter` keys off the dragged
// element's bounding-rect center, so a tall section's center sits far below the
// cursor and a swap only registers once you over-drag past the other section's
// center. Prefer the section the pointer is actually over, falling back to
// center distance only when the pointer is outside every droppable.
const sidebarSectionCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

const SortableSidebarSection = memo(function SortableSidebarSection({
  id,
  disabled,
  ...props
}: SortableSidebarSectionProps) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id,
    disabled,
    transition: SIDEBAR_SORTABLE_TRANSITION,
  });
  const style = useMemo<CSSProperties>(
    () => ({
      transform: CSS.Translate.toString(transform),
      transition,
      // Each section's sticky header creates its own stacking context
      // (`isolation: isolate`), so a dragged section paints behind the other
      // section's rows unless we lift it above them while dragging.
      position: isDragging ? "relative" : undefined,
      zIndex: isDragging ? 20 : undefined,
    }),
    [isDragging, transform, transition],
  );
  const dragBindings = useMemo<SidebarSectionDragBindings>(
    () => ({
      attributes,
      disabled,
      listeners,
      setActivatorNodeRef,
    }),
    [attributes, disabled, listeners, setActivatorNodeRef],
  );

  return (
    <TopLevelSidebarSection
      {...props}
      dragBindings={dragBindings}
      sectionRef={setNodeRef}
      sectionStyle={style}
    />
  );
});

const SortableProjectRow = memo(function SortableProjectRow({
  project,
  reorderDisabled,
  ...props
}: SortableProjectRowProps) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: project.id,
    disabled: reorderDisabled,
    transition: SIDEBAR_SORTABLE_TRANSITION,
  });
  const style = useMemo<CSSProperties>(
    () => ({
      transform: CSS.Translate.toString(transform),
      transition,
      position: isDragging ? "relative" : undefined,
      zIndex: isDragging ? 20 : undefined,
    }),
    [isDragging, transform, transition],
  );
  const projectDragBindings = useMemo<ProjectRowDragBindings>(
    () => ({
      attributes,
      disabled: reorderDisabled,
      listeners,
      setActivatorNodeRef,
    }),
    [attributes, listeners, reorderDisabled, setActivatorNodeRef],
  );

  return (
    <ProjectRow
      {...props}
      project={project}
      isProjectDragging={isDragging}
      projectDragBindings={projectDragBindings}
      projectRowRef={setNodeRef}
      projectRowStyle={style}
    />
  );
});

export function ProjectListActionButtons({
  onNewChat,
  onNewManager,
}: ProjectListActionButtonsProps) {
  const isNewChatDisabled = !onNewChat;
  const isNewManagerDisabled = !onNewManager;
  const newChatTitle = isNewChatDisabled ? "Start a new thread" : "New thread";
  const newManagerTitle = isNewManagerDisabled
    ? "Hire a new manager"
    : "New manager";

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
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={PROJECT_LIST_ACTION_BUTTON_CLASS}
        onClick={onNewManager}
        disabled={isNewManagerDisabled}
        title={newManagerTitle}
      >
        <Icon name="UserRoundPlus" />
        <span className="min-w-0 flex-1 truncate text-left">New manager</span>
        <span
          className={PROJECT_LIST_ACTION_TRAILING_SLOT_CLASS}
          aria-hidden="true"
        />
      </Button>
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
  const setRootComposeMode = useSetRootComposeMode();
  const sidebarNavigationQuery = useSidebarNavigation();
  const sidebarNavigation = sidebarNavigationQuery.data;
  const appsQuery = useApps();
  const apps = appsQuery.data ?? EMPTY_APPS;
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
  const { threadId: selectedThreadId } = useAppRoute();

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
    isPending: isManagerReorderPending,
    mutate: reorderProjectManagerMutate,
  } = useReorderProjectManager();
  const {
    isPending: isPinnedReorderPending,
    mutate: reorderPinnedThreadMutate,
  } = useReorderPinnedThread();
  const [optimisticProjectOrder, setOptimisticProjectOrder] = useState<
    ProjectResponse[] | null
  >(null);
  const renderedProjects = optimisticProjectOrder ?? projects;
  const renderedProjectIds = useMemo(
    () => (renderedProjects ?? []).map((project) => project.id),
    [renderedProjects],
  );
  const projectReorderDisabled =
    isProjectReorderPending || (renderedProjects?.length ?? 0) < 2;
  const {
    beginDragClickSuppression: beginProjectDragClickSuppression,
    clearDragClickSuppressionSoon: clearProjectDragClickSuppressionSoon,
    consumeDragClickSuppression: consumeProjectClickSuppression,
  } = useDragClickSuppression();
  const {
    beginDragClickSuppression: beginSidebarSectionDragClickSuppression,
    clearDragClickSuppressionSoon: clearSidebarSectionDragClickSuppressionSoon,
    consumeDragClickSuppression: consumeSidebarSectionClickSuppression,
  } = useDragClickSuppression();
  const projectSensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const handleProjectDragStart = useCallback(
    (_event: DragStartEvent) => {
      beginProjectDragClickSuppression();
    },
    [beginProjectDragClickSuppression],
  );
  const handleProjectDragCancel = useCallback(() => {
    clearProjectDragClickSuppressionSoon();
  }, [clearProjectDragClickSuppressionSoon]);
  const handleProjectDragEnd = useCallback(
    (event: DragEndEvent) => {
      clearProjectDragClickSuppressionSoon();
      if (!renderedProjects || isProjectReorderPending) {
        return;
      }
      const { active, over } = event;
      if (
        !over ||
        typeof active.id !== "string" ||
        typeof over.id !== "string"
      ) {
        return;
      }
      const request = buildNeighborReorderRequest({
        activeId: active.id,
        overId: over.id,
        items: renderedProjects,
      });
      if (!request) {
        return;
      }
      const nextProjects = applyNeighborReorder({
        items: renderedProjects,
        request,
      });
      flushSync(() => {
        setOptimisticProjectOrder(nextProjects);
      });
      reorderProjectMutate(
        {
          projectId: request.itemId,
          previousProjectId: request.previousItemId,
          nextProjectId: request.nextItemId,
        },
        {
          onSettled: () => {
            setOptimisticProjectOrder(null);
          },
        },
      );
    },
    [
      clearProjectDragClickSuppressionSoon,
      isProjectReorderPending,
      renderedProjects,
      reorderProjectMutate,
    ],
  );
  const handleReorderManager = useCallback<
    NonNullable<ProjectRowProps["onReorderManager"]>
  >(
    (projectId, request, callbacks) => {
      reorderProjectManagerMutate(
        {
          projectId,
          threadId: request.itemId,
          previousThreadId: request.previousItemId,
          nextThreadId: request.nextItemId,
        },
        {
          onSettled: callbacks.onSettled,
        },
      );
    },
    [reorderProjectManagerMutate],
  );
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
    ({ projectId, mode }: OpenRootComposeForProjectArgs) => {
      setRootComposeProjectId(projectId);
      setRootComposeMode(mode);
      onProjectSelect?.();
      navigate(getRootComposeRoutePath(), {
        state: { focusPrompt: true },
      });
    },
    [navigate, onProjectSelect, setRootComposeMode, setRootComposeProjectId],
  );
  const handleCreateProjectThread = useCallback(
    (projectId: string) => {
      openRootComposeForProject({ projectId, mode: "thread" });
    },
    [openRootComposeForProject],
  );
  const handleCreateProjectManager = useCallback(
    (projectId: string) => {
      openRootComposeForProject({ projectId, mode: "manager" });
    },
    [openRootComposeForProject],
  );
  const handleCreateProjectlessThread = useCallback(() => {
    openRootComposeForProject({
      projectId: PERSONAL_PROJECT_ID,
      mode: "thread",
    });
  }, [openRootComposeForProject]);
  const handleCreateProjectlessManager = useCallback(() => {
    openRootComposeForProject({
      projectId: PERSONAL_PROJECT_ID,
      mode: "manager",
    });
  }, [openRootComposeForProject]);
  useEffect(() => {
    if (!optimisticProjectOrder || !projects) {
      return;
    }
    if (hasSameItemOrder(optimisticProjectOrder, projects)) {
      setOptimisticProjectOrder(null);
    }
  }, [optimisticProjectOrder, projects]);
  const [collapsedProjectIdList, setCollapsedProjectIdList] = useAtom(
    collapsedProjectIdsAtom,
  );
  const [collapsedManagerIdList, setCollapsedManagerIdList] = useAtom(
    collapsedManagerIdsAtom,
  );
  const [collapsedEnvironmentIdList, setCollapsedEnvironmentIdList] = useAtom(
    collapsedEnvironmentIdsAtom,
  );
  const [sidebarSectionOrderList, setSidebarSectionOrderList] = useAtom(
    sidebarSectionOrderAtom,
  );
  const collapsedProjectIds = useMemo(
    () => new Set(collapsedProjectIdList),
    [collapsedProjectIdList],
  );
  const collapsedManagerIds = useMemo(
    () => new Set(collapsedManagerIdList),
    [collapsedManagerIdList],
  );
  const collapsedEnvironmentIds = useMemo(
    () => new Set(collapsedEnvironmentIdList),
    [collapsedEnvironmentIdList],
  );
  const sidebarSectionOrder = useMemo(
    () => normalizeSidebarSectionOrder(sidebarSectionOrderList),
    [sidebarSectionOrderList],
  );
  useEffect(() => {
    if (
      hasSameSidebarSectionOrder(sidebarSectionOrderList, sidebarSectionOrder)
    ) {
      return;
    }
    setSidebarSectionOrderList(sidebarSectionOrder);
  }, [
    setSidebarSectionOrderList,
    sidebarSectionOrder,
    sidebarSectionOrderList,
  ]);
  const pinnedSidebarState = useMemo(
    () => buildPinnedSidebarState({ threads }),
    [threads],
  );
  const hasPinnedSection = pinnedSidebarState.rootItems.length > 0;
  // No apps → no section: the empty Apps list adds nothing, so it stays hidden
  // (like the Pinned section) until at least one global app exists.
  const hasAppsSection = apps.length > 0;
  const visibleSidebarSectionOrder = useMemo(
    () =>
      sidebarSectionOrder.filter((sectionId) => {
        if (sectionId === "pinned") return hasPinnedSection;
        if (sectionId === "apps") return hasAppsSection;
        return true;
      }),
    [hasAppsSection, hasPinnedSection, sidebarSectionOrder],
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
    for (const project of renderedProjects ?? []) {
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

  const toggleProjectCollapsed = useCallback<ToggleCollapsedId>(
    (projectId) => {
      setCollapsedProjectIdList((current) => {
        return toggleCollapsedIdList({ current, id: projectId });
      });
    },
    [setCollapsedProjectIdList],
  );

  const toggleManagerCollapsed = useCallback<ToggleCollapsedId>(
    (threadId) => {
      setCollapsedManagerIdList((current) => {
        return toggleCollapsedIdList({ current, id: threadId });
      });
    },
    [setCollapsedManagerIdList],
  );

  const toggleEnvironmentCollapsed = useCallback<ToggleCollapsedId>(
    (environmentId) => {
      setCollapsedEnvironmentIdList((current) => {
        return toggleCollapsedIdList({ current, id: environmentId });
      });
    },
    [setCollapsedEnvironmentIdList],
  );

  const sidebarSectionSensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const handleSidebarSectionDragStart = useCallback(
    (_event: DragStartEvent) => {
      beginSidebarSectionDragClickSuppression();
    },
    [beginSidebarSectionDragClickSuppression],
  );
  const handleSidebarSectionDragCancel = useCallback(() => {
    clearSidebarSectionDragClickSuppressionSoon();
  }, [clearSidebarSectionDragClickSuppressionSoon]);
  const handleSidebarSectionDragEnd = useCallback(
    (event: DragEndEvent) => {
      clearSidebarSectionDragClickSuppressionSoon();
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
    [
      clearSidebarSectionDragClickSuppressionSoon,
      setSidebarSectionOrderList,
      visibleSidebarSectionOrder,
    ],
  );

  const projectlessThreadListState = getProjectThreadListState({
    status: projectsState.status,
    threads: threadsByProject.get(PERSONAL_PROJECT_ID),
  });

  const pinnedSectionContent = (
    <PinnedThreadTree
      rootItems={pinnedSidebarState.rootItems}
      selectedThreadId={selectedThreadId}
      collapsedManagerIds={collapsedManagerIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      onProjectSelect={onProjectSelect}
      onToggleManagerCollapsed={toggleManagerCollapsed}
      onToggleEnvironmentCollapsed={toggleEnvironmentCollapsed}
      isPinnedReorderPending={isPinnedReorderPending}
      onReorderPinnedRoot={handleReorderPinnedRoot}
    />
  );
  const projectsSectionContent = (
    <SidebarMenu className="gap-1">
      {projectsState.status === "loading" ? (
        <>
          <SidebarMenuSkeleton />
          <SidebarMenuSkeleton />
        </>
      ) : renderedProjects && renderedProjects.length > 1 ? (
        <DndContext
          sensors={projectSensors}
          collisionDetection={closestCenter}
          onDragStart={handleProjectDragStart}
          onDragCancel={handleProjectDragCancel}
          onDragEnd={handleProjectDragEnd}
        >
          <SortableContext
            items={renderedProjectIds}
            strategy={verticalListSortingStrategy}
          >
            {renderedProjects.map((project) => {
              const threadListState =
                threadListStatesByProjectId.get(project.id) ??
                EMPTY_PROJECT_THREAD_LIST_STATE;
              const localSourcePath = localSourcePathsByProjectId.get(
                project.id,
              );
              const isLocalPathInvalid = isLocalPathMissing(
                pathExistence,
                localSourcePath,
              );
              return (
                <SortableProjectRow
                  key={project.id}
                  project={project}
                  reorderDisabled={projectReorderDisabled}
                  threadListState={threadListState}
                  selectedThreadId={selectedThreadId}
                  isActive={false}
                  isCollapsed={collapsedProjectIds.has(project.id)}
                  collapsedManagerIds={collapsedManagerIds}
                  collapsedEnvironmentIds={collapsedEnvironmentIds}
                  isLocalPathInvalid={isLocalPathInvalid}
                  onProjectSelect={onProjectSelect}
                  onCreateProjectThread={handleCreateProjectThread}
                  onCreateProjectManager={handleCreateProjectManager}
                  onToggleProjectCollapsed={toggleProjectCollapsed}
                  onToggleManagerCollapsed={toggleManagerCollapsed}
                  onToggleEnvironmentCollapsed={toggleEnvironmentCollapsed}
                  isManagerReorderPending={isManagerReorderPending}
                  onReorderManager={handleReorderManager}
                  consumeProjectClickSuppression={
                    consumeProjectClickSuppression
                  }
                />
              );
            })}
          </SortableContext>
        </DndContext>
      ) : renderedProjects && renderedProjects.length > 0 ? (
        renderedProjects.map((project) => {
          const threadListState =
            threadListStatesByProjectId.get(project.id) ??
            EMPTY_PROJECT_THREAD_LIST_STATE;
          const localSourcePath = localSourcePathsByProjectId.get(project.id);
          const isLocalPathInvalid = isLocalPathMissing(
            pathExistence,
            localSourcePath,
          );
          return (
            <ProjectRow
              key={project.id}
              project={project}
              threadListState={threadListState}
              selectedThreadId={selectedThreadId}
              isActive={false}
              isCollapsed={collapsedProjectIds.has(project.id)}
              collapsedManagerIds={collapsedManagerIds}
              collapsedEnvironmentIds={collapsedEnvironmentIds}
              isLocalPathInvalid={isLocalPathInvalid}
              onProjectSelect={onProjectSelect}
              onCreateProjectThread={handleCreateProjectThread}
              onCreateProjectManager={handleCreateProjectManager}
              onToggleProjectCollapsed={toggleProjectCollapsed}
              onToggleManagerCollapsed={toggleManagerCollapsed}
              onToggleEnvironmentCollapsed={toggleEnvironmentCollapsed}
              isManagerReorderPending={isManagerReorderPending}
              onReorderManager={handleReorderManager}
            />
          );
        })
      ) : (
        <SidebarMenuItem>
          <EmptyState
            message={
              projectsState.status === "unavailable"
                ? "Projects unavailable"
                : "No projects"
            }
            icon="Folder"
            className="px-2 py-1.5"
            iconClassName="size-3.5 text-sidebar-foreground/75"
            messageClassName="text-xs font-medium text-sidebar-foreground/85"
          />
        </SidebarMenuItem>
      )}
    </SidebarMenu>
  );
  const threadsSectionContent = (
    <ProjectThreadTree
      projectId={PERSONAL_PROJECT_ID}
      threadListState={projectlessThreadListState}
      selectedThreadId={selectedThreadId}
      collapsedManagerIds={collapsedManagerIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      variant="section"
      onProjectSelect={onProjectSelect}
      onToggleManagerCollapsed={toggleManagerCollapsed}
      onToggleEnvironmentCollapsed={toggleEnvironmentCollapsed}
      isManagerReorderPending={isManagerReorderPending}
      onReorderManager={handleReorderManager}
    />
  );
  const appsSectionContent = <SidebarAppsSection apps={apps} />;
  const projectsSectionActions = onNewProject ? (
    <ProjectListProjectsSectionActions
      onNewProject={onNewProject}
      isCreatingProject={isCreatingProject}
    />
  ) : undefined;
  const projectsSectionActionsAlwaysVisible =
    projectsState.status === "ready" && (renderedProjects?.length ?? 0) === 0;
  const threadsSectionActions = (
    <ProjectListThreadsSectionActions
      onNewThread={handleCreateProjectlessThread}
      onNewManager={handleCreateProjectlessManager}
    />
  );

  return (
    <ProjectListShell>
      <DndContext
        sensors={sidebarSectionSensors}
        collisionDetection={sidebarSectionCollisionDetection}
        onDragStart={handleSidebarSectionDragStart}
        onDragCancel={handleSidebarSectionDragCancel}
        onDragEnd={handleSidebarSectionDragEnd}
      >
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
                  consumeClickSuppression={
                    consumeSidebarSectionClickSuppression
                  }
                >
                  {threadsSectionContent}
                </SortableSidebarSection>
              ) : (
                <SortableSidebarSection
                  key={sectionId}
                  id={sectionId}
                  label="Apps"
                  disabled={visibleSidebarSectionOrder.length < 2}
                  consumeClickSuppression={
                    consumeSidebarSectionClickSuppression
                  }
                >
                  {appsSectionContent}
                </SortableSidebarSection>
              ),
            )}
          </div>
        </SortableContext>
      </DndContext>
    </ProjectListShell>
  );
}

export const ProjectList = memo(ProjectListComponent);
