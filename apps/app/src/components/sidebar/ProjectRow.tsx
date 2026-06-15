import {
  memo,
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import type { ThreadListEntry } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import { NavLink, useNavigate } from "react-router-dom";
import { useCreateThreadInWorktree } from "@/hooks/useCreateThreadInWorktree";
import { usePromptDraftHasInput } from "@/hooks/usePromptDraftStorage";
import {
  useArchiveEnvironmentThreads,
  useUpdateEnvironment,
} from "@/hooks/mutations/environment-mutations";
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
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions.js";
import type { CollapsedChildActivity } from "@/lib/thread-activity";
import { cn } from "@/lib/utils";
import { getEnvironmentWorkspaceLabelIconName } from "@/lib/environment-workspace-display";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { getProjectSettingsRoutePath } from "@/lib/route-paths";
import { appToast } from "@/components/ui/app-toast";
import {
  ThreadRow,
  ThreadStatusGlyph,
  type ThreadRowOptions,
} from "./ThreadRow";
import {
  buildProjectThreadGroups,
  type EnvironmentThreadGroup,
  type ProjectThreadItem,
  type ProjectThreadNode,
} from "./projectThreadGroups";
import {
  SIDEBAR_PROJECT_GROUP_LINE_CLASS,
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  getSidebarThreadGroupLineLeft,
  getSidebarThreadRowPaddingLeft,
} from "./sidebarRowClasses";
import { type SidebarSortableDragBindings } from "./sortableMotion";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import { SidebarChildToggleChevron } from "./SidebarChildToggleChevron";

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
  selectedThreadId?: string;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  variant: ProjectThreadTreeVariant;
  onProjectSelect?: () => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
}

export type ProjectThreadTreeVariant = "project" | "section";

type ProjectItemClickCaptureHandler = MouseEventHandler<HTMLLIElement>;
type ProjectThreadListClickCaptureHandler = MouseEventHandler<HTMLDivElement>;

const EMPTY_PROJECT_THREADS: ThreadListEntry[] = [];
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
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
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

