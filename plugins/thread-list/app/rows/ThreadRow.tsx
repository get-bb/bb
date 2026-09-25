import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactNode,
} from "react";
import { useComposedRefs } from "@radix-ui/react-compose-refs";
import { useAtomValue } from "jotai";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
  COARSE_POINTER_ROW_HEIGHT_CLASS,
} from "@/components/ui/coarse-pointer-sizing";
import { cn } from "@/lib/utils";
import { LIST_HOVER_TRANSITION } from "@/components/ui/motion";
import {
  hasThreadListWorkingActivity,
  threadListIndicatorStateForThread,
  NO_COLLAPSED_CHILD_ACTIVITY,
  type CollapsedChildActivity,
  type ThreadListIndicatorState,
} from "../model/thread-activity.js";
import {
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreadSplit,
  experimental_useProviders,
  experimental_ProviderIcon as ProviderIcon,
  ThreadTitle,
  useSidebarSplitLayout,
  useSidebarThreadDraft,
  useSidebarThreadRowStatus,
  useSidebarThreadShortcut,
  type PluginSidebarSplitPane,
  type PluginSidebarThreadRowStatus,
} from "@get-bb/plugin-sdk/app";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { useSidebarProjectName } from "../model/use-sidebar-data.js";
import { sidebarShowProviderIconsAtom } from "../preferences/atoms.js";
import { AppCommandShortcutPill } from "../ui/AppCommandShortcutPill.js";
import { SidebarStickyTier } from "../ui/sidebar.js";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
  SIDEBAR_HOVER_ACTIONS_INSET_CLASS,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "../ui/sidebar-hover-actions.js";
import type { ConsumeDragClickSuppression } from "../ui/use-drag-click-suppression.js";
import { SidebarChildToggleChevron } from "./SidebarChildToggleChevron.js";
import { useSidebarRename } from "./SidebarInlineRename.js";
import { SidebarRowControls } from "./SidebarRowControls.js";
import {
  SIDEBAR_CONTROL_BUTTON_CLASS,
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_GLYPH_SLOT_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  SIDEBAR_ROW_OPEN_IN_SPLIT_STATE_CLASS,
  SIDEBAR_ROW_SELECTED_STATE_CLASS,
  SIDEBAR_STATUS_GLYPH_BOX_CLASS,
  getSidebarThreadGroupLineLeft,
  getSidebarThreadRowPaddingLeft,
} from "./sidebarRowClasses.js";
import type {
  SidebarNestTargetState,
  SidebarReorderPlacement,
  ThreadRowNestDrop,
} from "./sidebarThreadRowDroppable.js";
import type { SidebarSortableDragBindings } from "./sortableMotion.js";
import { SidebarThreadDragChip } from "../dnd/sidebarThreadDragChip.js";
import { SplitPaneMiniMap } from "./SplitPaneMiniMap.js";
import {
  ThreadActionsContextMenu,
  ThreadActionsMenu,
  ThreadArchiveQuickAction,
} from "./ThreadActionsMenu.js";
import {
  ThreadStatusGlyph,
  resolveThreadStatus,
  type ThreadStatusGlyphProps,
} from "./ThreadStatusGlyph.js";

const SIDEBAR_TITLE_DOUBLE_CLICK_MS = 400;

let lastSidebarTitleClick: { at: number; threadId: string } | null = null;

function consumeSidebarTitleDoubleClick(threadId: string): boolean {
  const now = Date.now();
  const previous = lastSidebarTitleClick;
  lastSidebarTitleClick = { at: now, threadId };
  return (
    previous !== null &&
    previous.threadId === threadId &&
    now - previous.at < SIDEBAR_TITLE_DOUBLE_CLICK_MS
  );
}

export function resetSidebarTitleDoubleClickForTest(): void {
  lastSidebarTitleClick = null;
}

interface ThreadRowBaseOptions {
  depth: number;
  isCompact: boolean;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  dragBindings?: SidebarSortableDragBindings;
  nestDrop?: ThreadRowNestDrop;
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
      stickyLevel?: number;
      onToggleCollapsed: (threadId: string) => void;
    });

