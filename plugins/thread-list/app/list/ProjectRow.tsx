import {
  ThreadListVisibility,
  ThreadListMore,
  ThreadListVisibilityGroupScope,
  ThreadListVisibilityMenuItems,
  type ThreadListVisibilityGroup,
} from "./ThreadListVisibility.js";
import {
  SidebarHeaderControls,
  SidebarSectionMenuItems,
} from "./SidebarHeaderControls.js";
import { SidebarRowControls, SidebarControlButton } from "../rows/SidebarRowControls.js";
import {
  SIDEBAR_CONTROL_BUTTON_CLASS,
  SIDEBAR_CONTROL_PAIR_SIZE_CLASS,
  SIDEBAR_GROUP_TEXT_CLASS,
} from "../rows/sidebarRowClasses.js";
import {
  Fragment,
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
import { useComposedRefs } from "@radix-ui/react-compose-refs";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { createPortal } from "react-dom";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { toast } from "sonner";
import {
  experimental_useSidebarThreadActions,
  useBbNavigate,
  useEnvironmentProviders,
  useSdk,
  useSidebarThreadDraftIds,
} from "@get-bb/plugin-sdk/app";
import {
  findEnvironmentDisplayProvider,
  getEnvironmentLabelIconName,
  resolveEnvironmentDisplayName,
  UNNAMED_ENVIRONMENT_LABEL,
} from "../ui/environment-workspace-display.js";
import type { SidebarProject } from "../model/use-sidebar-data.js";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "../ui/ConfirmDeleteDialog.js";
import { getMutationErrorMessage } from "../ui/mutation-errors.js";
import { useSidebarRename, useSidebarRenameState } from "../rows/SidebarInlineRename.js";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { ThreadListEmptyState } from "../ui/ThreadListEmptyState.js";
import {
  SidebarMenuSkeleton,
  SidebarStickyGroup,
  SidebarStickyTier,
} from "../ui/sidebar.js";
import {
  ProjectActionsContextMenu,
  ProjectActionsMenuItems,
} from "./ProjectActionsMenu.js";
import {
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_GLYPH_BOX_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
} from "@/components/ui/coarse-pointer-sizing";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "../ui/sidebar-hover-actions.js";
import type {
  CollapsibleSidebarSectionId,
  SidebarSectionId,
} from "../model/sidebar-section-id.js";
import {
  getCollapsedChildActivity,
  NO_COLLAPSED_CHILD_ACTIVITY,
  type CollapsedChildActivity,
} from "../model/thread-activity.js";
import { cn } from "@/lib/utils";
import {
  CollapsedThreadStatusGlyph,
  REORDER_PLACEMENT_CLASS,
  ThreadRow,
  type ThreadRowOptions,
} from "../rows/ThreadRow.js";
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
} from "../model/project-thread-groups.js";
import { buildSidebarEntitySectionId } from "../model/sidebar-section-order.js";
import { SidebarWindowedItems } from "./SidebarWindowedItems.js";
import { SidebarSectionRow } from "./SidebarSectionRow.js";
import { TopLevelSidebarSection } from "./TopLevelSidebarSection.js";
import {
  sidebarCollapsedThreadSectionsAtom,
  sidebarGroupThreadsByEnvironmentAtom,
} from "../preferences/atoms.js";
import {
  SIDEBAR_PROJECT_GROUP_LINE_CLASS,
  SIDEBAR_ROW_BASE_CLASS,
  getSidebarThreadGroupLineLeft,
  getSidebarThreadRowPaddingLeft,
} from "../rows/sidebarRowClasses.js";
import {
  resolveSectionDropTargetState,
  SectionDropTargetOverlay,
} from "../dnd/useSectionDropTargetState.js";
import {
  SIDEBAR_DRAG_OVERLAY_DROP_ANIMATION,
  useSidebarSortable,
  type SidebarSortableDragBindings,
} from "../rows/sortableMotion.js";
import type { ConsumeDragClickSuppression } from "../ui/use-drag-click-suppression.js";
import type { NeighborReorderRequest } from "../model/neighbor-reorder.js";
import { SidebarChildToggleChevron } from "../rows/SidebarChildToggleChevron.js";
import { SidebarSectionOrderList } from "./SidebarSectionOrderList.js";
import {
  useSectionThreadDnd,
  type SectionThreadDndState,
} from "../dnd/useSectionThreadDnd.js";
import {
  getSidebarThreadRowDroppableId,
  type ThreadRowNestDrop,
} from "../rows/sidebarThreadRowDroppable.js";
import { getSidebarItemKey } from "../rows/sidebarItemKeys.js";
import { useNestDropPreview } from "../dnd/useNestDropPreview.js";
import { useChronologicalSectionThreadDnd } from "../dnd/SectionThreadDndContext.js";
import {
  renderBuiltInSidebarSection,
  type BuiltInSidebarSectionOptions,
  type BuiltInSidebarSectionOptionsById,
} from "./BuiltInSidebarSection.js";
import { SectionThreadDndProvider } from "../dnd/SectionThreadDndContext.js";
import {
  useSidebarThreadDragOverlayModifiers,
  SIDEBAR_THREAD_DRAG_CHIP_CLASS,
  SIDEBAR_THREAD_DRAG_CHIP_STYLE,
} from "../dnd/sidebarThreadDragChip.js";

const SIDEBAR_STICKY_PARENT_DEPTH_CAP = 4;

export type ProjectThreadListState =
  | {
      status: "loading";
    }
  | {
      status: "ready";
      threads: SidebarThread[];
    }
  | {
      status: "unavailable";
    };

