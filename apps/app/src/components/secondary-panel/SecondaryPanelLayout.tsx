import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Key,
  type ReactNode,
} from "react";
import { useAtomValue } from "jotai";
import {
  Panel,
  PanelGroup,
  type ImperativePanelGroupHandle,
} from "react-resizable-panels";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  PersistentResponsiveDrawerShell,
  useResponsiveDrawerRealization,
} from "@bb/shared-ui/responsive-overlay";
import { cn } from "@bb/shared-ui/lib/utils";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import { dispatchBrowserViewBoundsSync } from "@/lib/browser-view-bounds-sync";
import {
  useOptionalPaneContext,
  usePaneSecondaryPanelRegistration,
  type PaneSecondaryPanelViewModel,
} from "@/views/thread-detail/PaneContext";
import {
  getPanelCollapseTransitionStyle,
  PANEL_COLLAPSE_TRANSITION_CLASS,
  usePanelCollapseTransitionsReady,
} from "./panelTransitionTokens";
import { secondaryPanelWidthPercentAtom } from "./threadSecondaryPanelAtoms";

const FULL_PANEL_SIZE_PERCENT = 100;
const MAIN_PANEL_MIN_SIZE_PERCENT = 30;

function noopToggleMainCollapse(): void {}

export interface SecondaryPanelRenderArgs {
  presentation: "inline" | "drawer";
  canShowNativeBrowserView: boolean;
  isMainCollapsed: boolean;
  onToggleMainCollapse: () => void;
  resizablePanelId?: string;
}

interface SecondaryPanelLayoutProps {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  /**
   * Identity of the physical resizable host. Defaults to `resetKey` for
   * surfaces whose content identity and host identity are the same.
   *
   * A routed surface can keep this stable while `resetKey` changes so the
   * mounted main subtree survives navigation, while drawer realization and
   * transition readiness still reset for the new content.
   */
  panelGroupKey?: Key;
  resetKey: Key;
  contentKey: string;
  drawerLabel: string;
  drawerFallback: ReactNode;
  mainPanelId: string;
  mainHeader?: ReactNode;
  main: ReactNode;
  collapse?: {
    active: boolean;
    onToggle: () => void;
  };
  renderPanel: (args: SecondaryPanelRenderArgs) => ReactNode;
  renderHostedPanel?: (panel: ReactNode) => ReactNode;
  composerHost: PluginComposerHost | null;
}

/**
 * The common layout for a page with a right-hand secondary panel.
 *
 * Page components provide their main content and the panel itself. This
 * component owns the responsive split/drawer behavior that must stay identical
 * between new-thread and thread-detail pages.
 */
