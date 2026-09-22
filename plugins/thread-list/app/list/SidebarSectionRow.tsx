import {
  SidebarHeaderControls,
  SidebarSectionMenuItems,
} from "./SidebarHeaderControls.js";
import {
  memo,
  useCallback,
  useState,
  type CSSProperties,
  type MouseEvent,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { SidebarStickyTier } from "../ui/sidebar.js";
import {
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
  SIDEBAR_HOVER_ACTIONS_GAP_CLASS,
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "../ui/sidebar-hover-actions.js";
import { cn } from "@bb/shared-ui/lib/utils";
import type { CollapsedChildActivity } from "@bb/client-core";
import {
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_GROUP_TEXT_CLASS,
  getSidebarThreadRowPaddingLeft,
} from "../rows/sidebarRowClasses.js";
import { SidebarChildToggleChevron } from "../rows/SidebarChildToggleChevron.js";
import { CollapsedThreadStatusGlyph } from "../rows/ThreadRow.js";
import type { SidebarSortableDragBindings } from "../rows/sortableMotion.js";
import type { ConsumeDragClickSuppression } from "../ui/use-drag-click-suppression.js";
import {
  useThreadGroupSplitIndicator,
  type ThreadSplitIndicatorTarget,
} from "./groupRollups.js";
import { SplitPaneMiniMap } from "../rows/SplitPaneMiniMap.js";
import { usePluginThreadRowStatusForThreads } from "./groupRollups.js";

const EMPTY_SPLIT_INDICATOR_THREADS: readonly ThreadSplitIndicatorTarget[] = [];

function stopActionsClick(event: MouseEvent<HTMLElement>) {
  event.stopPropagation();
}

interface SidebarSectionRowProps {
  name: string;
  labelEditor?: ReactNode;
  label: string;
  depth: number;
  activity: CollapsedChildActivity;
  collapsedThreads?: readonly ThreadSplitIndicatorTarget[];
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  stickyLevel?: number;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  dragBindings?: SidebarSortableDragBindings;
  isDropTargetActive?: boolean;
  onCreateThread?: () => void;
  onRename?: () => void;
  onRenameFromMenu?: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  onRemove?: () => void;
}

function SidebarSectionRowComponent({
  name,
  labelEditor,
  label,
  depth,
  activity,
  collapsedThreads = EMPTY_SPLIT_INDICATOR_THREADS,
  consumeClickSuppression,
  dragBindings,
  isDropTargetActive = false,
  isCollapsed,
  onToggleCollapsed,
  onCreateThread,
  onRename,
  onRenameFromMenu,
  onCloseAutoFocus,
  onRemove,
  stickyLevel,
}: SidebarSectionRowProps) {
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const collapsedSplitIndicator = useThreadGroupSplitIndicator(
    collapsedThreads,
    isCollapsed,
  );
  const pluginStatus = usePluginThreadRowStatusForThreads(collapsedThreads);
  const hasMenuActions = Boolean(onRename || onRemove);
  const hasActions = Boolean(onCreateThread || hasMenuActions);
  const showRollupIndicator =
    isCollapsed &&
    (collapsedSplitIndicator.miniMap !== null ||
      activity.pending ||
      activity.working ||
      activity.hasUnsubmittedDraft ||
      activity.unread ||
      activity.unreadError ||
      pluginStatus !== null);
  const renderRollupIndicator = () =>
    collapsedSplitIndicator.miniMap ? (
      <SplitPaneMiniMap
        slots={collapsedSplitIndicator.miniMap}
        label={`${label} — contains a thread open in split`}
        isWorking={activity.working || pluginStatus?.tone === "running"}
      />
    ) : (
      <CollapsedThreadStatusGlyph
        activity={activity}
        pluginStatus={pluginStatus}
      />
    );
  const className = cn(
    SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
    stickyLevel === undefined && "relative",
    SIDEBAR_ROW_BASE_CLASS,
    LIST_HOVER_TRANSITION,
    SIDEBAR_GROUP_TEXT_CLASS,
    COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
    dragBindings && !dragBindings.disabled && "select-none",
    isDropTargetActive && "bg-sidebar-accent text-sidebar-accent-foreground",
  );
  const style: CSSProperties = {
    paddingLeft: getSidebarThreadRowPaddingLeft(depth),
  };
  const handleClickCapture = useCallback<MouseEventHandler<HTMLElement>>(
    (event) => {
      if (labelEditor || !consumeClickSuppression?.()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [consumeClickSuppression, labelEditor],
  );
  const content = (
    <>
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        disabled={Boolean(labelEditor)}
        onClick={onToggleCollapsed}
        className="absolute inset-0 rounded-md outline-none ring-sidebar-ring focus-visible:ring-2"
      />
      <span className="relative z-10 flex min-w-0 flex-1 items-center gap-1 text-left">
        {labelEditor ?? (
          <span
            className="min-w-0 truncate"
            onDoubleClick={
              onRename
                ? (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onRename();
                  }
                : undefined
            }
          >
            {name}
          </span>
        )}
        <SidebarChildToggleChevron
          disabled={Boolean(labelEditor)}
          className={labelEditor ? "hidden" : undefined}
          isCollapsed={isCollapsed}
          expandLabel={`Expand ${label} section`}
          collapseLabel={`Collapse ${label} section`}
          onToggle={onToggleCollapsed}
        />
      </span>
      {showRollupIndicator ? (
        <span
          data-sidebar-collapsed-activity-edge=""
          data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
          className={cn(
            "pointer-events-none absolute right-0 top-1/2 z-20 inline-flex -translate-y-1/2 items-center text-subtle-foreground max-md:pointer-coarse:hidden",
            hasActions && SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
          )}
        >
          {renderRollupIndicator()}
        </span>
      ) : null}
      <span
        className={cn(
          "relative z-10 shrink-0",
          hasActions
            ? "inline-flex items-center"
            : COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
          labelEditor && "hidden",
        )}
      >
        {hasActions && showRollupIndicator ? (
          <span className="hidden shrink-0 items-center justify-center text-subtle-foreground max-md:pointer-coarse:inline-flex">
            {renderRollupIndicator()}
          </span>
        ) : null}
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
              isCollapsed && "max-md:pointer-coarse:hidden",
            )}
            onClick={stopActionsClick}
          >
            <SidebarHeaderControls
              label={`${label} section`}
              onNewThread={onCreateThread}
              onOpenChange={setIsActionsOpen}
              onCloseAutoFocus={onCloseAutoFocus}
            >
              <SidebarSectionMenuItems
                onRename={onRenameFromMenu ?? onRename}
                onRemove={onRemove}
              />
            </SidebarHeaderControls>
          </span>
        ) : showRollupIndicator ? (
          <span className="hidden size-full items-center justify-center text-subtle-foreground max-md:pointer-coarse:inline-flex">
            {renderRollupIndicator()}
          </span>
        ) : null}
      </span>
    </>
  );

  if (stickyLevel !== undefined) {
    return (
      <SidebarStickyTier
        ref={dragBindings?.setActivatorNodeRef}
        data-sidebar-rename-row=""
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
      data-sidebar-rename-row=""
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

export const SidebarSectionRow = memo(SidebarSectionRowComponent);
