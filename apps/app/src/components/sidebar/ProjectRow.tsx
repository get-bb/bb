import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  DndContext,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import { NavLink, useNavigate } from "react-router-dom";
import { useCreateThreadInWorktree } from "@/hooks/useCreateThreadInWorktree";
import { usePromptDraftHasInput } from "@/hooks/usePromptDraftStorage";
import {
  useArchiveEnvironmentThreads,
  useUpdateEnvironment,
} from "@/hooks/mutations/environment-mutations";
import { useUpdateThread } from "@/hooks/mutations/thread-state-mutations";
import { useDialogState } from "@/hooks/useDialogState";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { EmptyState } from "@/components/ui/empty-state.js";
import { Icon, type IconName } from "@/components/ui/icon.js";
import { LIST_HOVER_TRANSITION } from "@/components/ui/motion.js";
import {
  SidebarMenuItem,
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
} from "@/components/ui/coarse-pointer-sizing.js";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
  SIDEBAR_HOVER_ACTIONS_GAP_CLASS,
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions.js";
import type { CollapsedChildActivity } from "@/lib/thread-activity";
import { cn } from "@/lib/utils";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { getProjectSettingsRoutePath } from "@/lib/route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { appToast } from "@/components/ui/app-toast";
import {
  ThreadRow,
  ThreadStatusGlyph,
  type ThreadRowOptions,
} from "./ThreadRow";
import {
  buildChronologicalThreadList,
  buildProjectThreadGroups,
  CHRONOLOGICAL_CONTAINER_ID,
  getManualOrderItemKey,
  type EnvironmentThreadGroup,
  type ProjectThreadItem,
  type ProjectThreadNode,
  type SidebarFolderDefinition,
  type SidebarFolderGroup,
  type ThreadComparator,
} from "./projectThreadGroups";
import { SidebarFolderRow } from "./SidebarFolderRow";
import { sidebarCollapsedFoldersAtom } from "./sidebarCollapsedAtoms";
import {
  SIDEBAR_PROJECT_GROUP_LINE_CLASS,
  SIDEBAR_MORE_ACTION_TRIGGER_CLASS,
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_SELECTED_STATE_CLASS,
  SIDEBAR_ROW_STATIC_STATE_CLASS,
  getSidebarThreadGroupLineLeft,
  getSidebarThreadRowPaddingLeft,
} from "./sidebarRowClasses";
import {
  useSidebarSortable,
  type SidebarSortableDragBindings,
} from "./sortableMotion";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import { SidebarChildToggleChevron } from "./SidebarChildToggleChevron";
import type { SidebarReorderDndContextProps } from "./useSidebarReorderDnd";
import { useSidebarReorderDnd } from "./useSidebarReorderDnd";

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
  onProjectSelect?: () => void;
  onCreateProjectThread?: (projectId: string) => void;
  onToggleProjectCollapsed: (projectId: string) => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  consumeProjectClickSuppression?: ConsumeDragClickSuppression;
  projectDragBindings?: SidebarSortableDragBindings;
  projectRowRef?: (element: HTMLLIElement | null) => void;
  projectRowStyle?: CSSProperties;
}

export interface ProjectThreadTreeProps {
  projectId: string;
  threadListState: ProjectThreadListState;
  compareThreads: ThreadComparator;
  folders?: readonly SidebarFolderDefinition[];
  selectedThreadId?: string;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  variant: ProjectThreadTreeVariant;
  onProjectSelect?: () => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
}

export interface ChronologicalThreadTreeProps {
  threadListState: ProjectThreadListState;
  compareThreads: ThreadComparator;
  folders?: readonly SidebarFolderDefinition[];
  selectedThreadId?: string;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  onProjectSelect?: () => void;
  onCreateThreadInFolder?: (folderId: string) => void;
  onViewArchivedThreadsInFolder?: (folderId: string) => void;
  onRenameFolder?: (folder: SidebarFolderDefinition) => void;
  onRemoveFolder?: (folder: SidebarFolderDefinition) => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
}

export interface ChronologicalFolderThreadSectionsProps extends ChronologicalThreadTreeProps {
  renderAllThreadsSection: (content: ReactNode) => ReactNode;
  renderFoldersSection: (content: ReactNode) => ReactNode;
  renderThreadsSection: (content: ReactNode) => ReactNode;
}

export type ProjectThreadTreeVariant = "project" | "section";

type ProjectItemClickCaptureHandler = MouseEventHandler<HTMLLIElement>;
type ProjectThreadListClickCaptureHandler = MouseEventHandler<HTMLDivElement>;