interface ThreadRowProps {
  projectId: string;
  thread: SidebarThread;
  crossProjectId: string | null;
  isActive: boolean;
  onProjectSelect?: () => void;
  options: ThreadRowOptions;
}

type ThreadRowClickCaptureHandler = MouseEventHandler<HTMLDivElement>;

interface ThreadRowContainerArgs {
  children: ReactNode;
  className: string;
  containerRef: (element: HTMLDivElement | null) => void;
  dragBindings?: SidebarSortableDragBindings;
  nestTargetState: SidebarNestTargetState | null;
  reorderPlacement: SidebarReorderPlacement | null;
  onClick?: MouseEventHandler<HTMLDivElement>;
  onClickCapture?: ThreadRowClickCaptureHandler;
  onSplitDragPointerDown?: PointerEventHandler<HTMLElement>;
  stickyLevel?: number;
  style: CSSProperties;
}

const NEST_TARGET_STATE_CLASS: Record<SidebarNestTargetState, string> = {
  valid:
    "bg-sidebar-accent text-sidebar-accent-foreground ring-1 ring-inset ring-sidebar-ring",
  blocked: "ring-1 ring-inset ring-destructive/60",
  unchanged: "ring-1 ring-inset ring-sidebar-border",
};

export const REORDER_PLACEMENT_CLASS: Record<SidebarReorderPlacement, string> =
  {
    before:
      "before:pointer-events-none before:absolute before:inset-x-1 before:-top-px before:h-0.5 before:rounded-full before:bg-sidebar-ring before:content-['']",
    after:
      "after:pointer-events-none after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:rounded-full after:bg-sidebar-ring after:content-['']",
  };

function getThreadRowStyle(depth: number): CSSProperties {
  return {
    paddingLeft: getSidebarThreadRowPaddingLeft(depth),
  };
}

function renderThreadRowContainer({
  children,
  className,
  containerRef,
  dragBindings,
  nestTargetState,
  onClick,
  onClickCapture,
  onSplitDragPointerDown,
  reorderPlacement,
  stickyLevel,
  style,
}: ThreadRowContainerArgs) {
  const containerProps = {
    "data-sidebar-rename-row": "",
    className,
    style,
    "data-sidebar-nest-target": nestTargetState ?? undefined,
    "data-sidebar-reorder-placement": reorderPlacement ?? undefined,
    ...dragBindings?.attributes,
    ...(dragBindings?.listeners ?? {}),
    onClick,
    onClickCapture,
    onPointerDown: onSplitDragPointerDown,
  };
  if (stickyLevel !== undefined) {
    return (
      <SidebarStickyTier
        ref={containerRef}
        tier="parent"
        level={stickyLevel}
        {...containerProps}
      >
        {children}
      </SidebarStickyTier>
    );
  }

  return (
    <div ref={containerRef} {...containerProps}>
      {children}
    </div>
  );
}

interface CollapsedThreadStatusGlyphProps {
  activity: CollapsedChildActivity;
  pluginStatus?: PluginSidebarThreadRowStatus | null;
}

export function CollapsedThreadStatusGlyph({
  activity,
  pluginStatus = null,
}: CollapsedThreadStatusGlyphProps) {
  const statusProps: ThreadListIndicatorState = {
    hasPendingInteraction: activity.pending,
    hasUnsubmittedDraft: activity.hasUnsubmittedDraft,
    hasUnreadError: activity.unreadError,
    hasUnreadSuccess: activity.unread,
    isBackgroundAgentActive: activity.backgroundAgent,
    isBackgroundCommandActive: activity.backgroundCommand,
    isGoalActive: activity.goal,
    queuedWork: "none",
    isPlanModeActive: activity.planMode,
    isRuntimeActive: activity.runtimeWorking,
    isWorkflowActive: activity.workflow,
  };
  return <ThreadStatusGlyph {...statusProps} pluginStatus={pluginStatus} />;
}

type ThreadTrailingIndicatorProps = ThreadStatusGlyphProps & {
  pluginStatus: PluginSidebarThreadRowStatus | null;
};