export interface ProjectRowProps {
  project: SidebarProject;
  threadListState: ProjectThreadListState;
  rootItems?: readonly ProjectThreadItem[];
  selectedThreadId?: string;
  isActive: boolean;
  isCollapsed: boolean;
  compareThreads: ThreadComparator;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
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
  projectId?: string;
  dndParentKey?: string;
  rootItems?: readonly ProjectThreadItem[];
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
  onRemoveSection?: (section: SidebarSectionDefinition) => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
}

interface ChronologicalBuiltInSidebarSections {
  collapsedSectionIds: ReadonlySet<CollapsibleSidebarSectionId>;
  onToggleCollapsed: (id: CollapsibleSidebarSectionId) => void;
  pinned: BuiltInSidebarSectionOptions;
  threads: Omit<BuiltInSidebarSectionOptions, "content">;
}

interface ChronologicalSectionThreadSectionsProps extends SectionThreadTreeProps {
  builtInSections: ChronologicalBuiltInSidebarSections;
  onCreateThread?: () => void;
  topLevelSectionOrder: readonly SidebarSectionId[];
  fullSectionOrder: readonly SidebarSectionId[];
  onTopLevelSectionOrderChange: (order: SidebarSectionId[]) => void;
  pinnedReorderPending: boolean;
  pinnedRootNodes?: readonly ProjectThreadNode[];
  pinnedThreads: readonly SidebarThread[];
  onReorderPinnedThread: (
    request: NeighborReorderRequest,
    callbacks: { onSettled: () => void },
  ) => void;
}

type ProjectThreadTreeVariant = "project" | "section";

type ProjectThreadListClickCaptureHandler = MouseEventHandler<HTMLDivElement>;

const EMPTY_PROJECT_THREADS: SidebarThread[] = [];
const EMPTY_PINNED_ROOT_NODES: readonly ProjectThreadNode[] = [];
const EMPTY_THREAD_SECTIONS: readonly SidebarSectionDefinition[] = [];

interface ProjectThreadTreeGroupProps {
  children: ReactNode;
  variant: ProjectThreadTreeVariant;
  onClickCapture?: ProjectThreadListClickCaptureHandler;
}

interface ThreadTreeNodeRowProps {
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
  sectionDnd?: SectionThreadDndState | null;
  sortableRef?: (element: HTMLDivElement | null) => void;
  sortableStyle?: CSSProperties;
}

interface ThreadTreeItemRowProps {
  isEnvGrouped?: boolean;
  projectId: string | null;
  item: ProjectThreadItem;
  depthOffset: number;
  selectedThreadId?: string;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  variant: ProjectThreadTreeVariant;
  onProjectSelect?: () => void;
  onCreateThreadInSection?: (sectionId: string) => void;
  onRemoveSection?: (section: SidebarSectionDefinition) => void;
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
  onRemoveSection?: (section: SidebarSectionDefinition) => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  dragBindings?: SidebarSortableDragBindings;
  isDropTargetActive?: boolean;
  sectionDnd?: SectionThreadDndState;
  sortableRef?: (element: HTMLDivElement | null) => void;
  sortableStyle?: CSSProperties;
}

function getItemProjectId(item: ProjectThreadItem): string | null {
  switch (item.kind) {
    case "thread":
      return item.node.thread.projectId;
    case "environment":
      return item.group.nodes[0].thread.projectId;
    case "section": {
      const [firstItem] = item.group.items;
      return firstItem === undefined ? null : getItemProjectId(firstItem);
    }
  }
}

interface EnvironmentThreadGroupRowProps {
  sectionDnd?: SectionThreadDndState;
  dragBindings?: SidebarSortableDragBindings;
  sortableRef?: (element: HTMLDivElement | null) => void;
  sortableStyle?: CSSProperties;
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
  dragBindings?: SidebarSortableDragBindings;
  environmentId: string;
  environmentProviderId: string | null;
  representativeThread: SidebarThread;
  rowDepth: number;
  stickyLevel?: number;
  parentLineDepth?: number;
  childActivity: CollapsedChildActivity;
  isCollapsed: boolean;
  archiveThreadsPending: boolean;
  onArchiveThreads: () => void;
  onCreateNewThread: () => void;
  onToggleCollapsed: (environmentId: string) => void;
}

interface EnvironmentThreadGroupHeaderActionsProps {
  archiveThreadsPending: boolean;
  onArchiveThreads: () => void;
  onCreateNewThread: () => void;
  onRenameEnvironment: () => void;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}

interface UseArchiveEnvironmentThreadGroupActionArgs {
  environmentId: string;
  projectId: string;
  selectedThreadId?: string;
  threads: readonly SidebarThread[];
}

interface UseArchiveEnvironmentThreadGroupActionResult {
  archiveThreadsPending: boolean;
  onArchiveThreads: () => void;
}

interface FormatArchivedEnvironmentThreadsToastTitleArgs {
  archivedThreadIds: readonly string[];
  threads: readonly SidebarThread[];
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
  return `Archived ${archivedThread.displayTitle}`;
}

