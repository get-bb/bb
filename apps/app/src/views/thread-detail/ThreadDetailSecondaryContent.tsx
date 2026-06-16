import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  getBbDesktopInfo,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { useOptionalIsSidebarShowing } from "@/components/ui/sidebar.js";
import {
  Panel,
  PanelGroup,
  type ImperativePanelGroupHandle,
} from "react-resizable-panels";
import { ResponsiveDrawerShell } from "@/components/ui/responsive-overlay.js";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { DETAIL_GRID_CLASS } from "@/components/ui/detail-card.js";
import { useAtomValue } from "jotai";
import { cn } from "@/lib/utils";
import { ThreadSecondaryPanel } from "@/components/secondary-panel/ThreadSecondaryPanel";
import { secondaryPanelWidthPercentAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import {
  ThreadMetadataCard,
  ThreadMetadataContent,
  hasAnyThreadMetadata,
  type ThreadMetadataContentProps,
} from "@/components/secondary-panel/ThreadMetadataContent";
import { ThreadTimelinePane } from "./ThreadTimelinePane";
import { ConversationCollapsedRail } from "@/components/secondary-panel/ConversationCollapsedRail";
import { PANEL_COLLAPSE_TRANSITION_CLASS } from "@/components/secondary-panel/panelTransitionTokens";

const CLOSED_TIMELINE_PANEL_SIZE_PERCENT = 100;
const COLLAPSED_TIMELINE_PANEL_SIZE_PERCENT = 0;
const TIMELINE_PANEL_MIN_SIZE_PERCENT = 30;

type ThreadTimelinePaneProps = Omit<
  ComponentProps<typeof ThreadTimelinePane>,
  "footer" | "header"
>;
type ThreadSecondaryPanelProps = Omit<
  ComponentProps<typeof ThreadSecondaryPanel>,
  | "metadataContent"
  | "renderAsDrawer"
  | "isConversationCollapsed"
  | "onToggleConversationCollapse"
  | "reserveLeftForDesktopTrafficLights"
>;

interface ThreadDetailSecondaryContentProps {
  footer: ReactNode;
  header: ReactNode;
  isMetadataLoading: boolean;
  isSecondaryPanelOpen: boolean;
  isConversationCollapsed: boolean;
  surface: "page" | "popout";
  onToggleConversationCollapse: () => void;
  metadata: ThreadMetadataContentProps;
  secondaryPanel: ThreadSecondaryPanelProps;
  timeline: ThreadTimelinePaneProps;
}

type ThreadMetadataPropsEqual = (
  previous: ThreadMetadataContentProps,
  next: ThreadMetadataContentProps,
) => boolean;
type ThreadSecondaryPanelPropsEqual = (
  previous: ThreadSecondaryPanelProps,
  next: ThreadSecondaryPanelProps,
) => boolean;
type ThreadTimelinePanePropsEqual = (
  previous: ThreadTimelinePaneProps,
  next: ThreadTimelinePaneProps,
) => boolean;

interface UseStableThreadMetadataPropsArgs {
  value: ThreadMetadataContentProps;
}

interface UseStableThreadSecondaryPanelPropsArgs {
  value: ThreadSecondaryPanelProps;
}

interface UseStableThreadTimelinePanePropsArgs {
  value: ThreadTimelinePaneProps;
}

const areThreadMetadataPropsEqual: ThreadMetadataPropsEqual = (
  previous,
  next,
) =>
  previous.thread === next.thread &&
  previous.projectId === next.projectId &&
  previous.parentThreadDisplayName === next.parentThreadDisplayName &&
  previous.parentThreads === next.parentThreads &&
  previous.canAssignToParent === next.canAssignToParent &&
  previous.canTakeOverThread === next.canTakeOverThread &&
  previous.environment === next.environment &&
  previous.environmentDisplayHost === next.environmentDisplayHost &&
  previous.workspaceStatus === next.workspaceStatus &&
  previous.workspaceStatusError === next.workspaceStatusError &&
  previous.workspaceUnavailable === next.workspaceUnavailable &&
  previous.pullRequest === next.pullRequest &&
  previous.selectedMergeBaseBranch === next.selectedMergeBaseBranch &&
  previous.mergeBaseBranchRef === next.mergeBaseBranchRef &&
  previous.mergeBaseBranchOptions === next.mergeBaseBranchOptions &&
  previous.mergeBaseRemoteBranchOptions === next.mergeBaseRemoteBranchOptions &&
  previous.isLoadingMergeBaseBranchOptions ===
    next.isLoadingMergeBaseBranchOptions &&
  previous.threadSchedules === next.threadSchedules &&
  previous.updateThreadPending === next.updateThreadPending &&
  previous.storage === next.storage &&
  previous.onAssignParent === next.onAssignParent &&
  previous.onMergeBaseBranchChange === next.onMergeBaseBranchChange &&
  previous.onMergeBasePickerOpenChange === next.onMergeBasePickerOpenChange &&
  previous.onMergeBaseBranchSearchQueryChange ===
    next.onMergeBaseBranchSearchQueryChange &&
  previous.onChangedFileClick === next.onChangedFileClick &&
  previous.onCommitClick === next.onCommitClick;

const areThreadSecondaryPanelPropsEqual: ThreadSecondaryPanelPropsEqual = (
  previous,
  next,
) =>
  previous.activeTab === next.activeTab &&
  previous.canUseGitUi === next.canUseGitUi &&
  previous.defaultMergeBaseBranch === next.defaultMergeBaseBranch &&
  previous.environmentId === next.environmentId &&
  previous.workspaceRootPath === next.workspaceRootPath &&
  previous.fileTabs === next.fileTabs &&
  previous.fileTabContent === next.fileTabContent &&
  previous.browserDeck === next.browserDeck &&
  previous.isBrowserTabActive === next.isBrowserTabActive &&
  previous.isOpen === next.isOpen &&
  previous.showGitDiffTab === next.showGitDiffTab &&
  previous.onPanelFocus === next.onPanelFocus &&
  previous.onPanelChange === next.onPanelChange &&
  previous.onCollapse === next.onCollapse &&
  previous.onClose === next.onClose &&
  previous.onOpenNewTab === next.onOpenNewTab &&
  previous.onFileTabReorder === next.onFileTabReorder &&
  previous.onOpenFileInEditor === next.onOpenFileInEditor &&
  previous.onOpenFilePreview === next.onOpenFilePreview;

const areThreadTimelinePanePropsEqual: ThreadTimelinePanePropsEqual = (
  previous,
  next,
) =>
  previous.activeThinking === next.activeThinking &&
  previous.hasOlderTimelineRows === next.hasOlderTimelineRows &&
  previous.hostConnectionNotice === next.hostConnectionNotice &&
  previous.isLoadingOlderTimelineRows === next.isLoadingOlderTimelineRows &&
  previous.isThreadTimelinePending === next.isThreadTimelinePending &&
  previous.timelineError === next.timelineError &&
  previous.onLoadOlderRows === next.onLoadOlderRows &&
  previous.onOpenLink === next.onOpenLink &&
  previous.onOpenLocalFileLink === next.onOpenLocalFileLink &&
  previous.onTitleAction === next.onTitleAction &&
  previous.projectId === next.projectId &&
  previous.showOngoingIndicator === next.showOngoingIndicator &&
  previous.ongoingIndicatorLabel === next.ongoingIndicatorLabel &&
  previous.stopRequestedAt === next.stopRequestedAt &&
  previous.timelineRows === next.timelineRows &&
  previous.threadId === next.threadId &&
  previous.threadRuntimeDisplayStatus === next.threadRuntimeDisplayStatus &&
  previous.unreadDividerAutoScroll === next.unreadDividerAutoScroll &&
  previous.unreadDividerPlacement === next.unreadDividerPlacement &&
  previous.workspaceRootPath === next.workspaceRootPath;

function useStableThreadMetadataProps({
  value,
}: UseStableThreadMetadataPropsArgs): ThreadMetadataContentProps {
  const valueRef = useRef(value);
  if (!areThreadMetadataPropsEqual(valueRef.current, value)) {
    valueRef.current = value;
  }
  return valueRef.current;
}

function useStableThreadSecondaryPanelProps({
  value,
}: UseStableThreadSecondaryPanelPropsArgs): ThreadSecondaryPanelProps {
  const valueRef = useRef(value);
  if (!areThreadSecondaryPanelPropsEqual(valueRef.current, value)) {
    valueRef.current = value;
  }
  return valueRef.current;
}

function useStableThreadTimelinePaneProps({
  value,
}: UseStableThreadTimelinePanePropsArgs): ThreadTimelinePaneProps {
  const valueRef = useRef(value);
  if (!areThreadTimelinePanePropsEqual(valueRef.current, value)) {
    valueRef.current = value;
  }
  return valueRef.current;
}

export function ThreadDetailSecondaryContent({
  footer,
  header,
  isMetadataLoading,
  isSecondaryPanelOpen,
  isConversationCollapsed,
  surface,
  onToggleConversationCollapse,
  metadata,
  secondaryPanel,
  timeline,
}: ThreadDetailSecondaryContentProps) {
  const stableMetadata = useStableThreadMetadataProps({ value: metadata });
  const stableSecondaryPanel = useStableThreadSecondaryPanelProps({
    value: secondaryPanel,
  });
  const stableTimeline = useStableThreadTimelinePaneProps({ value: timeline });
  const renderAsDrawer = useIsCompactViewport();
  const persistedSecondaryWidthPercent = useAtomValue(
    secondaryPanelWidthPercentAtom,
  );
  // When the main sidebar is collapsed on macOS desktop, the traffic-light
  // cluster sits over the leftmost content (no expanded sidebar to absorb it).
  // The rail's chevron and the secondary panel's tab strip need to clear that
  // zone; nothing-to-do otherwise (web, or sidebar covers the cluster).
  const [desktopInfo] = useState(getBbDesktopInfo);
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const optionalIsMainSidebarShowing = useOptionalIsSidebarShowing();
  const isMainSidebarShowing =
    surface === "popout" ? false : optionalIsMainSidebarShowing === true;
  const isLeftmostSurfaceUnderTrafficLights =
    usesDesktopChrome && !isMainSidebarShowing && !renderAsDrawer;
  // Collapsing the conversation only makes sense on a wide viewport with the
  // secondary panel open — there is otherwise nothing to expand into.
  const canCollapseConversation = isSecondaryPanelOpen && !renderAsDrawer;
  const isConversationCollapsedActive =
    canCollapseConversation && isConversationCollapsed;
  // Real, in-scope activity signal for the collapsed rail: the agent is running.
  const isConversationWorking =
    stableTimeline.threadRuntimeDisplayStatus === "active";

  const horizontalPanelGroupRef = useRef<ImperativePanelGroupHandle | null>(
    null,
  );
  // Read inside the collapse layout effect without making width changes
  // re-trigger it (which would fight an in-progress resize drag).
  const persistedSecondaryWidthRef = useRef(persistedSecondaryWidthPercent);
  useEffect(() => {
    persistedSecondaryWidthRef.current = persistedSecondaryWidthPercent;
  }, [persistedSecondaryWidthPercent]);
  const didMountConversationCollapseRef = useRef(false);
  useLayoutEffect(() => {
    // Initial mount is handled by each panel's defaultSize; only animate when
    // the collapse state changes afterwards. A layout effect keeps the
    // secondary panel's lifted max size and the new layout in the same commit,
    // avoiding a flicker through the clamped 70% intermediate.
    if (!didMountConversationCollapseRef.current) {
      didMountConversationCollapseRef.current = true;
      return;
    }
    const group = horizontalPanelGroupRef.current;
    if (group === null || renderAsDrawer || !isSecondaryPanelOpen) {
      return;
    }
    if (isConversationCollapsedActive) {
      group.setLayout([COLLAPSED_TIMELINE_PANEL_SIZE_PERCENT, 100]);
    } else {
      const secondaryWidth = persistedSecondaryWidthRef.current;
      group.setLayout([100 - secondaryWidth, secondaryWidth]);
    }
  }, [isConversationCollapsedActive, isSecondaryPanelOpen, renderAsDrawer]);

  const metadataContent = useMemo(
    () =>
      hasAnyThreadMetadata(stableMetadata) ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ThreadMetadataContent {...stableMetadata} />
        </div>
      ) : isMetadataLoading ? (
        <ThreadMetadataLoadingSkeleton />
      ) : (
        <div className="px-4 pt-1 text-sm text-muted-foreground">
          No thread details available.
        </div>
      ),
    [isMetadataLoading, stableMetadata],
  );
  const inlineSecondaryPanelContent = !renderAsDrawer ? (
    <ThreadSecondaryPanel
      {...stableSecondaryPanel}
      renderAsDrawer={false}
      isConversationCollapsed={isConversationCollapsedActive}
      onToggleConversationCollapse={onToggleConversationCollapse}
      // Panel is leftmost only when the rail (36px) is the only thing between
      // it and the window edge — i.e. the conversation is also collapsed.
      reserveLeftForDesktopTrafficLights={
        isLeftmostSurfaceUnderTrafficLights && isConversationCollapsedActive
      }
      metadataContent={metadataContent}
    />
  ) : null;
  const drawerSecondaryPanelContent = renderAsDrawer ? (
    <ThreadSecondaryPanel
      {...stableSecondaryPanel}
      renderAsDrawer={true}
      isConversationCollapsed={false}
      onToggleConversationCollapse={onToggleConversationCollapse}
      reserveLeftForDesktopTrafficLights={false}
      metadataContent={metadataContent}
    />
  ) : null;

  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-clip",
        surface === "page" && "-mx-4 -mb-4 -mt-4 md:-mx-5 md:-mb-5 md:-mt-5",
      )}
    >
      {/*
        When collapsed we keep the resizable PanelGroup mounted (the timeline
        lifts to 0% and the panel to 100% via the layout effect) and slot the
        36px rail in beside it as a plain flex sibling. This sidesteps the
        "fixed px in a percentage engine" problem the same way a layout swap
        would, but without unmounting the PanelGroup — so the secondary
        panel's content (live iframes, parsed diffs, scroll position) is
        never torn down and re-created when toggling collapse.
      */}
      <div className="flex h-full w-full min-w-0">
        <ConversationCollapsedRail
          collapsed={isConversationCollapsedActive}
          isWorking={isConversationWorking}
          reserveTopForDesktopTrafficLights={
            isLeftmostSurfaceUnderTrafficLights
          }
          onExpand={onToggleConversationCollapse}
        />
        <PanelGroup
          // Thread-scoped panel state should mount at its saved size instead of
          // animating from the previously selected thread's layout.
          key={stableTimeline.threadId}
          ref={horizontalPanelGroupRef}
          direction="horizontal"
          className="h-full min-w-0 flex-1"
          // react-resizable-panels sets an INLINE `overflow: hidden` on the group
          // root, which is still programmatically scrollable. A `scrollIntoView`
          // from the app-preview iframe (clicking an in-page `#anchor`) walks up
          // and bumps this group's `scrollTop`, dragging the whole view out of
          // place. `clip` makes it a non-scroll container.
          style={{ overflow: "clip" }}
        >
          <Panel
            id="thread-detail-timeline-panel"
            collapsible
            collapsedSize={COLLAPSED_TIMELINE_PANEL_SIZE_PERCENT}
            defaultSize={
              isConversationCollapsedActive
                ? COLLAPSED_TIMELINE_PANEL_SIZE_PERCENT
                : isSecondaryPanelOpen && !renderAsDrawer
                  ? 100 - persistedSecondaryWidthPercent
                  : CLOSED_TIMELINE_PANEL_SIZE_PERCENT
            }
            minSize={TIMELINE_PANEL_MIN_SIZE_PERCENT}
            order={1}
            className={cn(
              "min-w-0 overflow-clip transition-[flex-grow,flex-basis]",
              PANEL_COLLAPSE_TRANSITION_CLASS,
            )}
          >
            <div
              data-conversation-collapsed={isConversationCollapsedActive}
              // `inert` removes the hidden conversation (header, timeline,
              // composer) from the tab order and a11y tree and blocks pointer
              // events, so keyboard focus can't land in the invisible pane.
              inert={isConversationCollapsedActive}
              className={cn(
                "flex h-full min-h-0 min-w-0 flex-col transition-opacity",
                PANEL_COLLAPSE_TRANSITION_CLASS,
                isConversationCollapsedActive && "opacity-0",
              )}
            >
              <ThreadTimelinePane
                {...stableTimeline}
                footer={footer}
                header={header}
              />
            </div>
          </Panel>
          {inlineSecondaryPanelContent}
        </PanelGroup>
      </div>
      {renderAsDrawer ? (
        <ResponsiveDrawerShell
          open={isSecondaryPanelOpen}
          onOpenChange={(open) => {
            if (!open) stableSecondaryPanel.onClose();
          }}
          srLabel="Thread details"
          contentClassName="h-[92dvh] max-h-[92dvh]"
          // `handleOnly` keeps vaul from binding its pointerdown handler on
          // the drawer body. Without it, vaul calls setPointerCapture on the
          // click target, which captures the pointer on Pierre tree's host
          // element and prevents the click from reaching rows inside the
          // shadow DOM. The drag handle bar still drags the drawer.
          handleOnly
          // This drawer hosts nested picker drawers; Vaul's input repositioning
          // reacts to any focused input, including nested search fields.
          repositionInputs={false}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {drawerSecondaryPanelContent}
          </div>
        </ResponsiveDrawerShell>
      ) : null}
    </div>
  );
}

const METADATA_SKELETON_ROW_VALUE_WIDTHS = ["w-40", "w-28", "w-36", "w-24"];

function ThreadMetadataLoadingSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ThreadMetadataCard>
        {METADATA_SKELETON_ROW_VALUE_WIDTHS.map((valueWidth, index) => (
          <div
            key={index}
            className={cn(DETAIL_GRID_CLASS, "items-center py-0.5")}
          >
            <Skeleton className="h-3 w-14 rounded-sm" />
            <Skeleton className={`h-3 ${valueWidth} max-w-full rounded-sm`} />
          </div>
        ))}
      </ThreadMetadataCard>
    </div>
  );
}