function ThreadTrailingIndicator({
  pluginStatus,
  ...statusProps
}: ThreadTrailingIndicatorProps) {
  const { indicatorKind, pluginStatusIsVisible } = resolveThreadStatus(
    statusProps,
    pluginStatus,
  );

  if (indicatorKind === "none" && !pluginStatusIsVisible) {
    return null;
  }

  return (
    <span
      data-sidebar-thread-trailing-indicator=""
      className={cn(
        SIDEBAR_ROW_GLYPH_SLOT_CLASS,
        SIDEBAR_STATUS_GLYPH_BOX_CLASS,
      )}
    >
      <ThreadStatusGlyph {...statusProps} pluginStatus={pluginStatus} />
    </span>
  );
}

function ThreadRestoreStatusAction({ thread }: { thread: SidebarThread }) {
  return (
    <span
      className="relative z-10 pointer-events-auto"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <ThreadArchiveQuickAction
        thread={thread}
        className={SIDEBAR_CONTROL_BUTTON_CLASS}
      />
    </span>
  );
}

function useThreadSplitMiniMap(
  threadId: string,
): readonly PluginSidebarSplitPane[] | null {
  const layout = useSidebarSplitLayout();
  return useMemo(() => {
    if (layout === null) return null;
    const slots = layout.panes.map<PluginSidebarSplitPane>((pane) => ({
      paneId: pane.paneId,
      rect: pane.rect,
      isMe: pane.threadId === threadId,
      isFocused: pane.isFocused,
    }));
    return slots.some((slot) => slot.isMe) ? slots : null;
  }, [layout, threadId]);
}