function getProjectThreadTreeEmptyStateClassName(
  variant: ProjectThreadTreeVariant,
): string {
  return cn("py-0.5", variant === "section" ? "px-2" : "pl-8 pr-2");
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
  nestDrop,
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
    ...(nestDrop ? { nestDrop } : {}),
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
  nestDrop?: ThreadRowNestDrop;
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
        "relative space-y-0.5",
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
  if (!sectionDnd) {
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
      displace: false,
    });
    const isActive = sectionDnd.activeItemId === itemId;

    return (
      <ThreadTreeItemRow
        {...props}
        consumeClickSuppression={sectionDnd.consumeClickSuppression}
        dragBindings={dragBindings}
        sectionDnd={sectionDnd}
        sortableRef={setNodeRef}
        sortableStyle={
          isActive ? { ...style, opacity: 0.35, pointerEvents: "none" } : style
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
        isTopLevelSection && sectionDnd.activeThread === null
          ? sortable.isOver
          : false
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
  const navigate = useBbNavigate();
  const sdk = useSdk();
  const [archiveThreadsPending, setArchiveThreadsPending] = useState(false);
  const onArchiveThreads = useCallback(() => {
    setArchiveThreadsPending(true);
    void sdk.environments
      .archiveThreads({ environmentId })
      .then((response) => {
        toast.success(
          formatArchivedEnvironmentThreadsToastTitle({
            archivedThreadIds: response.archivedThreadIds,
            threads,
          }),
        );
        if (
          selectedThreadId &&
          response.archivedThreadIds.includes(selectedThreadId)
        ) {
          navigate.toProject(projectId);
        }
      })
      .catch((error: unknown) => {
        toast.error(
          getMutationErrorMessage({
            error,
            fallbackMessage: "Failed to archive environment threads.",
          }),
        );
      })
      .finally(() => setArchiveThreadsPending(false));
  }, [environmentId, navigate, projectId, sdk, selectedThreadId, threads]);

  return {
    archiveThreadsPending,
    onArchiveThreads,
  };
}

function EnvironmentThreadGroupHeaderActions({
  archiveThreadsPending,
  onArchiveThreads,
  onCreateNewThread,
  onRenameEnvironment,
  onOpenChange,
  onCloseAutoFocus,
}: EnvironmentThreadGroupHeaderActionsProps) {
  return (
    <SidebarRowControls
      primaryAction={
        <SidebarControlButton
          label="New thread in environment"
          icon="MessageSquarePlus"
          onClick={onCreateNewThread}
        />
      }
    >
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Environment actions"
            data-sidebar-rename-anchor=""
            className={SIDEBAR_CONTROL_BUTTON_CLASS}
          >
            <Icon
              name="MoreHorizontal"
              className={COARSE_POINTER_ICON_SIZE_CLASS}
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          mobileTitle="Environment actions"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <DropdownMenuItem
            onSelect={() => {
              onRenameEnvironment();
            }}
          >
            <Icon name="Edit" aria-hidden="true" />
            Rename
          </DropdownMenuItem>
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
            Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarRowControls>
  );
}

function EnvironmentThreadGroupHeader({
  dragBindings,
  environmentId,
  environmentProviderId,
  representativeThread,
  rowDepth,
  stickyLevel,
  parentLineDepth,
  childActivity,
  isCollapsed,
  archiveThreadsPending,
  onArchiveThreads,
  onCreateNewThread,
  onToggleCollapsed,
}: EnvironmentThreadGroupHeaderProps) {
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const environmentProviders = useEnvironmentProviders();
  const providerLookup = findEnvironmentDisplayProvider(
    environmentProviders.status === "ready"
      ? environmentProviders.providers
      : undefined,
    environmentProviderId,
  );
  const displayName =
    resolveEnvironmentDisplayName(
      {
        name: representativeThread.environment?.name ?? null,
        branchName: representativeThread.environment?.branchName ?? null,
        path: representativeThread.environment?.path ?? null,
        environmentProviderId,
      },
      providerLookup,
    ) ?? UNNAMED_ENVIRONMENT_LABEL;
  const sdk = useSdk();
  const updateEnvironment = useCallback(
    (name: string | null) =>
      sdk.environments.update({ environmentId, name }),
    [environmentId, sdk],
  );
  const rename = useSidebarRename({
    kind: "environment",
    id: environmentId,
    ownerKey: `environment:${environmentId}:${representativeThread.id}`,
    name: representativeThread.environment?.name ?? "",
    label: "Environment name",
    placeholder:
      resolveEnvironmentDisplayName(
        {
          name: null,
          branchName: representativeThread.environment?.branchName ?? null,
          path: representativeThread.environment?.path ?? null,
          environmentProviderId,
        },
        providerLookup,
      ) ?? UNNAMED_ENVIRONMENT_LABEL,
    maxLength: 80,
    onSave: (name) => updateEnvironment(name),
    onClear:
      representativeThread.environment?.name != null
        ? () => updateEnvironment(null)
        : undefined,
  });
  const iconName = getEnvironmentLabelIconName(providerLookup);
  const showRollupGlyph =
    isCollapsed &&
    (childActivity.pending ||
      childActivity.working ||
      childActivity.hasUnsubmittedDraft ||
      childActivity.unread ||
      childActivity.unreadError);
  const className = cn(
    SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
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
          "pointer-events-none relative z-10 inline-flex shrink-0 items-center justify-center",
          SIDEBAR_GROUP_TEXT_CLASS,
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
      <span
        className={cn(
          "relative z-10 flex min-w-0 flex-1 items-center gap-1.5 text-left",
          SIDEBAR_GROUP_TEXT_CLASS,
        )}
      >
        {rename.editor ?? (
          <span
            className="min-w-0 truncate"
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              rename.startEditing();
            }}
          >
            {displayName}
          </span>
        )}
        <SidebarChildToggleChevron
          disabled={rename.isEditing}
          className={rename.isEditing ? "hidden" : undefined}
          isCollapsed={isCollapsed}
          expandLabel={`Expand ${displayName} threads`}
          collapseLabel={`Collapse ${displayName} threads`}
          onToggle={() => onToggleCollapsed(environmentId)}
          revealOnHover={!isCollapsed}
        />
      </span>
      <span
        className={cn(
          "relative z-10 inline-flex shrink-0 items-center",
          rename.isEditing && "hidden",
        )}
      >
        {showRollupGlyph ? (
          <span
            data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
            className={cn(
              SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
              COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
              "pointer-events-none absolute right-0 flex items-center justify-end text-subtle-foreground max-md:pointer-coarse:static max-md:pointer-coarse:shrink-0 max-md:pointer-coarse:justify-center",
            )}
          >
            <CollapsedThreadStatusGlyph activity={childActivity} />
          </span>
        ) : null}
        <div
          data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
          data-sidebar-hover-actions-mobile={
            SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE
          }
          className={cn(
            SIDEBAR_HOVER_ACTIONS_CLASS,
            SIDEBAR_CONTROL_PAIR_SIZE_CLASS,
            "relative flex items-center justify-end",
            rename.isEditing && "hidden",
            isCollapsed && "max-md:pointer-coarse:hidden",
          )}
        >
          <EnvironmentThreadGroupHeaderActions
            archiveThreadsPending={archiveThreadsPending}
            onArchiveThreads={onArchiveThreads}
            onCreateNewThread={onCreateNewThread}
            onRenameEnvironment={rename.startEditingFromMenu}
            onCloseAutoFocus={rename.onCloseAutoFocus}
            onOpenChange={setIsActionsOpen}
          />
        </div>
      </span>
    </>
  );

  if (stickyLevel !== undefined) {
    return (
      <SidebarStickyTier
        {...dragBindings?.attributes}
        {...dragBindings?.listeners}
        ref={dragBindings?.setActivatorNodeRef}
        tier="parent"
        data-sidebar-rename-row=""
        level={stickyLevel}
        className={className}
        style={style}
      >
        {content}
      </SidebarStickyTier>
    );
  }

  return (
    <div
      {...dragBindings?.attributes}
      {...dragBindings?.listeners}
      ref={dragBindings?.setActivatorNodeRef}
      data-sidebar-rename-row=""
      className={className}
      style={style}
    >
      {content}
    </div>
  );
}