const EMPTY_PROJECT_THREADS: ThreadListEntry[] = [];
const EMPTY_FOLDERS: readonly SidebarFolderDefinition[] = [];
const PROJECT_ROW_LEADING_SLOT_CLASS =
  "h-7 w-8 max-md:pointer-coarse:h-10 max-md:pointer-coarse:w-10";

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
  onCreateThreadInFolder?: (folderId: string) => void;
  onViewArchivedThreadsInFolder?: (folderId: string) => void;
  onRenameFolder?: (folder: SidebarFolderDefinition) => void;
  onRemoveFolder?: (folder: SidebarFolderDefinition) => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  dragBindings?: SidebarSortableDragBindings;
  isDropTargetActive?: boolean;
  manualSort?: ManualThreadTreeDndState;
  sortableRef?: (element: HTMLDivElement | null) => void;
  sortableStyle?: CSSProperties;
}

interface FolderTreeItemRowProps {
  folder: SidebarFolderGroup;
  depthOffset: number;
  selectedThreadId?: string;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  variant: ProjectThreadTreeVariant;
  onProjectSelect?: () => void;
  onCreateThreadInFolder?: (folderId: string) => void;
  onViewArchivedThreadsInFolder?: (folderId: string) => void;
  onRenameFolder?: (folder: SidebarFolderDefinition) => void;
  onRemoveFolder?: (folder: SidebarFolderDefinition) => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  dragBindings?: SidebarSortableDragBindings;
  isDropTargetActive?: boolean;
  manualSort?: ManualThreadTreeDndState;
  sortableRef?: (element: HTMLDivElement | null) => void;
  sortableStyle?: CSSProperties;
}

interface ManualThreadTreeDndState {
  consumeClickSuppression: ConsumeDragClickSuppression;
  dndContextProps: SidebarReorderDndContextProps;
  enabled: boolean;
  itemIdsByParentKey: ReadonlyMap<string, readonly string[]>;
  onClickCapture: MouseEventHandler<HTMLElement>;
  // The drop target showing an empty placeholder row while a thread is dragged
  // over it (after a short hover): a folder key, or the loose root container id.
  // The dragged row itself carries the title. One field drives both folder and
  // loose-list previews so they stay visually identical.
  dragOverParentKey: string | null;
}

interface UseManualThreadTreeDndArgs {
  containerId: string;
  enabled: boolean;
  rootItems: readonly ProjectThreadItem[];
}

type ManualSortableItemKind = "thread" | "folder" | "environment";

interface ManualThreadTreeLookup {
  folderIdByParentKey: Map<string, string | null>;
  itemIdsByParentKey: Map<string, string[]>;
  itemKindById: Map<string, ManualSortableItemKind>;
  parentKeyByItemId: Map<string, string>;
  threadByItemId: Map<string, ThreadListEntry>;
}

// Render key + routing projectId for any item kind. Folders derive from their
// first nested item, so a folder spanning projects in the Folders view still
// routes each contained thread to its own project.
export function getItemKey(item: ProjectThreadItem): string {
  switch (item.kind) {
    case "thread":
      return `thread:${item.node.thread.id}`;
    case "environment":
      return `env:${item.group.environmentId}`;
    case "folder":
      return `folder:${item.group.key}`;
  }
}

export function getItemProjectId(item: ProjectThreadItem): string {
  switch (item.kind) {
    case "thread":
      return item.node.thread.projectId;
    case "environment":
      return item.group.nodes[0].thread.projectId;
    case "folder":
      if (item.group.items.length === 0) {
        return PERSONAL_PROJECT_ID;
      }
      return getItemProjectId(item.group.items[0]);
  }
}

function getManualSortableItemKind(
  item: ProjectThreadItem,
): ManualSortableItemKind {
  return item.kind;
}

function collectManualThreadTreeLookup(
  items: readonly ProjectThreadItem[],
  containerId: string,
): ManualThreadTreeLookup {
  const lookup: ManualThreadTreeLookup = {
    folderIdByParentKey: new Map([[containerId, null]]),
    itemIdsByParentKey: new Map(),
    itemKindById: new Map(),
    parentKeyByItemId: new Map(),
    threadByItemId: new Map(),
  };

  const walk = (
    siblingItems: readonly ProjectThreadItem[],
    parentKey: string,
  ) => {
    const itemIds = siblingItems.map(getManualOrderItemKey);
    lookup.itemIdsByParentKey.set(parentKey, itemIds);

    for (const item of siblingItems) {
      const itemId = getManualOrderItemKey(item);
      lookup.itemKindById.set(itemId, getManualSortableItemKind(item));
      lookup.parentKeyByItemId.set(itemId, parentKey);

      if (item.kind === "thread") {
        lookup.threadByItemId.set(itemId, item.node.thread);
      } else if (item.kind === "folder") {
        lookup.folderIdByParentKey.set(item.group.key, item.group.id);
        walk(item.group.items, item.group.key);
      }
    }
  };

  walk(items, containerId);
  return lookup;
}

function hasFolderItems(items: readonly ProjectThreadItem[]): boolean {
  return items.some(
    (item) =>
      item.kind === "folder" ||
      (item.kind === "thread" && hasFolderItems(item.node.children)) ||
      (item.kind === "environment" &&
        item.group.nodes.some((node) => hasFolderItems(node.children))),
  );
}

