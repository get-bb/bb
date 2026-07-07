import {
  memo,
  useCallback,
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { useSetAtom } from "jotai";
import type { ThreadListEntry } from "@bb/domain";
import { getThreadConversationCollapsedAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import { Icon } from "@bb/shared-ui/icon";
import { SidebarStickyTier } from "@/components/ui/sidebar.js";
import { NavLink } from "react-router-dom";
import {
  ThreadActionsContextMenu,
  ThreadActionsMenu,
} from "@/components/thread/ThreadActionsMenu";
import {
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_GLYPH_BOX_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
  COARSE_POINTER_ROW_HEIGHT_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions.js";
import {
  hasActiveWorkflowActivity,
  isBusyThread,
  isRuntimeBusyThread,
  isUnreadDoneThread,
  NO_COLLAPSED_CHILD_ACTIVITY,
  type CollapsedChildActivity,
} from "@/lib/thread-activity";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { getThreadRoutePath } from "@/lib/route-paths";
import { cn } from "@bb/shared-ui/lib/utils";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import {
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_GLYPH_SLOT_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  SIDEBAR_ROW_SELECTED_STATE_CLASS,
  SIDEBAR_MORE_ACTION_TRIGGER_CLASS,
  SIDEBAR_SUCCESS_STATUS_DOT_CLASS,
  SIDEBAR_WORKING_STATUS_COLOR_CLASS,
  getSidebarThreadRowPaddingLeft,
  type SidebarUnreadDotTone,
} from "./sidebarRowClasses";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import type { SidebarSortableDragBindings } from "./sortableMotion";
import { SidebarChildToggleChevron } from "./SidebarChildToggleChevron";

interface ThreadRowBaseOptions {
  depth: number;
  isCompact: boolean;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  dragBindings?: SidebarSortableDragBindings;
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
    });

interface ThreadRowProps {
  projectId: string;
  thread: ThreadListEntry;
  isActive: boolean;
  hasComposerDraft: boolean;
  onProjectSelect?: () => void;
  options: ThreadRowOptions;
  // Visible row text override. Defaults to the thread title.
  displayTitle?: string;
  // Accessible name + hover tooltip override. Defaults to the thread title.
  accessibleTitle?: string;
}

type ThreadRowClickCaptureHandler = MouseEventHandler<HTMLDivElement>;

interface ThreadRowContainerArgs {
  children: ReactNode;
  className: string;
  dragBindings?: SidebarSortableDragBindings;
  onClickCapture?: ThreadRowClickCaptureHandler;
  showDragCursor: boolean;
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
  showDragCursor,
  stickyLevel,
  style,
}: ThreadRowContainerArgs) {
  // Draggable rows show a grab cursor over the whole row.
  const containerClassName = cn(
    className,
    showDragCursor && "cursor-grab active:cursor-grabbing",
  );
  if (stickyLevel !== undefined) {
    return (
      <SidebarStickyTier
        ref={dragBindings?.setActivatorNodeRef}
        tier="parent"
        level={stickyLevel}
        className={containerClassName}
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
    <div
      ref={dragBindings?.setActivatorNodeRef}
      className={containerClassName}
      style={style}
      {...dragBindings?.attributes}
      {...(dragBindings?.listeners ?? {})}
      onClickCapture={onClickCapture}
    >
      {children}
    </div>
  );
}

interface ThreadStatusGlyphProps {
  hasPendingInteraction: boolean;
  isBusy: boolean;
  isWorkflowActive: boolean;
  showUnreadBadge: boolean;
  unreadBadgeTone: SidebarUnreadDotTone;
}

interface ThreadUnreadBadgeLabelArgs {
  tone: SidebarUnreadDotTone;
}

export function ThreadStatusGlyph({
  hasPendingInteraction,
  isBusy,
  isWorkflowActive,
  showUnreadBadge,
  unreadBadgeTone,
}: ThreadStatusGlyphProps) {
  if (showUnreadBadge && unreadBadgeTone === "error") {
    const label = getThreadUnreadBadgeLabel({ tone: unreadBadgeTone });
    return (
      <Icon
        name="CircleX"
        className={cn("text-destructive", COARSE_POINTER_ICON_SIZE_CLASS)}
        aria-label={label}
      />
    );
  }

  if (hasPendingInteraction) {
    return (
      <Icon
        name="MessageQuestion"
        className={cn(
          "text-muted-foreground/75",
          COARSE_POINTER_ICON_SIZE_CLASS,
        )}
        aria-label="Thread needs user input"
      />
    );
  }

  if (isWorkflowActive) {
    return (
      <Icon
        name="Workflow"
        className={cn(
          "animate-shine-icon",
          SIDEBAR_WORKING_STATUS_COLOR_CLASS,
          COARSE_POINTER_ICON_SIZE_CLASS,
        )}
        aria-label="Workflow running"
      />
    );
  }

  if (showUnreadBadge) {
    const label = getThreadUnreadBadgeLabel({ tone: unreadBadgeTone });
    return (
      <span className={SIDEBAR_SUCCESS_STATUS_DOT_CLASS} aria-label={label} />
    );
  }

  if (isBusy) {
    return (
      <Icon
        name="Loading"
        className={cn(
          "animate-spin",
          SIDEBAR_WORKING_STATUS_COLOR_CLASS,
          COARSE_POINTER_ICON_SIZE_CLASS,
        )}
        aria-label="Thread working"
      />
    );
  }

  return null;
}

function getThreadUnreadBadgeLabel({
  tone,
}: ThreadUnreadBadgeLabelArgs): string {
  return tone === "error" ? "Unread thread failed" : "Unread thread succeeded";
}

type ThreadTrailingIndicatorProps = ThreadStatusGlyphProps;

function ThreadTrailingIndicator({
  hasPendingInteraction,
  isBusy,
  isWorkflowActive,
  showUnreadBadge,
  unreadBadgeTone,
}: ThreadTrailingIndicatorProps) {
  const showStatusGlyph =
    hasPendingInteraction || isBusy || isWorkflowActive || showUnreadBadge;

  if (!showStatusGlyph) {
    return null;
  }

  return (
    <span
      className={cn(
        SIDEBAR_ROW_GLYPH_SLOT_CLASS,
        COARSE_POINTER_GLYPH_BOX_CLASS,
      )}
    >
      <ThreadStatusGlyph
        hasPendingInteraction={hasPendingInteraction}
        isBusy={isBusy}
        isWorkflowActive={isWorkflowActive}
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
  displayTitle,
  accessibleTitle,
}: ThreadRowProps) {
  const [isDropdownActionsOpen, setIsDropdownActionsOpen] = useState(false);
  const [isContextActionsOpen, setIsContextActionsOpen] = useState(false);
  const setConversationCollapsed = useSetAtom(
    getThreadConversationCollapsedAtom(thread.id),
  );
  const showActive = isActive;
  const hasPendingInteraction = thread.hasPendingInteraction;
  const threadRuntimeBusy =
    isRuntimeBusyThread(thread) && !hasPendingInteraction;
  const threadWorkflowActive =
    !hasPendingInteraction && hasActiveWorkflowActivity(thread);
  const threadIsBusy = isBusyThread(thread) && !hasPendingInteraction;
  const showUnreadBadge =
    !hasPendingInteraction && !threadIsBusy && isUnreadDoneThread(thread);
  const unreadBadgeTone: SidebarUnreadDotTone =
    showUnreadBadge && thread.status === "error" ? "error" : "default";
  const threadTitle = getThreadDisplayTitle(thread);
  // Inside a folder the row shows the leaf but keeps the full path for a11y.
  const visibleTitle = displayTitle ?? threadTitle;
  const labelTitle = accessibleTitle ?? threadTitle;
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
  const trailingRuntimeBusy = hasHiddenChildren
    ? threadRuntimeBusy || childActivity.runtimeWorking
    : threadRuntimeBusy;
  const trailingIsWorkflowActive = hasHiddenChildren
    ? threadWorkflowActive || childActivity.workflow
    : threadWorkflowActive;
  const trailingIsBusy = trailingRuntimeBusy;
  const trailingShowUnreadBadge = hasHiddenChildren
    ? showUnreadBadge || childActivity.unread
    : showUnreadBadge;
  const trailingUnreadBadgeTone: SidebarUnreadDotTone =
    hasHiddenChildren && childActivity.unreadError ? "error" : unreadBadgeTone;
  const linkLabel = hasComposerDraft
    ? `Open ${labelTitle} (unsubmitted draft)`
    : `Open ${labelTitle}`;
  const rowDragBindings = options.dragBindings;
  const showDragCursor = rowDragBindings !== undefined && thread.pinnedAt === null;
  const rowClassName = cn(
    SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
    "group/thread-row",
    SIDEBAR_ROW_BASE_CLASS,
    LIST_HOVER_TRANSITION,
    parentOptions?.stickyLevel === undefined && "relative",
    options.isCompact
      ? COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS
      : COARSE_POINTER_ROW_HEIGHT_CLASS,
    showActive
      ? SIDEBAR_ROW_SELECTED_STATE_CLASS
      : SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
    !showActive && "has-[[data-state=open]]:bg-sidebar-accent",
    rowDragBindings && !rowDragBindings.disabled && "select-none",
  );
  const rowStyle = getThreadRowStyle(options.depth);
  const isActionsOpen = isDropdownActionsOpen || isContextActionsOpen;
  const handleRowClickCapture = useCallback<ThreadRowClickCaptureHandler>(
    (event) => {
      if (!options.consumeClickSuppression?.()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [options],
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
        className={cn(
          "absolute inset-0 rounded-md outline-none ring-sidebar-ring focus-visible:ring-2",
          // Draggable rows show a grab affordance; the link still selects on
          // click since a drag needs the activation distance.
          showDragCursor && "cursor-grab active:cursor-grabbing",
        )}
      />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 truncate" title={labelTitle}>
          {visibleTitle}
        </span>
        {parentOptions && hasChildren ? (
          <SidebarChildToggleChevron
            isCollapsed={isParentCollapsed}
            expandLabel={`Expand ${threadTitle} threads`}
            collapseLabel={`Collapse ${threadTitle} threads`}
            onToggle={() => parentOptions.onToggleCollapsed(thread.id)}
            revealOnHover
          />
        ) : null}
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
              isWorkflowActive={trailingIsWorkflowActive}
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
                "text-subtle-foreground hover:bg-transparent hover:text-foreground",
                SIDEBAR_MORE_ACTION_TRIGGER_CLASS,
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
    dragBindings: rowDragBindings,
    onClickCapture: options.consumeClickSuppression
      ? handleRowClickCapture
      : undefined,
    showDragCursor,
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
