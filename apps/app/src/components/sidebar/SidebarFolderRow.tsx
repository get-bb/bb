import {
  memo,
  useCallback,
  useState,
  type CSSProperties,
  type MouseEventHandler,
} from "react";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { SidebarStickyTier } from "@/components/ui/sidebar.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import {
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_GLYPH_BOX_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
  SIDEBAR_HOVER_ACTIONS_GAP_CLASS,
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions.js";
import { cn } from "@bb/shared-ui/lib/utils";
import type { CollapsedChildActivity } from "@/lib/thread-activity";
import {
  SIDEBAR_MORE_ACTION_TRIGGER_CLASS,
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_STATIC_STATE_CLASS,
  getSidebarThreadRowPaddingLeft,
} from "./sidebarRowClasses";
import { SidebarChildToggleChevron } from "./SidebarChildToggleChevron";
import { ThreadStatusGlyph } from "./ThreadRow";
import type { SidebarSortableDragBindings } from "./sortableMotion";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";

interface SidebarFolderRowProps {
  // Leaf segment shown on the header ("Q3").
  name: string;
  label: string;
  // Render depth (folder nesting + section offset); drives indentation.
  depth: number;
  activity: CollapsedChildActivity;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  // Pin depth among parent rows when sticky; absent = not pinned (past the cap).
  stickyLevel?: number;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  dragBindings?: SidebarSortableDragBindings;
  isDropTargetActive?: boolean;
  onCreateThread?: () => void;
  onViewArchivedThreads?: () => void;
  onRename?: () => void;
  onRemove?: () => void;
}

// The "Work › Q3" disclosure header for a folder. Not a thread: clicking
// toggles collapse, there is no navigation. It stays visually quieter than a
// project row while still mirroring parent-thread disclosure behavior.
function SidebarFolderRowComponent({
  name,
  label,
  depth,
  activity,
  consumeClickSuppression,
  dragBindings,
  isDropTargetActive = false,
  isCollapsed,
  onToggleCollapsed,
  onCreateThread,
  onViewArchivedThreads,
  onRename,
  onRemove,
  stickyLevel,
}: SidebarFolderRowProps) {
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const hasMenuActions = Boolean(onViewArchivedThreads || onRename || onRemove);
  const hasActions = Boolean(onCreateThread || hasMenuActions);
  // Collapsed: the header speaks for its hidden descendants through one glyph
  // (pending > working > unread). Expanded: descendants show their own glyphs.
  const showRollupGlyph =
    isCollapsed && (activity.pending || activity.working || activity.unread);
  const className = cn(
    SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
    // Only the non-sticky header needs `relative`; a sticky tier is already a
    // positioned box. Mirrors ThreadRow / EnvironmentThreadGroupHeader.
    stickyLevel === undefined && "relative",
    SIDEBAR_ROW_BASE_CLASS,
    LIST_HOVER_TRANSITION,
    SIDEBAR_ROW_STATIC_STATE_CLASS,
    COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
    dragBindings && !dragBindings.disabled && "select-none",
    isDropTargetActive && "bg-sidebar-accent text-sidebar-accent-foreground",
  );
  const style: CSSProperties = {
    paddingLeft: getSidebarThreadRowPaddingLeft(depth),
  };
  const handleClickCapture = useCallback<MouseEventHandler<HTMLElement>>(
    (event) => {
      if (!consumeClickSuppression?.()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [consumeClickSuppression],
  );
  const stopActionsClick = useCallback<MouseEventHandler<HTMLElement>>(
    (event) => {
      event.stopPropagation();
    },
    [],
  );
  const content = (
    <>
      {/* Full-bleed toggle target for pointer users; the chevron owns keyboard
          focus (mirrors the project row's hidden focus button). */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onToggleCollapsed}
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
          name={isCollapsed ? "Folder" : "FolderOpen"}
          className={COARSE_POINTER_ICON_SIZE_CLASS}
          aria-hidden="true"
        />
      </span>
      <span className="relative z-10 flex min-w-0 flex-1 items-center gap-1.5 text-left">
        <span className="min-w-0 truncate">{name}</span>
        <SidebarChildToggleChevron
          isCollapsed={isCollapsed}
          expandLabel={`Expand ${label} folder`}
          collapseLabel={`Collapse ${label} folder`}
          onToggle={onToggleCollapsed}
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
            className={cn(
              SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
              "pointer-events-none absolute inset-0 flex items-center justify-center text-subtle-foreground",
            )}
          >
            <ThreadStatusGlyph
              hasPendingInteraction={activity.pending}
              isBusy={activity.working}
              isWorkflowActive={activity.workflow}
              showUnreadBadge={activity.unread}
              unreadBadgeTone={activity.unreadError ? "error" : "default"}
            />
          </span>
        ) : null}
      </span>
      {hasActions ? (
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
          onClick={stopActionsClick}
        >
          {hasMenuActions ? (
            <DropdownMenu onOpenChange={setIsActionsOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${label} folder actions`}
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
                {onViewArchivedThreads ? (
                  <DropdownMenuItem onSelect={onViewArchivedThreads}>
                    <Icon name="Archive" aria-hidden="true" />
                    Archived threads
                  </DropdownMenuItem>
                ) : null}
                {onViewArchivedThreads && (onRename || onRemove) ? (
                  <DropdownMenuSeparator />
                ) : null}
                {onRename ? (
                  <DropdownMenuItem onSelect={onRename}>
                    <Icon name="Edit" aria-hidden="true" />
                    Rename
                  </DropdownMenuItem>
                ) : null}
                {onRemove ? (
                  <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                    <Icon name="Trash2" aria-hidden="true" />
                    Remove
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {onCreateThread ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`New thread in ${label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCreateThread();
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
              </TooltipTrigger>
              <TooltipContent side="bottom">New thread</TooltipContent>
            </Tooltip>
          ) : null}
        </span>
      ) : null}
    </>
  );

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
        onClickCapture={
          consumeClickSuppression ? handleClickCapture : undefined
        }
      >
        {content}
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
      onClickCapture={consumeClickSuppression ? handleClickCapture : undefined}
    >
      {content}
    </div>
  );
}

export const SidebarFolderRow = memo(SidebarFolderRowComponent);
