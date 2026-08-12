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
import { PersistentResponsiveDrawerShell } from "@bb/shared-ui/responsive-overlay";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { ThreadSecondaryPanel } from "@/components/secondary-panel/ThreadSecondaryPanel";
import { useDrawerPanelRealization } from "@/components/secondary-panel/useDrawerPanelRealization";
import { secondaryPanelWidthPercentAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { PANEL_COLLAPSE_TRANSITION_CLASS } from "@/components/secondary-panel/panelTransitionTokens";
import { PAGE_SHELL_CONTENT_STYLE } from "@/components/ui/page-shell-content-style.js";
import { dispatchBrowserViewBoundsSync } from "@/lib/browser-view-bounds-sync";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import {
  CHROME_ROW_HEIGHT_CLASS,
  getBbDesktopInfo,
  MACOS_APP_REGION_NO_DRAG_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { PluginHomepageSections } from "@/components/plugin/PluginHomepageSections";
import { usePluginComposerHost } from "@/components/plugin/plugin-composer-host";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  useOptionalPaneContext,
  usePaneSecondaryPanelRegistration,
  type PaneSecondaryPanelViewModel,
} from "./thread-detail/PaneContext";

const CLOSED_MAIN_PANEL_SIZE_PERCENT = 100;
const MAIN_PANEL_MIN_SIZE_PERCENT = 30;
const ROOT_COMPOSE_MAX_WIDTH_CLASS = "max-w-[760px]";

// Where root compose pins its right-panel toggle in the viewport corner (see
// rootPanelToggle in RootComposeView, which passes its selected position here).
// The window
// drag strip below must carve this same footprint back out of the macOS drag
// region while the panel is closed: Electron resolves app-regions in DOM order
// (later wins), and the strip renders after the fixed toggle, so a no-drag on
// the toggle itself would just be re-added by the strip's own drag rect. The
// carve has to live inside the strip, and this constant keeps the two footprints
// from drifting apart.
// The toggle is `fixed`, so it positions against the viewport, whose origin
// is under the translucent status bar in an iOS standalone PWA. Without the
// safe-area insets it lands on the status bar and collides with the battery.
// The insets are 0 everywhere else, so desktop and Safari keep the same
// offsets.
//
// The top offset centers the toggle on the same axis as the pinned sidebar
// trigger, which CHROME_ROW_CLASS box-centers in a 48px row (center = 24px).
// The button box is 28px normally and 36px under a coarse pointer, so the
// offset has to change with it: 24 - 28/2 = 10px, and 24 - 36/2 = 6px. A single
// offset lines up in one pointer mode and sits 4px low in the other.
export const ROOT_COMPOSE_PINNED_PANEL_TOGGLE_POSITION_CLASS =
  "right-[calc(1rem+env(safe-area-inset-right))] top-[calc(0.625rem+env(safe-area-inset-top))] max-md:pointer-coarse:top-[calc(0.375rem+env(safe-area-inset-top))]";

type RootSecondaryPanelProps = Omit<
  ComponentProps<typeof ThreadSecondaryPanel>,
  | "browserDeck"
  | "isConversationCollapsed"
  | "onToggleConversationCollapse"
  | "renderAsDrawer"
  | "showNewTabButton"
> & {
  renderBrowserDeck?: (args: {
    canShowNativeBrowserView: boolean;
  }) => ReactNode;
};

interface RootComposeSecondaryContentProps {
  children: ReactNode;
  contentClassName?: string;
  isSecondaryPanelOpen: boolean;
  onToggleSecondaryPanel: () => void;
  panelTogglePositionClassName: string;
  secondaryPanel: RootSecondaryPanelProps;
}

function noopToggleConversationCollapse(): void {}

function DrawerPanelLoadingSkeleton() {
  return (
    <div
      data-testid="drawer-panel-loading-skeleton"
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4"
    >
      <Skeleton className="h-8 w-40 rounded-md" />
      <Skeleton className="h-24 w-full rounded-md" />
      <Skeleton className="h-24 w-full rounded-md" />
    </div>
  );
}

export function RootComposeSecondaryContent({
  children,
  contentClassName,
  isSecondaryPanelOpen,
  onToggleSecondaryPanel,
  panelTogglePositionClassName,
  secondaryPanel,
}: RootComposeSecondaryContentProps) {
  const paneContext = useOptionalPaneContext();
  const secondaryPanelHost = paneContext?.secondaryPanelHost ?? null;
  const composerHost = usePluginComposerHost();
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
  const { isPanelRealized, realizePanel } = useDrawerPanelRealization({
    isDrawerOpen: isSecondaryPanelOpen,
    rendersAsDrawer: renderAsDrawer,
  });
  const [desktopInfo] = useState(getBbDesktopInfo);
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  // A bounded pane below a horizontal split is not part of the native window
  // chrome. Marking the top of every RootComposeView as draggable creates an
  // invisible Electron hit-test strip inside the lower pane: portaled menus
  // paint over it, but native pointer input is still consumed as window drag.
  // Standalone/single-pane compose surfaces and every pane touching the
  // workspace's top edge keep the intended title-bar drag affordance.
  const rendersWindowDragStrip =
    usesDesktopChrome && paneContext?.isTopRow !== false;
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
            realizePanel();
          }
        },
      );
    },
    [cancelCompactDrawerContentSettleFrame, realizePanel],
  );

  const canShowNativeBrowserView = renderAsDrawer
    ? isSecondaryPanelOpen && isCompactDrawerContentSettled
    : isSecondaryPanelOpen &&
      (secondaryPanelHost === null || paneContext?.isFocused === true);
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
  const inlineSecondaryPanelContent = useMemo(
    () =>
      !renderAsDrawer ? (
        <ThreadSecondaryPanel
          {...threadSecondaryPanelProps}
          browserDeck={browserDeck}
          renderAsDrawer={false}
          isConversationCollapsed={false}
          onToggleConversationCollapse={noopToggleConversationCollapse}
          showNewTabButton
          // In the split-workspace host, panes' panels share one PanelGroup,
          // so each pane's Panel needs its own layout identity (see the prop
          // doc).
          resizablePanelId={
            secondaryPanelHost === null || paneContext === null
              ? undefined
              : `thread-detail-secondary-panel-${paneContext.paneId}`
          }
        />
      ) : null,
    [
      browserDeck,
      paneContext,
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
      onToggleConversationCollapse={noopToggleConversationCollapse}
      showNewTabButton
    />
  ) : null;
  const hostedPanelModel = useMemo<PaneSecondaryPanelViewModel>(
    () => ({
      composerHost,
      contentKey: "new-thread",
      isMainCollapsed: false,
      isOpen: isSecondaryPanelOpen,
      panel: inlineSecondaryPanelContent,
      onToggle: onToggleSecondaryPanel,
    }),
    [
      composerHost,
      inlineSecondaryPanelContent,
      isSecondaryPanelOpen,
      onToggleSecondaryPanel,
    ],
  );
  usePaneSecondaryPanelRegistration(secondaryPanelHost, hostedPanelModel);

  const mainContent = (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {rendersWindowDragStrip ? (
        <div
          data-testid="root-compose-main-window-drag-strip"
          aria-hidden="true"
          className={cn(
            "absolute inset-x-0 top-0 z-10 shrink-0",
            CHROME_ROW_HEIGHT_CLASS,
            MACOS_WINDOW_DRAG_CLASS,
          )}
        >
          {!isSecondaryPanelOpen && secondaryPanelHost === null ? (
            <div
              data-testid="root-compose-drag-strip-toggle-cutout"
              className={cn(
                "absolute",
                panelTogglePositionClassName,
                COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
                MACOS_APP_REGION_NO_DRAG_CLASS,
              )}
            />
          ) : null}
        </div>
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
          <PluginHomepageSections />
        </div>
      </div>
    </div>
  );

  if (secondaryPanelHost !== null) {
    return (
      <div className="-mx-4 -mb-4 -mt-4 flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-clip md:-mx-5 md:-mb-5 md:-mt-5">
        {mainContent}
      </div>
    );
  }

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
            {mainContent}
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
          srLabel="Right panel"
          contentClassName="h-[92dvh] max-h-[92dvh]"
          onContentAnimationEnd={handleDrawerContentAnimationEnd}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Paint the light shell first. The real panel mounts two frames
                later, while the compositor moves the drawer. */}
            {isPanelRealized ? (
              drawerSecondaryPanelContent
            ) : (
              <DrawerPanelLoadingSkeleton />
            )}
          </div>
        </PersistentResponsiveDrawerShell>
      ) : null}
    </div>
  );
}
