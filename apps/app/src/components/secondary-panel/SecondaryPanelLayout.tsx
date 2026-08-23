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
import { usePrefersReducedMotion } from "@bb/shared-ui/hooks/use-media-query";
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
import {
  createSecondaryPanelGroupMotion,
  type SecondaryPanelGroupMotion,
} from "./secondaryPanelGroupMotion";

const FULL_PANEL_SIZE_PERCENT = 100;
const MAIN_PANEL_MIN_SIZE_PERCENT = 30;

function noopToggleMainCollapse(): void {}

export interface SecondaryPanelRenderArgs {
  presentation: "inline" | "drawer";
  canShowNativeBrowserView: boolean;
  inlinePanelToggle: "button" | "reserved";
  isMainCollapsed: boolean;
  onToggleMainCollapse: () => void;
  resizablePanelId?: string;
}

interface SecondaryPanelLayoutProps {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
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
  const shouldReduceMotion = usePrefersReducedMotion();
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
  const panelGroupMotionRef = useRef<SecondaryPanelGroupMotion | null>(null);
  if (panelGroupMotionRef.current === null) {
    panelGroupMotionRef.current = createSecondaryPanelGroupMotion();
  }
  const panelGroupMotion = panelGroupMotionRef.current;
  const persistedSecondaryWidthRef = useRef(persistedSecondaryWidthPercent);
  useEffect(() => {
    persistedSecondaryWidthRef.current = persistedSecondaryWidthPercent;
  }, [persistedSecondaryWidthPercent]);

  useLayoutEffect(() => {
    const group = horizontalPanelGroupRef.current;
    if (group === null || renderAsDrawer) {
      return;
    }
    if (group.getLayout().length !== 2) {
      return;
    }

    const secondaryWidth = !open
      ? 0
      : isMainCollapsed
        ? FULL_PANEL_SIZE_PERCENT
        : persistedSecondaryWidthRef.current;
    panelGroupMotion.setLayout(
      group,
      [FULL_PANEL_SIZE_PERCENT - secondaryWidth, secondaryWidth],
      shouldReduceMotion || !transitionsReady,
    );
  }, [
    isMainCollapsed,
    open,
    panelGroupMotion,
    renderAsDrawer,
    shouldReduceMotion,
    transitionsReady,
  ]);

  useLayoutEffect(
    () => () => {
      panelGroupMotion.stop();
    },
    [panelGroupMotion],
  );

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
    // oxlint-disable-next-line react/set-state-in-effect
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
            inlinePanelToggle:
              secondaryPanelHost === null ? "button" : "reserved",
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
      secondaryPanelHost,
    ],
  );
  const drawerPanel = useMemo(
    () =>
      renderAsDrawer
        ? renderPanel({
            presentation: "drawer",
            canShowNativeBrowserView,
            inlinePanelToggle: "button",
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
          data-split-resize-grid-root=""
          direction="horizontal"
          className="@container h-full min-w-0 flex-1"
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
            defaultSize={FULL_PANEL_SIZE_PERCENT}
            minSize={MAIN_PANEL_MIN_SIZE_PERCENT}
            order={1}
            className="min-w-0 overflow-clip"
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
