import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  Panel,
  PanelGroup,
  type ImperativePanelGroupHandle,
} from "react-resizable-panels";
import { ResponsiveDrawerShell } from "@bb/shared-ui/responsive-overlay";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { DETAIL_GRID_CLASS } from "@/components/ui/detail-card.js";
import { useAtomValue } from "jotai";
import { cn } from "@bb/shared-ui/lib/utils";
import { ThreadSecondaryPanel } from "@/components/secondary-panel/ThreadSecondaryPanel";
import { secondaryPanelWidthPercentAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import {
  ThreadMetadataCard,
  ThreadMetadataContent,
  hasAnyThreadMetadata,
  type ThreadMetadataContentProps,
} from "@/components/secondary-panel/ThreadMetadataContent";
import { useThreads } from "@/hooks/queries/thread-queries";
import { isRunningThreadRuntimeDisplayStatus } from "@/components/thread/timeline";
import { ThreadTimelinePane } from "./ThreadTimelinePane";
import { ConversationCollapsedRail } from "@/components/secondary-panel/ConversationCollapsedRail";
import { PANEL_COLLAPSE_TRANSITION_CLASS } from "@/components/secondary-panel/panelTransitionTokens";
import { dispatchBrowserViewBoundsSync } from "@/lib/browser-view-bounds-sync";
import {
  usePaneContext,
  usePaneSecondaryPanelRegistration,
  type PaneSecondaryPanelViewModel,
} from "./PaneContext";
import { useOptionalIsSidebarShowing } from "@/components/ui/sidebar.js";
import {
  getBbDesktopInfo,
  shouldReserveMacosTrafficLights,
} from "@/lib/bb-desktop";
import { useDesktopWindowState } from "@/hooks/useDesktopWindowState";
import { PluginComposerHostScopeProvider } from "@/components/plugin/plugin-composer-host";

const CLOSED_TIMELINE_PANEL_SIZE_PERCENT = 100;
const COLLAPSED_TIMELINE_PANEL_SIZE_PERCENT = 0;
const TIMELINE_PANEL_MIN_SIZE_PERCENT = 30;

type ThreadTimelinePaneProps = Omit<
  ComponentProps<typeof ThreadTimelinePane>,
  "footer"
>;
type ThreadSecondaryPanelProps = Omit<
  ComponentProps<typeof ThreadSecondaryPanel>,
  | "metadataContent"
  | "renderAsDrawer"
  | "isConversationCollapsed"
  | "onToggleConversationCollapse"
  | "browserDeck"
> & {
  renderBrowserDeck?: (args: {
    canShowNativeBrowserView: boolean;
  }) => ReactNode;
};

interface ThreadDetailSecondaryContentProps {
  footer: ReactNode;
  header: ReactNode;
  isMetadataLoading: boolean;
  isSecondaryPanelOpen: boolean;
  isConversationCollapsed: boolean;
  /**
   * True when rendering inside a bounded split card. Bounded panes skip the
   * page-bleed negative margins below — the card supplies the boundary, so
   * bleeding out of it only gets clipped by the card's overflow-hidden (and
   * leaves a dead band at the bottom, since negative margins shift content
   * without stretching it).
   */
  isBoundedPane: boolean;
  onToggleSecondaryPanel: () => void;
  onToggleConversationCollapse: () => void;
  renderHostedPanel: (panel: ReactNode) => ReactNode;
  metadata: ThreadMetadataContentProps;
  secondaryPanel: ThreadSecondaryPanelProps;
  timeline: ThreadTimelinePaneProps;
}

export function ThreadDetailSecondaryContent(
  props: ThreadDetailSecondaryContentProps,
) {
  return (
    <PluginComposerHostScopeProvider>
      <ThreadDetailSecondaryContentBody {...props} />
    </PluginComposerHostScopeProvider>
  );
}

function ThreadDetailSecondaryContentBody({
  footer,
  header,
  isMetadataLoading,
  isSecondaryPanelOpen,
  isConversationCollapsed,
  isBoundedPane,
  onToggleSecondaryPanel,
  onToggleConversationCollapse,
  renderHostedPanel,
  metadata,
  secondaryPanel,
  timeline,
}: ThreadDetailSecondaryContentProps) {
  const { isFocused, paneId, secondaryPanelHost } = usePaneContext();
  const stableMetadata = metadata;
  const stableSecondaryPanel = secondaryPanel;
  const stableTimeline = timeline;
  const renderAsDrawer = useIsCompactViewport();
  const persistedSecondaryWidthPercent = useAtomValue(
    secondaryPanelWidthPercentAtom,
  );
  // The hosted (split-workspace) collapsed rail is the window's top-left-most
  // surface while the main sidebar is collapsed on macOS desktop: it must
  // reserve a title-bar-height strip so the traffic lights sit on clean window
  // chrome instead of on the rail's glyph/working indicator. When the sidebar
  // is open it hosts the lights itself and the rail sits to its right; the
  // inline (non-host) rail always sits below a full-width header on the lights'
  // row, so neither needs the reserve there.
  // `null` (no sidebar context, e.g. tests) is treated as showing, so no
  // reserve is applied.
  const isSidebarShowing = useOptionalIsSidebarShowing();
  const [desktopInfo] = useState(getBbDesktopInfo);
  const desktopWindowState = useDesktopWindowState();
  const hostedRailReservesTrafficLights =
    isSidebarShowing === false &&
    shouldReserveMacosTrafficLights({
      desktopInfo,
      windowState: desktopWindowState,
    });
  // Collapsing the conversation only makes sense on a wide viewport with the
  // secondary panel open — there is otherwise nothing to expand into.
  const canCollapseConversation = isSecondaryPanelOpen && !renderAsDrawer;
  const isConversationCollapsedActive =
    canCollapseConversation && isConversationCollapsed;
  // Real, in-scope activity signal for the collapsed rail: the agent is running.
  const isConversationWorking = isRunningThreadRuntimeDisplayStatus(
    stableTimeline.threadRuntimeDisplayStatus,
  );
  const [isCompactDrawerContentSettled, setIsCompactDrawerContentSettled] =
    useState(false);
  const compactDrawerContentSettleFrameRef = useRef<number | null>(null);
  const compactDrawerContentSettleGenerationRef = useRef(0);
  const compactDrawerContentSettleStateRef = useRef({
    isSecondaryPanelOpen,
    renderAsDrawer,
    threadId: stableTimeline.threadId,
  });

  useLayoutEffect(() => {
    compactDrawerContentSettleStateRef.current = {
      isSecondaryPanelOpen,
      renderAsDrawer,
      threadId: stableTimeline.threadId,
    };
  }, [isSecondaryPanelOpen, renderAsDrawer, stableTimeline.threadId]);

  const cancelCompactDrawerContentSettleFrame = useCallback(() => {
    compactDrawerContentSettleGenerationRef.current += 1;
    if (compactDrawerContentSettleFrameRef.current === null) {
      return;
    }
    window.cancelAnimationFrame(compactDrawerContentSettleFrameRef.current);
    compactDrawerContentSettleFrameRef.current = null;
  }, []);

  useLayoutEffect(() => {
    cancelCompactDrawerContentSettleFrame();
    setIsCompactDrawerContentSettled(false);
  }, [
    cancelCompactDrawerContentSettleFrame,
    isSecondaryPanelOpen,
    renderAsDrawer,
    stableTimeline.threadId,
  ]);

  useLayoutEffect(
    () => () => {
      cancelCompactDrawerContentSettleFrame();
    },
    [cancelCompactDrawerContentSettleFrame],
  );

  const handleDrawerContentAnimationEnd = useCallback(
    (open: boolean) => {
      if (!open) {
        return;
      }
      const currentState = compactDrawerContentSettleStateRef.current;
      if (!currentState.isSecondaryPanelOpen || !currentState.renderAsDrawer) {
        return;
      }

      cancelCompactDrawerContentSettleFrame();
      const requestGeneration = compactDrawerContentSettleGenerationRef.current;
      const requestThreadId = currentState.threadId;
      compactDrawerContentSettleFrameRef.current = window.requestAnimationFrame(
        () => {
          compactDrawerContentSettleFrameRef.current = null;
          const latestState = compactDrawerContentSettleStateRef.current;
          if (
            compactDrawerContentSettleGenerationRef.current !==
              requestGeneration ||
            latestState.threadId !== requestThreadId ||
            !latestState.isSecondaryPanelOpen ||
            !latestState.renderAsDrawer
          ) {
            return;
          }

          dispatchBrowserViewBoundsSync();

          const stateAfterSync = compactDrawerContentSettleStateRef.current;
          if (
            compactDrawerContentSettleGenerationRef.current ===
              requestGeneration &&
            stateAfterSync.threadId === requestThreadId &&
            stateAfterSync.isSecondaryPanelOpen &&
            stateAfterSync.renderAsDrawer
          ) {
            setIsCompactDrawerContentSettled(true);
          }
        },
      );
    },
    [cancelCompactDrawerContentSettleFrame],
  );
  const canShowNativeBrowserView = renderAsDrawer
    ? isSecondaryPanelOpen && isCompactDrawerContentSettled
    : isSecondaryPanelOpen && (secondaryPanelHost === null || isFocused);
  const { renderBrowserDeck, ...threadSecondaryPanelProps } =
    stableSecondaryPanel;
  const browserDeck = useMemo(
    () => renderBrowserDeck?.({ canShowNativeBrowserView }),
    [canShowNativeBrowserView, renderBrowserDeck],
  );

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

  // Mirror ForksRow's query (deduped by react-query) so the visibility gate
  // accounts for the lazily-fetched Forks row.
  const forksQuery = useThreads({
    projectId: stableMetadata.thread.projectId,
    sourceThreadId: stableMetadata.thread.id,
    originKind: "fork",
    archived: false,
  });
  const hasForks = (forksQuery.data?.length ?? 0) > 0;

  const metadataContent = useMemo(
    () =>
      hasAnyThreadMetadata(stableMetadata, hasForks) ? (
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
    [hasForks, isMetadataLoading, stableMetadata],
  );
  const inlineSecondaryPanelContent = useMemo(
    () =>
      !renderAsDrawer ? (
        <ThreadSecondaryPanel
          {...threadSecondaryPanelProps}
          browserDeck={browserDeck}
          renderAsDrawer={false}
          isConversationCollapsed={isConversationCollapsedActive}
          onToggleConversationCollapse={onToggleConversationCollapse}
          // The full-width header bar owns the (stable) right-panel toggle, so
          // the panel drops its own inline hide control entirely — no reserved
          // slot, so the trailing expand control sits flush at the edge.
          inlinePanelToggle={
            secondaryPanelHost === null ? "hidden" : "reserved"
          }
          // In the split-workspace host, panes' panels share one PanelGroup, so
          // each pane's Panel needs its own layout identity (see the prop doc).
          resizablePanelId={
            secondaryPanelHost === null
              ? undefined
              : `thread-detail-secondary-panel-${paneId}`
          }
          metadataContent={metadataContent}
        />
      ) : null,
    [
      browserDeck,
      isConversationCollapsedActive,
      metadataContent,
      onToggleConversationCollapse,
      paneId,
      renderAsDrawer,
      secondaryPanelHost,
      threadSecondaryPanelProps,
    ],
  );
  const drawerSecondaryPanelContent = renderAsDrawer ? (
    <ThreadSecondaryPanel
      {...threadSecondaryPanelProps}
      browserDeck={browserDeck}
      renderAsDrawer={true}
      isConversationCollapsed={false}
      onToggleConversationCollapse={onToggleConversationCollapse}
      metadataContent={metadataContent}
    />
  ) : null;
  const hostedCollapsedRail = useMemo(
    () => (
      <ConversationCollapsedRail
        collapsed={isConversationCollapsedActive}
        isWorking={isConversationWorking}
        reserveTopForDesktopTrafficLights={hostedRailReservesTrafficLights}
        onExpand={onToggleConversationCollapse}
      />
    ),
    [
      hostedRailReservesTrafficLights,
      isConversationCollapsedActive,
      isConversationWorking,
      onToggleConversationCollapse,
    ],
  );
  const hostedPanelModel = useMemo<PaneSecondaryPanelViewModel>(
    () => ({
      collapsedRail: hostedCollapsedRail,
      contentKey: stableTimeline.threadId,
      isMainCollapsed: isConversationCollapsedActive,
      isOpen: isSecondaryPanelOpen,
      panel: renderHostedPanel(inlineSecondaryPanelContent),
      onToggle: onToggleSecondaryPanel,
    }),
    [
      hostedCollapsedRail,
      inlineSecondaryPanelContent,
      isConversationCollapsedActive,
      isSecondaryPanelOpen,
      onToggleSecondaryPanel,
      renderHostedPanel,
      stableTimeline.threadId,
    ],
  );
  usePaneSecondaryPanelRegistration(secondaryPanelHost, hostedPanelModel);

  if (secondaryPanelHost !== null) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-clip">
        {header}
        <div
          data-conversation-collapsed={isConversationCollapsedActive}
          inert={isConversationCollapsedActive}
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col transition-opacity",
            PANEL_COLLAPSE_TRANSITION_CLASS,
            isConversationCollapsedActive && "opacity-0",
          )}
        >
          <ThreadTimelinePane {...stableTimeline} footer={footer} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-clip",
        !isBoundedPane && "-mx-4 -mb-4 -mt-4 md:-mx-5 md:-mb-5 md:-mt-5",
      )}
    >
      {/*
        The thread header is a full-width bar above the split, so its right-aligned
        actions stay anchored to the window edge instead of riding the timeline
        panel's width as the secondary panel opens and closes.
      */}
      {header}
      {/*
        When collapsed we keep the resizable PanelGroup mounted (the timeline
        lifts to 0% and the panel to 100% via the layout effect) and slot the
        36px rail in beside it as a plain flex sibling. This sidesteps the
        "fixed px in a percentage engine" problem the same way a layout swap
        would, but without unmounting the PanelGroup — so the secondary
        panel's content (live iframes, parsed diffs, scroll position) is
        never torn down and re-created when toggling collapse.
      */}
      <div className="flex min-h-0 w-full min-w-0 flex-1">
        <ConversationCollapsedRail
          collapsed={isConversationCollapsedActive}
          isWorking={isConversationWorking}
          // The inline (non-split) surface keeps a full-width thread header on
          // the traffic-light row above this rail, so the lights never reach the
          // rail's glyph — only the hosted split rail owns the window top-left.
          reserveTopForDesktopTrafficLights={false}
          onExpand={onToggleConversationCollapse}
        />
        <PanelGroup
          // Thread-scoped panel state should mount at its saved size instead of
          // animating from the previously selected thread's layout.
          key={stableTimeline.threadId}
          ref={horizontalPanelGroupRef}
          direction="horizontal"
          // Query container so the secondary panel can hold its content at the
          // panel's open width in cqw and clip it into view instead of reflowing
          // (see ThreadSecondaryPanel swipe mode). Scoping it to the group — not
          // the rail+group row — keeps cqw equal to the panel's own width even
          // when the conversation-collapsed rail is present.
          className="@container h-full min-w-0 flex-1"
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
              <ThreadTimelinePane {...stableTimeline} footer={footer} />
            </div>
          </Panel>
          {inlineSecondaryPanelContent}
        </PanelGroup>
      </div>
      {renderAsDrawer ? (
        <ResponsiveDrawerShell
          open={isSecondaryPanelOpen}
          onOpenChange={(open) => {
            if (!open) threadSecondaryPanelProps.onClose();
          }}
          srLabel="Thread details"
          contentClassName="h-[92dvh] max-h-[92dvh]"
          onContentAnimationEnd={handleDrawerContentAnimationEnd}
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