const EnvironmentThreadGroupRow = memo(function EnvironmentThreadGroupRow({
  sectionDnd,
  dragBindings,
  sortableRef,
  sortableStyle,
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
  const { environmentId, environmentProviderId, nodes, stats } =
    environmentThreadGroup;
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
  const sidebarActions = experimental_useSidebarThreadActions();
  const representativeSectionId = representativeThread.sectionId;
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
    sidebarActions.openNewThread({
      projectId,
      environmentId,
      ...(representativeSectionId === null
        ? {}
        : { sectionId: representativeSectionId }),
      focusPrompt: true,
    });
  }, [
    environmentId,
    onProjectSelect,
    projectId,
    representativeSectionId,
    sidebarActions,
  ]);
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
      <SidebarStickyGroup
        ref={sortableRef}
        style={sortableStyle}
        className="space-y-0.5"
      >
        <EnvironmentThreadGroupHeader
          dragBindings={dragBindings}
          environmentId={environmentId}
          environmentProviderId={environmentProviderId}
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
                  <SectionDndItemRow
                    key={node.thread.id}
                    projectId={projectId}
                    item={nodeItems[index]}
                    sectionDnd={sectionDnd}
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
    </>
  );
});

const ThreadTreeItemRow = memo(function ThreadTreeItemRow({
  isEnvGrouped = false,
  projectId,
  item,
  depthOffset,
  selectedThreadId,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  variant,
  onProjectSelect,
  onCreateThreadInSection,
  onRemoveSection,
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
        onRemoveSection={onRemoveSection}
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
        projectId={projectId ?? item.node.thread.projectId}
        node={item.node}
        depthOffset={depthOffset}
        isEnvGrouped={isEnvGrouped}
        selectedThreadId={selectedThreadId}
        collapsedThreadIds={collapsedThreadIds}
        collapsedEnvironmentIds={collapsedEnvironmentIds}
        variant={variant}
        onProjectSelect={onProjectSelect}
        onToggleThreadCollapsed={onToggleThreadCollapsed}
        onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
        consumeClickSuppression={consumeClickSuppression}
        dragBindings={dragBindings}
        sectionDnd={sectionDnd}
        sortableRef={sortableRef}
        sortableStyle={sortableStyle}
      />
    );
  }

  return (
    <EnvironmentThreadGroupRow
      projectId={projectId ?? item.group.nodes[0].thread.projectId}
      environmentThreadGroup={item.group}
      sectionDnd={sectionDnd}
      dragBindings={dragBindings}
      sortableRef={sortableRef}
      sortableStyle={sortableStyle}
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

function getNestDropPreviewRowStyle(depth: number): CSSProperties {
  const indent =
    getSidebarThreadRowPaddingLeft(depth) - getSidebarThreadRowPaddingLeft(0);
  return {
    paddingLeft: getSidebarThreadRowPaddingLeft(0),
    marginLeft: indent > 0 ? indent : undefined,
    width: indent > 0 ? `calc(100% - ${indent}px)` : undefined,
  };
}

export function NestDropPreviewRow({
  depth,
  thread,
}: {
  depth: number;
  thread: SidebarThread;
}) {
  return (
    <div
      aria-hidden="true"
      data-sidebar-nest-drop-preview="true"
      style={getNestDropPreviewRowStyle(depth)}
      className={cn(
        SIDEBAR_ROW_BASE_CLASS,
        COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
        "pointer-events-none overflow-hidden text-sidebar-foreground opacity-50",
      )}
    >
      <span className="min-w-0 flex-1 truncate">
        {thread.displayTitle}
      </span>
    </div>
  );
}

export function SectionThreadDragOverlayPortal({
  activeThread,
}: {
  activeThread: SidebarThread | null;
}) {
  const modifiers = useSidebarThreadDragOverlayModifiers();
  return createPortal(
    <DragOverlay
      className="cursor-grabbing"
      dropAnimation={activeThread ? SIDEBAR_DRAG_OVERLAY_DROP_ANIMATION : null}
      modifiers={modifiers}
    >
      {activeThread ? <SectionThreadDragOverlay thread={activeThread} /> : null}
    </DragOverlay>,
    document.body,
  );
}

export function SectionThreadDragOverlay({
  thread,
}: {
  thread: SidebarThread;
}) {
  return (
    <div
      aria-hidden="true"
      data-sidebar-section-drag-overlay="true"
      style={SIDEBAR_THREAD_DRAG_CHIP_STYLE}
      className={SIDEBAR_THREAD_DRAG_CHIP_CLASS}
    >
      <span className="min-w-0 flex-1 truncate">
        {thread.displayTitle}
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
  onRemoveSection,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
  consumeClickSuppression,
  dragBindings,
  isDropTargetActive = false,
  sectionDnd,
  sortableRef,
  sortableStyle,
}: SectionTreeItemRowProps) {
  const sdk = useSdk();
  const rename = useSidebarRename({
    kind: "section",
    id: section.id,
    ownerKey: `section:${section.id}:${variant}:${depthOffset}`,
    name: section.name,
    label: "Section name",
    onSave: (name) => sdk.threadSections.update({ id: section.id, name }),
  });
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
  const threadDropState = resolveSectionDropTargetState(
    sectionDnd ?? null,
    sectionKey,
  );
  const showChildren = !isCollapsed && section.items.length > 0;
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

  const childrenArea = showChildren ? (
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
              const itemKey = getSidebarItemKey(item);
              return (
                <Fragment key={itemKey}>
                  <SectionDndItemRow
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
                    onRemoveSection={onRemoveSection}
                    onToggleThreadCollapsed={onToggleThreadCollapsed}
                    onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
                    sectionDnd={sectionDnd}
                  />
                </Fragment>
              );
            }}
          />
        </SectionDndSortableList>
      ) : null}
    </div>
  ) : null;

  if (variant === "section" && depthOffset === 0) {
    const topLevelActions = (
      <SidebarHeaderControls
        label={`${section.name} section`}
        sectionId={buildSidebarEntitySectionId("section", section.id)}
        onNewThread={
          onCreateThreadInSection
            ? () => onCreateThreadInSection(section.id)
            : undefined
        }
        onOpenChange={setIsTopLevelActionsOpen}
        onCloseAutoFocus={rename.onCloseAutoFocus}
      >
        <SidebarSectionMenuItems
          onRename={rename.startEditingFromMenu}
          onRemove={
            onRemoveSection ? () => onRemoveSection(section) : undefined
          }
        />
      </SidebarHeaderControls>
    );
    return (
      <TopLevelSidebarSection
        label={section.name}
        labelEditor={rename.editor}
        onRename={rename.startEditing}
        sectionId={section.id}
        actions={topLevelActions}
        actionsOpen={isTopLevelActionsOpen}
        actionsMobileAlways
        collapseControl={{
          isCollapsed,
          onToggleCollapsed: handleToggleCollapsed,
        }}
        collapsedActivity={section.activity}
        collapsedThreads={sectionThreads}
        consumeClickSuppression={consumeClickSuppression}
        dragBindings={rename.isEditing ? undefined : dragBindings}
        dropParentKey={sectionKey}
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
      className="relative space-y-0.5 rounded-md transition-colors"
    >
      {threadDropState ? (
        <SectionDropTargetOverlay state={threadDropState} />
      ) : null}
      <SidebarSectionRow
        name={section.name}
        label={section.name}
        sectionId={buildSidebarEntitySectionId("section", section.id)}
        labelEditor={rename.editor}
        onRename={rename.startEditing}
        onRenameFromMenu={rename.startEditingFromMenu}
        depth={headerDepth}
        onCloseAutoFocus={rename.onCloseAutoFocus}
        activity={section.activity}
        collapsedThreads={sectionThreads}
        consumeClickSuppression={consumeClickSuppression}
        dragBindings={rename.isEditing ? undefined : dragBindings}
        isCollapsed={isCollapsed}
        onCreateThread={
          onCreateThreadInSection
            ? () => onCreateThreadInSection(section.id)
            : undefined
        }
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
  sectionDnd,
  sortableRef,
  sortableStyle,
}: ThreadTreeNodeRowProps) {
  const isCollapsed = collapsedThreadIds.has(node.thread.id);
  const hasChildren = node.children.length > 0;
  const isParent = hasChildren;
  const nestDropEnabled = Boolean(sectionDnd);
  const { setNodeRef: setNestDropNodeRef } = useDroppable({
    id: getSidebarThreadRowDroppableId(node.thread.id),
    disabled: !nestDropEnabled,
    resizeObserverConfig: { disabled: !nestDropEnabled },
  });
  const rowNodeRef = useComposedRefs<HTMLDivElement>(
    setNestDropNodeRef,
    sortableRef,
  );
  const nestTargetState =
    sectionDnd?.nestTarget?.threadId === node.thread.id
      ? sectionDnd.nestTarget.state
      : null;
  const nestPreviewThread =
    nestTargetState === "valid" && (!hasChildren || !isCollapsed)
      ? (sectionDnd?.activeThread ?? null)
      : null;
  const nestPreviewBeforeKey = nestPreviewThread
    ? (sectionDnd?.nestPreviewBeforeKey ?? null)
    : null;
  const reorderPlacement =
    sectionDnd?.reorderTarget?.threadId === node.thread.id
      ? sectionDnd.reorderTarget.placement
      : null;
  const showChildren = !isCollapsed && hasChildren;
  const afterSubtree = showChildren && reorderPlacement === "after";
  const nestDrop = useMemo<ThreadRowNestDrop | undefined>(
    () =>
      nestDropEnabled
        ? {
            setNodeRef: rowNodeRef,
            state: nestTargetState,
            reorderPlacement: afterSubtree ? null : reorderPlacement,
          }
        : undefined,
    [
      afterSubtree,
      nestDropEnabled,
      nestTargetState,
      reorderPlacement,
      rowNodeRef,
    ],
  );
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
        nestDrop,
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
      nestDrop,
      node,
      onToggleThreadCollapsed,
      variant,
    ],
  );
  const rowProjectId = node.thread.projectId;
  const crossProjectId = rowProjectId !== projectId ? rowProjectId : null;
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
      onProjectSelect={onProjectSelect}
      options={options}
    />
  );

  if (!hasChildren && !sortableRef && nestPreviewThread === null) {
    return row;
  }

  return (
    <SidebarStickyGroup
      style={sortableStyle}
      className={cn(
        "relative space-y-0.5",
        afterSubtree && REORDER_PLACEMENT_CLASS.after,
      )}
    >
      {row}
      {showChildren || nestPreviewThread !== null ? (
        <div className="relative space-y-px">
          <ThreadTreeGroupLine parentRowDepth={parentRowDepth} />
          {showChildren ? (
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
                const itemKey = getSidebarItemKey(item);
                return (
                  <Fragment key={itemKey}>
                    {nestPreviewThread !== null &&
                    nestPreviewBeforeKey === itemKey ? (
                      <NestDropPreviewRow
                        depth={parentRowDepth + 1}
                        thread={nestPreviewThread}
                      />
                    ) : null}
                    <SectionDndItemRow
                      projectId={rowProjectId}
                      item={item}
                      depthOffset={depthOffset}
                      selectedThreadId={selectedThreadId}
                      collapsedThreadIds={collapsedThreadIds}
                      collapsedEnvironmentIds={collapsedEnvironmentIds}
                      variant={variant}
                      onProjectSelect={onProjectSelect}
                      onToggleThreadCollapsed={onToggleThreadCollapsed}
                      onToggleEnvironmentCollapsed={
                        onToggleEnvironmentCollapsed
                      }
                      sectionDnd={sectionDnd ?? undefined}
                    />
                  </Fragment>
                );
              }}
            />
          ) : null}
          {nestPreviewThread !== null && nestPreviewBeforeKey === null ? (
            <NestDropPreviewRow
              depth={parentRowDepth + 1}
              thread={nestPreviewThread}
            />
          ) : null}
        </div>
      ) : null}
    </SidebarStickyGroup>
  );
});

