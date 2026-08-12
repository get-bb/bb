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
import { PersistentResponsiveDrawerShell } from "@bb/shared-ui/responsive-overlay";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { DETAIL_GRID_CLASS } from "@/components/ui/detail-card.js";
import { useAtomValue } from "jotai";
import { cn } from "@bb/shared-ui/lib/utils";
import { ThreadSecondaryPanel } from "@/components/secondary-panel/ThreadSecondaryPanel";
import { useDrawerPanelRealization } from "@/components/secondary-panel/useDrawerPanelRealization";
import {
  secondaryPanelWidthPercentAtom,
} from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import {
  ThreadMetadataCard,
  ThreadMetadataContent,
  hasAnyThreadMetadata,
  type ThreadMetadataContentProps,
} from "@/components/secondary-panel/ThreadMetadataContent";
import { useThreads } from "@/hooks/queries/thread-queries";
import { ThreadTimelinePane } from "./ThreadTimelinePane";
import { PANEL_COLLAPSE_TRANSITION_CLASS } from "@/components/secondary-panel/panelTransitionTokens";
import { dispatchBrowserViewBoundsSync } from "@/lib/browser-view-bounds-sync";
import {
  usePaneContext,
  usePaneSecondaryPanelRegistration,
  type PaneSecondaryPanelViewModel,
} from "./PaneContext";
import {
  PluginComposerHostScopeProvider,
  usePluginComposerHost,
} from "@/components/plugin/plugin-composer-host";

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
  const composerHost = usePluginComposerHost();
  const stableMetadata = metadata;
  const stableSecondaryPanel = secondaryPanel;
  const stableTimeline = timeline;
  const renderAsDrawer = useIsCompactViewport();
  const persistedSecondaryWidthPercent = useAtomValue(
    secondaryPanelWidthPercentAtom,
  );
  // Collapsing the conversation only makes sense on a wide viewport with the
  // secondary panel open — there is otherwise nothing to expand into.
  const canCollapseConversation = isSecondaryPanelOpen && !renderAsDrawer;
  const isConversationCollapsedActive =
    canCollapseConversation && isConversationCollapsed;
  const [isCompactDrawerContentSettled, setIsCompactDrawerContentSettled] =
    useState(false);
  const { isPanelRealized, realizePanel } = useDrawerPanelRealization({
    isDrawerOpen: isSecondaryPanelOpen,
    rendersAsDrawer: renderAsDrawer,
  });
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
            realizePanel();
          }
        },
      );
    },
    [cancelCompactDrawerContentSettleFrame, realizePanel],
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
          // The owning thread or workspace header shows a closed panel. Once
          // open, collapse belongs at the outer edge of the panel toolbar.
          inlinePanelToggle="button"
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
  const hostedPanelModel = useMemo<PaneSecondaryPanelViewModel>(
    () => ({
      composerHost,
      contentKey: stableTimeline.threadId,
      isMainCollapsed: isConversationCollapsedActive,
      isOpen: isSecondaryPanelOpen,
      panel: renderHostedPanel(inlineSecondaryPanelContent),
      onToggle: onToggleSecondaryPanel,
    }),
    [
      composerHost,
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
        When collapsed we keep the resizable PanelGroup mounted: the timeline
        lifts to 0% and the panel to 100% via the layout effect. Nothing
        unmounts, so the secondary panel's content (live iframes, parsed diffs,
        scroll position) is never torn down and re-created when toggling
        collapse. The panel header's own toggle restores the conversation.
      */}
      {/* PanelGroup sets an inline `height: 100%`, so it needs this flex-sized
          row to resolve against rather than the column that also holds the
          header. */}
      <div className="flex min-h-0 w-full min-w-0 flex-1">
        <PanelGroup
          // Thread-scoped panel state should mount at its saved size instead of
          // animating from the previously selected thread's layout.
          key={stableTimeline.threadId}
          ref={horizontalPanelGroupRef}
          direction="horizontal"
          // Query container so the secondary panel can hold its content at the
          // panel's open width in cqw and clip it into view instead of
          // reflowing (see ThreadSecondaryPanel swipe mode).
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
              {header}
              <ThreadTimelinePane {...stableTimeline} footer={footer} />
            </div>
          </Panel>
          {inlineSecondaryPanelContent}
        </PanelGroup>
      </div>
      {renderAsDrawer ? (
        <PersistentResponsiveDrawerShell
          open={isSecondaryPanelOpen}
          onOpenChange={(open) => {
            if (!open) threadSecondaryPanelProps.onClose();
          }}
          srLabel="Thread details"
          contentClassName="h-[92dvh] max-h-[92dvh]"
          onContentAnimationEnd={handleDrawerContentAnimationEnd}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Paint the light shell first. The real panel mounts two frames
                later, while the compositor moves the drawer. */}
            {isPanelRealized ? (
              drawerSecondaryPanelContent
            ) : (
              <ThreadMetadataLoadingSkeleton />
            )}
          </div>
        </PersistentResponsiveDrawerShell>
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