// Resolve where a dragged thread would land. Shared by drag-over (preview +
// auto-expand) and drag-end (the move) so they never disagree. `toParentKey`
// is the destination folder key, or the container id for the loose root.
function resolveThreadDropTarget(
  lookup: ManualThreadTreeLookup,
  active: DragEndEvent["active"],
  over: DragEndEvent["over"],
): { activeId: string; fromParentKey: string; toParentKey: string } | null {
  if (!over || typeof active.id !== "string" || typeof over.id !== "string") {
    return null;
  }
  const activeId = active.id;
  const overId = over.id;
  if (activeId === overId) return null;

  const activeKind = lookup.itemKindById.get(activeId);
  const overKind = lookup.itemKindById.get(overId);
  const fromParentKey = lookup.parentKeyByItemId.get(activeId);
  if (activeKind !== "thread" || !fromParentKey) return null;

  let toParentKey = overKind ? lookup.parentKeyByItemId.get(overId) : undefined;
  if (!overKind && lookup.folderIdByParentKey.has(overId)) {
    // Dropping on a folder's child area (the droppable parent).
    toParentKey = overId;
  } else if (overKind === "folder") {
    // Dropping on a folder header means "move into this folder".
    toParentKey = overId;
  }
  if (!toParentKey || fromParentKey === toParentKey) return null;
  return { activeId, fromParentKey, toParentKey };
}

// Spring-loaded delay before a hovered drop target shows its placeholder (and a
// folder expands). The placeholder/expand shift layout, so deferring them until
// the pointer settles keeps dragging *through* a folder (e.g. up out of one's
// own folder) smooth instead of the inserted row shoving the dragged item down.
const DRAG_DWELL_MS = 200;

function useManualThreadTreeDnd({
  containerId,
  enabled,
  rootItems,
}: UseManualThreadTreeDndArgs): ManualThreadTreeDndState | null {
  const lookup = useMemo(
    () => collectManualThreadTreeLookup(rootItems, containerId),
    [containerId, rootItems],
  );
  const updateThread = useUpdateThread();
  const setCollapsedFolders = useSetAtom(sidebarCollapsedFoldersAtom);
  // Whether a thread (vs. nothing droppable) is currently being dragged.
  const draggingThreadRef = useRef(false);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The drop target the dwell timer is counting toward (folder key or the loose
  // root container); null when the pointer isn't over a droppable target.
  const dwellParentKeyRef = useRef<string | null>(null);
  // The drop target currently showing an (empty) placeholder row, after dwell:
  // a folder key, or the loose root container id.
  const [dragOverParentKey, setDragOverParentKey] = useState<string | null>(
    null,
  );

  const clearDropDwell = useCallback(() => {
    if (dwellTimerRef.current !== null) {
      clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = null;
    }
    dwellParentKeyRef.current = null;
  }, []);

  useEffect(() => clearDropDwell, [clearDropDwell]);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const activeId = event.active.id;
      draggingThreadRef.current =
        typeof activeId === "string" && lookup.threadByItemId.has(activeId);
      clearDropDwell();
      setDragOverParentKey(null);
    },
    [clearDropDwell, lookup],
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      if (!enabled || !draggingThreadRef.current) return;
      const drop = resolveThreadDropTarget(lookup, event.active, event.over);
      // The drop target the placeholder will mark: a folder key, or the loose
      // root container. Null when the pointer isn't over a valid target.
      const targetParentKey = drop ? drop.toParentKey : null;

      // Same target as the in-flight dwell: nothing to do (don't thrash timers
      // on every pointer move).
      if (targetParentKey === dwellParentKeyRef.current) return;

      clearDropDwell();
      dwellParentKeyRef.current = targetParentKey;
      setDragOverParentKey((current) => (current ? null : current));
      if (targetParentKey === null) return;

      // Spring-loaded: reveal the placeholder (and expand a collapsed target
      // folder) only after the pointer settles, so passing through a folder
      // mid-drag doesn't shift it under the cursor. The loose root is never
      // collapsed, so it only gets the placeholder.
      dwellTimerRef.current = setTimeout(() => {
        dwellTimerRef.current = null;
        if (
          !draggingThreadRef.current ||
          dwellParentKeyRef.current !== targetParentKey
        ) {
          return;
        }
        if (targetParentKey !== containerId) {
          setCollapsedFolders((current) =>
            current.includes(targetParentKey)
              ? current.filter((key) => key !== targetParentKey)
              : current,
          );
        }
        setDragOverParentKey(targetParentKey);
      }, DRAG_DWELL_MS);
    },
    [clearDropDwell, containerId, enabled, lookup, setCollapsedFolders],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      draggingThreadRef.current = false;
      clearDropDwell();
      setDragOverParentKey(null);
      if (!enabled) return;

      const drop = resolveThreadDropTarget(lookup, event.active, event.over);
      if (!drop) return;

      const thread = lookup.threadByItemId.get(drop.activeId);
      if (!thread) return;

      const destinationFolderId =
        lookup.folderIdByParentKey.get(drop.toParentKey) ?? null;
      updateThread.mutate({
        id: drop.activeId,
        folderId: destinationFolderId,
      });
    },
    [clearDropDwell, enabled, lookup, updateThread],
  );

  const handleDragCancel = useCallback(() => {
    draggingThreadRef.current = false;
    clearDropDwell();
    setDragOverParentKey(null);
  }, [clearDropDwell]);

  const { consumeClickSuppression, dndContextProps, onClickCapture } =
    useSidebarReorderDnd({
      onDragEnd: handleDragEnd,
      onDragStart: handleDragStart,
      onDragOver: handleDragOver,
      onDragCancel: handleDragCancel,
    });

  if (!enabled) {
    return null;
  }

  return {
    consumeClickSuppression,
    dndContextProps,
    enabled,
    itemIdsByParentKey: lookup.itemIdsByParentKey,
    onClickCapture,
    dragOverParentKey,
  };
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

