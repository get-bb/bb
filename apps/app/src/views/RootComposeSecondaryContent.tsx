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
import { useAtomValue } from "jotai";
import {
  Panel,
  PanelGroup,
  type ImperativePanelGroupHandle,
} from "react-resizable-panels";
import { ResponsiveDrawerShell } from "@/components/ui/responsive-overlay.js";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport.js";
import { ThreadSecondaryPanel } from "@/components/secondary-panel/ThreadSecondaryPanel";
import { secondaryPanelWidthPercentAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import { PANEL_COLLAPSE_TRANSITION_CLASS } from "@/components/secondary-panel/panelTransitionTokens";
import { PAGE_SHELL_CONTENT_STYLE } from "@/components/ui/page-shell-content-style.js";
import { dispatchBrowserViewBoundsSync } from "@/lib/browser-view-bounds-sync";
import {
  CHROME_ROW_HEIGHT_CLASS,
  getBbDesktopInfo,
  MACOS_WINDOW_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { cn } from "@/lib/utils";

const CLOSED_MAIN_PANEL_SIZE_PERCENT = 100;
const MAIN_PANEL_MIN_SIZE_PERCENT = 30;
const ROOT_COMPOSE_MAX_WIDTH_CLASS = "max-w-[760px]";

type RootSecondaryPanelProps = Omit<
  ComponentProps<typeof ThreadSecondaryPanel>,
  | "browserDeck"
  | "isConversationCollapsed"
  | "onToggleConversationCollapse"
  | "renderAsDrawer"
> & {
  renderBrowserDeck?: (args: {
    canShowNativeBrowserView: boolean;
  }) => ReactNode;
};

interface RootComposeSecondaryContentProps {
  children: ReactNode;
  contentClassName?: string;
  isSecondaryPanelOpen: boolean;
  secondaryPanel: RootSecondaryPanelProps;
}

function noopToggleConversationCollapse(): void {}

export function RootComposeSecondaryContent({
  children,
  contentClassName,
  isSecondaryPanelOpen,
  secondaryPanel,
}: RootComposeSecondaryContentProps) {
  const renderAsDrawer = useIsCompactViewport();
  const persistedSecondaryWidthPercent = useAtomValue(
    secondaryPanelWidthPercentAtom,
  );
  const horizontalPanelGroupRef = useRef<ImperativePanelGroupHandle | null>(
    null,
  );
  // Read inside the layout sync without making width changes re-trigger it,
  // which would fight an in-progress resize drag.
  const persistedSecondaryWidthRef = useRef(persistedSecondaryWidthPercent);
  useEffect(() => {
    persistedSecondaryWidthRef.current = persistedSecondaryWidthPercent;
  }, [persistedSecondaryWidthPercent]);
  const [isCompactDrawerContentSettled, setIsCompactDrawerContentSettled] =
    useState(false);
  const [desktopInfo] = useState(getBbDesktopInfo);
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const compactDrawerContentSettleFrameRef = useRef<number | null>(null);
  const compactDrawerContentSettleGenerationRef = useRef(0);
  const compactDrawerContentSettleStateRef = useRef({
    isSecondaryPanelOpen,
    renderAsDrawer,
  });

  useLayoutEffect(() => {
    compactDrawerContentSettleStateRef.current = {
      isSecondaryPanelOpen,
      renderAsDrawer,
    };
  }, [isSecondaryPanelOpen, renderAsDrawer]);

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
      compactDrawerContentSettleFrameRef.current = window.requestAnimationFrame(
        () => {
          compactDrawerContentSettleFrameRef.current = null;
          const latestState = compactDrawerContentSettleStateRef.current;
          if (
            compactDrawerContentSettleGenerationRef.current !==
              requestGeneration ||
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
    : isSecondaryPanelOpen;
  const { renderBrowserDeck, ...threadSecondaryPanelProps } = secondaryPanel;
  const browserDeck = useMemo(
    () => renderBrowserDeck?.({ canShowNativeBrowserView }),
    [canShowNativeBrowserView, renderBrowserDeck],
  );
  useLayoutEffect(() => {
    const group = horizontalPanelGroupRef.current;
    if (group === null || renderAsDrawer) {
      return;
    }

    if (!isSecondaryPanelOpen) {
      group.setLayout([CLOSED_MAIN_PANEL_SIZE_PERCENT, 0]);
      return;
    }

    const secondaryWidth = persistedSecondaryWidthRef.current;
    group.setLayout([
      CLOSED_MAIN_PANEL_SIZE_PERCENT - secondaryWidth,
      secondaryWidth,
    ]);
  }, [isSecondaryPanelOpen, renderAsDrawer]);
  const inlineSecondaryPanelContent = !renderAsDrawer ? (
    <ThreadSecondaryPanel
      {...threadSecondaryPanelProps}
      browserDeck={browserDeck}
      renderAsDrawer={false}
      isConversationCollapsed={false}
      onToggleConversationCollapse={noopToggleConversationCollapse}
    />
  ) : null;
  const drawerSecondaryPanelContent = renderAsDrawer ? (
    <ThreadSecondaryPanel
      {...threadSecondaryPanelProps}
      browserDeck={browserDeck}
      renderAsDrawer={true}
      isConversationCollapsed={false}
      onToggleConversationCollapse={noopToggleConversationCollapse}
    />
  ) : null;

  return (
    <div className="-mx-4 -mb-4 -mt-4 flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-clip md:-mx-5 md:-mb-5 md:-mt-5">
      {/* Size container so the secondary panel's content can be pinned to its
          open width in container-query units (cqw) — a fixed-width layer that
          translates in (rather than reflowing) while the panel's flex width
          animates as a spacer to make room. */}
      <div className="@container flex h-full w-full min-w-0">
        <PanelGroup
          ref={horizontalPanelGroupRef}
          direction="horizontal"
          className="h-full min-w-0 flex-1"
          style={{ overflow: "clip" }}
        >
          <Panel
            id="root-compose-main-panel"
            defaultSize={
              isSecondaryPanelOpen && !renderAsDrawer
                ? CLOSED_MAIN_PANEL_SIZE_PERCENT -
                  persistedSecondaryWidthPercent
                : CLOSED_MAIN_PANEL_SIZE_PERCENT
            }
            minSize={MAIN_PANEL_MIN_SIZE_PERCENT}
            order={1}
            className={cn(
              "min-w-0 overflow-clip transition-[flex-grow,flex-basis]",
              // Match the secondary panel's swipe timing so the shared boundary
              // moves uniformly as the panel opens/closes.
              PANEL_COLLAPSE_TRANSITION_CLASS,
            )}
          >
            <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
              {usesDesktopChrome ? (
                <div
                  data-testid="root-compose-main-window-drag-strip"
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-x-0 top-0 z-10 shrink-0",
                    CHROME_ROW_HEIGHT_CLASS,
                    MACOS_WINDOW_DRAG_CLASS,
                  )}
                />
              ) : null}
              <div className="@container/page min-h-0 flex-1 overflow-y-auto">
                <div
                  className={cn(
                    "mx-auto flex w-full flex-col px-4 pb-4 pt-2",
                    ROOT_COMPOSE_MAX_WIDTH_CLASS,
                    contentClassName,
                  )}
                  style={PAGE_SHELL_CONTENT_STYLE}
                >
                  {children}
                </div>
              </div>
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
          srLabel="Right panel"
          contentClassName="h-[92dvh] max-h-[92dvh]"
          onContentAnimationEnd={handleDrawerContentAnimationEnd}
          handleOnly
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
