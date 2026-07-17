import {
  memo,
  useCallback,
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type PointerEventHandler,
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
  hasActiveBackgroundAgentActivity,
  hasActiveBackgroundCommandActivity,
  hasActiveGoalActivity,
  hasActivePlanModeActivity,
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
import { useSidebarThreadShortcut } from "./sidebarThreadShortcuts";
import { SidebarThreadTitle } from "./SidebarThreadTitleMentions";
import { SplitPaneMiniMap } from "./SplitPaneMiniMap";
import { usePaneContentSplitIndicator } from "./paneContentSplitIndicator";
import { useThreadSplitsEnabled } from "@/hooks/useThreadSplitsEnabled";
import { useThreadRowSplitDrag } from "./useThreadRowSplitDrag";
import { APP_COMMAND_SHORTCUT_HINT_CLASS } from "@/components/commands/AppCommandShortcutHint";
import { useThreadTitleDisplayText } from "@/components/thread/ThreadTitleMentions";

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
  // Split-drag initiator; engages only when the pointer leaves the sidebar, so
  // it coexists with the dnd-kit reorder listeners in `dragBindings`.
  onSplitDragPointerDown?: PointerEventHandler<HTMLElement>;
  stickyLevel?: number;
  style: CSSProperties;
}

function ThreadDraftIndicator({ isWorking }: { isWorking: boolean }) {
  return (
    <Icon
      name="Edit"
      className={cn(
        "pointer-events-none shrink-0",
        COARSE_POINTER_ICON_SIZE_CLASS,
        isWorking
          ? ["animate-shine-icon", SIDEBAR_WORKING_STATUS_COLOR_CLASS]
          : "text-muted-foreground",
      )}
      {...(isWorking
        ? { "aria-label": "Thread working with unsubmitted draft" }
        : { "aria-hidden": true })}
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
  onSplitDragPointerDown,
  stickyLevel,
  style,
}: ThreadRowContainerArgs) {
  // Never show a grab cursor on thread rows. Section DnD still works after the
  // activation distance; the link still selects on click.
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
        onPointerDown={onSplitDragPointerDown}
      >
        {children}
      </SidebarStickyTier>
    );
  }

  return (
    <div
      ref={dragBindings?.setActivatorNodeRef}
      className={className}
      style={style}
      {...dragBindings?.attributes}
      {...(dragBindings?.listeners ?? {})}
      onClickCapture={onClickCapture}
      onPointerDown={onSplitDragPointerDown}
    >
      {children}
    </div>
  );
}

