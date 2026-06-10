import {
  memo,
  useCallback,
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type { ThreadListEntry } from "@bb/domain";
import {
  getThreadConversationCollapsedAtom,
  getThreadSecondaryPanelOpenAtom,
} from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import { useFixedPanelTabsState } from "@/lib/fixed-panel-tabs";
import { getActiveSecondaryAppId } from "@/lib/fixed-panel-tabs-state";
import { Icon, type IconName } from "@/components/ui/icon.js";
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
  getEnvironmentWorkspaceDisplayIconLabel,
  getEnvironmentWorkspaceDisplayIconName,
} from "@/lib/environment-workspace-display";
import {
  isBusyThread,
  isUnreadDoneThread,
  NO_COLLAPSED_CHILD_ACTIVITY,
  type CollapsedChildActivity,
} from "@/lib/thread-activity";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { getThreadRoutePath } from "@/lib/app-route-paths";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_GLYPH_SLOT_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  SIDEBAR_UNREAD_DOT_CLASS,
  getSidebarThreadRowPaddingLeft,
} from "./sidebarRowClasses";
import type { ConsumeDragClickSuppression } from "./useDragClickSuppression";
import type { SidebarSortableDragBindings } from "./sortableMotion";

interface ThreadRowBaseOptions {
  depth: number;
  isCompact: boolean;
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

interface ThreadParentChevronProps {
  isCollapsed: boolean;
  onToggle: () => void;
  threadTitle: string;
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

// Toggles a parent thread's children. Mirrors the "Projects" section-label
// chevron (trailing the title, ChevronRight that rotates 90° when expanded) but
// stays visible at rest: unlike a labeled section, a thread row gives no other
// cue that it has children to collapse.
function ThreadParentChevron({
  isCollapsed,
  onToggle,
  threadTitle,
}: ThreadParentChevronProps) {
  return (
    <button
      type="button"
      aria-expanded={!isCollapsed}
      aria-label={
        isCollapsed
          ? `Expand ${threadTitle} threads`
          : `Collapse ${threadTitle} threads`
      }
      title={isCollapsed ? "Expand child threads" : "Collapse child threads"}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      className="relative z-10 inline-flex size-5 shrink-0 items-center justify-center rounded-md text-subtle-foreground outline-none ring-sidebar-ring transition-colors hover:bg-state-hover hover:text-foreground focus-visible:ring-2"
    >
      <Icon
        name="ChevronRight"
        className={cn(
          "size-3 transition-transform duration-150",
          !isCollapsed && "rotate-90",
        )}
        aria-hidden="true"
      />
    </button>
  );
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
}

export function ThreadStatusGlyph({
  hasPendingInteraction,
  isBusy,
  showUnreadBadge,
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
    return (
      <span
        className={SIDEBAR_UNREAD_DOT_CLASS}
        aria-label="Unread thread requires attention"
        title="Unread thread requires attention"
      />
    );
  }

  return null;
}

interface ThreadTrailingIndicatorProps extends ThreadStatusGlyphProps {
  environmentIcon: IconName | null;
  environmentIconLabel: string | null;
}

function ThreadTrailingIndicator({
  environmentIcon,
  environmentIconLabel,
  hasPendingInteraction,
  isBusy,
  showUnreadBadge,
}: ThreadTrailingIndicatorProps) {
  const showStatusGlyph = hasPendingInteraction || isBusy || showUnreadBadge;

  if (showStatusGlyph) {
    return (
      <span
        className={cn(SIDEBAR_ROW_GLYPH_SLOT_CLASS, COARSE_POINTER_GLYPH_BOX_CLASS)}
      >
        <ThreadStatusGlyph
          hasPendingInteraction={hasPendingInteraction}
          isBusy={isBusy}
          showUnreadBadge={showUnreadBadge}
        />
      </span>
    );
  }

  return (
    <ThreadTrailingIcon
      environmentIcon={environmentIcon}
      environmentIconLabel={environmentIconLabel}
    />
  );
}

function ThreadTrailingIcon({
  environmentIcon,
  environmentIconLabel,
}: ThreadTrailingIconProps) {
  return environmentIcon ? (
    <Icon
      name={environmentIcon}
      className={cn("text-muted-foreground", COARSE_POINTER_ICON_SIZE_CLASS)}
      aria-label={environmentIconLabel ?? undefined}
    />
  ) : null;
}

interface ThreadTrailingIconProps {
  environmentIcon: IconName | null;
  environmentIconLabel: string | null;
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
  // When this thread tucks its conversation into the collapsed rail to show an
  // app full-screen, the app's sidebar row owns the single selected highlight,
  // so this row drops its own selected background even though it is the route's
  // selected thread. Keeps exactly one row highlighted across the sidebar.
  const isConversationCollapsed = useAtomValue(
    getThreadConversationCollapsedAtom(thread.id),
  );
  const isSecondaryPanelOpen = useAtomValue(
    getThreadSecondaryPanelOpenAtom(thread.id),
  );
  const fixedPanelTabsState = useFixedPanelTabsState(thread.id);
  const appOwnsSurface =
    isConversationCollapsed &&
    getActiveSecondaryAppId({
      isSecondaryPanelOpen,
      state: fixedPanelTabsState,
    }) !== null;
  const showActive = isActive && !appOwnsSurface;
  const hasPendingInteraction = thread.hasPendingInteraction;
  const threadIsBusy = isBusyThread(thread) && !hasPendingInteraction;
  const showUnreadBadge = !hasPendingInteraction && isUnreadDoneThread(thread);
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
  const hasHiddenChildren =
    isParentRow && isParentCollapsed && hasChildren;
  const trailingHasPendingInteraction = hasHiddenChildren
    ? hasPendingInteraction || childActivity.pending
    : hasPendingInteraction;
  const trailingIsBusy = hasHiddenChildren
    ? threadIsBusy || childActivity.working
    : threadIsBusy;
  const trailingShowUnreadBadge = hasHiddenChildren
    ? showUnreadBadge || childActivity.unread
    : showUnreadBadge;
  const linkLabel = hasComposerDraft
    ? `Open ${threadTitle} (unsubmitted draft)`
    : `Open ${threadTitle}`;
  const linkTitle = linkLabel;
  // Env-grouped children sit under a header that already shows the
  // worktree branch + icon, so suppress the redundant trailing icon.
  const environmentIcon = options.isEnvGrouped
    ? null
    : getEnvironmentWorkspaceDisplayIconName(
        thread.environmentWorkspaceDisplayKind,
      );
  const environmentIconLabel = options.isEnvGrouped
    ? null
    : getEnvironmentWorkspaceDisplayIconLabel(
        thread.environmentWorkspaceDisplayKind,
      );
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
          // Selecting a thread/agent row restores its conversation: the inverse
          // of opening an app row, which tucks the conversation into the
          // collapsed rail so the app fills the view (see SidebarAppsSection).
          // Both write this thread's own collapse flag, so selecting one thread
          // never disturbs another's full-screen-app state.
          setConversationCollapsed(false);
          onProjectSelect?.();
        }}
        aria-label={linkLabel}
        title={linkTitle}
        className="absolute inset-0 rounded-md outline-none ring-sidebar-ring focus-visible:ring-2"
      />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 truncate">{threadTitle}</span>
        {parentOptions && hasChildren ? (
          <ThreadParentChevron
            isCollapsed={isParentCollapsed}
            onToggle={() => {
              parentOptions.onToggleCollapsed(thread.id);
            }}
            threadTitle={threadTitle}
          />
        ) : null}
        {hasComposerDraft ? <ThreadDraftIndicator /> : null}
      </span>
      <span
        className={cn(
          "flex shrink-0 items-center justify-end",
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
              environmentIcon={environmentIcon}
              environmentIconLabel={environmentIconLabel}
              hasPendingInteraction={trailingHasPendingInteraction}
              isBusy={trailingIsBusy}
              showUnreadBadge={trailingShowUnreadBadge}
            />
          </span>
          <div
            data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
            className={cn(
              SIDEBAR_HOVER_ACTIONS_CLASS,
              "absolute inset-0 z-10 flex items-center justify-end",
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
