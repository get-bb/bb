import {
  memo,
  useCallback,
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { useSetAtom } from "jotai";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import {
  getThreadConversationCollapsedAtom,
} from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import { Icon } from "@/components/ui/icon.js";
import { SidebarStickyTier } from "@/components/ui/sidebar.js";
import { NavLink } from "react-router-dom";
import {
  ThreadActionsContextMenu,
  ThreadActionsMenu,
} from "@/components/thread/ThreadActionsMenu";
import {
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_DOT_SIZE_CLASS,
  COARSE_POINTER_GLYPH_BOX_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
  COARSE_POINTER_ROW_HEIGHT_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions.js";
import {
  isBusyThread,
  isUnreadDoneThread,
  NO_COLLAPSED_CHILD_ACTIVITY,
  type CollapsedChildActivity,
} from "@/lib/thread-activity";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { getThreadRoutePath } from "@/lib/route-paths";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_GLYPH_SLOT_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  SIDEBAR_UNREAD_DOT_CLASS_BY_TONE,
  getSidebarThreadRowPaddingLeft,
  type SidebarUnreadDotTone,
} from "./sidebarRowClasses";
import {
  getEnvironmentWorkspaceDisplayIconLabel,
  getEnvironmentWorkspaceDisplayIconName,
} from "@/lib/environment-workspace-display";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import type { SidebarSortableDragBindings } from "./sortableMotion";
import { SidebarChildToggleChevron } from "./SidebarChildToggleChevron";

interface ThreadRowBaseOptions {
  depth: number;
  isCompact: boolean;
  // True when this row is nested under a worktree group header (2+ threads share
  // the env). The header already shows the worktree glyph, so the row suppresses
  // its own leading worktree glyph to avoid repeating it.
  isEnvGrouped: boolean;
}

export type ThreadRowOptions =
  | (ThreadRowBaseOptions & {
      kind: "default";
    })
  | (ThreadRowBaseOptions & {
      kind: "parent";
      isCollapsed: boolean;
      childCount: number;
      childActivity: CollapsedChildActivity;
      // Depth among pinned parents when this row is sticky; absent = not pinned
      // (deeper than the sticky cap, or not a sticky parent role).
      stickyLevel?: number;
      onToggleCollapsed: (threadId: string) => void;
      consumeClickSuppression?: ConsumeDragClickSuppression;
      dragBindings?: SidebarSortableDragBindings;
    });

interface ThreadRowProps {
  projectId: string;
  thread: ThreadListEntry;
  isActive: boolean;
  hasComposerDraft: boolean;
  onProjectSelect?: () => void;
  options: ThreadRowOptions;
}

type ThreadRowClickCaptureHandler = MouseEventHandler<HTMLDivElement>;

interface ThreadRowContainerArgs {
  children: ReactNode;
  className: string;
  dragBindings?: SidebarSortableDragBindings;
  onClickCapture?: ThreadRowClickCaptureHandler;
  stickyLevel?: number;
  style: CSSProperties;
}

function ThreadDraftIndicator() {
  return (
    <Icon
      name="Edit"
      className="pointer-events-none size-3.5 shrink-0 text-muted-foreground"
      aria-hidden="true"
    />
  );
}

function getThreadRowStyle(depth: number): CSSProperties {
  return {
    paddingLeft: getSidebarThreadRowPaddingLeft(depth),
  };
}

function renderThreadRowContainer({
  children,
  className,
  dragBindings,
  onClickCapture,
  stickyLevel,
  style,
}: ThreadRowContainerArgs) {
  if (stickyLevel !== undefined) {
    return (
      <SidebarStickyTier
        ref={dragBindings?.setActivatorNodeRef}
        tier="parent"
        level={stickyLevel}
        className={className}
        style={style}
        {...dragBindings?.attributes}
        {...(dragBindings?.listeners ?? {})}
        onClickCapture={onClickCapture}
      >
        {children}
      </SidebarStickyTier>
    );
  }

  return (
    <div className={className} style={style} onClickCapture={onClickCapture}>
      {children}
    </div>
  );
}

interface ThreadStatusGlyphProps {
  hasPendingInteraction: boolean;
  isBusy: boolean;
  showUnreadBadge: boolean;
  unreadBadgeTone: SidebarUnreadDotTone;
}

interface ThreadUnreadBadgeLabelArgs {
  tone: SidebarUnreadDotTone;
}

export function ThreadStatusGlyph({
  hasPendingInteraction,
  isBusy,
  showUnreadBadge,
  unreadBadgeTone,
}: ThreadStatusGlyphProps) {
  if (hasPendingInteraction) {
    return (
      <span
        className={cn(
          "rounded-full bg-attention",
          COARSE_POINTER_DOT_SIZE_CLASS,
        )}
        aria-label="Pending interaction requires attention"
        title="Pending interaction"
      />
    );
  }

  if (isBusy) {
    return (
      <Icon
        name="CircleDashed"
        className={cn(
          "animate-spin text-muted-foreground",
          COARSE_POINTER_ICON_SIZE_CLASS,
        )}
        aria-label="Thread working"
      />
    );
  }

  if (showUnreadBadge) {
    const label = getThreadUnreadBadgeLabel({ tone: unreadBadgeTone });
    return (
      <span
        className={SIDEBAR_UNREAD_DOT_CLASS_BY_TONE[unreadBadgeTone]}
        aria-label={label}
        title={label}
      />
    );
  }

  return null;
}

function getThreadUnreadBadgeLabel({
  tone,
}: ThreadUnreadBadgeLabelArgs): string {
  return tone === "error"
    ? "Unread thread encountered an error"
    : "Unread thread requires attention";
}

// The right edge of a thread row is reserved for status (pending/busy/unread).
// Worktree identity is conveyed by the leading environment-group header, never
// a trailing icon, so the row reads one way regardless of grouping.
function ThreadTrailingIndicator({
  hasPendingInteraction,
  isBusy,
  showUnreadBadge,
  unreadBadgeTone,
}: ThreadStatusGlyphProps) {
  const showStatusGlyph = hasPendingInteraction || isBusy || showUnreadBadge;

  if (!showStatusGlyph) {
    return null;
  }

  return (
    <span
      className={cn(SIDEBAR_ROW_GLYPH_SLOT_CLASS, COARSE_POINTER_GLYPH_BOX_CLASS)}
    >
      <ThreadStatusGlyph
        hasPendingInteraction={hasPendingInteraction}
        isBusy={isBusy}
        showUnreadBadge={showUnreadBadge}
        unreadBadgeTone={unreadBadgeTone}
      />
    </span>
  );
}

function ThreadRowComponent({
  projectId,
  thread,
  isActive,
  hasComposerDraft,
  onProjectSelect,
  options,
}: ThreadRowProps) {
  const [isDropdownActionsOpen, setIsDropdownActionsOpen] = useState(false);
  const [isContextActionsOpen, setIsContextActionsOpen] = useState(false);
  const setConversationCollapsed = useSetAtom(
    getThreadConversationCollapsedAtom(thread.id),
  );
  const showActive = isActive;
  const hasPendingInteraction = thread.hasPendingInteraction;
  const threadIsBusy = isBusyThread(thread) && !hasPendingInteraction;
  const showUnreadBadge = !hasPendingInteraction && isUnreadDoneThread(thread);
  const unreadBadgeTone: SidebarUnreadDotTone =
    showUnreadBadge && thread.status === "error" ? "error" : "default";
  const threadTitle = getThreadDisplayTitle(thread);
  const parentOptions = options.kind === "parent" ? options : null;
  const isParentRow = parentOptions !== null;
  const isParentCollapsed = parentOptions?.isCollapsed ?? false;
  const childCount = parentOptions?.childCount ?? 0;
  const childActivity =
    parentOptions?.childActivity ?? NO_COLLAPSED_CHILD_ACTIVITY;
  const hasChildren = childCount > 0;
  // A collapsed parent hides its descendants behind one glyph, so it must
  // surface its own status combined with the rolled-up child activity. Expanded
  // parents and leaves show only their own status.
  const hasHiddenChildren = isParentRow && isParentCollapsed && hasChildren;
  const trailingHasPendingInteraction = hasHiddenChildren
    ? hasPendingInteraction || childActivity.pending
    : hasPendingInteraction;
  const trailingIsBusy = hasHiddenChildren
    ? threadIsBusy || childActivity.working
    : threadIsBusy;
  const trailingShowUnreadBadge = hasHiddenChildren
    ? showUnreadBadge || childActivity.unread
    : showUnreadBadge;
  const trailingUnreadBadgeTone: SidebarUnreadDotTone =
    hasHiddenChildren && childActivity.unreadError ? "error" : unreadBadgeTone;
  const linkLabel = hasComposerDraft
    ? `Open ${threadTitle} (unsubmitted draft)`
    : `Open ${threadTitle}`;
  const linkTitle = linkLabel;
  // A lone worktree thread (not nested under a worktree group header) carries a
  // leading worktree glyph so its environment reads at a glance, keeping the
  // worktree indicator in the same leading position as the group header. Forks
  // already lead with the Fork glyph, so they don't also show it.
  const leadingWorktreeIcon =
    options.isEnvGrouped || thread.childOrigin === "fork"
      ? null
      : getEnvironmentWorkspaceDisplayIconName(
          thread.environmentWorkspaceDisplayKind,
        );
  const leadingWorktreeIconLabel =
    leadingWorktreeIcon === null
      ? null
      : getEnvironmentWorkspaceDisplayIconLabel(
          thread.environmentWorkspaceDisplayKind,
        );
  // A thread that lives in no project (the "Threads" section) leads with the
  // same "Don't work in a project" glyph the composer uses, so its lack of a
  // project reads at a glance — shown only when no fork/worktree glyph already
  // occupies the leading slot.
  const showNoProjectIcon =
    thread.projectId === PERSONAL_PROJECT_ID &&
    thread.childOrigin !== "fork" &&
    leadingWorktreeIcon === null;
  const parentDragBindings = parentOptions?.dragBindings;
  const rowClassName = cn(
    SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
    "group/thread-row",
    SIDEBAR_ROW_BASE_CLASS,
    parentOptions?.stickyLevel === undefined && "relative",
    options.isCompact
      ? COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS
      : COARSE_POINTER_ROW_HEIGHT_CLASS,
    showActive
      ? "bg-sidebar-border text-sidebar-foreground"
      : SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
    parentDragBindings &&
      !parentDragBindings.disabled &&
      "select-none cursor-grab active:cursor-grabbing",
  );
  const rowStyle = getThreadRowStyle(options.depth);
  const isActionsOpen = isDropdownActionsOpen || isContextActionsOpen;
  const handleParentClickCapture = useCallback<ThreadRowClickCaptureHandler>(
    (event) => {
      if (!parentOptions?.consumeClickSuppression?.()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [parentOptions],
  );

  const rowContent = (
    <>
      <NavLink
        to={getThreadRoutePath({ projectId, threadId: thread.id })}
        onClick={() => {
          // Selecting a thread/agent row restores its conversation without
          // disturbing any other thread's collapsed conversation state.
          setConversationCollapsed(false);
          onProjectSelect?.();
        }}
        aria-label={linkLabel}
        title={linkTitle}
        className="absolute inset-0 rounded-md outline-none ring-sidebar-ring focus-visible:ring-2"
      />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {/*
          Leading disclosure slot, unified with every other expandable row: the
          caret toggles children (the row body still navigates). Leaves get an
          equal-width spacer so all titles align in one column, file-tree style.
        */}
        {parentOptions && hasChildren ? (
          <span className="relative z-10 -ml-1 inline-flex shrink-0">
            <SidebarChildToggleChevron
              isCollapsed={isParentCollapsed}
              expandLabel={`Expand ${threadTitle} threads`}
              collapseLabel={`Collapse ${threadTitle} threads`}
              expandTitle="Expand child threads"
              collapseTitle="Collapse child threads"
              onToggle={() => parentOptions.onToggleCollapsed(thread.id)}
              revealOnHover={!isParentCollapsed}
            />
          </span>
        ) : (
          <span className="-ml-1 size-5 shrink-0" aria-hidden="true" />
        )}
        {/*
          Identity glyph (fork / worktree), rendered only when present. An empty
          column is NOT reserved: a glyph-less row's title sits right after the
          caret (no dead gap), and a worktree-group child — which suppresses its
          glyph — lands in the same column as a sibling fork's leading icon
          rather than being pushed a column further right.
        */}
        {thread.childOrigin === "fork" ? (
          <span
            className="inline-flex w-4 shrink-0 items-center justify-center"
            title="Forked thread"
          >
            <Icon
              name="Fork"
              className="size-3.5 text-muted-foreground"
              aria-label="Forked thread"
            />
          </span>
        ) : leadingWorktreeIcon ? (
          <span
            className="inline-flex w-4 shrink-0 items-center justify-center"
            title={leadingWorktreeIconLabel ?? undefined}
          >
            <Icon
              name={leadingWorktreeIcon}
              className="size-3.5 text-muted-foreground"
              aria-label={leadingWorktreeIconLabel ?? undefined}
            />
          </span>
        ) : showNoProjectIcon ? (
          <span
            className="inline-flex w-4 shrink-0 items-center justify-center"
            title="Not in a project"
          >
            <Icon
              name="FolderMinus"
              className="size-3.5 text-muted-foreground"
              aria-label="Not in a project"
            />
          </span>
        ) : null}
        <span className="min-w-0 truncate">{threadTitle}</span>
        {hasComposerDraft ? <ThreadDraftIndicator /> : null}
      </span>
      <span
        className={cn(
          "flex shrink-0 items-center justify-end max-md:pointer-coarse:pointer-events-none",
          COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
        )}
      >
        <span
          className={cn(
            "relative shrink-0",
            COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
          )}
        >
          <span
            data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
            className={cn(
              SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
              "absolute inset-0 flex items-center justify-center",
            )}
          >
            <ThreadTrailingIndicator
              hasPendingInteraction={trailingHasPendingInteraction}
              isBusy={trailingIsBusy}
              showUnreadBadge={trailingShowUnreadBadge}
              unreadBadgeTone={trailingUnreadBadgeTone}
            />
          </span>
          <div
            data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
            className={cn(
              SIDEBAR_HOVER_ACTIONS_CLASS,
              "absolute inset-0 z-10 flex items-center justify-end max-md:pointer-coarse:hidden",
            )}
          >
            <ThreadActionsMenu
              thread={thread}
              triggerClassName={cn(
                "text-muted-foreground",
                COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
              )}
              onOpenChange={setIsDropdownActionsOpen}
            />
          </div>
        </span>
      </span>
    </>
  );

  const row = renderThreadRowContainer({
    children: rowContent,
    className: rowClassName,
    dragBindings: parentDragBindings,
    onClickCapture: parentOptions ? handleParentClickCapture : undefined,
    stickyLevel: parentOptions?.stickyLevel,
    style: rowStyle,
  });

  return (
    <ThreadActionsContextMenu
      thread={thread}
      onOpenChange={setIsContextActionsOpen}
    >
      {row}
    </ThreadActionsContextMenu>
  );
}

export const ThreadRow = memo(ThreadRowComponent);