interface ThreadStatusGlyphProps {
  hasPendingInteraction: boolean;
  isBackgroundAgentActive: boolean;
  isBackgroundCommandActive: boolean;
  isForegroundAgentWorking: boolean;
  isGoalActive: boolean;
  isPlanModeActive: boolean;
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
  isBackgroundAgentActive,
  isBackgroundCommandActive,
  isForegroundAgentWorking,
  isGoalActive,
  isPlanModeActive,
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
        name="CircleQuestion"
        className={cn(
          "text-muted-foreground/75",
          COARSE_POINTER_ICON_SIZE_CLASS,
        )}
        aria-label="Thread needs user input"
      />
    );
  }

  if (isForegroundAgentWorking) {
    return (
      <Icon
        name="Loading"
        className={cn(
          "animate-spin",
          SIDEBAR_WORKING_STATUS_COLOR_CLASS,
          COARSE_POINTER_ICON_SIZE_CLASS,
        )}
        aria-label="Agent working"
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

  if (isBackgroundAgentActive) {
    return (
      <Icon
        name="UserRoundPlus"
        className={cn(
          "animate-shine-icon",
          SIDEBAR_WORKING_STATUS_COLOR_CLASS,
          COARSE_POINTER_ICON_SIZE_CLASS,
        )}
        aria-label="Background agent running"
      />
    );
  }

  if (isBackgroundCommandActive) {
    return (
      <Icon
        name="Terminal"
        className={cn(
          "animate-shine-icon",
          SIDEBAR_WORKING_STATUS_COLOR_CLASS,
          COARSE_POINTER_ICON_SIZE_CLASS,
        )}
        aria-label="Background command running"
      />
    );
  }

  if (isPlanModeActive) {
    return (
      <Icon
        name="ListTodo"
        className={cn(
          "animate-shine-icon",
          SIDEBAR_WORKING_STATUS_COLOR_CLASS,
          COARSE_POINTER_ICON_SIZE_CLASS,
        )}
        aria-label="Plan mode active"
      />
    );
  }

  if (isGoalActive) {
    return (
      <Icon
        name="Target"
        className={cn(
          "animate-shine-icon",
          SIDEBAR_WORKING_STATUS_COLOR_CLASS,
          COARSE_POINTER_ICON_SIZE_CLASS,
        )}
        aria-label="Goal active"
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

interface CollapsedThreadStatusGlyphProps {
  activity: CollapsedChildActivity;
  isBusy: boolean;
}

export function CollapsedThreadStatusGlyph({
  activity,
  isBusy,
}: CollapsedThreadStatusGlyphProps) {
  return (
    <ThreadStatusGlyph
      hasPendingInteraction={activity.pending}
      isBackgroundAgentActive={activity.backgroundAgent}
      isBackgroundCommandActive={activity.backgroundCommand}
      isForegroundAgentWorking={activity.runtimeWorking}
      isGoalActive={activity.goal}
      isPlanModeActive={activity.planMode}
      isBusy={isBusy}
      isWorkflowActive={activity.workflow}
      showUnreadBadge={activity.unread}
      unreadBadgeTone={activity.unreadError ? "error" : "default"}
    />
  );
}

function getThreadUnreadBadgeLabel({
  tone,
}: ThreadUnreadBadgeLabelArgs): string {
  return tone === "error" ? "Unread thread failed" : "Unread thread succeeded";
}

type ThreadTrailingIndicatorProps = ThreadStatusGlyphProps & {
  hasComposerDraft: boolean;
  isActive: boolean;
};

function isThreadLoadingGlyphVisible({
  hasPendingInteraction,
  isBackgroundAgentActive,
  isBackgroundCommandActive,
  isForegroundAgentWorking,
  isGoalActive,
  isPlanModeActive,
  isBusy,
  isWorkflowActive,
  showUnreadBadge,
  unreadBadgeTone,
}: ThreadStatusGlyphProps): boolean {
  if (
    (showUnreadBadge && unreadBadgeTone === "error") ||
    hasPendingInteraction
  ) {
    return false;
  }
  if (isForegroundAgentWorking) {
    return true;
  }
  if (
    isWorkflowActive ||
    isBackgroundAgentActive ||
    isBackgroundCommandActive ||
    isPlanModeActive ||
    isGoalActive ||
    showUnreadBadge
  ) {
    return false;
  }
  return isBusy;
}

function ThreadTrailingIndicator({
  hasComposerDraft,
  hasPendingInteraction,
  isActive,
  isBackgroundAgentActive,
  isBackgroundCommandActive,
  isForegroundAgentWorking,
  isGoalActive,
  isPlanModeActive,
  isBusy,
  isWorkflowActive,
  showUnreadBadge,
  unreadBadgeTone,
}: ThreadTrailingIndicatorProps) {
  const statusProps: ThreadStatusGlyphProps = {
    hasPendingInteraction,
    isBackgroundAgentActive,
    isBackgroundCommandActive,
    isForegroundAgentWorking,
    isGoalActive,
    isPlanModeActive,
    isBusy,
    isWorkflowActive,
    showUnreadBadge,
    unreadBadgeTone,
  };
  const showStatusGlyph =
    hasPendingInteraction ||
    isBackgroundAgentActive ||
    isBackgroundCommandActive ||
    isForegroundAgentWorking ||
    isGoalActive ||
    isPlanModeActive ||
    isBusy ||
    isWorkflowActive ||
    showUnreadBadge;
  const draftIsWorking =
    hasComposerDraft && isActive && isThreadLoadingGlyphVisible(statusProps);
  const hasCriticalStatus =
    (showUnreadBadge && unreadBadgeTone === "error") || hasPendingInteraction;
  const showDraftIndicator = hasComposerDraft && !hasCriticalStatus;

  if (!showStatusGlyph && !showDraftIndicator) {
    return null;
  }

  return (
    <span
      data-sidebar-thread-trailing-indicator=""
      className={cn(
        SIDEBAR_ROW_GLYPH_SLOT_CLASS,
        COARSE_POINTER_GLYPH_BOX_CLASS,
      )}
    >
      {showDraftIndicator ? (
        <ThreadDraftIndicator isWorking={draftIsWorking} />
      ) : (
        <ThreadStatusGlyph {...statusProps} />
      )}
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
  const shortcut = useSidebarThreadShortcut(thread.id);
  const showActive = isActive;
  const hasPendingInteraction = thread.hasPendingInteraction;
  const threadRuntimeBusy =
    isRuntimeBusyThread(thread) && !hasPendingInteraction;
  const threadWorkflowActive =
    !hasPendingInteraction && hasActiveWorkflowActivity(thread);
  const threadBackgroundAgentActive =
    !hasPendingInteraction && hasActiveBackgroundAgentActivity(thread);
  const threadBackgroundCommandActive =
    !hasPendingInteraction && hasActiveBackgroundCommandActivity(thread);
  const threadPlanModeActive =
    !hasPendingInteraction && hasActivePlanModeActivity(thread);
  const threadGoalActive =
    !hasPendingInteraction && hasActiveGoalActivity(thread);
  const threadIsBusy = isBusyThread(thread) && !hasPendingInteraction;
  const threadUnreadDone = isUnreadDoneThread(thread);
  const threadUnreadError = threadUnreadDone && thread.status === "error";
  const showUnreadBadge =
    threadUnreadError ||
    (!hasPendingInteraction && !threadIsBusy && threadUnreadDone);
  const unreadBadgeTone: SidebarUnreadDotTone = threadUnreadError
    ? "error"
    : "default";
  const threadTitle = getThreadDisplayTitle(thread);
  // Inside a section the row shows the leaf but keeps the full path for a11y.
  const visibleTitle = displayTitle ?? threadTitle;
  const labelTitle = useThreadTitleDisplayText(accessibleTitle ?? threadTitle);
  const threadSplitsEnabled = useThreadSplitsEnabled();
  const splitIndicator = usePaneContentSplitIndicator(
    { kind: "thread", projectId, threadId: thread.id },
    threadSplitsEnabled,
  );
  const { onPointerDown: onSplitDragPointerDown, openInSplit } =
    useThreadRowSplitDrag({
      projectId,
      threadId: thread.id,
      title: labelTitle,
    });
  // Splits are disabled on compact viewports; the drag hook signals that by
  // withholding its pointer handler, so gate the click/menu entry points on it.
  const splitAvailable = onSplitDragPointerDown !== undefined;
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
  const trailingBackgroundAgentActive = hasHiddenChildren
    ? threadBackgroundAgentActive || childActivity.backgroundAgent
    : threadBackgroundAgentActive;
  const trailingBackgroundCommandActive = hasHiddenChildren
    ? threadBackgroundCommandActive || childActivity.backgroundCommand
    : threadBackgroundCommandActive;
  const trailingPlanModeActive = hasHiddenChildren
    ? threadPlanModeActive || childActivity.planMode
    : threadPlanModeActive;
  const trailingGoalActive = hasHiddenChildren
    ? threadGoalActive || childActivity.goal
    : threadGoalActive;
  const trailingIsBusy = hasHiddenChildren
    ? threadIsBusy || childActivity.working
    : threadIsBusy;
  const trailingShowUnreadBadge = hasHiddenChildren
    ? showUnreadBadge || childActivity.unread
    : showUnreadBadge;
  const trailingUnreadBadgeTone: SidebarUnreadDotTone =
    hasHiddenChildren && childActivity.unreadError ? "error" : unreadBadgeTone;
  const linkLabel = hasComposerDraft
    ? `Open ${labelTitle} (unsubmitted draft)`
    : `Open ${labelTitle}`;
  const rowDragBindings = options.dragBindings;
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
    // Subtle open-in-split tint, weaker than the active-row treatment. The
    // focused pane's thread is already the active row, so this only marks the
    // other open panes; hover still wins over it.
    !showActive && splitIndicator.isOpenInSplit && "bg-sidebar-accent/50",
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
        data-sidebar-thread-shortcut-target=""
        data-sidebar-thread-id={thread.id}
        onClick={(event) => {
          // Selecting a thread/agent row restores its conversation without
          // disturbing any other thread's collapsed conversation state.
          setConversationCollapsed(false);
          // Cmd/Ctrl-click is the split feature's second entry point: open the
          // thread in the split instead of replacing the focused pane. Match the
          // drag rules (right split / focus if open / replace at the cap).
          if (splitAvailable && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            openInSplit();
            return;
          }
          onProjectSelect?.();
        }}
        aria-label={linkLabel}
        aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
        className="absolute inset-0 rounded-md outline-none ring-sidebar-ring focus-visible:ring-2"
      />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 truncate" title={labelTitle}>
          <SidebarThreadTitle title={visibleTitle} />
        </span>
        {parentOptions && hasChildren ? (
          <SidebarChildToggleChevron
            isCollapsed={isParentCollapsed}
            expandLabel={`Expand ${labelTitle} threads`}
            collapseLabel={`Collapse ${labelTitle} threads`}
            onToggle={() => parentOptions.onToggleCollapsed(thread.id)}
            revealOnHover
          />
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-0.5">
        {splitIndicator.miniMap ? (
          <SplitPaneMiniMap
            slots={splitIndicator.miniMap}
            label={`${labelTitle} — open in split`}
          />
        ) : null}
        {shortcut ? (
          <kbd aria-hidden="true" className={APP_COMMAND_SHORTCUT_HINT_CLASS}>
            {shortcut.label}
          </kbd>
        ) : (
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
                data-sidebar-hover-actions-open={
                  isActionsOpen ? "true" : undefined
                }
                className={cn(
                  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
                  "absolute inset-0 flex items-center justify-center",
                )}
              >
                <ThreadTrailingIndicator
                  hasComposerDraft={hasComposerDraft}
                  hasPendingInteraction={trailingHasPendingInteraction}
                  isActive={isActive}
                  isBackgroundAgentActive={trailingBackgroundAgentActive}
                  isBackgroundCommandActive={trailingBackgroundCommandActive}
                  isForegroundAgentWorking={trailingRuntimeBusy}
                  isGoalActive={trailingGoalActive}
                  isPlanModeActive={trailingPlanModeActive}
                  isBusy={trailingIsBusy}
                  isWorkflowActive={trailingIsWorkflowActive}
                  showUnreadBadge={trailingShowUnreadBadge}
                  unreadBadgeTone={trailingUnreadBadgeTone}
                />
              </span>
              <div
                data-sidebar-hover-actions-open={
                  isActionsOpen ? "true" : undefined
                }
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
                  onOpenInSplit={splitAvailable ? openInSplit : undefined}
                  onOpenChange={setIsDropdownActionsOpen}
                />
              </div>
            </span>
          </span>
        )}
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
    onSplitDragPointerDown,
    stickyLevel: parentOptions?.stickyLevel,
    style: rowStyle,
  });

  return (
    <ThreadActionsContextMenu
      thread={thread}
      onOpenInSplit={splitAvailable ? openInSplit : undefined}
      onOpenChange={setIsContextActionsOpen}
    >
      {row}
    </ThreadActionsContextMenu>
  );
}

export const ThreadRow = memo(ThreadRowComponent);