function ManualSortableList({
  children,
  manualSort,
  parentKey,
}: {
  children: ReactNode;
  manualSort?: ManualThreadTreeDndState | null;
  parentKey: string;
}) {
  if (!manualSort?.enabled) {
    return <>{children}</>;
  }

  return (
    <SortableContext
      items={[...(manualSort.itemIdsByParentKey.get(parentKey) ?? [])]}
      strategy={verticalListSortingStrategy}
    >
      {children}
    </SortableContext>
  );
}

// Registers the loose root as a droppable so drops onto its bare/empty area
// resolve to the loose container. Drop feedback is the inserted placeholder row
// (see the loose section), matching how folders preview a drop.
function ManualDroppableParent({
  children,
  className,
  manualSort,
  parentKey,
}: {
  children: ReactNode;
  className?: string;
  manualSort?: ManualThreadTreeDndState | null;
  parentKey: string;
}) {
  const { setNodeRef } = useDroppable({
    id: parentKey,
    disabled: !manualSort?.enabled,
  });

  return (
    <div ref={setNodeRef} className={className}>
      {children}
    </div>
  );
}

const ManualSortableThreadTreeItemRow = memo(
  function ManualSortableThreadTreeItemRow({
    manualSort,
    ...props
  }: ThreadTreeItemRowProps) {
    if (!manualSort?.enabled || props.item.kind === "environment") {
      return <ThreadTreeItemRow manualSort={manualSort} {...props} />;
    }

    if (props.item.kind === "folder") {
      return (
        <ManualDroppableFolderTreeItemRow {...props} manualSort={manualSort} />
      );
    }

    return (
      <ManualDraggableThreadTreeItemRow {...props} manualSort={manualSort} />
    );
  },
);

const ManualDraggableThreadTreeItemRow = memo(
  function ManualDraggableThreadTreeItemRow({
    manualSort,
    ...props
  }: ThreadTreeItemRowProps & { manualSort: ManualThreadTreeDndState }) {
    const itemId = getManualOrderItemKey(props.item);
    const { dragBindings, setNodeRef, style } = useSidebarSortable({
      id: itemId,
      disabled: false,
    });

    return (
      <ThreadTreeItemRow
        {...props}
        consumeClickSuppression={manualSort.consumeClickSuppression}
        dragBindings={dragBindings}
        manualSort={manualSort}
        sortableRef={setNodeRef}
        sortableStyle={style}
      />
    );
  },
);

const ManualDroppableFolderTreeItemRow = memo(
  function ManualDroppableFolderTreeItemRow({
    manualSort,
    ...props
  }: ThreadTreeItemRowProps & { manualSort: ManualThreadTreeDndState }) {
    const itemId = getManualOrderItemKey(props.item);
    const { isOver, setNodeRef } = useDroppable({ id: itemId });

    return (
      <ThreadTreeItemRow
        {...props}
        consumeClickSuppression={manualSort.consumeClickSuppression}
        isDropTargetActive={isOver}
        manualSort={manualSort}
        sortableRef={setNodeRef}
      />
    );
  },
);

function useArchiveEnvironmentThreadGroupAction({
  environmentId,
  projectId,
  selectedThreadId,
  threads,
}: UseArchiveEnvironmentThreadGroupActionArgs): UseArchiveEnvironmentThreadGroupActionResult {
  const navigate = useNavigate();
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
    (childActivity.pending || childActivity.working || childActivity.unread);
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
              "pointer-events-none absolute inset-0 flex items-center justify-center text-subtle-foreground",
            )}
          >
            <ThreadStatusGlyph
              hasPendingInteraction={childActivity.pending}
              isBusy={childActivity.runtimeWorking}
              isWorkflowActive={childActivity.workflow}
              showUnreadBadge={childActivity.unread}
              unreadBadgeTone={childActivity.unreadError ? "error" : "default"}
            />
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
            {nodes.map((node) => (
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
            ))}
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