export function SecondaryPanelLayout({
  open,
  onToggle,
  onClose,
  panelGroupKey,
  resetKey,
  contentKey,
  drawerLabel,
  drawerFallback,
  mainPanelId,
  mainHeader,
  main,
  collapse,
  renderPanel,
  renderHostedPanel,
  composerHost,
}: SecondaryPanelLayoutProps) {
  const paneContext = useOptionalPaneContext();
  const secondaryPanelHost = paneContext?.secondaryPanelHost ?? null;
  const renderAsDrawer = useIsCompactViewport();
  const transitionsReady = usePanelCollapseTransitionsReady(
    resetKey,
    !renderAsDrawer,
  );
  const persistedSecondaryWidthPercent = useAtomValue(
    secondaryPanelWidthPercentAtom,
  );
  const isMainCollapsed = open && !renderAsDrawer && collapse?.active === true;

  const horizontalPanelGroupRef = useRef<ImperativePanelGroupHandle | null>(
    null,
  );
  // Width changes should not interrupt an active resize drag. The saved width
  // is only read when another event changes the layout.
  const persistedSecondaryWidthRef = useRef(persistedSecondaryWidthPercent);
  useEffect(() => {
    persistedSecondaryWidthRef.current = persistedSecondaryWidthPercent;
  }, [persistedSecondaryWidthPercent]);

  useLayoutEffect(() => {
    const group = horizontalPanelGroupRef.current;
    if (group === null || renderAsDrawer) {
      return;
    }
    // A page may not render its secondary panel until it has content. The
    // panel group validates layouts against its currently registered panels,
    // so a two-entry layout would throw while only the main panel exists.
    if (group.getLayout().length !== 2) {
      return;
    }

    if (!open) {
      group.setLayout([FULL_PANEL_SIZE_PERCENT, 0]);
      return;
    }
    if (isMainCollapsed) {
      group.setLayout([0, FULL_PANEL_SIZE_PERCENT]);
      return;
    }

    const secondaryWidth = persistedSecondaryWidthRef.current;
    group.setLayout([FULL_PANEL_SIZE_PERCENT - secondaryWidth, secondaryWidth]);
  }, [isMainCollapsed, open, renderAsDrawer]);

  const [isCompactDrawerContentSettled, setIsCompactDrawerContentSettled] =
    useState(false);
  const { isContentRealized: isPanelRealized, realizeContent: realizePanel } =
    useResponsiveDrawerRealization({
      open,
      enabled: renderAsDrawer,
    });
  const compactDrawerContentSettleFrameRef = useRef<number | null>(null);
  const compactDrawerContentSettleGenerationRef = useRef(0);
  const compactDrawerContentSettleStateRef = useRef({
    open,
    renderAsDrawer,
    resetKey,
  });

  useLayoutEffect(() => {
    compactDrawerContentSettleStateRef.current = {
      open,
      renderAsDrawer,
      resetKey,
    };
  }, [open, renderAsDrawer, resetKey]);

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
    // Native browser visibility is external to React and must be revoked
    // before paint when the drawer identity changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsCompactDrawerContentSettled(false);
  }, [cancelCompactDrawerContentSettleFrame, open, renderAsDrawer, resetKey]);

  useLayoutEffect(
    () => () => {
      cancelCompactDrawerContentSettleFrame();
    },
    [cancelCompactDrawerContentSettleFrame],
  );

  const handleDrawerContentAnimationEnd = useCallback(
    (animationEndedOpen: boolean) => {
      if (!animationEndedOpen) {
        return;
      }
      const currentState = compactDrawerContentSettleStateRef.current;
      if (!currentState.open || !currentState.renderAsDrawer) {
        return;
      }

      cancelCompactDrawerContentSettleFrame();
      const requestGeneration = compactDrawerContentSettleGenerationRef.current;
      const requestResetKey = currentState.resetKey;
      compactDrawerContentSettleFrameRef.current = window.requestAnimationFrame(
        () => {
          compactDrawerContentSettleFrameRef.current = null;
          const latestState = compactDrawerContentSettleStateRef.current;
          if (
            compactDrawerContentSettleGenerationRef.current !==
              requestGeneration ||
            latestState.resetKey !== requestResetKey ||
            !latestState.open ||
            !latestState.renderAsDrawer
          ) {
            return;
          }

          dispatchBrowserViewBoundsSync();

          const stateAfterSync = compactDrawerContentSettleStateRef.current;
          if (
            compactDrawerContentSettleGenerationRef.current ===
              requestGeneration &&
            stateAfterSync.resetKey === requestResetKey &&
            stateAfterSync.open &&
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
    ? open && isCompactDrawerContentSettled
    : open && (secondaryPanelHost === null || paneContext?.isFocused === true);
  const resizablePanelId =
    secondaryPanelHost === null || paneContext === null
      ? undefined
      : `thread-detail-secondary-panel-${paneContext.paneId}`;

  const inlinePanel = useMemo(
    () =>
      renderAsDrawer
        ? null
        : renderPanel({
            presentation: "inline",
            canShowNativeBrowserView,
            isMainCollapsed,
            onToggleMainCollapse: collapse?.onToggle ?? noopToggleMainCollapse,
            resizablePanelId,
          }),
    [
      canShowNativeBrowserView,
      collapse?.onToggle,
      isMainCollapsed,
      renderAsDrawer,
      renderPanel,
      resizablePanelId,
    ],
  );
  const drawerPanel = useMemo(
    () =>
      renderAsDrawer
        ? renderPanel({
            presentation: "drawer",
            canShowNativeBrowserView,
            isMainCollapsed: false,
            onToggleMainCollapse: collapse?.onToggle ?? noopToggleMainCollapse,
          })
        : null,
    [canShowNativeBrowserView, collapse?.onToggle, renderAsDrawer, renderPanel],
  );
  const hostedPanelModel = useMemo<PaneSecondaryPanelViewModel>(
    () => ({
      composerHost,
      contentKey,
      isMainCollapsed,
      isOpen: open,
      panel: renderHostedPanel?.(inlinePanel) ?? inlinePanel,
      onToggle,
      transitionsReady,
    }),
    [
      composerHost,
      contentKey,
      inlinePanel,
      isMainCollapsed,
      onToggle,
      open,
      renderHostedPanel,
      transitionsReady,
    ],
  );
  usePaneSecondaryPanelRegistration(secondaryPanelHost, hostedPanelModel);

  const mainContent = (
    <div
      data-conversation-collapsed={isMainCollapsed}
      inert={isMainCollapsed}
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col transition-opacity",
        secondaryPanelHost === null && "h-full",
        PANEL_COLLAPSE_TRANSITION_CLASS,
        isMainCollapsed && "opacity-0",
      )}
    >
      {secondaryPanelHost === null ? mainHeader : null}
      {main}
    </div>
  );

  if (secondaryPanelHost !== null) {
    return (
      <>
        {mainHeader}
        {mainContent}
      </>
    );
  }

  return (
    <>
      <div className="flex min-h-0 w-full min-w-0 flex-1">
        <PanelGroup
          key={panelGroupKey ?? resetKey}
          ref={horizontalPanelGroupRef}
          direction="horizontal"
          className="@container h-full min-w-0 flex-1"
          // A clipped group cannot be programmatically scrolled by an iframe's
          // scrollIntoView call, which would otherwise move the entire page.
          style={{
            overflow: "clip",
            ...getPanelCollapseTransitionStyle(transitionsReady),
          }}
        >
          <Panel
            id={mainPanelId}
            {...(collapse === undefined
              ? {}
              : { collapsible: true, collapsedSize: 0 })}
            defaultSize={
              isMainCollapsed
                ? 0
                : open && !renderAsDrawer
                  ? FULL_PANEL_SIZE_PERCENT - persistedSecondaryWidthPercent
                  : FULL_PANEL_SIZE_PERCENT
            }
            minSize={MAIN_PANEL_MIN_SIZE_PERCENT}
            order={1}
            className={cn(
              "min-w-0 overflow-clip transition-[flex-grow,flex-basis]",
              PANEL_COLLAPSE_TRANSITION_CLASS,
            )}
          >
            {mainContent}
          </Panel>
          {inlinePanel}
        </PanelGroup>
      </div>
      {renderAsDrawer ? (
        <PersistentResponsiveDrawerShell
          open={open}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              onClose();
            }
          }}
          srLabel={drawerLabel}
          contentClassName="h-[92dvh] max-h-[92dvh]"
          onContentAnimationEnd={handleDrawerContentAnimationEnd}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {isPanelRealized ? drawerPanel : drawerFallback}
          </div>
        </PersistentResponsiveDrawerShell>
      ) : null}
    </>
  );
}
