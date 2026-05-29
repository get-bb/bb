import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  getBbDesktopInfo,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { useIsSidebarShowing } from "@/components/ui/sidebar.js";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelGroupHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { ResponsiveDrawerShell } from "@/components/ui/responsive-overlay.js";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { useAtomValue } from "jotai";
import {
  MAX_TERMINAL_PANEL_HEIGHT_PERCENT,
  MIN_TERMINAL_PANEL_HEIGHT_PERCENT,
} from "@/lib/thread-terminal-panel-state";
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
type TerminalPanelDraggingHandler = (isDragging: boolean) => void;

interface ThreadDetailSecondaryContentProps {
  footer: ReactNode;
  header: ReactNode;
  isMetadataLoading: boolean;
  isSecondaryPanelOpen: boolean;
  isConversationCollapsed: boolean;
  onToggleConversationCollapse: () => void;
  metadata: ThreadMetadataContentProps;
  secondaryPanel: ThreadSecondaryPanelProps;
  terminalPanel?: ReactNode;
  terminalPanelHeightPercent: number;
  terminalPanelOpen: boolean;
  onTerminalPanelResize: (sizePercent: number) => void;
  timeline: ThreadTimelinePaneProps;
}

export function ThreadDetailSecondaryContent({
  footer,
  header,
  isMetadataLoading,
  isSecondaryPanelOpen,
  isConversationCollapsed,
  onToggleConversationCollapse,
  metadata,
  onTerminalPanelResize,
  secondaryPanel,
  terminalPanel,
  terminalPanelHeightPercent,
  terminalPanelOpen,
  timeline,
}: ThreadDetailSecondaryContentProps) {
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
  const isMainSidebarShowing = useIsSidebarShowing();
  const isLeftmostSurfaceUnderTrafficLights =
    usesDesktopChrome && !isMainSidebarShowing && !renderAsDrawer;
  // Collapsing the conversation only makes sense on a wide viewport with the
  // secondary panel open — there is otherwise nothing to expand into.
  const canCollapseConversation = isSecondaryPanelOpen && !renderAsDrawer;
  const isConversationCollapsedActive =
    canCollapseConversation && isConversationCollapsed;
  // Real, in-scope activity signal for the collapsed rail: the agent is running.
  const isConversationWorking = timeline.threadRuntimeDisplayStatus === "active";

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

  const terminalPanelRef = useRef<ImperativePanelHandle | null>(null);
  const lastTerminalSizeRef = useRef(terminalPanelHeightPercent);
  const isTerminalPanelDraggingRef = useRef(false);
  const didMountTerminalRef = useRef(false);

  useEffect(() => {
    if (isTerminalPanelDraggingRef.current) {
      return;
    }
    lastTerminalSizeRef.current = terminalPanelHeightPercent;
  }, [terminalPanelHeightPercent]);

  useEffect(() => {
    // Skip initial mount — Panel's defaultSize handles it.
    if (!didMountTerminalRef.current) {
      didMountTerminalRef.current = true;
      return;
    }
    const panel = terminalPanelRef.current;
    if (!panel) {
      return;
    }
    if (terminalPanelOpen) {
      panel.expand(lastTerminalSizeRef.current);
    } else {
      panel.collapse();
    }
  }, [terminalPanelOpen]);

  const persistTerminalPanelSize = useCallback(() => {
    const size = lastTerminalSizeRef.current;
    if (size <= 0) {
      return;
    }
    onTerminalPanelResize(size);
  }, [onTerminalPanelResize]);

  const handleTerminalPanelResize = useCallback(
    (size: number) => {
      if (size <= 0) {
        return;
      }
      lastTerminalSizeRef.current = size;
      if (!isTerminalPanelDraggingRef.current) {
        onTerminalPanelResize(size);
      }
    },
    [onTerminalPanelResize],
  );

  const handleTerminalPanelDragging = useCallback<TerminalPanelDraggingHandler>(
    (isDragging) => {
      isTerminalPanelDraggingRef.current = isDragging;
      if (!isDragging) {
        persistTerminalPanelSize();
      }
    },
    [persistTerminalPanelSize],
  );

  const metadataContent = hasAnyThreadMetadata(metadata) ? (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ThreadMetadataContent {...metadata} />
    </div>
  ) : isMetadataLoading ? (
    <ThreadMetadataLoadingSkeleton />
  ) : (
    <div className="pt-1 text-sm text-muted-foreground">
      No thread details available.
    </div>
  );
  const inlineSecondaryPanelContent = !renderAsDrawer ? (
    <ThreadSecondaryPanel
      {...secondaryPanel}
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
      {...secondaryPanel}
      renderAsDrawer={true}
      isConversationCollapsed={false}
      onToggleConversationCollapse={onToggleConversationCollapse}
      reserveLeftForDesktopTrafficLights={false}
      metadataContent={metadataContent}
    />
  ) : null;

  return (
    <div className="-mx-4 -mb-4 -mt-4 flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:-mx-5 md:-mb-5 md:-mt-5">
      <PanelGroup
        // Thread-scoped panel state should mount at its saved size instead of
        // animating from the previously selected thread's layout.
        key={timeline.threadId}
        direction="vertical"
        className="h-full w-full min-w-0"
      >
        <Panel
          id="thread-detail-main-panel"
          defaultSize={
            terminalPanelOpen ? 100 - terminalPanelHeightPercent : 100
          }
          minSize={30}
          order={1}
          className="min-w-0 overflow-hidden"
        >
          {/*
            When collapsed we keep the resizable PanelGroup mounted (the timeline
            lifts to 0% and the panel to 100% via the layout effect) and slot the
            36px rail in beside it as a plain flex sibling. This sidesteps the
            "fixed px in a percentage engine" problem the same way a layout swap
            would, but without unmounting the PanelGroup — so the secondary
            panel's content (live app iframes, parsed diffs, scroll position) is
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
              ref={horizontalPanelGroupRef}
              direction="horizontal"
              className="h-full min-w-0 flex-1"
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
                  "min-w-0 overflow-hidden transition-[flex-grow,flex-basis]",
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
                    {...timeline}
                    footer={footer}
                    header={header}
                  />
                </div>
              </Panel>
              {inlineSecondaryPanelContent}
            </PanelGroup>
          </div>
        </Panel>
        {terminalPanel ? (
          <>
            <TerminalPanelResizeHandle
              isOpen={terminalPanelOpen}
              onDragging={handleTerminalPanelDragging}
            />
            <Panel
              ref={terminalPanelRef}
              id="thread-detail-terminal-panel"
              collapsible
              collapsedSize={0}
              defaultSize={terminalPanelOpen ? terminalPanelHeightPercent : 0}
              minSize={MIN_TERMINAL_PANEL_HEIGHT_PERCENT}
              maxSize={MAX_TERMINAL_PANEL_HEIGHT_PERCENT}
              order={2}
              onResize={handleTerminalPanelResize}
              className={cn(
                "min-h-0 min-w-0 overflow-hidden transition-[flex-grow,flex-basis,opacity]",
                PANEL_COLLAPSE_TRANSITION_CLASS,
                terminalPanelOpen ? "opacity-100" : "opacity-0",
              )}
            >
              {terminalPanel}
            </Panel>
          </>
        ) : null}
      </PanelGroup>
      {renderAsDrawer ? (
        <ResponsiveDrawerShell
          open={isSecondaryPanelOpen}
          onOpenChange={(open) => {
            if (!open) secondaryPanel.onClose();
          }}
          srLabel="Thread details"
          contentClassName="h-[92dvh] max-h-[92dvh]"
          // `handleOnly` keeps vaul from binding its pointerdown handler on
          // the drawer body. Without it, vaul calls setPointerCapture on the
          // click target, which captures the pointer on Pierre tree's host
          // element and prevents the click from reaching rows inside the
          // shadow DOM. The drag handle bar still drags the drawer.
          handleOnly
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {drawerSecondaryPanelContent}
          </div>
        </ResponsiveDrawerShell>
      ) : null}
    </div>
  );
}

interface TerminalPanelResizeHandleProps {
  isOpen: boolean;
  onDragging: TerminalPanelDraggingHandler;
}

function TerminalPanelResizeHandle({
  isOpen,
  onDragging,
}: TerminalPanelResizeHandleProps) {
  return (
    <PanelResizeHandle
      id="thread-detail-terminal-panel-handle"
      disabled={!isOpen}
      onDragging={onDragging}
      className={cn(
        "group relative shrink-0 cursor-row-resize overflow-visible bg-transparent transition-[height,opacity,background-color]",
        PANEL_COLLAPSE_TRANSITION_CLASS,
        "before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-['']",
        isOpen ? "h-px opacity-100" : "pointer-events-none h-0 opacity-0",
      )}
      aria-label="Resize thread and terminal panels"
    >
      <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border transition-colors group-hover:bg-accent-foreground/35" />
    </PanelResizeHandle>
  );
}

const METADATA_SKELETON_ROW_VALUE_WIDTHS = ["w-40", "w-28", "w-36", "w-24"];

function ThreadMetadataLoadingSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ThreadMetadataCard hasFlexibleHeight={false}>
        {METADATA_SKELETON_ROW_VALUE_WIDTHS.map((valueWidth, index) => (
          <div
            key={index}
            className="grid grid-cols-[var(--detail-label-width,96px)_minmax(0,1fr)] items-center gap-x-3 py-0.5"
          >
            <Skeleton className="h-3 w-14 rounded-sm" />
            <Skeleton className={`h-3 ${valueWidth} max-w-full rounded-sm`} />
          </div>
        ))}
      </ThreadMetadataCard>
    </div>
  );
}
