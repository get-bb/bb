import {
  memo,
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { DndContext, DragOverlay, useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { createPortal } from "react-dom";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import { NavLink } from "react-router-dom";
import { useCreateThreadInWorktree } from "@/hooks/useCreateThreadInWorktree";
import {
  usePromptDraftHasInput,
  usePromptDraftInputThreadIds,
} from "@/hooks/usePromptDraftStorage";
import {
  useArchiveEnvironmentThreads,
  useUpdateEnvironment,
} from "@/hooks/mutations/environment-mutations";
import { useDialogState } from "@/hooks/useDialogState";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { EmptyState } from "@bb/shared-ui/empty-state";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  SidebarMenuSkeleton,
  SidebarStickyGroup,
  SidebarStickyTier,
} from "@/components/ui/sidebar.js";
import {
  ProjectActionsContextMenu,
  ProjectActionsMenu,
} from "@/components/project/ProjectActionsMenu";
import {
  EnvironmentRenameDialog,
  type EnvironmentRenameDialogTarget,
} from "@/components/dialogs/EnvironmentRenameDialog";
import {
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_GLYPH_BOX_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
  SIDEBAR_HOVER_ACTIONS_GAP_CLASS,
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions.js";
import {
  getCollapsedChildActivity,
  NO_COLLAPSED_CHILD_ACTIVITY,
  type CollapsedChildActivity,
} from "@/lib/thread-activity";
import { cn } from "@bb/shared-ui/lib/utils";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { getProjectSettingsRoutePath } from "@/lib/route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { appToast } from "@/components/ui/app-toast";
import { useRouteNavigate } from "@/components/ui/app-route-anchor";
import {
  CollapsedThreadStatusGlyph,
  ThreadRow,
  type ThreadRowOptions,
} from "./ThreadRow";
import {
  buildSectionThreadList,
  buildProjectThreadGroups,
  CHRONOLOGICAL_CONTAINER_ID,
  collectProjectThreadItemNavigationEntries,
  countProjectThreadItemRows,
  getProjectThreadItemDescendants,
  getSidebarDndItemId,
  isSidebarProjectThread,
  projectThreadItemContainsThread,
  type EnvironmentThreadGroup,
  type ProjectThreadItem,
  type ProjectThreadItemRowCountContext,
  type ProjectThreadNode,
  type SidebarSectionDefinition,
  type SidebarSectionGroup,
  type ThreadComparator,
} from "./projectThreadGroups";
import { SidebarWindowedItems } from "./SidebarWindowedItems";
import { SidebarSectionRow } from "./SidebarSectionRow";
import { TopLevelSidebarSection } from "./TopLevelSidebarSection";
import {
  sidebarCollapsedThreadSectionsAtom,
  type CollapsibleSidebarSectionId,
  type SidebarSectionId,
} from "./sidebarCollapsedAtoms";
import {
  SIDEBAR_PROJECT_GROUP_LINE_CLASS,
  SIDEBAR_MORE_ACTION_TRIGGER_CLASS,
  SIDEBAR_ROW_BASE_CLASS,
  getSidebarThreadGroupLineLeft,
  getSidebarThreadRowPaddingLeft,
} from "./sidebarRowClasses";
import {
  SIDEBAR_DRAG_OVERLAY_DROP_ANIMATION,
  useSidebarSortable,
  type SidebarSortableDragBindings,
} from "./sortableMotion";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import type { NeighborReorderRequest } from "@/lib/neighbor-reorder";
import { SidebarChildToggleChevron } from "./SidebarChildToggleChevron";
import { buildSidebarEntitySectionId } from "./sidebarSectionOrder";
import { SidebarSectionOrderList } from "./SidebarSectionOrderList";
import {
  collectSectionThreadDndLookup,
  PINNED_THREAD_PARENT_KEY,
  useSectionThreadDnd,
  type SectionThreadDndState,
} from "./useSectionThreadDnd";
import {
  getBuiltInSidebarSectionNode,
  renderBuiltInSidebarSection,
  type BuiltInSidebarSectionNodes,
  type BuiltInSidebarSectionOptions,
  type BuiltInSidebarSectionOptionsById,
} from "./BuiltInSidebarSection";
import { SectionThreadDndProvider } from "./SectionThreadDndContext";

// Pin the project row plus this many parent levels (parent threads,
// worktree group headers); rows deeper than the cap render non-sticky so a deep
// chain can't pin more ancestors than a short viewport can hold.
const SIDEBAR_STICKY_PARENT_DEPTH_CAP = 4;

export type ProjectThreadListState =
  | {
      status: "loading";
    }
  | {
      status: "ready";
      threads: ThreadListEntry[];
    }
  | {
      status: "unavailable";
    };

export interface ProjectRowProps {
  project: ProjectResponse;
  threadListState: ProjectThreadListState;
  selectedThreadId?: string;
  isActive: boolean;
  isCollapsed: boolean;
  compareThreads: ThreadComparator;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  isLocalPathInvalid: boolean;
  headerActions?: ReactNode;
  headerActionsOpen?: boolean;
  onProjectSelect?: () => void;
  onCreateProjectThread?: (projectId: string) => void;
  onToggleProjectCollapsed: (projectId: string) => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  consumeProjectClickSuppression?: ConsumeDragClickSuppression;
  projectDragBindings?: SidebarSortableDragBindings;
  projectRowRef?: (element: HTMLDivElement | null) => void;
  projectRowStyle?: CSSProperties;
}

interface ProjectThreadTreeProps {
  // Route every row to this project; omit to derive each row's project from
  // its own thread (cross-project views such as By machine).
  projectId?: string;
  threadListState: ProjectThreadListState;
  compareThreads: ThreadComparator;
  selectedThreadId?: string;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  variant: ProjectThreadTreeVariant;
  onProjectSelect?: () => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
}

interface SectionThreadTreeProps {
  threadListState: ProjectThreadListState;
  compareThreads: ThreadComparator;
  sections?: readonly SidebarSectionDefinition[];
  selectedThreadId?: string;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  onProjectSelect?: () => void;
  onCreateThreadInSection?: (sectionId: string) => void;
  onRenameSection?: (section: SidebarSectionDefinition) => void;
  onRemoveSection?: (section: SidebarSectionDefinition) => void;
  renderTopLevelSectionHeaderActions?: (
    section: SidebarSectionDefinition,
  ) => TopLevelSectionHeaderActions;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
}

interface TopLevelSectionHeaderActions {
  actions: ReactNode;
  actionsOpen: boolean;
}

interface ChronologicalBuiltInSidebarSections {
  collapsedSectionIds: ReadonlySet<CollapsibleSidebarSectionId>;
  onToggleCollapsed: (id: CollapsibleSidebarSectionId) => void;
  pinned: BuiltInSidebarSectionOptions;
  threads: Omit<BuiltInSidebarSectionOptions, "content">;
}

interface ChronologicalSectionThreadSectionsProps extends SectionThreadTreeProps {
  builtInSections?: ChronologicalBuiltInSidebarSections;
  topLevelSectionOrder: readonly SidebarSectionId[];
  onTopLevelSectionOrderChange: (order: SidebarSectionId[]) => void;
  pinnedReorderPending: boolean;
  pinnedThreads: readonly ThreadListEntry[];
  onReorderPinnedThread: (
    request: NeighborReorderRequest,
    callbacks: { onSettled: () => void },
  ) => void;
  renderPinnedSection?: (
    consumeClickSuppression?: ConsumeDragClickSuppression,
  ) => ReactNode;
  renderThreadsSection?: (
    content: ReactNode,
    consumeClickSuppression?: ConsumeDragClickSuppression,
  ) => ReactNode;
}

type ProjectThreadTreeVariant = "project" | "section";

type ProjectThreadListClickCaptureHandler = MouseEventHandler<HTMLDivElement>;

const EMPTY_PROJECT_THREADS: ThreadListEntry[] = [];
const EMPTY_THREAD_SECTIONS: readonly SidebarSectionDefinition[] = [];

interface ShouldSuppressPinnedThreadDropPreviewArgs {
  activeThreadId: string | undefined;
  dragOverParentKey: string | null;
  pinnedThreads: readonly Pick<ThreadListEntry, "id">[];
}

export function shouldSuppressPinnedThreadDropPreview({
  activeThreadId,
  dragOverParentKey,
  pinnedThreads,
}: ShouldSuppressPinnedThreadDropPreviewArgs): boolean {
  return (
    activeThreadId !== undefined &&
    dragOverParentKey === PINNED_THREAD_PARENT_KEY &&
    pinnedThreads.some((thread) => thread.id === activeThreadId)
  );
}

interface ProjectThreadTreeGroupProps {
  children: ReactNode;
  variant: ProjectThreadTreeVariant;
  onClickCapture?: ProjectThreadListClickCaptureHandler;
}

interface ThreadTreeNodeRowProps {
  // Project of the enclosing group for a root node, or of the parent thread for
  // a child node. A node whose thread lives elsewhere gets a cross-project marker.
  projectId: string;
  node: ProjectThreadNode;
  depthOffset: number;
  isEnvGrouped: boolean;
  selectedThreadId?: string;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  variant: ProjectThreadTreeVariant;
  onProjectSelect?: () => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  dragBindings?: SidebarSortableDragBindings;
  sortableRef?: (element: HTMLDivElement | null) => void;
  sortableStyle?: CSSProperties;
}

interface ThreadTreeItemRowProps {
  projectId: string;
  item: ProjectThreadItem;
  depthOffset: number;
  selectedThreadId?: string;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  variant: ProjectThreadTreeVariant;
  onProjectSelect?: () => void;
  onCreateThreadInSection?: (sectionId: string) => void;
  onRenameSection?: (section: SidebarSectionDefinition) => void;
  onRemoveSection?: (section: SidebarSectionDefinition) => void;
  renderTopLevelSectionHeaderActions?: SectionThreadTreeProps["renderTopLevelSectionHeaderActions"];
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  dragBindings?: SidebarSortableDragBindings;
  isDropTargetActive?: boolean;
  sectionDnd?: SectionThreadDndState;
  sortableRef?: (element: HTMLDivElement | null) => void;
  sortableStyle?: CSSProperties;
}

interface SectionTreeItemRowProps {
  section: SidebarSectionGroup;
  depthOffset: number;
  selectedThreadId?: string;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  variant: ProjectThreadTreeVariant;
  onProjectSelect?: () => void;
  onCreateThreadInSection?: (sectionId: string) => void;
  onRenameSection?: (section: SidebarSectionDefinition) => void;
  onRemoveSection?: (section: SidebarSectionDefinition) => void;
  renderTopLevelSectionHeaderActions?: SectionThreadTreeProps["renderTopLevelSectionHeaderActions"];
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  dragBindings?: SidebarSortableDragBindings;
  isDropTargetActive?: boolean;
  sectionDnd?: SectionThreadDndState;
  sortableRef?: (element: HTMLDivElement | null) => void;
  sortableStyle?: CSSProperties;
}

// Render key + routing projectId for any item kind. Sections derive from their
// first nested item, so a section spanning projects in the Sections view still
// routes each contained thread to its own project.
function getItemKey(item: ProjectThreadItem): string {
  switch (item.kind) {
    case "thread":
      return `thread:${item.node.thread.id}`;
    case "environment":
      return `env:${item.group.environmentId}`;
    case "section":
      return `section:${item.group.key}`;
  }
}

function getItemProjectId(item: ProjectThreadItem): string {
  switch (item.kind) {
    case "thread":
      return item.node.thread.projectId;
    case "environment":
      return item.group.nodes[0].thread.projectId;
    case "section":
      if (item.group.items.length === 0) {
        return PERSONAL_PROJECT_ID;
      }
      return getItemProjectId(item.group.items[0]);
  }
}

interface EnvironmentThreadGroupRowProps {
  projectId: string;
  environmentThreadGroup: EnvironmentThreadGroup;
  depthOffset: number;
  selectedThreadId?: string;
  isCollapsed: boolean;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  variant: ProjectThreadTreeVariant;
  onProjectSelect?: () => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
}

interface ThreadTreeGroupLineProps {
  parentRowDepth: number;
}

interface ThreadTreeLineContinuationProps {
  parentRowDepth: number;
}

interface GetThreadNodeStickyLevelArgs {
  depthOffset: number;
  node: ProjectThreadNode;
}

interface EnvironmentThreadGroupHeaderProps {
  environmentId: string;
  representativeThread: ThreadListEntry;
  rowDepth: number;
  stickyLevel?: number;
  parentLineDepth?: number;
  childActivity: CollapsedChildActivity;
  isCollapsed: boolean;
  archiveThreadsPending?: boolean;
  onArchiveThreads?: () => void;
  onCreateNewThread?: () => void;
  onRenameEnvironment?: () => void;
  onToggleCollapsed: (environmentId: string) => void;
}

interface EnvironmentThreadGroupHeaderActionsProps {
  archiveThreadsPending: boolean;
  onArchiveThreads?: () => void;
  onCreateNewThread?: () => void;
  onRenameEnvironment?: () => void;
  onOpenChange: (open: boolean) => void;
}

interface UseArchiveEnvironmentThreadGroupActionArgs {
  environmentId: string;
  projectId: string;
  selectedThreadId?: string;
  threads: readonly ThreadListEntry[];
}

interface UseArchiveEnvironmentThreadGroupActionResult {
  archiveThreadsPending: boolean;
  onArchiveThreads: () => void;
}

interface UseEnvironmentThreadGroupRenameActionArgs {
  environmentId: string;
  representativeThread: ThreadListEntry;
}

interface UseEnvironmentThreadGroupRenameActionResult {
  onRenameDialogOpenChange: (open: boolean) => void;
  onRenameEnvironment: () => void;
  onSubmitRenameEnvironment: (
    environmentId: string,
    name: string | null,
  ) => void;
  renameDialogTarget: EnvironmentRenameDialogTarget | null;
  renameEnvironmentErrorMessage: string | null;
  renameEnvironmentPending: boolean;
}

interface FormatArchivedEnvironmentThreadsToastTitleArgs {
  archivedThreadIds: readonly string[];
  threads: readonly Pick<ThreadListEntry, "id" | "title" | "titleFallback">[];
}

export function formatArchivedEnvironmentThreadsToastTitle({
  archivedThreadIds,
  threads,
}: FormatArchivedEnvironmentThreadsToastTitleArgs): string {
  if (archivedThreadIds.length !== 1) {
    return `Archived ${archivedThreadIds.length} threads`;
  }

  const archivedThread = threads.find(
    (thread) => thread.id === archivedThreadIds[0],
  );
  if (!archivedThread) {
    return "Archived 1 thread";
  }
  return `Archived ${getThreadDisplayTitle(archivedThread)}`;
}

function getProjectThreadTreeEmptyStateIcon(
  variant: ProjectThreadTreeVariant,
): IconName | undefined {
  if (variant === "section") {
    return "MessageSquare";
  }

  return undefined;
}

function getProjectThreadTreeEmptyStateClassName(
  variant: ProjectThreadTreeVariant,
): string {
  return cn(
    "py-0.5",
    variant === "section" ? "px-2" : "pl-8 pr-2",
    "group-data-[collapsible=icon]:hidden",
  );
}

function getProjectThreadTreeEmptyStateMessageClassName(): string {
  // One notch below the section-header label so an empty placeholder never
  // out-emphasizes the header it sits under.
  return "text-xs leading-4 text-subtle-foreground/60";
}

function getProjectThreadTreeGroupLineClassName(
  variant: ProjectThreadTreeVariant,
): string | undefined {
  if (variant === "project") {
    return SIDEBAR_PROJECT_GROUP_LINE_CLASS;
  }

  return undefined;
}

function getProjectThreadTreeRootDepthOffset(
  variant: ProjectThreadTreeVariant,
): number {
  return variant === "section" ? 0 : 1;
}

function getThreadRowDepth({
  depthOffset,
  nodeDepth,
  variant,
}: GetThreadRowDepthArgs): number {
  return getProjectThreadTreeRootDepthOffset(variant) + nodeDepth + depthOffset;
}

function getThreadRowOptions({
  childActivity,
  childCount,
  consumeClickSuppression,
  dragBindings,
  depthOffset,
  isCollapsed,
  isEnvGrouped,
  isParent,
  nodeDepth,
  onToggleThreadCollapsed,
  stickyLevel,
  variant,
}: GetThreadRowOptionsArgs): ThreadRowOptions {
  const depth = getThreadRowDepth({ depthOffset, nodeDepth, variant });
  const baseOptions = {
    depth,
    isCompact: nodeDepth > 0 || isEnvGrouped,
    ...(consumeClickSuppression ? { consumeClickSuppression } : {}),
    ...(dragBindings ? { dragBindings } : {}),
  };

  if (!isParent) {
    return {
      ...baseOptions,
      kind: "default",
    };
  }

  return {
    ...baseOptions,
    kind: "parent",
    isCollapsed,
    childCount,
    childActivity,
    ...(stickyLevel !== undefined ? { stickyLevel } : {}),
    onToggleCollapsed: onToggleThreadCollapsed,
  };
}

interface GetThreadRowOptionsArgs {
  childActivity: CollapsedChildActivity;
  childCount: number;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  dragBindings?: SidebarSortableDragBindings;
  isCollapsed: boolean;
  isEnvGrouped: boolean;
  isParent: boolean;
  depthOffset: number;
  nodeDepth: number;
  onToggleThreadCollapsed: (threadId: string) => void;
  stickyLevel?: number;
  variant: ProjectThreadTreeVariant;
}

interface GetThreadRowDepthArgs {
  depthOffset: number;
  nodeDepth: number;
  variant: ProjectThreadTreeVariant;
}

// A node's pin depth among parents equals how many ancestor rows sit above it
// in the tree: its tree depth plus any offset from an enclosing env group
// header (which occupies a row of its own). Beyond the cap, return undefined so
// the row renders non-sticky.
function getThreadNodeStickyLevel({
  depthOffset,
  node,
}: GetThreadNodeStickyLevelArgs): number | undefined {
  const level = node.depth + depthOffset;
  return level < SIDEBAR_STICKY_PARENT_DEPTH_CAP ? level : undefined;
}

function ThreadTreeGroupLine({ parentRowDepth }: ThreadTreeGroupLineProps) {
  return (
    <span
      className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-border-hairline opacity-70"
      style={{ left: getSidebarThreadGroupLineLeft(parentRowDepth) }}
      aria-hidden="true"
    />
  );
}

function ThreadTreeLineContinuation({
  parentRowDepth,
}: ThreadTreeLineContinuationProps) {
  return (
    <span
      className="pointer-events-none absolute -bottom-0.5 top-0 z-[1] w-px bg-border-hairline opacity-70"
      style={{ left: getSidebarThreadGroupLineLeft(parentRowDepth) }}
      aria-hidden="true"
    />
  );
}

function ProjectThreadTreeGroup({
  children,
  variant,
  onClickCapture,
}: ProjectThreadTreeGroupProps) {
  return (
    <div
      data-sidebar-sticky-section={variant === "section" ? "" : undefined}
      className={cn(
        "relative space-y-0.5 group-data-[collapsible=icon]:hidden",
        getProjectThreadTreeGroupLineClassName(variant),
      )}
      onClickCapture={onClickCapture}
    >
      {children}
    </div>
  );
}

function SectionDndSortableList({
  children,
  sectionDnd,
  parentKey,
}: {
  children: ReactNode;
  sectionDnd?: SectionThreadDndState | null;
  parentKey: string;
}) {
  if (!sectionDnd) {
    return <>{children}</>;
  }

  return (
    <SortableContext
      items={[...(sectionDnd.itemIdsByParentKey.get(parentKey) ?? [])]}
      strategy={verticalListSortingStrategy}
    >
      {children}
    </SortableContext>
  );
}

// Registers the loose root as a droppable so drops onto its bare/empty area
// resolve to the loose container. Drop feedback is the inserted placeholder row
// (see the loose section), matching how sections preview a drop.
function SectionDndDroppableParent({
  children,
  sectionDnd,
  parentKey,
}: {
  children: ReactNode;
  sectionDnd?: SectionThreadDndState | null;
  parentKey: string;
}) {
  const { setNodeRef } = useDroppable({
    id: parentKey,
    disabled: !sectionDnd,
  });

  return <div ref={setNodeRef}>{children}</div>;
}

const SectionDndItemRow = memo(function SectionDndItemRow({
  sectionDnd,
  ...props
}: ThreadTreeItemRowProps) {
  if (!sectionDnd || props.item.kind === "environment") {
    return <ThreadTreeItemRow sectionDnd={sectionDnd} {...props} />;
  }

  if (props.item.kind === "section") {
    return <DroppableSectionItemRow {...props} sectionDnd={sectionDnd} />;
  }

  return <DraggableSectionThreadItemRow {...props} sectionDnd={sectionDnd} />;
});

const DraggableSectionThreadItemRow = memo(
  function DraggableSectionThreadItemRow({
    sectionDnd,
    ...props
  }: ThreadTreeItemRowProps & { sectionDnd: SectionThreadDndState }) {
    const itemId = getSidebarDndItemId(props.item);
    const { dragBindings, setNodeRef, style } = useSidebarSortable({
      id: itemId,
      disabled: false,
    });

    return (
      <ThreadTreeItemRow
        {...props}
        consumeClickSuppression={sectionDnd.consumeClickSuppression}
        dragBindings={dragBindings}
        sectionDnd={sectionDnd}
        sortableRef={setNodeRef}
        sortableStyle={
          sectionDnd.activeThread?.id === itemId
            ? { ...style, opacity: 0.25 }
            : style
        }
      />
    );
  },
);

const DroppableSectionItemRow = memo(function DroppableSectionItemRow({
  sectionDnd,
  ...props
}: ThreadTreeItemRowProps & { sectionDnd: SectionThreadDndState }) {
  const itemId = getSidebarDndItemId(props.item);
  const isTopLevelSection =
    props.variant === "section" && props.depthOffset === 0;
  const topLevelSectionId =
    props.item.kind === "section"
      ? buildSidebarEntitySectionId("section", props.item.group.id)
      : itemId;
  const sortable = useSidebarSortable({
    id: topLevelSectionId,
    disabled: !isTopLevelSection,
  });
  const droppable = useDroppable({ id: itemId, disabled: isTopLevelSection });

  return (
    <ThreadTreeItemRow
      {...props}
      consumeClickSuppression={sectionDnd.consumeClickSuppression}
      dragBindings={isTopLevelSection ? sortable.dragBindings : undefined}
      isDropTargetActive={
        isTopLevelSection ? sortable.isOver : droppable.isOver
      }
      sectionDnd={sectionDnd}
      sortableRef={
        isTopLevelSection ? sortable.setNodeRef : droppable.setNodeRef
      }
      sortableStyle={isTopLevelSection ? sortable.style : undefined}
    />
  );
});

function useArchiveEnvironmentThreadGroupAction({
  environmentId,
  projectId,
  selectedThreadId,
  threads,
}: UseArchiveEnvironmentThreadGroupActionArgs): UseArchiveEnvironmentThreadGroupActionResult {
  const navigate = useRouteNavigate();
  const archiveEnvironmentThreads = useArchiveEnvironmentThreads();
  const {
    isPending: archiveThreadsIsPending,
    mutateAsync: archiveThreads,
    variables,
  } = archiveEnvironmentThreads;
  const archiveThreadsPending =
    archiveThreadsIsPending && variables?.id === environmentId;
  const onArchiveThreads = useCallback(() => {
    void archiveThreads({ id: environmentId })
      .then((response) => {
        appToast.success(
          formatArchivedEnvironmentThreadsToastTitle({
            archivedThreadIds: response.archivedThreadIds,
            threads,
          }),
        );
        if (
          selectedThreadId &&
          response.archivedThreadIds.includes(selectedThreadId)
        ) {
          navigate(`/projects/${projectId}`);
        }
      })
      .catch(() => undefined);
  }, [
    archiveThreads,
    environmentId,
    navigate,
    projectId,
    selectedThreadId,
    threads,
  ]);

  return {
    archiveThreadsPending,
    onArchiveThreads,
  };
}

function useEnvironmentThreadGroupRenameAction({
  environmentId,
  representativeThread,
}: UseEnvironmentThreadGroupRenameActionArgs): UseEnvironmentThreadGroupRenameActionResult {
  const renameDialog = useDialogState<EnvironmentRenameDialogTarget>();
  const updateEnvironment = useUpdateEnvironment();
  const {
    error,
    isPending,
    mutate: updateEnvironmentMutate,
    reset: resetUpdateEnvironment,
    variables,
  } = updateEnvironment;
  const renameEnvironmentPending = isPending && variables?.id === environmentId;
  const renameEnvironmentErrorMessage =
    error && variables?.id === environmentId
      ? getMutationErrorMessage({
          error,
          fallbackMessage: "Failed to update environment.",
        })
      : null;
  const { onClose, onOpen, onOpenChange, target } = renameDialog;

  const onRenameEnvironment = useCallback(() => {
    resetUpdateEnvironment();
    onOpen({
      ...(representativeThread.environmentBranchName !== null
        ? { branchName: representativeThread.environmentBranchName }
        : {}),
      canClearName: representativeThread.environmentName !== null,
      id: environmentId,
      currentName: representativeThread.environmentName ?? "",
    });
  }, [environmentId, onOpen, representativeThread, resetUpdateEnvironment]);

  const onSubmitRenameEnvironment = useCallback(
    (targetEnvironmentId: string, name: string | null) => {
      updateEnvironmentMutate(
        { id: targetEnvironmentId, name },
        { onSuccess: onClose },
      );
    },
    [onClose, updateEnvironmentMutate],
  );

  return {
    onRenameDialogOpenChange: onOpenChange,
    onRenameEnvironment,
    onSubmitRenameEnvironment,
    renameDialogTarget: target,
    renameEnvironmentErrorMessage,
    renameEnvironmentPending,
  };
}

function EnvironmentThreadGroupHeaderActions({
  archiveThreadsPending,
  onArchiveThreads,
  onCreateNewThread,
  onRenameEnvironment,
  onOpenChange,
}: EnvironmentThreadGroupHeaderActionsProps) {
  if (!onCreateNewThread && !onArchiveThreads && !onRenameEnvironment) {
    return null;
  }

  return (
    <span className="inline-flex shrink-0 items-center">
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Worktree actions"
            className={cn(
              "rounded-md p-0 text-muted-foreground",
              "data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-foreground",
              SIDEBAR_MORE_ACTION_TRIGGER_CLASS,
            )}
          >
            <Icon
              name="MoreHorizontal"
              className={COARSE_POINTER_ICON_SIZE_CLASS}
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onCreateNewThread ? (
            <DropdownMenuItem onSelect={onCreateNewThread}>
              <Icon name="MessageSquarePlus" aria-hidden="true" />
              New thread
            </DropdownMenuItem>
          ) : null}
          {onRenameEnvironment ? (
            <DropdownMenuItem
              onSelect={() => {
                onRenameEnvironment();
              }}
            >
              <Icon name="Edit" aria-hidden="true" />
              Rename
            </DropdownMenuItem>
          ) : null}
          {onArchiveThreads ? (
            <DropdownMenuItem
              disabled={archiveThreadsPending}
              onSelect={(event) => {
                if (archiveThreadsPending) {
                  event.preventDefault();
                  return;
                }
                onArchiveThreads();
              }}
            >
              <Icon name="Archive" aria-hidden="true" />
              Archive worktree
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

function EnvironmentThreadGroupHeader({
  environmentId,
  representativeThread,
  rowDepth,
  stickyLevel,
  parentLineDepth,
  childActivity,
  isCollapsed,
  archiveThreadsPending = false,
  onArchiveThreads,
  onCreateNewThread,
  onRenameEnvironment,
  onToggleCollapsed,
}: EnvironmentThreadGroupHeaderProps) {
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const environmentName = representativeThread.environmentName;
  const branchName = representativeThread.environmentBranchName;
  const displayName = environmentName || branchName || "Worktree";
  const iconName: IconName = "FolderGit";
  // Collapsed: the header speaks for its hidden children through one status
  // glyph. Expanded: the children show their own glyphs, and the synthetic
  // header has no status of its own.
  const showRollupGlyph =
    isCollapsed &&
    (childActivity.pending ||
      childActivity.working ||
      childActivity.hasUnsubmittedDraft ||
      childActivity.unread ||
      childActivity.unreadError);
  const className = cn(
    SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
    // A pinned header is already a positioned (sticky) box for its absolute
    // children; adding `relative` (a utility-layer rule) would override the
    // component-layer `position: sticky` and silently un-stick it. Only the
    // non-sticky header needs `relative`. Mirrors ThreadRow.
    stickyLevel === undefined && "relative",
    SIDEBAR_ROW_BASE_CLASS,
    COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  );
  const style = {
    paddingLeft: getSidebarThreadRowPaddingLeft(rowDepth),
  };
  const content = (
    <>
      {parentLineDepth === undefined ? null : (
        <ThreadTreeLineContinuation parentRowDepth={parentLineDepth} />
      )}
      <span
        className={cn(
          "pointer-events-none relative z-10 inline-flex shrink-0 items-center justify-center text-subtle-foreground",
          COARSE_POINTER_GLYPH_BOX_CLASS,
        )}
        aria-hidden="true"
      >
        <Icon
          name={iconName}
          className={COARSE_POINTER_ICON_SIZE_CLASS}
          aria-hidden="true"
        />
      </span>
      <span className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-1.5 text-left text-subtle-foreground/80">
        <span className="min-w-0 truncate">
          <span>{displayName}</span>
        </span>
        <SidebarChildToggleChevron
          isCollapsed={isCollapsed}
          expandLabel={`Expand ${displayName} threads`}
          collapseLabel={`Collapse ${displayName} threads`}
          onToggle={() => onToggleCollapsed(environmentId)}
          revealOnHover
        />
      </span>
      <span
        className={cn(
          "relative z-10 shrink-0",
          COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
        )}
      >
        {showRollupGlyph ? (
          <span
            data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
            className={cn(
              SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
              "pointer-events-none absolute inset-0 flex items-center justify-end text-subtle-foreground",
            )}
          >
            <CollapsedThreadStatusGlyph activity={childActivity} />
          </span>
        ) : null}
        <div
          data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
          className={cn(
            SIDEBAR_HOVER_ACTIONS_CLASS,
            "absolute inset-0 flex items-center justify-end",
          )}
        >
          <EnvironmentThreadGroupHeaderActions
            archiveThreadsPending={archiveThreadsPending}
            onArchiveThreads={onArchiveThreads}
            onCreateNewThread={onCreateNewThread}
            onRenameEnvironment={onRenameEnvironment}
            onOpenChange={setIsActionsOpen}
          />
        </div>
      </span>
    </>
  );

  if (stickyLevel !== undefined) {
    return (
      <SidebarStickyTier
        tier="parent"
        level={stickyLevel}
        className={className}
        style={style}
      >
        {content}
      </SidebarStickyTier>
    );
  }

  return (
    <div className={className} style={style}>
      {content}
    </div>
  );
}

const EnvironmentThreadGroupRow = memo(function EnvironmentThreadGroupRow({
  projectId,
  environmentThreadGroup,
  depthOffset,
  selectedThreadId,
  isCollapsed,
  variant,
  onProjectSelect,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
}: EnvironmentThreadGroupRowProps) {
  const { environmentId, nodes, stats } = environmentThreadGroup;
  const representativeNode = nodes[0];
  const representativeThread = representativeNode.thread;
  const nodeDepth = representativeNode.depth;
  const rowDepth = getThreadRowDepth({
    depthOffset,
    nodeDepth,
    variant,
  });
  const parentLineDepth =
    nodeDepth > 0
      ? getThreadRowDepth({
          depthOffset,
          nodeDepth: nodeDepth - 1,
          variant,
        })
      : undefined;
  const createThreadInWorktree = useCreateThreadInWorktree({
    projectId,
    environmentId,
  });
  const threads = useMemo(() => nodes.map((node) => node.thread), [nodes]);
  const { archiveThreadsPending, onArchiveThreads } =
    useArchiveEnvironmentThreadGroupAction({
      environmentId,
      projectId,
      selectedThreadId,
      threads,
    });
  const handleCreateNewThread = useCallback(() => {
    onProjectSelect?.();
    createThreadInWorktree();
  }, [createThreadInWorktree, onProjectSelect]);
  const {
    onRenameDialogOpenChange,
    onRenameEnvironment,
    onSubmitRenameEnvironment,
    renameDialogTarget,
    renameEnvironmentErrorMessage,
    renameEnvironmentPending,
  } = useEnvironmentThreadGroupRenameAction({
    environmentId,
    representativeThread,
  });
  // One environment group can hold hundreds of threads, so its node list
  // windows like every other sibling list (#1261 review follow-up).
  const nodeItems = useMemo<ProjectThreadItem[]>(
    () => nodes.map((node) => ({ kind: "thread", node })),
    [nodes],
  );
  const { itemKeys, estimateRows, getNavigationEntries, alwaysMountedKeys } =
    useWindowedThreadItems({
      items: nodeItems,
      collapsedThreadIds,
      collapsedEnvironmentIds,
      selectedThreadId,
    });

  return (
    <>
      <SidebarStickyGroup className="space-y-0.5">
        <EnvironmentThreadGroupHeader
          environmentId={environmentId}
          representativeThread={representativeThread}
          rowDepth={rowDepth}
          stickyLevel={getThreadNodeStickyLevel({
            depthOffset,
            node: representativeNode,
          })}
          parentLineDepth={parentLineDepth}
          childActivity={stats.childActivity}
          isCollapsed={isCollapsed}
          archiveThreadsPending={archiveThreadsPending}
          onArchiveThreads={onArchiveThreads}
          onCreateNewThread={handleCreateNewThread}
          onRenameEnvironment={onRenameEnvironment}
          onToggleCollapsed={onToggleEnvironmentCollapsed}
        />
        {!isCollapsed ? (
          <div className="relative space-y-px">
            <ThreadTreeGroupLine parentRowDepth={rowDepth} />
            <SidebarWindowedItems
              itemKeys={itemKeys}
              estimateRows={estimateRows}
              getNavigationEntries={getNavigationEntries}
              alwaysMountedKeys={alwaysMountedKeys}
              renderItem={(index) => {
                const node = nodes[index];
                if (!node) {
                  return null;
                }
                return (
                  <ThreadTreeNodeRow
                    key={node.thread.id}
                    projectId={projectId}
                    node={node}
                    depthOffset={depthOffset + 1}
                    isEnvGrouped
                    selectedThreadId={selectedThreadId}
                    collapsedThreadIds={collapsedThreadIds}
                    collapsedEnvironmentIds={collapsedEnvironmentIds}
                    variant={variant}
                    onProjectSelect={onProjectSelect}
                    onToggleThreadCollapsed={onToggleThreadCollapsed}
                    onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
                  />
                );
              }}
            />
          </div>
        ) : null}
      </SidebarStickyGroup>
      <EnvironmentRenameDialog
        errorMessage={renameEnvironmentErrorMessage}
        target={renameDialogTarget}
        pending={renameEnvironmentPending}
        onOpenChange={onRenameDialogOpenChange}
        onRename={onSubmitRenameEnvironment}
      />
    </>
  );
});

const ThreadTreeItemRow = memo(function ThreadTreeItemRow({
  projectId,
  item,
  depthOffset,
  selectedThreadId,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  variant,
  onProjectSelect,
  onCreateThreadInSection,
  onRenameSection,
  onRemoveSection,
  renderTopLevelSectionHeaderActions,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
  consumeClickSuppression,
  dragBindings,
  isDropTargetActive,
  sectionDnd,
  sortableRef,
  sortableStyle,
}: ThreadTreeItemRowProps) {
  if (item.kind === "section") {
    return (
      <SectionTreeItemRow
        section={item.group}
        depthOffset={depthOffset}
        selectedThreadId={selectedThreadId}
        collapsedThreadIds={collapsedThreadIds}
        collapsedEnvironmentIds={collapsedEnvironmentIds}
        variant={variant}
        onProjectSelect={onProjectSelect}
        onCreateThreadInSection={onCreateThreadInSection}
        onRenameSection={onRenameSection}
        onRemoveSection={onRemoveSection}
        renderTopLevelSectionHeaderActions={renderTopLevelSectionHeaderActions}
        onToggleThreadCollapsed={onToggleThreadCollapsed}
        onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
        consumeClickSuppression={consumeClickSuppression}
        dragBindings={dragBindings}
        isDropTargetActive={isDropTargetActive}
        sectionDnd={sectionDnd}
        sortableRef={sortableRef}
        sortableStyle={sortableStyle}
      />
    );
  }

  if (item.kind === "thread") {
    return (
      <ThreadTreeNodeRow
        projectId={projectId}
        node={item.node}
        depthOffset={depthOffset}
        isEnvGrouped={false}
        selectedThreadId={selectedThreadId}
        collapsedThreadIds={collapsedThreadIds}
        collapsedEnvironmentIds={collapsedEnvironmentIds}
        variant={variant}
        onProjectSelect={onProjectSelect}
        onToggleThreadCollapsed={onToggleThreadCollapsed}
        onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
        consumeClickSuppression={consumeClickSuppression}
        dragBindings={dragBindings}
        sortableRef={sortableRef}
        sortableStyle={sortableStyle}
      />
    );
  }

  return (
    <EnvironmentThreadGroupRow
      projectId={projectId}
      environmentThreadGroup={item.group}
      depthOffset={depthOffset}
      selectedThreadId={selectedThreadId}
      isCollapsed={collapsedEnvironmentIds.has(item.group.environmentId)}
      collapsedThreadIds={collapsedThreadIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      variant={variant}
      onProjectSelect={onProjectSelect}
      onToggleThreadCollapsed={onToggleThreadCollapsed}
      onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
    />
  );
});

// A derived section and its (recursively rendered) contents. Collapse state lives
// in sidebarCollapsedThreadSectionsAtom — read here rather than threaded so the rest of
// the tree's prop wiring and memo equality stay untouched. Children render one
// depth deeper.
// Empty drop-slot rendered inside the (auto-expanded) hovered section so the
// landing spot is visible. The dragged row itself carries the title (like
// dragging a queued message), so this placeholder stays intentionally blank.
export function DropPreviewRow({
  depth,
  visible = true,
}: {
  depth: number;
  visible?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      data-sidebar-section-drop-preview="true"
      data-visible={visible ? "true" : "false"}
      style={{
        paddingLeft: getSidebarThreadRowPaddingLeft(depth),
        // `space-y-px` supplies the normal row gap once visible. Suppress it
        // while collapsed so every target owns a truly zero-height slot.
        marginTop: visible ? undefined : 0,
      }}
      className={cn(
        SIDEBAR_ROW_BASE_CLASS,
        "pointer-events-none overflow-hidden transition-[height,margin,opacity,border-width] duration-150 ease-out",
        visible
          ? cn(
              COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
              "border border-dashed border-sidebar-border bg-sidebar-accent/40 opacity-100",
            )
          : "h-0 border-0 opacity-0 max-md:pointer-coarse:h-0",
      )}
    />
  );
}

function SectionThreadDragOverlay({ thread }: { thread: ThreadListEntry }) {
  return (
    <div
      aria-hidden="true"
      data-sidebar-section-drag-overlay="true"
      style={{ paddingLeft: getSidebarThreadRowPaddingLeft(0) }}
      className={cn(
        SIDEBAR_ROW_BASE_CLASS,
        COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
        "pointer-events-none bg-sidebar-accent text-sidebar-accent-foreground shadow-sm ring-1 ring-sidebar-border",
      )}
    >
      <span className="min-w-0 flex-1 truncate">
        {getThreadDisplayTitle(thread)}
      </span>
    </div>
  );
}

const SectionTreeItemRow = memo(function SectionTreeItemRow({
  section,
  depthOffset,
  selectedThreadId,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  variant,
  onProjectSelect,
  onCreateThreadInSection,
  onRenameSection,
  onRemoveSection,
  renderTopLevelSectionHeaderActions,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
  consumeClickSuppression,
  dragBindings,
  isDropTargetActive = false,
  sectionDnd,
  sortableRef,
  sortableStyle,
}: SectionTreeItemRowProps) {
  const [isTopLevelActionsOpen, setIsTopLevelActionsOpen] = useState(false);
  const collapsedSections = useAtomValue(sidebarCollapsedThreadSectionsAtom);
  const setCollapsedSections = useSetAtom(sidebarCollapsedThreadSectionsAtom);
  const sectionKey = section.key;
  const isCollapsed = collapsedSections.includes(sectionKey);
  const handleToggleCollapsed = useCallback(() => {
    setCollapsedSections((current) =>
      current.includes(sectionKey)
        ? current.filter((key) => key !== sectionKey)
        : [...current, sectionKey],
    );
  }, [sectionKey, setCollapsedSections]);

  const headerDepth = getThreadRowDepth({ depthOffset, nodeDepth: 0, variant });
  const stickyLevel =
    depthOffset < SIDEBAR_STICKY_PARENT_DEPTH_CAP ? depthOffset : undefined;
  const showDropPreview = sectionDnd?.dragOverParentKey === sectionKey;
  const showChildren = !isCollapsed && section.items.length > 0;
  // Force the children area open while a thread drag is active so the empty
  // drop-placeholder row is visible even when the section is empty. During a
  // drag the collapsed preview slot stays mounted in every expanded drop
  // target so its height transition can run in both directions as the pointer
  // crosses sections; outside a drag the area unmounts entirely, so an empty
  // expanded section adds no height (mounting it added the wrapper's margin).
  const showChildrenArea =
    showChildren || (sectionDnd?.activeThread != null && !isCollapsed);
  const sectionThreads = useMemo(
    () => getProjectThreadItemDescendants(section.items),
    [section.items],
  );
  const { itemKeys, estimateRows, getNavigationEntries, alwaysMountedKeys } =
    useWindowedThreadItems({
      items: section.items,
      collapsedThreadIds,
      collapsedEnvironmentIds,
      selectedThreadId,
    });

  const childrenArea = showChildrenArea ? (
    <div className="relative space-y-px">
      {variant === "project" || depthOffset > 0 ? (
        <ThreadTreeGroupLine parentRowDepth={headerDepth} />
      ) : null}
      {showChildren ? (
        <SectionDndSortableList sectionDnd={sectionDnd} parentKey={section.key}>
          <SidebarWindowedItems
            itemKeys={itemKeys}
            estimateRows={estimateRows}
            getNavigationEntries={getNavigationEntries}
            alwaysMountedKeys={alwaysMountedKeys}
            renderItem={(index) => {
              const item = section.items[index];
              if (!item) {
                return null;
              }
              return (
                <SectionDndItemRow
                  key={getItemKey(item)}
                  projectId={getItemProjectId(item)}
                  item={item}
                  depthOffset={
                    variant === "section" && depthOffset === 0
                      ? 0
                      : depthOffset + 1
                  }
                  selectedThreadId={selectedThreadId}
                  collapsedThreadIds={collapsedThreadIds}
                  collapsedEnvironmentIds={collapsedEnvironmentIds}
                  variant={variant}
                  onProjectSelect={onProjectSelect}
                  onCreateThreadInSection={onCreateThreadInSection}
                  onRenameSection={onRenameSection}
                  onRemoveSection={onRemoveSection}
                  onToggleThreadCollapsed={onToggleThreadCollapsed}
                  onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
                  sectionDnd={sectionDnd}
                />
              );
            }}
          />
        </SectionDndSortableList>
      ) : null}
      {sectionDnd ? (
        <DropPreviewRow
          visible={showDropPreview}
          depth={getThreadRowDepth({
            depthOffset:
              variant === "section" && depthOffset === 0 ? 0 : depthOffset + 1,
            nodeDepth: 0,
            variant,
          })}
        />
      ) : null}
    </div>
  ) : null;

  if (variant === "section" && depthOffset === 0) {
    const externalHeaderActions = renderTopLevelSectionHeaderActions?.(section);
    const hasMenuActions = Boolean(onRenameSection || onRemoveSection);
    const hasTopLevelActions = Boolean(
      externalHeaderActions?.actions ||
      hasMenuActions ||
      onCreateThreadInSection,
    );
    const topLevelActionsOpen =
      isTopLevelActionsOpen || externalHeaderActions?.actionsOpen === true;
    const topLevelActionControls = (
      <>
        {externalHeaderActions?.actions}
        {hasMenuActions ? (
          <DropdownMenu onOpenChange={setIsTopLevelActionsOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`${section.name} section actions`}
                className={cn(
                  "rounded-md p-0 text-subtle-foreground hover:bg-transparent hover:text-foreground",
                  SIDEBAR_MORE_ACTION_TRIGGER_CLASS,
                )}
              >
                <Icon
                  name="MoreHorizontal"
                  className={COARSE_POINTER_ICON_SIZE_CLASS}
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onRenameSection ? (
                <DropdownMenuItem onSelect={() => onRenameSection(section)}>
                  <Icon name="Edit" aria-hidden="true" />
                  Rename
                </DropdownMenuItem>
              ) : null}
              {onRemoveSection ? (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => onRemoveSection(section)}
                >
                  <Icon name="Trash2" aria-hidden="true" />
                  Remove
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {onCreateThreadInSection ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`New thread in ${section.name}`}
            onClick={() => onCreateThreadInSection(section.id)}
            className={cn(
              "rounded-md p-0 text-subtle-foreground hover:bg-transparent hover:text-foreground",
              COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
            )}
          >
            <Icon
              name="MessageSquarePlus"
              className={COARSE_POINTER_ICON_SIZE_CLASS}
            />
          </Button>
        ) : null}
      </>
    );
    const topLevelActions = hasTopLevelActions ? (
      <span
        data-sidebar-hover-actions-open={
          topLevelActionsOpen ? "true" : undefined
        }
        data-sidebar-hover-actions-mobile={
          SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE
        }
        className={cn(
          SIDEBAR_HOVER_ACTIONS_CLASS,
          "relative z-10 inline-flex shrink-0 items-center",
          SIDEBAR_HOVER_ACTIONS_GAP_CLASS,
        )}
      >
        {topLevelActionControls}
      </span>
    ) : null;

    return (
      <TopLevelSidebarSection
        label={section.name}
        sectionId={section.id}
        actions={topLevelActions}
        actionsAlwaysVisible
        actionsOpen={topLevelActionsOpen}
        actionsMobileAlways
        collapseControl={{
          isCollapsed,
          onToggleCollapsed: handleToggleCollapsed,
        }}
        collapsedActivity={section.activity}
        collapsedThreads={sectionThreads}
        consumeClickSuppression={consumeClickSuppression}
        dragBindings={dragBindings}
        isDropTargetActive={isDropTargetActive}
        sectionRef={sortableRef}
        sectionStyle={sortableStyle}
      >
        {childrenArea}
      </TopLevelSidebarSection>
    );
  }

  return (
    <SidebarStickyGroup
      ref={sortableRef}
      style={sortableStyle}
      data-sidebar-section-id={section.id}
      className={cn(
        "space-y-0.5 rounded-md transition-colors",
        isDropTargetActive &&
          "[&_.bb-sidebar-hover-actions-row]:!bg-sidebar-accent [&_.bb-sidebar-hover-actions-row]:!text-sidebar-accent-foreground",
      )}
    >
      <SidebarSectionRow
        name={section.name}
        label={section.name}
        depth={headerDepth}
        activity={section.activity}
        collapsedThreads={sectionThreads}
        consumeClickSuppression={consumeClickSuppression}
        dragBindings={dragBindings}
        isDropTargetActive={isDropTargetActive}
        isCollapsed={isCollapsed}
        onCreateThread={
          onCreateThreadInSection
            ? () => onCreateThreadInSection(section.id)
            : undefined
        }
        onRename={onRenameSection ? () => onRenameSection(section) : undefined}
        onRemove={onRemoveSection ? () => onRemoveSection(section) : undefined}
        onToggleCollapsed={handleToggleCollapsed}
        stickyLevel={stickyLevel}
      />
      {childrenArea}
    </SidebarStickyGroup>
  );
});

export const ThreadTreeNodeRow = memo(function ThreadTreeNodeRow({
  projectId,
  node,
  depthOffset,
  isEnvGrouped,
  selectedThreadId,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  variant,
  onProjectSelect,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
  consumeClickSuppression,
  dragBindings,
  sortableRef,
  sortableStyle,
}: ThreadTreeNodeRowProps) {
  const isCollapsed = collapsedThreadIds.has(node.thread.id);
  const hasChildren = node.children.length > 0;
  const isParent = hasChildren;
  const parentRowDepth = getThreadRowDepth({
    depthOffset,
    nodeDepth: node.depth,
    variant,
  });
  const options = useMemo<ThreadRowOptions>(
    () =>
      getThreadRowOptions({
        childActivity: node.stats.childActivity,
        childCount: node.stats.childCount,
        consumeClickSuppression,
        dragBindings,
        depthOffset,
        isCollapsed,
        isEnvGrouped,
        isParent,
        nodeDepth: node.depth,
        onToggleThreadCollapsed,
        stickyLevel: hasChildren
          ? getThreadNodeStickyLevel({ depthOffset, node })
          : undefined,
        variant,
      }),
    [
      consumeClickSuppression,
      depthOffset,
      dragBindings,
      isCollapsed,
      isEnvGrouped,
      isParent,
      hasChildren,
      node,
      onToggleThreadCollapsed,
      variant,
    ],
  );
  const showChildren = !isCollapsed && hasChildren;
  // Route and draft keys always use the thread's own project; a child may live
  // in a different project than the parent it nests under.
  const rowProjectId = node.thread.projectId;
  const crossProjectId = rowProjectId !== projectId ? rowProjectId : null;
  const hasComposerDraft = usePromptDraftHasInput({
    kind: "thread",
    projectId: rowProjectId,
    threadId: node.thread.id,
  });
  // A parent thread can hold a long child list, so it windows like every
  // other sibling list (#1261 review follow-up).
  const { itemKeys, estimateRows, getNavigationEntries, alwaysMountedKeys } =
    useWindowedThreadItems({
      items: node.children,
      collapsedThreadIds,
      collapsedEnvironmentIds,
      selectedThreadId,
    });
  const row = (
    <ThreadRow
      projectId={rowProjectId}
      thread={node.thread}
      crossProjectId={crossProjectId}
      isActive={selectedThreadId === node.thread.id}
      hasComposerDraft={hasComposerDraft}
      onProjectSelect={onProjectSelect}
      options={options}
    />
  );

  if (!hasChildren && !sortableRef) {
    return row;
  }

  return (
    <SidebarStickyGroup
      ref={sortableRef}
      style={sortableStyle}
      className="space-y-0.5"
    >
      {row}
      {showChildren ? (
        <div className="relative space-y-px">
          <ThreadTreeGroupLine parentRowDepth={parentRowDepth} />
          <SidebarWindowedItems
            itemKeys={itemKeys}
            estimateRows={estimateRows}
            getNavigationEntries={getNavigationEntries}
            alwaysMountedKeys={alwaysMountedKeys}
            renderItem={(index) => {
              const item = node.children[index];
              if (!item) {
                return null;
              }
              return (
                <ThreadTreeItemRow
                  key={getItemKey(item)}
                  projectId={rowProjectId}
                  item={item}
                  depthOffset={depthOffset}
                  selectedThreadId={selectedThreadId}
                  collapsedThreadIds={collapsedThreadIds}
                  collapsedEnvironmentIds={collapsedEnvironmentIds}
                  variant={variant}
                  onProjectSelect={onProjectSelect}
                  onToggleThreadCollapsed={onToggleThreadCollapsed}
                  onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
                />
              );
            }}
          />
        </div>
      ) : null}
    </SidebarStickyGroup>
  );
});

function ThreadTreeLoadingSkeleton() {
  return (
    <div className="group-data-[collapsible=icon]:hidden">
      <SidebarMenuSkeleton />
    </div>
  );
}

interface SectionThreadTreeItemsProps {
  items: readonly ProjectThreadItem[];
  sectionDnd: SectionThreadDndState | null;
  variant: ProjectThreadTreeVariant;
  // Route every row to this project; omit to derive each row's project from its
  // own thread (the cross-project Sections view).
  projectId?: string;
  depthOffset?: number;
  // Wrap the rows in a SortableContext for this parent. Omit when an outer
  // SortableList already provides the context (the split Sections/Threads view).
  sortableParentKey?: string;
  selectedThreadId?: string;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  onProjectSelect?: () => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  onCreateThreadInSection?: (sectionId: string) => void;
  onRenameSection?: (section: SidebarSectionDefinition) => void;
  onRemoveSection?: (section: SidebarSectionDefinition) => void;
  renderTopLevelSectionHeaderActions?: SectionThreadTreeProps["renderTopLevelSectionHeaderActions"];
}

// Windowing inputs shared by every list of ProjectThreadItems: stable keys,
// a placeholder row-count estimate, and the item holding the active thread
// (kept mounted so DOM-driven keyboard navigation keeps its anchor).
function useWindowedThreadItems({
  items,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  selectedThreadId,
}: {
  items: readonly ProjectThreadItem[];
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  selectedThreadId?: string;
}) {
  const collapsedSectionKeyList = useAtomValue(
    sidebarCollapsedThreadSectionsAtom,
  );
  const itemKeys = useMemo(() => items.map(getItemKey), [items]);
  const rowCountContext = useMemo<ProjectThreadItemRowCountContext>(
    () => ({
      collapsedThreadIds,
      collapsedEnvironmentIds,
      collapsedSectionKeys: new Set(collapsedSectionKeyList),
    }),
    [collapsedThreadIds, collapsedEnvironmentIds, collapsedSectionKeyList],
  );
  const estimateRows = useCallback(
    (index: number) => {
      const item = items[index];
      return item ? countProjectThreadItemRows(item, rowCountContext) : 1;
    },
    [items, rowCountContext],
  );
  const getNavigationEntries = useCallback(
    (index: number) => {
      const item = items[index];
      return item
        ? collectProjectThreadItemNavigationEntries(item, rowCountContext)
        : [];
    },
    [items, rowCountContext],
  );
  const alwaysMountedKeys = useMemo(() => {
    if (!selectedThreadId) {
      return undefined;
    }
    const activeItem = items.find((item) =>
      projectThreadItemContainsThread(item, selectedThreadId),
    );
    return activeItem ? new Set([getItemKey(activeItem)]) : undefined;
  }, [items, selectedThreadId]);
  return { itemKeys, estimateRows, getNavigationEntries, alwaysMountedKeys };
}

// The one place that maps thread-tree items to rows. Every sidebar view
// (project, chronological, sections) renders through this, so a row-prop
// change lands once instead of being copied across each view's renderer.
function SectionThreadTreeItems({
  items,
  sectionDnd,
  variant,
  projectId,
  depthOffset = 0,
  sortableParentKey,
  selectedThreadId,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  onProjectSelect,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
  onCreateThreadInSection,
  onRenameSection,
  onRemoveSection,
  renderTopLevelSectionHeaderActions,
}: SectionThreadTreeItemsProps) {
  const { itemKeys, estimateRows, getNavigationEntries, alwaysMountedKeys } =
    useWindowedThreadItems({
      items,
      collapsedThreadIds,
      collapsedEnvironmentIds,
      selectedThreadId,
    });
  const rows = (
    <SidebarWindowedItems
      itemKeys={itemKeys}
      estimateRows={estimateRows}
      getNavigationEntries={getNavigationEntries}
      alwaysMountedKeys={alwaysMountedKeys}
      renderItem={(index) => {
        const item = items[index];
        if (!item) {
          return null;
        }
        return (
          <SectionDndItemRow
            key={getItemKey(item)}
            projectId={projectId ?? getItemProjectId(item)}
            item={item}
            depthOffset={depthOffset}
            selectedThreadId={selectedThreadId}
            collapsedThreadIds={collapsedThreadIds}
            collapsedEnvironmentIds={collapsedEnvironmentIds}
            variant={variant}
            onProjectSelect={onProjectSelect}
            onToggleThreadCollapsed={onToggleThreadCollapsed}
            onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
            onCreateThreadInSection={onCreateThreadInSection}
            onRenameSection={onRenameSection}
            onRemoveSection={onRemoveSection}
            renderTopLevelSectionHeaderActions={
              renderTopLevelSectionHeaderActions
            }
            sectionDnd={sectionDnd ?? undefined}
          />
        );
      }}
    />
  );

  return (
    <ProjectThreadTreeGroup
      variant={variant}
      onClickCapture={sectionDnd?.onClickCapture}
    >
      {sortableParentKey !== undefined ? (
        <SectionDndSortableList
          sectionDnd={sectionDnd}
          parentKey={sortableParentKey}
        >
          {rows}
        </SectionDndSortableList>
      ) : (
        rows
      )}
    </ProjectThreadTreeGroup>
  );
}

export const ProjectThreadTree = memo(function ProjectThreadTree({
  projectId,
  threadListState,
  compareThreads,
  selectedThreadId,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  variant,
  onProjectSelect,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
}: ProjectThreadTreeProps) {
  const projectThreads =
    threadListState.status === "ready"
      ? threadListState.threads
      : EMPTY_PROJECT_THREADS;
  const draftThreadIds = usePromptDraftInputThreadIds(projectThreads);
  const rootItems = useMemo(
    () =>
      buildProjectThreadGroups(projectThreads, compareThreads, draftThreadIds),
    [compareThreads, draftThreadIds, projectThreads],
  );

  if (threadListState.status === "loading") {
    return <ThreadTreeLoadingSkeleton />;
  }

  if (rootItems.length === 0) {
    const emptyState = (
      <EmptyState
        message={
          threadListState.status === "unavailable"
            ? "Threads unavailable"
            : "No threads"
        }
        icon={getProjectThreadTreeEmptyStateIcon(variant)}
        className={getProjectThreadTreeEmptyStateClassName(variant)}
        iconClassName="size-3.5 text-subtle-foreground/50"
        messageClassName={getProjectThreadTreeEmptyStateMessageClassName()}
      />
    );

    if (variant === "section") {
      return emptyState;
    }

    return (
      <ProjectThreadTreeGroup variant={variant}>
        {emptyState}
      </ProjectThreadTreeGroup>
    );
  }

  // Per-project trees never contain section items or enable section drag-and-drop;
  // sections live only in the cross-project Sections view below.
  return (
    <SectionThreadTreeItems
      items={rootItems}
      sectionDnd={null}
      variant={variant}
      projectId={projectId}
      sortableParentKey={projectId}
      selectedThreadId={selectedThreadId}
      collapsedThreadIds={collapsedThreadIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      onProjectSelect={onProjectSelect}
      onToggleThreadCollapsed={onToggleThreadCollapsed}
      onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
    />
  );
});

export const ChronologicalSectionThreadSections = memo(
  function ChronologicalSectionThreadSections({
    threadListState,
    compareThreads,
    sections = EMPTY_THREAD_SECTIONS,
    selectedThreadId,
    collapsedThreadIds,
    collapsedEnvironmentIds,
    onProjectSelect,
    onCreateThreadInSection,
    onRenameSection,
    onRemoveSection,
    renderTopLevelSectionHeaderActions,
    onToggleThreadCollapsed,
    onToggleEnvironmentCollapsed,
    builtInSections,
    topLevelSectionOrder,
    onTopLevelSectionOrderChange,
    pinnedReorderPending,
    pinnedThreads,
    onReorderPinnedThread,
    renderPinnedSection,
    renderThreadsSection,
  }: ChronologicalSectionThreadSectionsProps) {
    const threads =
      threadListState.status === "ready"
        ? threadListState.threads
        : EMPTY_PROJECT_THREADS;
    const draftThreadIds = usePromptDraftInputThreadIds(threads);
    const rootItems = useMemo(
      () =>
        buildSectionThreadList(
          threads,
          compareThreads,
          sections,
          draftThreadIds,
        ),
      [threads, compareThreads, sections, draftThreadIds],
    );
    const persistedSectionItems = rootItems.filter(
      (item) => item.kind === "section",
    );
    const sectionDnd = useSectionThreadDnd({
      containerId: CHRONOLOGICAL_CONTAINER_ID,
      enabled:
        topLevelSectionOrder.length > 1 || persistedSectionItems.length > 0,
      rootItems,
      topLevelSectionOrder,
      onTopLevelSectionOrderChange,
      pinnedReorderPending,
      pinnedThreads,
      onReorderPinnedThread,
    });
    const renderedRootItems = useMemo(() => {
      const activeThread = sectionDnd?.activeThread;
      const projectedSectionId = sectionDnd?.projectedSectionId;
      if (!activeThread || projectedSectionId === undefined) {
        return rootItems;
      }

      const hasProjectedThread = threads.some(
        (thread) => thread.id === activeThread.id,
      );
      return buildSectionThreadList(
        hasProjectedThread
          ? threads.map((thread) =>
              thread.id === activeThread.id
                ? { ...thread, sectionId: projectedSectionId }
                : thread,
            )
          : [...threads, { ...activeThread, sectionId: projectedSectionId }],
        compareThreads,
        sections,
        draftThreadIds,
      );
    }, [
      compareThreads,
      draftThreadIds,
      sectionDnd,
      sections,
      rootItems,
      threads,
    ]);
    const renderedSectionDnd = useMemo<SectionThreadDndState | null>(() => {
      if (!sectionDnd) {
        return null;
      }
      const suppressPinnedDropPreview = shouldSuppressPinnedThreadDropPreview({
        activeThreadId: sectionDnd.activeThread?.id,
        dragOverParentKey: sectionDnd.dragOverParentKey,
        pinnedThreads,
      });
      if (renderedRootItems === rootItems) {
        return suppressPinnedDropPreview
          ? { ...sectionDnd, dragOverParentKey: null }
          : sectionDnd;
      }

      if (suppressPinnedDropPreview) {
        return { ...sectionDnd, dragOverParentKey: null };
      }

      const activeThreadId = sectionDnd.activeThread?.id;
      const renderedPinnedThreads = activeThreadId
        ? pinnedThreads.filter((thread) => thread.id !== activeThreadId)
        : pinnedThreads;
      const renderedLookup = collectSectionThreadDndLookup(
        renderedRootItems,
        CHRONOLOGICAL_CONTAINER_ID,
        renderedPinnedThreads,
      );
      return {
        ...sectionDnd,
        // The projected thread row is the landing slot now. Suppress the old
        // blank preview and give every SortableContext the projected parent
        // membership so dnd-kit can measure the real destination row.
        dragOverParentKey: null,
        itemIdsByParentKey: renderedLookup.itemIdsByParentKey,
        pinnedItemIds:
          renderedLookup.itemIdsByParentKey.get(PINNED_THREAD_PARENT_KEY) ?? [],
      };
    }, [sectionDnd, pinnedThreads, renderedRootItems, rootItems]);
    const sectionItems = renderedRootItems.filter(
      (item) => item.kind === "section",
    );
    const looseItems = renderedRootItems.filter(
      (item) => item.kind !== "section",
    );
    const looseThreads = getProjectThreadItemDescendants(looseItems);

    // No sortableParentKey: the outer SectionDndSortableList below provides the
    // SortableContext spanning both the sections and loose-threads sections.
    const renderItems = (items: readonly ProjectThreadItem[]) => (
      <SectionThreadTreeItems
        items={items}
        sectionDnd={renderedSectionDnd}
        variant="section"
        selectedThreadId={selectedThreadId}
        collapsedThreadIds={collapsedThreadIds}
        collapsedEnvironmentIds={collapsedEnvironmentIds}
        onProjectSelect={onProjectSelect}
        onToggleThreadCollapsed={onToggleThreadCollapsed}
        onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
        onCreateThreadInSection={onCreateThreadInSection}
        onRenameSection={onRenameSection}
        onRemoveSection={onRemoveSection}
        renderTopLevelSectionHeaderActions={renderTopLevelSectionHeaderActions}
      />
    );

    // A thread dragged out of a section previews its landing in the loose list
    // with the same inserted placeholder sections use (hiding the empty state so
    // the placeholder reads as the drop slot when the loose list is empty).
    const showLoosePreview =
      renderedSectionDnd?.dragOverParentKey === CHRONOLOGICAL_CONTAINER_ID;
    const looseEmptyState = (
      <EmptyState
        message={
          threadListState.status === "unavailable"
            ? "Threads unavailable"
            : "No threads"
        }
        icon={getProjectThreadTreeEmptyStateIcon("section")}
        className={getProjectThreadTreeEmptyStateClassName("section")}
        iconClassName="size-3.5 text-subtle-foreground/50"
        messageClassName={getProjectThreadTreeEmptyStateMessageClassName()}
      />
    );
    const threadsListContent =
      threadListState.status === "loading" ? (
        <ThreadTreeLoadingSkeleton />
      ) : looseItems.length > 0 ? (
        <SortableContext
          items={looseItems.map(getSidebarDndItemId)}
          strategy={verticalListSortingStrategy}
        >
          {renderItems(looseItems)}
        </SortableContext>
      ) : renderedSectionDnd ? (
        <div className="grid">
          <div
            className={cn(
              "col-start-1 row-start-1 transition-opacity duration-150 ease-out",
              showLoosePreview ? "opacity-0" : "opacity-100",
            )}
          >
            {looseEmptyState}
          </div>
          <div className="col-start-1 row-start-1">
            <DropPreviewRow depth={0} visible={showLoosePreview} />
          </div>
        </div>
      ) : (
        looseEmptyState
      );
    const threadsContent = renderedSectionDnd ? (
      <SectionDndDroppableParent
        sectionDnd={renderedSectionDnd}
        parentKey={CHRONOLOGICAL_CONTAINER_ID}
      >
        {threadsListContent}
        {looseItems.length > 0 ? (
          <DropPreviewRow
            visible={showLoosePreview}
            depth={getThreadRowDepth({
              depthOffset: 0,
              nodeDepth: 0,
              variant: "section",
            })}
          />
        ) : null}
      </SectionDndDroppableParent>
    ) : (
      threadsListContent
    );

    const sectionItemsBySectionId = new Map(
      sectionItems.map((item) => [
        buildSidebarEntitySectionId("section", item.group.id),
        item,
      ]),
    );
    const consumeClickSuppression = renderedSectionDnd?.consumeClickSuppression;
    const configuredBuiltInSections:
      | BuiltInSidebarSectionOptionsById
      | undefined = builtInSections
      ? {
          pinned: {
            ...builtInSections.pinned,
            isDropTargetActive:
              renderedSectionDnd?.dragOverParentKey ===
              PINNED_THREAD_PARENT_KEY,
          },
          threads: {
            ...builtInSections.threads,
            activity: getCollapsedChildActivity(looseThreads, draftThreadIds),
            collapsedThreads: looseThreads,
            content: threadsContent,
          },
        }
      : undefined;
    const legacyBuiltInSectionNodes: BuiltInSidebarSectionNodes = {
      pinned: renderPinnedSection?.(consumeClickSuppression),
      threads: renderThreadsSection?.(threadsContent, consumeClickSuppression),
    };
    const orderedSections = (
      <SidebarSectionOrderList order={topLevelSectionOrder}>
        {(sectionId) => {
          const builtInSection =
            builtInSections && configuredBuiltInSections
              ? renderBuiltInSidebarSection({
                  sectionId,
                  sections: configuredBuiltInSections,
                  disabled: topLevelSectionOrder.length < 2,
                  collapsedSectionIds: builtInSections.collapsedSectionIds,
                  onToggleCollapsed: builtInSections.onToggleCollapsed,
                  consumeClickSuppression,
                  showPinnedSection: topLevelSectionOrder.includes("pinned"),
                })
              : getBuiltInSidebarSectionNode(
                  sectionId,
                  legacyBuiltInSectionNodes,
                );
          if (builtInSection !== undefined) {
            return <div key={sectionId}>{builtInSection}</div>;
          }
          const sectionItem = sectionItemsBySectionId.get(sectionId);
          return sectionItem ? (
            <div key={sectionId}>{renderItems([sectionItem])}</div>
          ) : null;
        }}
      </SidebarSectionOrderList>
    );

    return sectionDnd ? (
      <DndContext {...sectionDnd.dndContextProps}>
        <SectionThreadDndProvider value={renderedSectionDnd}>
          {orderedSections}
          {createPortal(
            // The overlay only renders thread content, so a section drag has
            // nothing to fly home and skips the drop animation entirely.
            <DragOverlay
              className="cursor-grabbing"
              dropAnimation={
                sectionDnd.activeThread
                  ? SIDEBAR_DRAG_OVERLAY_DROP_ANIMATION
                  : null
              }
            >
              {sectionDnd.activeThread ? (
                <SectionThreadDragOverlay thread={sectionDnd.activeThread} />
              ) : null}
            </DragOverlay>,
            document.body,
          )}
        </SectionThreadDndProvider>
      </DndContext>
    ) : (
      orderedSections
    );
  },
);

function ProjectRowComponent({
  project,
  threadListState,
  selectedThreadId,
  isCollapsed,
  compareThreads,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  isLocalPathInvalid,
  headerActions,
  headerActionsOpen = false,
  onProjectSelect,
  onCreateProjectThread,
  onToggleProjectCollapsed,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
  consumeProjectClickSuppression,
  projectDragBindings,
  projectRowRef,
  projectRowStyle,
}: ProjectRowProps) {
  const [isDropdownActionsOpen, setIsDropdownActionsOpen] = useState(false);
  const [isContextActionsOpen, setIsContextActionsOpen] = useState(false);
  const isActionsOpen =
    isDropdownActionsOpen || isContextActionsOpen || headerActionsOpen;
  const projectThreads = useMemo(
    () =>
      isCollapsed && threadListState.status === "ready"
        ? threadListState.threads.filter(isSidebarProjectThread)
        : EMPTY_PROJECT_THREADS,
    [isCollapsed, threadListState],
  );
  const draftThreadIds = usePromptDraftInputThreadIds(projectThreads);
  const handleProjectRowToggle = useCallback(() => {
    onToggleProjectCollapsed(project.id);
  }, [onToggleProjectCollapsed, project.id]);
  const handleCreateThread = useCallback(() => {
    onCreateProjectThread?.(project.id);
  }, [onCreateProjectThread, project.id]);
  const projectActivity = useMemo<CollapsedChildActivity>(() => {
    if (!isCollapsed || threadListState.status !== "ready") {
      return NO_COLLAPSED_CHILD_ACTIVITY;
    }
    return getCollapsedChildActivity(projectThreads, draftThreadIds);
  }, [draftThreadIds, isCollapsed, projectThreads, threadListState.status]);
  const projectActions = (
    <>
      {headerActions ? (
        <span
          data-sidebar-hover-actions-open={
            headerActionsOpen ? "true" : undefined
          }
          className={SIDEBAR_HOVER_ACTIONS_CLASS}
        >
          {headerActions}
        </span>
      ) : null}
      {isLocalPathInvalid ? (
        <NavLink
          to={getProjectSettingsRoutePath(project.id)}
          onClick={(event) => {
            event.stopPropagation();
            onProjectSelect?.();
          }}
          aria-label="Project folder not found"
          className={cn(
            "relative z-10 inline-flex shrink-0 items-center justify-center rounded-md text-destructive outline-none ring-sidebar-ring transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2",
            COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
          )}
        >
          <Icon
            name="AlertTriangle"
            className={COARSE_POINTER_ICON_SIZE_CLASS}
          />
        </NavLink>
      ) : null}
      <span className="relative z-10 inline-flex shrink-0 items-center">
        <span
          data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
          data-sidebar-hover-actions-mobile={
            SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE
          }
          className={cn(
            SIDEBAR_HOVER_ACTIONS_CLASS,
            "relative z-10 inline-flex shrink-0 items-center",
            SIDEBAR_HOVER_ACTIONS_GAP_CLASS,
          )}
        >
          <ProjectActionsMenu
            project={project}
            onOpenChange={setIsDropdownActionsOpen}
            triggerClassName={cn(
              "relative z-10 text-subtle-foreground hover:bg-transparent hover:text-foreground",
              SIDEBAR_MORE_ACTION_TRIGGER_CLASS,
            )}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`New thread in ${project.name}`}
            disabled={!onCreateProjectThread}
            onClick={(event) => {
              event.stopPropagation();
              handleCreateThread();
            }}
            className={cn(
              "rounded-md p-0 text-subtle-foreground hover:bg-transparent hover:text-foreground",
              COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
            )}
          >
            <Icon
              name="MessageSquarePlus"
              className={COARSE_POINTER_ICON_SIZE_CLASS}
            />
          </Button>
        </span>
      </span>
    </>
  );

  return (
    <ProjectActionsContextMenu
      project={project}
      onOpenChange={setIsContextActionsOpen}
    >
      <div
        data-sidebar-sticky-project-item=""
        data-sidebar-project-id={project.id}
      >
        <TopLevelSidebarSection
          label={project.name}
          actions={projectActions}
          actionsAlwaysVisible
          actionsMobileAlways
          actionsOpen={isActionsOpen}
          collapseControl={{
            isCollapsed,
            onToggleCollapsed: handleProjectRowToggle,
          }}
          collapsedActivity={projectActivity}
          collapsedThreads={projectThreads}
          consumeClickSuppression={consumeProjectClickSuppression}
          dragBindings={projectDragBindings}
          sectionRef={projectRowRef}
          sectionStyle={projectRowStyle}
        >
          <ProjectThreadTree
            projectId={project.id}
            threadListState={threadListState}
            selectedThreadId={selectedThreadId}
            collapsedThreadIds={collapsedThreadIds}
            collapsedEnvironmentIds={collapsedEnvironmentIds}
            compareThreads={compareThreads}
            variant="section"
            onProjectSelect={onProjectSelect}
            onToggleThreadCollapsed={onToggleThreadCollapsed}
            onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
          />
        </TopLevelSidebarSection>
      </div>
    </ProjectActionsContextMenu>
  );
}

interface ProjectRowPropsComparisonArgs {
  prev: ProjectRowProps;
  next: ProjectRowProps;
}

function getThreadIdsWithChildren(
  threads: readonly ThreadListEntry[],
): Set<string> {
  const threadIds = new Set(threads.map((thread) => thread.id));
  const threadIdsWithChildren = new Set<string>();

  for (const thread of threads) {
    if (thread.parentThreadId === null) continue;
    if (!threadIds.has(thread.parentThreadId)) continue;

    threadIdsWithChildren.add(thread.parentThreadId);
  }

  return threadIdsWithChildren;
}

function hasCollapsedThreadStateChanged({
  prev,
  next,
}: ProjectRowPropsComparisonArgs): boolean {
  if (prev.collapsedThreadIds === next.collapsedThreadIds) {
    return false;
  }
  if (prev.threadListState.status !== "ready") {
    return false;
  }

  const threadIdsWithChildren = getThreadIdsWithChildren(
    prev.threadListState.threads,
  );
  for (const threadId of threadIdsWithChildren) {
    if (
      prev.collapsedThreadIds.has(threadId) !==
      next.collapsedThreadIds.has(threadId)
    ) {
      return true;
    }
  }

  return false;
}

function hasCollapsedEnvironmentStateChanged({
  prev,
  next,
}: ProjectRowPropsComparisonArgs): boolean {
  if (prev.collapsedEnvironmentIds === next.collapsedEnvironmentIds) {
    return false;
  }
  if (prev.threadListState.status !== "ready") {
    return false;
  }

  for (const thread of prev.threadListState.threads) {
    if (thread.environmentId === null) continue;
    if (
      prev.collapsedEnvironmentIds.has(thread.environmentId) !==
      next.collapsedEnvironmentIds.has(thread.environmentId)
    ) {
      return true;
    }
  }

  return false;
}

function areProjectRowPropsEqual(
  prev: ProjectRowProps,
  next: ProjectRowProps,
): boolean {
  if (
    prev.project !== next.project ||
    prev.threadListState !== next.threadListState ||
    prev.isActive !== next.isActive ||
    prev.isCollapsed !== next.isCollapsed ||
    prev.compareThreads !== next.compareThreads ||
    prev.isLocalPathInvalid !== next.isLocalPathInvalid ||
    prev.headerActions !== next.headerActions ||
    prev.headerActionsOpen !== next.headerActionsOpen ||
    prev.onProjectSelect !== next.onProjectSelect ||
    prev.onCreateProjectThread !== next.onCreateProjectThread ||
    prev.onToggleProjectCollapsed !== next.onToggleProjectCollapsed ||
    prev.onToggleThreadCollapsed !== next.onToggleThreadCollapsed ||
    prev.onToggleEnvironmentCollapsed !== next.onToggleEnvironmentCollapsed ||
    prev.consumeProjectClickSuppression !==
      next.consumeProjectClickSuppression ||
    prev.projectDragBindings !== next.projectDragBindings ||
    prev.projectRowRef !== next.projectRowRef ||
    prev.projectRowStyle !== next.projectRowStyle
  ) {
    return false;
  }
  // selectedThreadId is a shared sidebar prop; only projects containing the
  // previously- or newly-selected thread need to re-render.
  if (prev.selectedThreadId !== next.selectedThreadId) {
    if (prev.threadListState.status !== "ready") {
      return false;
    }
    for (const thread of prev.threadListState.threads) {
      if (
        thread.id === prev.selectedThreadId ||
        thread.id === next.selectedThreadId
      ) {
        return false;
      }
    }
  }
  // Collapsed row sets are shared sidebar props; only invalidate if this
  // project's parent-thread or worktree-env collapse state actually changed.
  if (prev.threadListState.status !== "ready") {
    return true;
  }
  return (
    !hasCollapsedThreadStateChanged({ prev, next }) &&
    !hasCollapsedEnvironmentStateChanged({ prev, next })
  );
}

export const ProjectRow = memo(ProjectRowComponent, areProjectRowPropsEqual);