function getProjectThreadTreeEmptyStateMessageClassName(
  variant: ProjectThreadTreeVariant,
): string {
  return cn(
    "text-xs leading-4",
    variant === "project"
      ? "font-medium text-sidebar-foreground/85"
      : "text-muted-foreground",
  );
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
    isEnvGrouped,
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
    ...(consumeClickSuppression ? { consumeClickSuppression } : {}),
    ...(dragBindings ? { dragBindings } : {}),
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
      className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-border-hairline"
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
      className="pointer-events-none absolute -bottom-0.5 top-0 z-[1] w-px bg-border-hairline"
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

function formatArchivedWorktreeThreadMessage(threadCount: number): string {
  return threadCount === 1
    ? "Archived 1 worktree thread"
    : `Archived ${threadCount} worktree threads`;
}

function useArchiveEnvironmentThreadGroupAction({
  environmentId,
  projectId,
  selectedThreadId,
}: UseArchiveEnvironmentThreadGroupActionArgs): UseArchiveEnvironmentThreadGroupActionResult {
  const navigate = useNavigate();
  const archiveEnvironmentThreads = useArchiveEnvironmentThreads();
  const {
    isPending: archiveThreadsIsPending,
    mutate: archiveThreads,
    variables,
  } = archiveEnvironmentThreads;
  const archiveThreadsPending =
    archiveThreadsIsPending && variables?.id === environmentId;
  const onArchiveThreads = useCallback(() => {
    archiveThreads(
      { id: environmentId },
      {
        onSuccess: (response) => {
          appToast.success(
            formatArchivedWorktreeThreadMessage(
              response.archivedThreadIds.length,
            ),
          );
          if (
            selectedThreadId &&
            response.archivedThreadIds.includes(selectedThreadId)
          ) {
            navigate(`/projects/${projectId}`);
          }
        },
      },
    );
  }, [archiveThreads, environmentId, navigate, projectId, selectedThreadId]);

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
            title="Worktree actions"
            className={cn(
              "rounded-md p-0 text-muted-foreground",
              COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
            )}
          >
            <Icon
              name="MoreHorizontal"
              className={COARSE_POINTER_ICON_SIZE_CLASS}
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {onCreateNewThread ? (
            <DropdownMenuItem onSelect={onCreateNewThread}>
              New thread
            </DropdownMenuItem>
          ) : null}
          {onRenameEnvironment ? (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                onRenameEnvironment();
              }}
            >
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
  const headerTitle = environmentName
    ? branchName
      ? `${environmentName} (${branchName})`
      : environmentName
    : branchName
      ? `Worktree: ${branchName}`
      : "Worktree";
  const iconName = getEnvironmentWorkspaceLabelIconName(
    representativeThread.environmentWorkspaceDisplayKind,
  );
  // Collapsed: the header speaks for its hidden children through one status
  // glyph (pending > working > unread). Expanded: the children show their own
  // glyphs, and the synthetic header has no status of its own.
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
    SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  );
  const style = {
    paddingLeft: getSidebarThreadRowPaddingLeft(rowDepth),
  };
  const content = (
    <>
      {parentLineDepth === undefined ? null : (
        <ThreadTreeLineContinuation parentRowDepth={parentLineDepth} />
      )}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => {
          onToggleCollapsed(environmentId);
        }}
        className="absolute inset-0 rounded-md outline-none ring-sidebar-ring focus-visible:ring-2"
      />
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
      <span className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-1.5 text-left">
        <span className="min-w-0 truncate">
          <span>{environmentName ?? "Worktree"}</span>
          {branchName ? (
            <>
              <span>{environmentName ? " · " : ": "}</span>
              <span className="text-muted-foreground">{branchName}</span>
            </>
          ) : null}
        </span>
        <SidebarChildToggleChevron
          isCollapsed={isCollapsed}
          expandLabel={`Expand ${headerTitle} threads`}
          collapseLabel={`Collapse ${headerTitle} threads`}
          expandTitle="Expand worktree threads"
          collapseTitle="Collapse worktree threads"
          onToggle={() => onToggleCollapsed(environmentId)}
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
              isBusy={childActivity.working}
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
        title={headerTitle}
      >
        {content}
      </SidebarStickyTier>
    );
  }

  return (
    <div className={className} style={style} title={headerTitle}>
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
  const { archiveThreadsPending, onArchiveThreads } =
    useArchiveEnvironmentThreadGroupAction({
      environmentId,
      projectId,
      selectedThreadId,
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

const ThreadTreeItemRow = memo(function ThreadTreeItemRow({
  projectId,
  item,
  depthOffset,
  selectedThreadId,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  variant,
  onProjectSelect,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
}: ThreadTreeItemRowProps) {
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
  const hasComposerDraft = usePromptDraftHasInput({
    projectId,
    threadId: node.thread.id,
  });
  const row = (
    <ThreadRow
      projectId={projectId}
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
              key={
                item.kind === "thread"
                  ? `thread:${item.node.thread.id}`
                  : `env:${item.group.environmentId}`
              }
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

export const ProjectThreadTree = memo(function ProjectThreadTree({
  projectId,
  threadListState,
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
  const rootItems = useMemo(
    () => buildProjectThreadGroups(projectThreads),
    [projectThreads],
  );

  if (threadListState.status === "loading") {
    return (
      <div className="group-data-[collapsible=icon]:hidden">
        <SidebarMenuSkeleton />
      </div>
    );
  }

  if (projectThreads.length === 0) {
    const emptyState = (
      <EmptyState
        message={
          threadListState.status === "unavailable"
            ? "Threads unavailable"
            : "No threads"
        }
        icon={getProjectThreadTreeEmptyStateIcon(variant)}
        className={getProjectThreadTreeEmptyStateClassName(variant)}
        iconClassName="size-3.5"
        messageClassName={getProjectThreadTreeEmptyStateMessageClassName(
          variant,
        )}
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
    <ProjectThreadTreeGroup variant={variant}>
      {rootItems.map((item) => (
        <ThreadTreeItemRow
          key={
            item.kind === "thread"
              ? `thread:${item.node.thread.id}`
              : `env:${item.group.environmentId}`
          }
          projectId={projectId}
          item={item}
          depthOffset={0}
          selectedThreadId={selectedThreadId}
          collapsedThreadIds={collapsedThreadIds}
          collapsedEnvironmentIds={collapsedEnvironmentIds}
          variant={variant}
          onProjectSelect={onProjectSelect}
          onToggleThreadCollapsed={onToggleThreadCollapsed}
          onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
        />
      ))}
    </ProjectThreadTreeGroup>
  );
});

function ProjectRowComponent({
  project,
  threadListState,
  selectedThreadId,
  isActive,
  isCollapsed,
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
              "group/project-row flex w-full items-center rounded-md text-sm transition-colors",
              isActive
                ? "bg-sidebar-border text-sidebar-foreground"
                : SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
              projectDragBindings &&
                !projectDragBindings.disabled &&
                "select-none cursor-grab active:cursor-grabbing",
            )}
            title={project.name}
            {...projectDragBindings?.attributes}
            {...(projectDragBindings?.listeners ?? {})}
          >
            <button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              onClick={handleProjectRowToggle}
              className="absolute inset-0 rounded-md outline-none ring-sidebar-ring focus-visible:ring-2"
            />
            <span
              className={cn(
                "pointer-events-none relative z-10 flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors group-hover/project-row:text-sidebar-foreground",
                PROJECT_ROW_LEADING_SLOT_CLASS,
              )}
              aria-hidden
            >
              <Icon
                name={isCollapsed ? "Folder" : "FolderOpen"}
                className={COARSE_POINTER_ICON_SIZE_CLASS}
              />
            </span>
            <span className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-1.5 text-left">
              <span className="min-w-0 truncate">{project.name}</span>
              <SidebarChildToggleChevron
                isCollapsed={isCollapsed}
                expandLabel={`Expand ${project.name}`}
                collapseLabel={`Collapse ${project.name}`}
                expandTitle="Expand project threads"
                collapseTitle="Collapse project threads"
                onToggle={handleProjectRowToggle}
              />
            </span>
            {isLocalPathInvalid ? (
              <NavLink
                to={getProjectSettingsRoutePath(project.id)}
                onClick={(event) => {
                  event.stopPropagation();
                  onProjectSelect?.();
                }}
                title="Project folder not found. Open project settings to fix."
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
              )}
            >
              <ProjectActionsMenu
                project={project}
                onOpenChange={setIsDropdownActionsOpen}
                triggerClassName={cn(
                  "relative z-10 text-muted-foreground",
                  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
                )}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`New thread in ${project.name}`}
                title="New thread"
                disabled={!onCreateProjectThread}
                onClick={(event) => {
                  event.stopPropagation();
                  handleCreateThread();
                }}
                className={cn(
                  "rounded-md p-0 text-muted-foreground",
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