function ThreadRowComponent({
  projectId,
  thread,
  crossProjectId,
  isActive,
  onProjectSelect,
  options,
}: ThreadRowProps) {
  const [isDropdownActionsOpen, setIsDropdownActionsOpen] = useState(false);
  const [isContextActionsOpen, setIsContextActionsOpen] = useState(false);
  const actions = experimental_useSidebarThreadActions();
  const showProviderIcons = useAtomValue(sidebarShowProviderIconsAtom);
  const { providers } = experimental_useProviders();
  const provider = showProviderIcons
    ? providers.find((candidate) => candidate.id === thread.providerId)
    : undefined;
  const shortcut = useSidebarThreadShortcut(thread.id);
  const pluginThreadRowStatus = useSidebarThreadRowStatus(thread.id);
  const { hasUnsubmittedDraft: hasComposerDraft } = useSidebarThreadDraft(
    thread.id,
  );
  const showActive = isActive;
  const threadStatus = threadListIndicatorStateForThread(
    thread,
    hasComposerDraft,
  );
  const labelTitle = thread.displayTitle;
  const crossProjectName = useSidebarProjectName(crossProjectId);
  const crossProjectLabel =
    crossProjectId === null
      ? null
      : crossProjectName
        ? `In project ${crossProjectName}`
        : "In another project";
  const handleRename = useCallback(
    (nextTitle: string) => actions.rename(thread.id, nextTitle),
    [actions, thread.id],
  );
  const rename = useSidebarRename({
    kind: "thread",
    id: thread.id,
    name: labelTitle,
    label: "Thread name",
    onSave: handleRename,
  });
  const { editor, isEditing, startEditing } = rename;
  const startTitleEditing = useCallback(
    (event: { preventDefault: () => void; stopPropagation: () => void }) => {
      event.preventDefault();
      event.stopPropagation();
      startEditing();
    },
    [startEditing],
  );
  const miniMap = useThreadSplitMiniMap(thread.id);
  const isOpenInSplit = miniMap !== null;
  const split = experimental_useSidebarThreadSplit(thread.id);
  const onSplitDragPointerDown = split.splitProps.onPointerDown;
  const splitAvailable = split.isAvailable;
  const openInSplit = useCallback(() => {
    actions.open(thread.id, { split: true });
  }, [actions, thread.id]);
  const parentOptions = options.kind === "parent" ? options : null;
  const isParentRow = parentOptions !== null;
  const isParentCollapsed = parentOptions?.isCollapsed ?? false;
  const childCount = parentOptions?.childCount ?? 0;
  const childActivity =
    parentOptions?.childActivity ?? NO_COLLAPSED_CHILD_ACTIVITY;
  const hasChildren = childCount > 0;
  const reserveActionSpace =
    crossProjectLabel !== null || (isParentRow && hasChildren);
  const hasHiddenChildren = isParentRow && isParentCollapsed && hasChildren;
  const trailingIndicatorState: ThreadListIndicatorState = {
    hasPendingInteraction:
      threadStatus.hasPendingInteraction ||
      (hasHiddenChildren && childActivity.pending),
    hasUnsubmittedDraft:
      threadStatus.hasUnsubmittedDraft ||
      (hasHiddenChildren && childActivity.hasUnsubmittedDraft),
    hasUnreadError:
      threadStatus.hasUnreadError ||
      (hasHiddenChildren && childActivity.unreadError),
    hasUnreadSuccess:
      threadStatus.hasUnreadSuccess ||
      (hasHiddenChildren && childActivity.unread),
    isBackgroundAgentActive:
      threadStatus.isBackgroundAgentActive ||
      (hasHiddenChildren && childActivity.backgroundAgent),
    isBackgroundCommandActive:
      threadStatus.isBackgroundCommandActive ||
      (hasHiddenChildren && childActivity.backgroundCommand),
    isGoalActive:
      threadStatus.isGoalActive || (hasHiddenChildren && childActivity.goal),
    queuedWork: threadStatus.queuedWork,
    isPlanModeActive:
      threadStatus.isPlanModeActive ||
      (hasHiddenChildren && childActivity.planMode),
    isRuntimeActive:
      threadStatus.isRuntimeActive ||
      (hasHiddenChildren && childActivity.runtimeWorking),
    isWorkflowActive:
      threadStatus.isWorkflowActive ||
      (hasHiddenChildren && childActivity.workflow),
  };
  const trailingIndicatorResolution = resolveThreadStatus(
    trailingIndicatorState,
    pluginThreadRowStatus,
  );
  const trailingIndicatorKind = trailingIndicatorResolution.indicatorKind;
  const splitIndicatorIsWorking = hasThreadListWorkingActivity(
    trailingIndicatorState,
    pluginThreadRowStatus?.tone === "running",
  );
  const splitIndicatorLabel = trailingIndicatorResolution.accessibleLabel
    ? `${labelTitle} — open in split; ${trailingIndicatorResolution.accessibleLabel}`
    : `${labelTitle} — open in split`;
  const linkLabel = hasComposerDraft
    ? `Open ${labelTitle} (unsubmitted draft)`
    : `Open ${labelTitle}`;
  const rowDragBindings = isEditing ? undefined : options.dragBindings;
  const nestTargetState = options.nestDrop?.state ?? null;
  const reorderPlacement = options.nestDrop?.reorderPlacement ?? null;
  const containerRef = useComposedRefs<HTMLDivElement>(
    rowDragBindings?.setActivatorNodeRef,
    options.nestDrop?.setNodeRef,
  );
  const rowClassName = cn(
    SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
    "group/thread-row cursor-pointer",
    SIDEBAR_ROW_BASE_CLASS,
    LIST_HOVER_TRANSITION,
    parentOptions?.stickyLevel === undefined && "relative",
    options.isCompact
      ? COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS
      : COARSE_POINTER_ROW_HEIGHT_CLASS,
    showActive
      ? SIDEBAR_ROW_SELECTED_STATE_CLASS
      : SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
    !showActive && isOpenInSplit && SIDEBAR_ROW_OPEN_IN_SPLIT_STATE_CLASS,
    !showActive &&
      "has-[[data-state=open]]:bg-sidebar-accent has-[[data-sidebar-rename-anchor]:focus-visible]:bg-sidebar-accent",
    rowDragBindings && !rowDragBindings.disabled && "select-none",
    "data-[sidebar-touch-armed=true]:!bg-transparent",
    nestTargetState && NEST_TARGET_STATE_CLASS[nestTargetState],
    reorderPlacement && REORDER_PLACEMENT_CLASS[reorderPlacement],
  );
  const rowStyle = getThreadRowStyle(options.depth);
  const parentGuideLeft =
    options.depth > 0 ? getSidebarThreadGroupLineLeft(options.depth - 1) : null;
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

  const rowLinkRef = useRef<HTMLAnchorElement>(null);
  const handleRowClick = useCallback<MouseEventHandler<HTMLDivElement>>(
    (event) => {
      if (event.target !== event.currentTarget) {
        if (!(event.target instanceof Element)) return;
        if (!event.target.closest("[data-sidebar-thread-trailing]")) return;
        if (event.target.closest("a, button")) return;
      }
      rowLinkRef.current?.click();
    },
    [],
  );
  const rowContent = (
    <>
      {parentOptions?.stickyLevel !== undefined && parentGuideLeft !== null ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-0.5 top-0 z-[1] w-px bg-border-hairline opacity-70"
          style={{ left: parentGuideLeft }}
        />
      ) : null}
      <span
        className={cn(
          "relative flex min-w-0 flex-1 items-center gap-1.5 self-stretch",
          "group-data-[sidebar-touch-armed=true]/thread-row:hidden",
          !shortcut &&
            !isEditing &&
            (reserveActionSpace
              ? "pr-7.5 max-md:pointer-coarse:pr-0"
              : SIDEBAR_HOVER_ACTIONS_INSET_CLASS),
        )}
      >
        <a
          ref={rowLinkRef}
          href={thread.href}
          data-sidebar-thread-shortcut-target=""
          data-sidebar-thread-id={thread.id}
          data-sidebar-rename-anchor=""
          onClick={(event) => {
            if (isEditing) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            if (splitAvailable && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              openInSplit();
              return;
            }
            if (consumeSidebarTitleDoubleClick(thread.id)) {
              event.preventDefault();
              event.stopPropagation();
              startEditing();
              return;
            }
            onProjectSelect?.();
          }}
          onDoubleClick={isEditing ? undefined : startTitleEditing}
          aria-label={linkLabel}
          aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
          className="absolute inset-0 rounded-md outline-none"
        />
        <span
          className={cn(
            "pointer-events-none relative flex min-w-0 items-center self-stretch",
            ((crossProjectLabel === null && (!parentOptions || !hasChildren)) ||
              isEditing) &&
              "flex-1",
          )}
        >
          {isEditing ? (
            <span className="pointer-events-auto relative z-10 min-w-0 flex-1 overflow-visible">
              {editor}
            </span>
          ) : (
            <>
              {provider ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      data-sidebar-thread-provider={provider.id}
                      role="img"
                      aria-label={provider.displayName}
                      className="pointer-events-auto relative z-[31] flex size-4 shrink-0 items-center justify-center mr-1.5 text-muted-foreground"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        rowLinkRef.current?.click();
                      }}
                    >
                      <ProviderIcon
                        providerKind="agent"
                        provider={provider}
                        className="size-4"
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {provider.displayName}
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <span
                className={cn(
                  "bb-thread-title",
                  crossProjectLabel !== null && "min-w-0 truncate",
                )}
                title={labelTitle}
                onDoubleClick={startTitleEditing}
              >
                <ThreadTitle threadId={thread.id} />
              </span>
            </>
          )}
        </span>
        {crossProjectLabel !== null ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                data-sidebar-thread-cross-project=""
                role="img"
                aria-label={crossProjectLabel}
                className="relative z-[31] flex size-5 shrink-0 items-center justify-center text-muted-foreground"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  rowLinkRef.current?.click();
                }}
              >
                <Icon name="FolderExport" className="size-3.5" aria-hidden />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">{crossProjectLabel}</TooltipContent>
          </Tooltip>
        ) : null}
        {parentOptions && hasChildren ? (
          <SidebarChildToggleChevron
            disabled={isEditing}
            className={isEditing ? "hidden" : undefined}
            isCollapsed={isParentCollapsed}
            expandLabel={`Expand ${labelTitle} threads`}
            collapseLabel={`Collapse ${labelTitle} threads`}
            onToggle={() => parentOptions.onToggleCollapsed(thread.id)}
            revealOnHover={!isParentCollapsed}
          />
        ) : null}
      </span>
      {rowDragBindings && !rowDragBindings.disabled ? (
        <SidebarThreadDragChip
          title={labelTitle}
          visualOnly
          className="hidden group-data-[sidebar-touch-armed=true]/thread-row:flex"
        />
      ) : null}
      <span
        data-sidebar-thread-trailing=""
        className={cn(
          "flex shrink-0 items-center gap-0.5 group-data-[sidebar-touch-armed=true]/thread-row:hidden",
          isEditing && "hidden",
        )}
      >
        {thread.archivedAt !== null ? (
          <span className="relative flex items-center max-md:pointer-coarse:hidden">
            <div
              data-sidebar-hover-actions-open={
                isActionsOpen ? "true" : undefined
              }
              className={cn(
                SIDEBAR_HOVER_ACTIONS_CLASS,
                "absolute right-full z-10 max-md:pointer-coarse:hidden",
              )}
            >
              <ThreadActionsMenu
                thread={thread}
                triggerClassName={SIDEBAR_CONTROL_BUTTON_CLASS}
                onOpenInSplit={splitAvailable ? openInSplit : undefined}
                onOpenChange={setIsDropdownActionsOpen}
                onRename={rename.startEditingFromMenu}
                onCloseAutoFocus={rename.onCloseAutoFocus}
              />
            </div>
            <ThreadRestoreStatusAction thread={thread} />
          </span>
        ) : shortcut ? (
          <AppCommandShortcutPill shortcut={shortcut} />
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
                {miniMap ? (
                  <span
                    data-sidebar-thread-trailing-indicator=""
                    className={cn(
                      SIDEBAR_ROW_GLYPH_SLOT_CLASS,
                      SIDEBAR_STATUS_GLYPH_BOX_CLASS,
                    )}
                  >
                    <SplitPaneMiniMap
                      slots={miniMap}
                      label={splitIndicatorLabel}
                      isWorking={splitIndicatorIsWorking}
                    />
                  </span>
                ) : (
                  <ThreadTrailingIndicator
                    {...trailingIndicatorState}
                    hideIdleDraftLabel={
                      !hasHiddenChildren && trailingIndicatorKind === "draft"
                    }
                    pluginStatus={pluginThreadRowStatus}
                  />
                )}
              </span>
              <div
                data-sidebar-hover-actions-open={
                  isActionsOpen ? "true" : undefined
                }
                className={cn(
                  SIDEBAR_HOVER_ACTIONS_CLASS,
                  "absolute inset-y-0 right-0 z-10 flex items-center justify-end max-md:pointer-coarse:hidden",
                  isEditing && "invisible pointer-events-none",
                )}
              >
                <SidebarRowControls
                  primaryAction={
                    <ThreadArchiveQuickAction
                      thread={thread}
                      className={SIDEBAR_CONTROL_BUTTON_CLASS}
                    />
                  }
                >
                  <ThreadActionsMenu
                    thread={thread}
                    triggerClassName={SIDEBAR_CONTROL_BUTTON_CLASS}
                    onOpenInSplit={splitAvailable ? openInSplit : undefined}
                    onOpenChange={setIsDropdownActionsOpen}
                    onRename={rename.startEditingFromMenu}
                    onCloseAutoFocus={rename.onCloseAutoFocus}
                  />
                </SidebarRowControls>
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
    containerRef,
    dragBindings: rowDragBindings,
    nestTargetState,
    reorderPlacement,
    onClick: isEditing ? undefined : handleRowClick,
    onClickCapture:
      !isEditing && options.consumeClickSuppression
        ? handleRowClickCapture
        : undefined,
    onSplitDragPointerDown: isEditing ? undefined : onSplitDragPointerDown,
    stickyLevel: parentOptions?.stickyLevel,
    style: rowStyle,
  });

  return (
    <ThreadActionsContextMenu
      thread={thread}
      onOpenInSplit={splitAvailable ? openInSplit : undefined}
      onOpenChange={setIsContextActionsOpen}
      onRename={rename.startEditingFromMenu}
      onCloseAutoFocus={rename.onCloseAutoFocus}
      disabled={isEditing}
      dragging={rowDragBindings?.isDragging ?? false}
    >
      {row}
    </ThreadActionsContextMenu>
  );
}

export const ThreadRow = memo(ThreadRowComponent);
