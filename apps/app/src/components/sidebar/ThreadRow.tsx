import { memo, useCallback, useState, type MouseEventHandler } from "react";
import { useSetAtom } from "jotai";
import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
import type { ThreadListEntry } from "@bb/domain";
import { getThreadConversationCollapsedAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
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
  getSidebarThreadRowPaddingClass,
  type SidebarThreadRowIndent,
} from "./sidebarRowClasses";
import type { ConsumeDragClickSuppression } from "./useDragClickSuppression";

export type ThreadRowOptions =
  | {
      kind: "default";
      indent: SidebarThreadRowIndent;
    }
  | {
      kind: "managed-child";
      indent: SidebarThreadRowIndent;
    }
  | {
      kind: "env-grouped-child";
      indent: SidebarThreadRowIndent;
    }
  | {
      kind: "env-grouped-managed-child";
      indent: SidebarThreadRowIndent;
    }
  | {
      kind: "manager";
      indent: SidebarThreadRowIndent;
      isCollapsed: boolean;
      nestedChildCount: number;
      managedChildActivity: CollapsedChildActivity;
      onToggleCollapsed: (threadId: string) => void;
      consumeClickSuppression?: ConsumeDragClickSuppression;
      dragBindings?: ThreadRowDragBindings;
    };

export interface ThreadRowDragBindings {
  attributes: DraggableAttributes;
  disabled: boolean;
  listeners: DraggableSyntheticListeners;
  setActivatorNodeRef: (element: HTMLDivElement | null) => void;
}

interface ThreadRowProps {
  projectId: string;
  thread: ThreadListEntry;
  isActive: boolean;
  onProjectSelect?: () => void;
  options: ThreadRowOptions;
}

interface ManagerChevronProps {
  isCollapsed: boolean;
  onToggle: () => void;
  threadTitle: string;
}

type ThreadRowClickCaptureHandler = MouseEventHandler<HTMLDivElement>;

function ManagerChevron({
  isCollapsed,
  onToggle,
  threadTitle,
}: ManagerChevronProps) {
  return (
    <button
      type="button"
      aria-expanded={!isCollapsed}
      aria-label={
        isCollapsed
          ? `Expand ${threadTitle} threads`
          : `Collapse ${threadTitle} threads`
      }
      title={
        isCollapsed ? "Expand managed threads" : "Collapse managed threads"
      }
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        "relative z-10 rounded-md outline-none ring-sidebar-ring transition-colors hover:text-sidebar-foreground focus-visible:ring-2",
        SIDEBAR_ROW_GLYPH_SLOT_CLASS,
        COARSE_POINTER_GLYPH_BOX_CLASS,
      )}
    >
      <span
        className={cn(
          "relative inline-flex items-center justify-center",
          COARSE_POINTER_ICON_SIZE_CLASS,
        )}
      >
        <span
          data-manager-leading-icon=""
          className={cn(
            "absolute inline-flex items-center justify-center opacity-100 transition-opacity duration-150 group-hover/thread-row:opacity-0 group-has-[:focus-visible]/thread-row:opacity-0",
            COARSE_POINTER_ICON_SIZE_CLASS,
          )}
          aria-hidden="true"
        >
          <Icon
            name="UserRound"
            className={COARSE_POINTER_ICON_SIZE_CLASS}
            aria-hidden="true"
          />
        </span>
        <span
          data-manager-collapse-indicator=""
          className={cn(
            "absolute inline-flex items-center justify-center opacity-0 transition-all duration-150 group-hover/thread-row:opacity-100 group-has-[:focus-visible]/thread-row:opacity-100",
            COARSE_POINTER_ICON_SIZE_CLASS,
            !isCollapsed && "rotate-90",
          )}
          aria-hidden="true"
        >
          <Icon
            name="ChevronRight"
            className={COARSE_POINTER_ICON_SIZE_CLASS}
            aria-hidden="true"
          />
        </span>
      </span>
    </button>
  );
}