export const ThreadTreeItemRow = memo(function ThreadTreeItemRow({
  projectId,
  item,
  depthOffset,
  selectedThreadId,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  variant,
  onProjectSelect,
  onCreateThreadInFolder,
  onViewArchivedThreadsInFolder,
  onRenameFolder,
  onRemoveFolder,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
  consumeClickSuppression,
  dragBindings,
  isDropTargetActive,
  manualSort,
  sortableRef,
  sortableStyle,
}: ThreadTreeItemRowProps) {
  if (item.kind === "folder") {
    return (
      <FolderTreeItemRow
        folder={item.group}
        depthOffset={depthOffset}
        selectedThreadId={selectedThreadId}
        collapsedThreadIds={collapsedThreadIds}
        collapsedEnvironmentIds={collapsedEnvironmentIds}
        variant={variant}
        onProjectSelect={onProjectSelect}
        onCreateThreadInFolder={onCreateThreadInFolder}
        onViewArchivedThreadsInFolder={onViewArchivedThreadsInFolder}
        onRenameFolder={onRenameFolder}
        onRemoveFolder={onRemoveFolder}
        onToggleThreadCollapsed={onToggleThreadCollapsed}
        onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
        consumeClickSuppression={consumeClickSuppression}
        dragBindings={dragBindings}
        isDropTargetActive={isDropTargetActive}
        manualSort={manualSort}
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

// A derived folder and its (recursively rendered) contents. Collapse state lives
// in sidebarCollapsedFoldersAtom — read here rather than threaded so the rest of
// the tree's prop wiring and memo equality stay untouched. Children render one
// depth deeper.
// Empty drop-slot rendered inside the (auto-expanded) hovered folder so the
// landing spot is visible. The dragged row itself carries the title (like
// dragging a queued message), so this placeholder stays intentionally blank.
export function DropPreviewRow({ depth }: { depth: number }) {
  return (
    <div
      aria-hidden="true"
      data-sidebar-folder-drop-preview="true"
      style={{ paddingLeft: getSidebarThreadRowPaddingLeft(depth) }}
      className={cn(
        SIDEBAR_ROW_BASE_CLASS,
        COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
        "pointer-events-none border border-dashed border-sidebar-border bg-sidebar-accent/40",
      )}
    />
  );
}

const FolderTreeItemRow = memo(function FolderTreeItemRow({
  folder,
  depthOffset,
  selectedThreadId,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  variant,
  onProjectSelect,
  onCreateThreadInFolder,
  onViewArchivedThreadsInFolder,
  onRenameFolder,
  onRemoveFolder,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
  consumeClickSuppression,
  dragBindings,
  isDropTargetActive = false,
  manualSort,
  sortableRef,
  sortableStyle,
}: FolderTreeItemRowProps) {
  const collapsedFolders = useAtomValue(sidebarCollapsedFoldersAtom);
  const setCollapsedFolders = useSetAtom(sidebarCollapsedFoldersAtom);
  const folderKey = folder.key;
  const isCollapsed = collapsedFolders.includes(folderKey);
  const handleToggleCollapsed = useCallback(() => {
    setCollapsedFolders((current) =>
      current.includes(folderKey)
        ? current.filter((key) => key !== folderKey)
        : [...current, folderKey],
    );
  }, [folderKey, setCollapsedFolders]);

  const headerDepth = getThreadRowDepth({ depthOffset, nodeDepth: 0, variant });
  const stickyLevel =
    depthOffset < SIDEBAR_STICKY_PARENT_DEPTH_CAP ? depthOffset : undefined;
  const showDropPreview = manualSort?.dragOverParentKey === folderKey;
  const showChildren = !isCollapsed && folder.items.length > 0;
  // Force the children area open while a thread is dragged over this folder so
  // the empty drop-placeholder row is visible even when the folder is empty.
  const showChildrenArea = showChildren || showDropPreview;

  return (
    <SidebarStickyGroup
      ref={sortableRef}
      style={sortableStyle}
      className={cn(
        "space-y-0.5 rounded-md transition-colors",
        isDropTargetActive &&
          "[&_.bb-sidebar-hover-actions-row]:!bg-sidebar-accent [&_.bb-sidebar-hover-actions-row]:!text-sidebar-accent-foreground",
      )}
    >
      <SidebarFolderRow
        name={folder.name}
        label={folder.name}
        depth={headerDepth}
        activity={folder.activity}
        consumeClickSuppression={consumeClickSuppression}
        dragBindings={dragBindings}
        isDropTargetActive={isDropTargetActive}
        isCollapsed={isCollapsed}
        onCreateThread={
          onCreateThreadInFolder
            ? () => onCreateThreadInFolder(folder.id)
            : undefined
        }
        onViewArchivedThreads={
          onViewArchivedThreadsInFolder
            ? () => onViewArchivedThreadsInFolder(folder.id)
            : undefined
        }
        onRename={onRenameFolder ? () => onRenameFolder(folder) : undefined}
        onRemove={onRemoveFolder ? () => onRemoveFolder(folder) : undefined}
        onToggleCollapsed={handleToggleCollapsed}
        stickyLevel={stickyLevel}
      />
      {showChildrenArea ? (
        <div className="relative space-y-px">
          <ThreadTreeGroupLine parentRowDepth={headerDepth} />
          {showChildren ? (
            <ManualSortableList manualSort={manualSort} parentKey={folder.key}>
              {folder.items.map((item) => (
                <ManualSortableThreadTreeItemRow
                  key={getItemKey(item)}
                  projectId={getItemProjectId(item)}
                  item={item}
                  depthOffset={depthOffset + 1}
                  selectedThreadId={selectedThreadId}
                  collapsedThreadIds={collapsedThreadIds}
                  collapsedEnvironmentIds={collapsedEnvironmentIds}
                  variant={variant}
                  onProjectSelect={onProjectSelect}
                  onCreateThreadInFolder={onCreateThreadInFolder}
                  onViewArchivedThreadsInFolder={onViewArchivedThreadsInFolder}
                  onRenameFolder={onRenameFolder}
                  onRemoveFolder={onRemoveFolder}
                  onToggleThreadCollapsed={onToggleThreadCollapsed}
                  onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
                  manualSort={manualSort}
                />
              ))}
            </ManualSortableList>
          ) : null}
          {showDropPreview ? (
            <DropPreviewRow
              depth={getThreadRowDepth({
                depthOffset: depthOffset + 1,
                nodeDepth: 0,
                variant,
              })}
            />
          ) : null}
        </div>
      ) : null}
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
  const rowProjectId =
    variant === "section" ? node.thread.projectId : projectId;
  const hasComposerDraft = usePromptDraftHasInput({
    kind: "thread",
    projectId: rowProjectId,
    threadId: node.thread.id,
  });
  const row = (
    <ThreadRow
      projectId={rowProjectId}
      thread={node.thread}
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
          {node.children.map((item) => (
            <ThreadTreeItemRow
              key={getItemKey(item)}
              projectId={projectId}
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
          ))}
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

interface ManualThreadTreeItemsProps {
  items: readonly ProjectThreadItem[];
  manualSort: ManualThreadTreeDndState | null;
  variant: ProjectThreadTreeVariant;
  // Route every row to this project; omit to derive each row's project from its
  // own thread (the cross-project Folders view).
  projectId?: string;
  depthOffset?: number;
  // Wrap the rows in a SortableContext for this parent. Omit when an outer
  // SortableList already provides the context (the split Folders/Threads view).
  sortableParentKey?: string;
  selectedThreadId?: string;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  onProjectSelect?: () => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  onCreateThreadInFolder?: (folderId: string) => void;
  onViewArchivedThreadsInFolder?: (folderId: string) => void;
  onRenameFolder?: (folder: SidebarFolderDefinition) => void;
  onRemoveFolder?: (folder: SidebarFolderDefinition) => void;
}

// The one place that maps thread-tree items to rows. Every sidebar view
// (project, flat chronological, folders) renders through this, so a row-prop
// change lands once instead of being copied across each view's renderer.
function ManualThreadTreeItems({
  items,
  manualSort,
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
  onCreateThreadInFolder,
  onViewArchivedThreadsInFolder,
  onRenameFolder,
  onRemoveFolder,
}: ManualThreadTreeItemsProps) {
  const rows = items.map((item) => (
    <ManualSortableThreadTreeItemRow
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
      onCreateThreadInFolder={onCreateThreadInFolder}
      onViewArchivedThreadsInFolder={onViewArchivedThreadsInFolder}
      onRenameFolder={onRenameFolder}
      onRemoveFolder={onRemoveFolder}
      manualSort={manualSort ?? undefined}
    />
  ));

  return (
    <ProjectThreadTreeGroup
      variant={variant}
      onClickCapture={manualSort?.onClickCapture}
    >
      {sortableParentKey !== undefined ? (
        <ManualSortableList
          manualSort={manualSort}
          parentKey={sortableParentKey}
        >
          {rows}
        </ManualSortableList>
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
  folders = EMPTY_FOLDERS,
  selectedThreadId,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  variant,
  onProjectSelect,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
}: ProjectThreadTreeProps) {
  const groupBy = "none" as const;
  const projectThreads =
    threadListState.status === "ready"
      ? threadListState.threads
      : EMPTY_PROJECT_THREADS;
  const rootItems = useMemo(
    () =>
      buildProjectThreadGroups(projectThreads, compareThreads, {
        groupBy,
        containerId: projectId,
        folders,
      }),
    [compareThreads, projectThreads, groupBy, projectId, folders],
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

  // Per-project trees always group by "none", so they never contain folder
  // items and never enable folder drag-and-drop (folders live only in the
  // cross-project Folders view; see ChronologicalFolderThreadSections). Rendering
  // without manual DnD keeps react-query mutations out of a tree that can never
  // use them.
  return (
    <ManualThreadTreeItems
      items={rootItems}
      manualSort={null}
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

// Flat Folders bucket: one top-level row per non-pinned thread across all
// projects, globally ordered by the chosen comparator before folder bucketing.
// It intentionally drops parent/child nesting and worktree grouping so nothing
// hides behind a collapsed parent. Derives projectId per row from its own
// thread so cross-project rows still route correctly.
export const ChronologicalThreadTree = memo(function ChronologicalThreadTree({
  threadListState,
  compareThreads,
  folders = EMPTY_FOLDERS,
  selectedThreadId,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  onProjectSelect,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
}: ChronologicalThreadTreeProps) {
  const groupBy = "folder" as const;
  const threads =
    threadListState.status === "ready"
      ? threadListState.threads
      : EMPTY_PROJECT_THREADS;
  const rootItems = useMemo(
    () =>
      buildChronologicalThreadList(threads, compareThreads, {
        groupBy,
        containerId: CHRONOLOGICAL_CONTAINER_ID,
        folders,
      }),
    [threads, compareThreads, groupBy, folders],
  );
  const manualSort = useManualThreadTreeDnd({
    containerId: CHRONOLOGICAL_CONTAINER_ID,
    enabled: hasFolderItems(rootItems),
    rootItems,
  });

  if (threadListState.status === "loading") {
    return <ThreadTreeLoadingSkeleton />;
  }

  if (rootItems.length === 0) {
    return (
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
  }

  const tree = (
    <ManualThreadTreeItems
      items={rootItems}
      manualSort={manualSort}
      variant="section"
      sortableParentKey={CHRONOLOGICAL_CONTAINER_ID}
      selectedThreadId={selectedThreadId}
      collapsedThreadIds={collapsedThreadIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      onProjectSelect={onProjectSelect}
      onToggleThreadCollapsed={onToggleThreadCollapsed}
      onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
    />
  );

  return manualSort ? (
    <DndContext {...manualSort.dndContextProps}>{tree}</DndContext>
  ) : (
    tree
  );
});

export const ChronologicalFolderThreadSections = memo(
  function ChronologicalFolderThreadSections({
    threadListState,
    compareThreads,
    folders = EMPTY_FOLDERS,
    selectedThreadId,
    collapsedThreadIds,
    collapsedEnvironmentIds,
    onProjectSelect,
    onCreateThreadInFolder,
    onViewArchivedThreadsInFolder,
    onRenameFolder,
    onRemoveFolder,
    onToggleThreadCollapsed,
    onToggleEnvironmentCollapsed,
    renderAllThreadsSection,
    renderFoldersSection,
    renderThreadsSection,
  }: ChronologicalFolderThreadSectionsProps) {
    const groupBy = "folder" as const;
    const threads =
      threadListState.status === "ready"
        ? threadListState.threads
        : EMPTY_PROJECT_THREADS;
    const rootItems = useMemo(
      () =>
        buildChronologicalThreadList(threads, compareThreads, {
          groupBy,
          containerId: CHRONOLOGICAL_CONTAINER_ID,
          folders,
        }),
      [threads, compareThreads, groupBy, folders],
    );
    const manualSort = useManualThreadTreeDnd({
      containerId: CHRONOLOGICAL_CONTAINER_ID,
      enabled: hasFolderItems(rootItems),
      rootItems,
    });
    const folderItems = rootItems.filter((item) => item.kind === "folder");
    const hasFolders = folderItems.length > 0;
    const looseItems = rootItems.filter((item) => item.kind !== "folder");

    // No sortableParentKey: the outer ManualSortableList below provides the
    // SortableContext spanning both the folders and loose-threads sections.
    const renderItems = (items: readonly ProjectThreadItem[]) => (
      <ManualThreadTreeItems
        items={items}
        manualSort={manualSort}
        variant="section"
        selectedThreadId={selectedThreadId}
        collapsedThreadIds={collapsedThreadIds}
        collapsedEnvironmentIds={collapsedEnvironmentIds}
        onProjectSelect={onProjectSelect}
        onToggleThreadCollapsed={onToggleThreadCollapsed}
        onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
        onCreateThreadInFolder={onCreateThreadInFolder}
        onViewArchivedThreadsInFolder={onViewArchivedThreadsInFolder}
        onRenameFolder={onRenameFolder}
        onRemoveFolder={onRemoveFolder}
      />
    );

    const foldersContent =
      threadListState.status === "loading" ? (
        <ThreadTreeLoadingSkeleton />
      ) : folderItems.length > 0 ? (
        renderItems(folderItems)
      ) : threadListState.status === "unavailable" ? (
        <EmptyState
          message="Folders unavailable"
          className={getProjectThreadTreeEmptyStateClassName("section")}
          messageClassName={getProjectThreadTreeEmptyStateMessageClassName()}
        />
      ) : null;
    // A thread dragged out of a folder previews its landing in the loose list
    // with the same inserted placeholder folders use (hiding the empty state so
    // the placeholder reads as the drop slot when the loose list is empty).
    const showLoosePreview =
      manualSort?.dragOverParentKey === CHRONOLOGICAL_CONTAINER_ID;
    const threadsListContent =
      threadListState.status === "loading" ? (
        <ThreadTreeLoadingSkeleton />
      ) : looseItems.length > 0 ? (
        renderItems(looseItems)
      ) : showLoosePreview ? null : (
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
    const threadsContent = manualSort?.enabled ? (
      <ManualDroppableParent
        manualSort={manualSort}
        parentKey={CHRONOLOGICAL_CONTAINER_ID}
      >
        {threadsListContent}
        {showLoosePreview ? (
          <DropPreviewRow
            depth={getThreadRowDepth({
              depthOffset: 0,
              nodeDepth: 0,
              variant: "section",
            })}
          />
        ) : null}
      </ManualDroppableParent>
    ) : (
      threadsListContent
    );

    const sections = (
      <ManualSortableList
        manualSort={manualSort}
        parentKey={CHRONOLOGICAL_CONTAINER_ID}
      >
        {hasFolders ? (
          <>
            {renderFoldersSection(foldersContent)}
            {renderThreadsSection(threadsContent)}
          </>
        ) : (
          renderAllThreadsSection(threadsContent)
        )}
      </ManualSortableList>
    );

    return manualSort ? (
      <DndContext {...manualSort.dndContextProps}>{sections}</DndContext>
    ) : (
      sections
    );
  },
);

function ProjectRowComponent({
  project,
  threadListState,
  selectedThreadId,
  isActive,
  isCollapsed,
  compareThreads,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  isLocalPathInvalid,
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
  const isActionsOpen = isDropdownActionsOpen || isContextActionsOpen;
  const handleProjectRowClickCapture =
    useCallback<ProjectItemClickCaptureHandler>(
      (event) => {
        if (!consumeProjectClickSuppression?.()) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
      },
      [consumeProjectClickSuppression],
    );
  const handleProjectRowToggle = useCallback(() => {
    onToggleProjectCollapsed(project.id);
  }, [onToggleProjectCollapsed, project.id]);
  const handleCreateThread = useCallback(() => {
    onCreateProjectThread?.(project.id);
  }, [onCreateProjectThread, project.id]);
  return (
    <SidebarStickyGroup asChild data-sidebar-sticky-project-item="">
      <SidebarMenuItem
        ref={projectRowRef}
        style={projectRowStyle}
        onClickCapture={handleProjectRowClickCapture}
      >
        <ProjectActionsContextMenu
          project={project}
          onOpenChange={setIsContextActionsOpen}
        >
          <SidebarStickyTier
            ref={projectDragBindings?.setActivatorNodeRef}
            tier="project"
            className={cn(
              SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
              "group/project-row flex w-full items-center rounded-md text-sm",
              LIST_HOVER_TRANSITION,
              isActive
                ? SIDEBAR_ROW_SELECTED_STATE_CLASS
                : SIDEBAR_ROW_STATIC_STATE_CLASS,
              projectDragBindings &&
                !projectDragBindings.disabled &&
                "select-none",
            )}
            {...projectDragBindings?.attributes}
            {...(projectDragBindings?.listeners ?? {})}
          >
            <span
              className={cn(
                "pointer-events-none relative z-10 flex shrink-0 items-center justify-center rounded-md text-muted-foreground",
                PROJECT_ROW_LEADING_SLOT_CLASS,
                LIST_HOVER_TRANSITION,
              )}
              aria-hidden
            >
              <Icon
                name={isCollapsed ? "Folder" : "FolderOpen"}
                className={COARSE_POINTER_ICON_SIZE_CLASS}
              />
            </span>
            <span className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-1.5 text-left">
              <span className="min-w-0 truncate" title={project.name}>
                {project.name}
              </span>
              <SidebarChildToggleChevron
                isCollapsed={isCollapsed}
                expandLabel={`Expand ${project.name}`}
                collapseLabel={`Collapse ${project.name}`}
                onToggle={handleProjectRowToggle}
                revealOnHover
              />
            </span>
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
            <span
              data-sidebar-hover-actions-open={
                isActionsOpen ? "true" : undefined
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
          </SidebarStickyTier>
        </ProjectActionsContextMenu>

        {!isCollapsed ? (
          <ProjectThreadTree
            projectId={project.id}
            threadListState={threadListState}
            selectedThreadId={selectedThreadId}
            collapsedThreadIds={collapsedThreadIds}
            collapsedEnvironmentIds={collapsedEnvironmentIds}
            compareThreads={compareThreads}
            variant="project"
            onProjectSelect={onProjectSelect}
            onToggleThreadCollapsed={onToggleThreadCollapsed}
            onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
          />
        ) : null}
      </SidebarMenuItem>
    </SidebarStickyGroup>
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