function ThreadTreeLoadingSkeleton() {
  return (
    <div>
      <SidebarMenuSkeleton />
    </div>
  );
}

interface SectionThreadTreeItemsProps {
  items: readonly ProjectThreadItem[];
  sectionDnd: SectionThreadDndState | null;
  variant: ProjectThreadTreeVariant;
  projectId?: string;
  depthOffset?: number;
  sortableParentKey?: string;
  selectedThreadId?: string;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  onProjectSelect?: () => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  onCreateThreadInSection?: (sectionId: string) => void;
  onRemoveSection?: (section: SidebarSectionDefinition) => void;
}

function itemContainsRename(
  item: ProjectThreadItem,
  rename: NonNullable<ReturnType<typeof useSidebarRenameState>>,
): boolean {
  switch (item.kind) {
    case "thread":
      return (
        (rename.kind === "thread" && item.node.thread.id === rename.id) ||
        item.node.children.some((child) => itemContainsRename(child, rename))
      );
    case "environment":
      return (
        (rename.kind === "environment" &&
          item.group.environmentId === rename.id) ||
        item.group.nodes.some((node) =>
          itemContainsRename({ kind: "thread", node }, rename),
        )
      );
    case "section":
      return (
        (rename.kind === "section" && item.group.id === rename.id) ||
        item.group.items.some((child) => itemContainsRename(child, rename))
      );
  }
}

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
  const rename = useSidebarRenameState();
  const collapsedSectionKeyList = useAtomValue(
    sidebarCollapsedThreadSectionsAtom,
  );
  const itemKeys = useMemo(() => items.map(getSidebarItemKey), [items]);
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
    const keys = new Set<string>();
    for (const item of items) {
      if (
        (selectedThreadId &&
          projectThreadItemContainsThread(item, selectedThreadId)) ||
        (rename && itemContainsRename(item, rename))
      ) {
        keys.add(getSidebarItemKey(item));
      }
    }
    return keys.size > 0 ? keys : undefined;
  }, [items, selectedThreadId, rename]);
  return { itemKeys, estimateRows, getNavigationEntries, alwaysMountedKeys };
}

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
  onRemoveSection,
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
        const itemKey = getSidebarItemKey(item);
        return (
          <Fragment key={itemKey}>
            <SectionDndItemRow
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
              onRemoveSection={onRemoveSection}
              sectionDnd={sectionDnd ?? undefined}
            />
          </Fragment>
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
  dndParentKey,
  rootItems: providedRootItems,
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
  const sectionDnd = useChronologicalSectionThreadDnd();
  const draftThreadIds = useSidebarThreadDraftIds();
  const groupThreadsByEnvironment = useAtomValue(
    sidebarGroupThreadsByEnvironmentAtom,
  );
  const rootItems = useMemo(
    () =>
      providedRootItems ??
      buildProjectThreadGroups(
        projectThreads,
        compareThreads,
        draftThreadIds,
        groupThreadsByEnvironment,
      ),
    [
      compareThreads,
      draftThreadIds,
      groupThreadsByEnvironment,
      projectThreads,
      providedRootItems,
    ],
  );

  if (threadListState.status === "loading") {
    return <ThreadTreeLoadingSkeleton />;
  }

  if (rootItems.length === 0) {
    const emptyState = (
      <ThreadListEmptyState
        message={
          threadListState.status === "unavailable"
            ? "Threads unavailable"
            : undefined
        }
        showIcon={variant === "section"}
        className={getProjectThreadTreeEmptyStateClassName(variant)}
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

  return (
    <SectionThreadTreeItems
      items={rootItems}
      sectionDnd={dndParentKey !== undefined ? sectionDnd : null}
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
    onCreateThread,
    onCreateThreadInSection,
    onRemoveSection,
    onToggleThreadCollapsed,
    onToggleEnvironmentCollapsed,
    builtInSections,
    topLevelSectionOrder,
    fullSectionOrder,
    onTopLevelSectionOrderChange,
    pinnedReorderPending,
    pinnedRootNodes = EMPTY_PINNED_ROOT_NODES,
    pinnedThreads,
    onReorderPinnedThread,
  }: ChronologicalSectionThreadSectionsProps) {
    const threads =
      threadListState.status === "ready"
        ? threadListState.threads
        : EMPTY_PROJECT_THREADS;
    const expandThread = useCallback(
      (threadId: string) => {
        if (collapsedThreadIds.has(threadId)) {
          onToggleThreadCollapsed(threadId);
        }
      },
      [collapsedThreadIds, onToggleThreadCollapsed],
    );
    const draftThreadIds = useSidebarThreadDraftIds();
    const groupThreadsByEnvironment = useAtomValue(
      sidebarGroupThreadsByEnvironmentAtom,
    );
    const rootItems = useMemo(
      () =>
        buildSectionThreadList(
          threads,
          compareThreads,
          sections,
          draftThreadIds,
          groupThreadsByEnvironment,
        ),
      [
        threads,
        compareThreads,
        sections,
        draftThreadIds,
        groupThreadsByEnvironment,
      ],
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
      onExpandThread: expandThread,
      pinnedReorderPending,
      pinnedThreads,
      pinnedRootNodes,
      onReorderPinnedThread,
    });
    const renderedSectionDnd = useNestDropPreview({
      compareThreads,
      draftThreadIds,
      pinnedRootNodes,
      sectionDnd,
      sections,
      threads,
    });
    const sectionItems = rootItems.filter((item) => item.kind === "section");
    const looseItems = rootItems.filter((item) => item.kind !== "section");
    const looseThreads = getProjectThreadItemDescendants(looseItems);

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
        onRemoveSection={onRemoveSection}
      />
    );

    const looseEmptyState = (
      <ThreadListEmptyState
        message={
          threadListState.status === "unavailable"
            ? "Threads unavailable"
            : undefined
        }
        className={getProjectThreadTreeEmptyStateClassName("section")}
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
      ) : (
        looseEmptyState
      );
    const threadsContent = renderedSectionDnd ? (
      <SectionDndDroppableParent
        sectionDnd={renderedSectionDnd}
        parentKey={CHRONOLOGICAL_CONTAINER_ID}
      >
        {threadsListContent}
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
    const configuredBuiltInSections: BuiltInSidebarSectionOptionsById = {
      pinned: builtInSections.pinned,
      threads: {
        ...builtInSections.threads,
        activity: getCollapsedChildActivity(looseThreads, draftThreadIds),
        collapsedThreads: looseThreads,
        content: threadsContent,
      },
    };

    const visibilityGroups: ThreadListVisibilityGroup[] = [
      {
        id: "threads",
        title: "Threads",
        threads: looseThreads,
        onNewThread: onCreateThread,
        renderContent: (close: () => void) => (
          <ProjectThreadTree
            rootItems={looseItems}
            threadListState={
              threadListState.status === "ready"
                ? { status: "ready", threads: looseThreads }
                : threadListState
            }
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
      ...sectionItems.map((item) => ({
        id: buildSidebarEntitySectionId("section", item.group.id),
        title: item.group.name,
        threads: getProjectThreadItemDescendants(item.group.items),
        onNewThread: onCreateThreadInSection
          ? () => onCreateThreadInSection(item.group.id)
          : undefined,
        renderContent: (close: () => void) => (
          <ProjectThreadTree
            rootItems={item.group.items}
            threadListState={{
              status: "ready",
              threads: getProjectThreadItemDescendants(item.group.items),
            }}
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
      })),
    ];
    const orderedSections = (
      <SidebarSectionOrderList order={topLevelSectionOrder}>
        {(sectionId) => {
          const builtInSection = renderBuiltInSidebarSection({
            sectionId,
            sections: configuredBuiltInSections,
            disabled: topLevelSectionOrder.length < 2,
            collapsedSectionIds: builtInSections.collapsedSectionIds,
            onToggleCollapsed: builtInSections.onToggleCollapsed,
            consumeClickSuppression,
            showPinnedSection: topLevelSectionOrder.includes("pinned"),
          });
          if (builtInSection !== undefined) {
            return sectionId === "threads" ? (
              <ThreadListVisibilityGroupScope key={sectionId} id={sectionId}>
                {builtInSection}
              </ThreadListVisibilityGroupScope>
            ) : (
              <div key={sectionId}>{builtInSection}</div>
            );
          }
          const sectionItem = sectionItemsBySectionId.get(sectionId);
          return sectionItem ? (
            <ThreadListVisibilityGroupScope key={sectionId} id={sectionId}>
              {renderItems([sectionItem])}
            </ThreadListVisibilityGroupScope>
          ) : null;
        }}
      </SidebarSectionOrderList>
    );

    return (
      <ThreadListVisibility
        groups={visibilityGroups}
        order={fullSectionOrder}
        onOrderChange={onTopLevelSectionOrderChange}
        label="Sections"
        selectedThreadId={selectedThreadId}
      >
        {sectionDnd ? (
          <DndContext {...sectionDnd.dndContextProps}>
            <SectionThreadDndProvider value={renderedSectionDnd}>
              {orderedSections}
              <SectionThreadDragOverlayPortal
                activeThread={sectionDnd.activeThread}
              />
            </SectionThreadDndProvider>
          </DndContext>
        ) : (
          orderedSections
        )}
        <ThreadListMore />
      </ThreadListVisibility>
    );
  },
);

function ProjectRowComponent({
  project,
  threadListState,
  rootItems,
  selectedThreadId,
  isCollapsed,
  compareThreads,
  collapsedThreadIds,
  collapsedEnvironmentIds,
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
  const sdk = useSdk();
  const rename = useSidebarRename({
    kind: "project",
    id: project.id,
    ownerKey: `project:${project.id}`,
    name: project.name,
    label: "Project name",
    onSave: (name) => sdk.projects.update({ projectId: project.id, name }),
  });
  const [isDropdownActionsOpen, setIsDropdownActionsOpen] = useState(false);
  const [isContextActionsOpen, setIsContextActionsOpen] = useState(false);
  const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false);
  const [isRemovePending, setIsRemovePending] = useState(false);
  const isActionsOpen = isDropdownActionsOpen || isContextActionsOpen;
  const projectThreads = useMemo(
    () =>
      isCollapsed && threadListState.status === "ready"
        ? threadListState.threads.filter(isSidebarProjectThread)
        : EMPTY_PROJECT_THREADS,
    [isCollapsed, threadListState],
  );
  const draftThreadIds = useSidebarThreadDraftIds();
  const handleProjectRowToggle = useCallback(() => {
    onToggleProjectCollapsed(project.id);
  }, [onToggleProjectCollapsed, project.id]);
  const handleCreateThread = useCallback(() => {
    onCreateProjectThread?.(project.id);
  }, [onCreateProjectThread, project.id]);
  const requestRemove = useCallback(() => setIsRemoveDialogOpen(true), []);
  const confirmRemove = useCallback(() => {
    setIsRemovePending(true);
    void sdk.projects
      .delete({ projectId: project.id })
      .then(() => setIsRemoveDialogOpen(false))
      .catch((error: unknown) => {
        toast.error(
          getMutationErrorMessage({
            error,
            fallbackMessage: "Failed to remove project.",
          }),
        );
      })
      .finally(() => setIsRemovePending(false));
  }, [project.id, sdk]);
  const projectActivity = useMemo<CollapsedChildActivity>(() => {
    if (!isCollapsed || threadListState.status !== "ready") {
      return NO_COLLAPSED_CHILD_ACTIVITY;
    }
    return getCollapsedChildActivity(projectThreads, draftThreadIds);
  }, [draftThreadIds, isCollapsed, projectThreads, threadListState.status]);
  const projectActions = (
    <SidebarHeaderControls
      label={project.name}
      sectionId={buildSidebarEntitySectionId("project", project.id)}
      onNewThread={onCreateProjectThread ? handleCreateThread : undefined}
      onOpenChange={setIsDropdownActionsOpen}
      onCloseAutoFocus={rename.onCloseAutoFocus}
    >
      <ProjectActionsMenuItems
        project={project}
        surface="dropdown"
        onRename={rename.startEditingFromMenu}
        onRemove={requestRemove}
        extraActions={(surface) => (
          <ThreadListVisibilityMenuItems surface={surface} />
        )}
      />
    </SidebarHeaderControls>
  );

  return (
    <>
      <ProjectActionsContextMenu
        extraActions={(surface) => (
          <ThreadListVisibilityMenuItems surface={surface} />
        )}
        project={project}
        disabled={rename.isEditing}
        onRename={rename.startEditingFromMenu}
        onRemove={requestRemove}
        onCloseAutoFocus={rename.onCloseAutoFocus}
        onOpenChange={setIsContextActionsOpen}
      >
        <div
          data-sidebar-sticky-project-item=""
          data-sidebar-project-id={project.id}
        >
          <TopLevelSidebarSection
            label={project.name}
            dropParentKey={buildSidebarEntitySectionId("project", project.id)}
            labelEditor={rename.editor}
            onRename={rename.startEditing}
            actions={projectActions}
            actionsMobileAlways
            actionsOpen={isActionsOpen}
            collapseControl={{
              isCollapsed,
              onToggleCollapsed: handleProjectRowToggle,
            }}
            collapsedActivity={projectActivity}
            collapsedThreads={projectThreads}
            consumeClickSuppression={consumeProjectClickSuppression}
            dragBindings={rename.isEditing ? undefined : projectDragBindings}
            sectionRef={projectRowRef}
            sectionStyle={projectRowStyle}
          >
            <ProjectThreadTree
              projectId={project.id}
              dndParentKey={buildSidebarEntitySectionId("project", project.id)}
              rootItems={rootItems}
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
      <ConfirmDeleteDialog
        open={isRemoveDialogOpen}
        onOpenChange={setIsRemoveDialogOpen}
      >
        <ConfirmDeleteDialogContent
          title={`Remove ${project.name}?`}
          description="The project and its threads are removed from bb. This cannot be undone."
          confirmLabel="Remove project"
          pending={isRemovePending}
          onConfirm={confirmRemove}
          onCancel={() => setIsRemoveDialogOpen(false)}
        />
      </ConfirmDeleteDialog>
    </>
  );
}

interface ProjectRowPropsComparisonArgs {
  prev: ProjectRowProps;
  next: ProjectRowProps;
}

function getThreadIdsWithChildren(
  threads: readonly SidebarThread[],
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
    const environmentId = thread.environment?.id ?? null;
    if (environmentId === null) continue;
    if (
      prev.collapsedEnvironmentIds.has(environmentId) !==
      next.collapsedEnvironmentIds.has(environmentId)
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
    prev.rootItems !== next.rootItems ||
    prev.isActive !== next.isActive ||
    prev.isCollapsed !== next.isCollapsed ||
    prev.compareThreads !== next.compareThreads ||
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
  if (prev.threadListState.status !== "ready") {
    return true;
  }
  return (
    !hasCollapsedThreadStateChanged({ prev, next }) &&
    !hasCollapsedEnvironmentStateChanged({ prev, next })
  );
}

export const ProjectRow = memo(ProjectRowComponent, areProjectRowPropsEqual);