function ManagerLeadingIcon() {
  return (
    <span
      data-manager-leading-icon=""
      className={cn(SIDEBAR_ROW_GLYPH_SLOT_CLASS, COARSE_POINTER_GLYPH_BOX_CLASS)}
      aria-hidden="true"
    >
      <Icon
        name="UserRound"
        className={COARSE_POINTER_ICON_SIZE_CLASS}
        aria-hidden="true"
      />
    </span>
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
  onProjectSelect,
  options,
}: ThreadRowProps) {
  const [isDropdownActionsOpen, setIsDropdownActionsOpen] = useState(false);
  const [isContextActionsOpen, setIsContextActionsOpen] = useState(false);
  const setConversationCollapsed = useSetAtom(
    getThreadConversationCollapsedAtom(thread.id),
  );
  const hasPendingInteraction = thread.hasPendingInteraction;
  const threadIsBusy = isBusyThread(thread) && !hasPendingInteraction;
  const showUnreadBadge = !hasPendingInteraction && isUnreadDoneThread(thread);
  const threadTitle = getThreadDisplayTitle(thread);
  const managerOptions = options.kind === "manager" ? options : null;
  const isManager = managerOptions !== null;
  const isManagedChild = options.kind === "managed-child";
  const isEnvGroupedChild = options.kind === "env-grouped-child";
  const isEnvGroupedManagedChild = options.kind === "env-grouped-managed-child";
  const isCompactChild =
    isManagedChild || isEnvGroupedChild || isEnvGroupedManagedChild;
  const isUnderEnvHeader = isEnvGroupedChild || isEnvGroupedManagedChild;
  const isManagerCollapsed = managerOptions?.isCollapsed ?? false;
  const nestedChildCount = managerOptions?.nestedChildCount ?? 0;
  const managedChildActivity =
    managerOptions?.managedChildActivity ?? NO_COLLAPSED_CHILD_ACTIVITY;
  const hasNestedChildren = nestedChildCount > 0;
  // A collapsed manager hides both itself and its children behind one glyph, so
  // it must surface its own status combined with the rolled-up child activity;
  // an expanded manager (and any leaf row) shows its own status, since the
  // children are then visible with their own glyphs.
  const hasHiddenChildren =
    isManager && isManagerCollapsed && hasNestedChildren;
  const trailingHasPendingInteraction = hasHiddenChildren
    ? hasPendingInteraction || managedChildActivity.pending
    : hasPendingInteraction;
  const trailingIsBusy = hasHiddenChildren
    ? threadIsBusy || managedChildActivity.working
    : threadIsBusy;
  const trailingShowUnreadBadge = hasHiddenChildren
    ? showUnreadBadge || managedChildActivity.unread
    : showUnreadBadge;
  // Env-grouped children sit under a header that already shows the
  // worktree branch + icon, so suppress the redundant trailing icon.
  const environmentIcon = isUnderEnvHeader
    ? null
    : getEnvironmentWorkspaceDisplayIconName(
        thread.environmentWorkspaceDisplayKind,
      );
  const environmentIconLabel = isUnderEnvHeader
    ? null
    : getEnvironmentWorkspaceDisplayIconLabel(
        thread.environmentWorkspaceDisplayKind,
      );
  const rowClassName = cn(
    SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
    "group/thread-row",
    SIDEBAR_ROW_BASE_CLASS,
    !isManager && "relative",
    isCompactChild
      ? COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS
      : COARSE_POINTER_ROW_HEIGHT_CLASS,
    getSidebarThreadRowPaddingClass(options.indent),
    isActive
      ? "bg-sidebar-border text-sidebar-foreground"
      : SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  );
  const isActionsOpen = isDropdownActionsOpen || isContextActionsOpen;
  const managerDragBindings = managerOptions?.dragBindings;
  const handleManagerClickCapture = useCallback<ThreadRowClickCaptureHandler>(
    (event) => {
      if (!managerOptions?.consumeClickSuppression?.()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [managerOptions],
  );

  const rowContent = (
    <>
      <NavLink
        to={getThreadRoutePath({ projectId, threadId: thread.id })}
        onClick={() => {
          // Selecting a thread/agent row restores its conversation: the inverse
          // of opening an app row, which tucks the conversation into the
          // collapsed rail so the app fills the view (see ThreadAppRow). Both
          // write this thread's own collapse flag, so selecting one thread
          // never disturbs another's full-screen-app state.
          setConversationCollapsed(false);
          onProjectSelect?.();
        }}
        aria-label={`Open ${threadTitle}`}
        title={`Open ${threadTitle}`}
        className="absolute inset-0 rounded-md outline-none ring-sidebar-ring focus-visible:ring-2"
      />
      {managerOptions && hasNestedChildren ? (
        <ManagerChevron
          isCollapsed={isManagerCollapsed}
          onToggle={() => {
            managerOptions.onToggleCollapsed(thread.id);
          }}
          threadTitle={threadTitle}
        />
      ) : isManager ? (
        <ManagerLeadingIcon />
      ) : null}
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 truncate">{threadTitle}</span>
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
              showManagerArchiveAll={isManager && nestedChildCount > 0}
              triggerClassName={cn(
                "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
                COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
              )}
              onOpenChange={setIsDropdownActionsOpen}
            />
          </div>
        </span>
      </span>
    </>
  );

  const row = isManager ? (
    <SidebarStickyTier
      ref={managerDragBindings?.setActivatorNodeRef}
      tier="manager"
      className={cn(
        rowClassName,
        managerDragBindings &&
          !managerDragBindings.disabled &&
          "select-none cursor-grab active:cursor-grabbing",
      )}
      {...managerDragBindings?.attributes}
      {...(managerDragBindings?.listeners ?? {})}
      onClickCapture={handleManagerClickCapture}
    >
      {rowContent}
    </SidebarStickyTier>
  ) : (
    <div className={rowClassName}>{rowContent}</div>
  );

  return (
    <ThreadActionsContextMenu
      thread={thread}
      showManagerArchiveAll={isManager && nestedChildCount > 0}
      onOpenChange={setIsContextActionsOpen}
    >
      {row}
    </ThreadActionsContextMenu>
  );
}

export const ThreadRow = memo(ThreadRowComponent);
