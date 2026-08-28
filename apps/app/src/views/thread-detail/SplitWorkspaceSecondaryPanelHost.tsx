import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelGroupHandle,
} from "react-resizable-panels";
import { Button } from "@bb/shared-ui/button";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { usePrefersReducedMotion } from "@bb/shared-ui/hooks/use-media-query";
import { HEADER_ICON_BUTTON_CLASS } from "@/components/layout/AppPageHeader";
import { AppCommandShortcutHint } from "@/components/commands/AppCommandShortcutHint";
import {
  useAppCommandHandler,
  useAppCommandShortcut,
} from "@/components/commands/AppCommandProvider";
import { secondaryPanelWidthPercentAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import {
  THREAD_SECONDARY_PANEL_MAX_SIZE_PERCENT,
  THREAD_SECONDARY_PANEL_MIN_SIZE_PERCENT,
} from "@/components/secondary-panel/secondaryPanelSizing";
import {
  SecondaryPanelHostLayoutContext,
  type SecondaryPanelHostLayout,
} from "@/components/secondary-panel/SecondaryPanelHostLayoutContext";
import { useRightPanelToggleIconName } from "@/components/secondary-panel/panelToggleControlState";
import {
  getPanelCollapseTransitionStyle,
  PANEL_RESIZE_HIT_AREA_MARGINS,
  PANEL_RESIZE_HANDLE_LAYER_CLASS,
  PANEL_RESIZE_HIT_TARGET_CLASS,
} from "@/components/secondary-panel/panelTransitionTokens";
import { MACOS_APP_REGION_NO_DRAG_CLASS } from "@/lib/bb-desktop";
import { PluginComposerHostProvider } from "@/components/plugin/plugin-composer-host";
import { usePanelResizeSnap } from "@/components/secondary-panel/usePanelResizeSnap";
import {
  createSecondaryPanelGroupMotion,
  type SecondaryPanelGroupMotion,
} from "@/components/secondary-panel/secondaryPanelGroupMotion";
import {
  type PaneSecondaryPanelRegistry,
  usePaneSecondaryPanelModel,
} from "./PaneContext";

const MAIN_PANEL_OPEN_SIZE_PERCENT = 100;
const MAIN_PANEL_MIN_SIZE_PERCENT = 30;

interface SplitWorkspaceSecondaryPanelHostProps {
  children: ReactNode;
  focusedPaneId: string;
  isPaneMaximized: boolean;
  registry: PaneSecondaryPanelRegistry;
}

export function SplitWorkspaceSecondaryPanelHost({
  children,
  focusedPaneId,
  isPaneMaximized,
  registry,
}: SplitWorkspaceSecondaryPanelHostProps) {
  const model = usePaneSecondaryPanelModel(registry, focusedPaneId);
  const panelGroupRef = useRef<ImperativePanelGroupHandle | null>(null);
  const panelGroupMotionRef = useRef<SecondaryPanelGroupMotion | null>(null);
  if (panelGroupMotionRef.current === null) {
    panelGroupMotionRef.current = createSecondaryPanelGroupMotion();
  }
  const panelGroupMotion = panelGroupMotionRef.current;
  const panelWidthPercent = useAtomValue(secondaryPanelWidthPercentAtom);
  const shouldReduceMotion = usePrefersReducedMotion();
  const shortcut = useAppCommandShortcut("panel.toggle");

  const [isPanelVisible, setIsPanelVisible] = useState<boolean | null>(null);
  const isOpen = isPanelVisible ?? model?.isOpen ?? false;
  const lastTargetRef = useRef<{
    paneId: string;
    contentKey: string;
    isOpen: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    if (model === null) {
      lastTargetRef.current = null;
      return;
    }
    const previousTarget = lastTargetRef.current;
    lastTargetRef.current = {
      paneId: focusedPaneId,
      contentKey: model.contentKey,
      isOpen: model.isOpen,
    };
    if (isPanelVisible === null) {
      setIsPanelVisible(model.isOpen);
      return;
    }
    if (
      previousTarget !== null &&
      previousTarget.paneId === focusedPaneId &&
      previousTarget.contentKey === model.contentKey
    ) {
      if (model.isOpen !== previousTarget.isOpen) {
        setIsPanelVisible(model.isOpen);
      }
      return;
    }
    if (model.isOpen !== isPanelVisible) model.onToggle();
  }, [focusedPaneId, isPanelVisible, model]);

  const panelLayoutTargetRef = useRef({
    isMainCollapsed: model?.isMainCollapsed === true,
    isOpen,
    isPaneMaximized,
    panelWidthPercent,
  });
  panelLayoutTargetRef.current = {
    isMainCollapsed: model?.isMainCollapsed === true,
    isOpen,
    isPaneMaximized,
    panelWidthPercent,
  };
  const applyPanelLayout = useCallback(
    (reduceMotion: boolean) => {
      const group = panelGroupRef.current;
      if (group === null) return;
      if (group.getLayout().length !== 2) return;

      const target = panelLayoutTargetRef.current;
      const secondaryWidth =
        target.isPaneMaximized || !target.isOpen
          ? 0
          : target.isMainCollapsed
            ? MAIN_PANEL_OPEN_SIZE_PERCENT
            : target.panelWidthPercent;
      panelGroupMotion.setLayout(
        group,
        [MAIN_PANEL_OPEN_SIZE_PERCENT - secondaryWidth, secondaryWidth],
        reduceMotion,
      );
    },
    [panelGroupMotion],
  );

  useLayoutEffect(() => {
    applyPanelLayout(shouldReduceMotion || model?.transitionsReady === false);
  }, [
    applyPanelLayout,
    isOpen,
    isPaneMaximized,
    model?.isMainCollapsed,
    model?.transitionsReady,
    shouldReduceMotion,
  ]);

  useEffect(() => {
    applyPanelLayout(true);
  }, [applyPanelLayout, focusedPaneId, model?.contentKey]);

  useLayoutEffect(
    () => () => {
      panelGroupMotion.stop();
    },
    [panelGroupMotion],
  );

  const toggleWindowPanel = () => {
    if (model !== null) {
      model.onToggle();
      return;
    }
    setIsPanelVisible((current) => !(current ?? false));
  };
  useAppCommandHandler("panel.toggle", () => {
    if (model !== null) return false;
    toggleWindowPanel();
    return true;
  });

  const setPanelWidthPercent = useSetAtom(secondaryPanelWidthPercentAtom);
  const lastEmptyPanelSizeRef = useRef(0);
  const handleEmptyPanelPointerResize = useCallback(
    (leadingFraction: number) => {
      panelGroupRef.current?.setLayout([
        leadingFraction * 100,
        (1 - leadingFraction) * 100,
      ]);
    },
    [],
  );
  const {
    finish: finishEmptyPanelResizeSnap,
    onPointerDownCapture: handleEmptyPanelResizePointerDownCapture,
  } = usePanelResizeSnap({
    axis: "x",
    onResize: handleEmptyPanelPointerResize,
    target: { boundaryIndex: 1, childCount: 2 },
  });
  const handleEmptyPanelResize = (size: number) => {
    if (size > 0) lastEmptyPanelSizeRef.current = size;
  };
  const handleEmptyPanelDragging = (isDragging: boolean) => {
    if (isDragging) return;
    finishEmptyPanelResizeSnap();
    if (lastEmptyPanelSizeRef.current <= 0) return;
    setPanelWidthPercent(lastEmptyPanelSizeRef.current);
  };
  const handleEmptyPanelCollapse = () => {
    if (lastEmptyPanelSizeRef.current <= 0) return;
    setIsPanelVisible(false);
  };

  const toggleLabel = isOpen ? "Hide right panel" : "Show right panel";
  const toggleIconName = useRightPanelToggleIconName();
  const showsCornerToggle = !isPaneMaximized;
  const pinsCornerToggle = showsCornerToggle;
  const hostLayout = useMemo<SecondaryPanelHostLayout>(
    () => ({ isOpen, isSuppressed: isPaneMaximized, pinsCornerToggle }),
    [isOpen, isPaneMaximized, pinsCornerToggle],
  );

  return (
    <SecondaryPanelHostLayoutContext.Provider value={hostLayout}>
      <div
        className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
        style={getPanelCollapseTransitionStyle(model?.transitionsReady ?? true)}
      >
        <div
          data-testid="split-workspace-panel-toggle"
          className={cn(
            "absolute right-4 top-2.5 z-40",
            !showsCornerToggle && "hidden",
            MACOS_APP_REGION_NO_DRAG_CLASS,
          )}
        >
          <AppCommandShortcutHint
            shortcut={shortcut}
            className="absolute right-0 top-full mt-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={HEADER_ICON_BUTTON_CLASS}
            aria-label={
              shortcut ? `${toggleLabel} (${shortcut.label})` : toggleLabel
            }
            aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
            aria-expanded={isOpen}
            onClick={toggleWindowPanel}
          >
            <Icon name={toggleIconName} />
          </Button>
        </div>
        <PanelGroup
          ref={panelGroupRef}
          data-split-resize-grid-root=""
          direction="horizontal"
          className="@container h-full min-w-0 flex-1"
          style={{ overflow: "clip" }}
        >
          <Panel
            id="split-workspace-main-panel"
            collapsible
            collapsedSize={0}
            defaultSize={MAIN_PANEL_OPEN_SIZE_PERCENT}
            minSize={MAIN_PANEL_MIN_SIZE_PERCENT}
            order={1}
            className="min-w-0 overflow-clip"
          >
            <div className="relative flex h-full min-h-0 min-w-0">
              {children}
            </div>
          </Panel>
          {model === null ? (
            <>
              <PanelResizeHandle
                id="split-workspace-empty-secondary-panel-handle"
                data-secondary-panel-boundary=""
                disabled={!isOpen}
                onDragging={handleEmptyPanelDragging}
                onPointerDownCapture={(event) =>
                  handleEmptyPanelResizePointerDownCapture(event.nativeEvent)
                }
                data-panel-resize-snap-handle=""
                hitAreaMargins={PANEL_RESIZE_HIT_AREA_MARGINS}
                className={cn(
                  "relative shrink-0 overflow-visible bg-border-seam transition-colors hover:bg-ring/40 data-[resize-handle-state=drag]:bg-ring/40",
                  PANEL_RESIZE_HANDLE_LAYER_CLASS,
                  isOpen
                    ? "w-px cursor-col-resize opacity-100"
                    : "pointer-events-none w-0 opacity-0",
                )}
                aria-label="Resize right panel"
              >
                <span
                  aria-hidden
                  data-panel-resize-hit-target=""
                  className={PANEL_RESIZE_HIT_TARGET_CLASS}
                />
              </PanelResizeHandle>
              <Panel
                id="split-workspace-empty-secondary-panel"
                collapsible
                collapsedSize={0}
                defaultSize={0}
                minSize={THREAD_SECONDARY_PANEL_MIN_SIZE_PERCENT}
                maxSize={THREAD_SECONDARY_PANEL_MAX_SIZE_PERCENT}
                onCollapse={handleEmptyPanelCollapse}
                onResize={handleEmptyPanelResize}
                order={2}
                className="min-w-0 overflow-clip"
              >
                <div
                  data-testid="split-workspace-empty-panel-state"
                  className="flex h-full min-h-0 flex-col overflow-hidden bg-background p-4 pt-12"
                >
                  <EmptyStatePanel className="flex-1 rounded-lg">
                    This pane has no right panel.
                  </EmptyStatePanel>
                </div>
              </Panel>
            </>
          ) : (
            <PluginComposerHostProvider
              key={focusedPaneId}
              value={model.composerHost}
            >
              {model.panel}
            </PluginComposerHostProvider>
          )}
        </PanelGroup>
      </div>
    </SecondaryPanelHostLayoutContext.Provider>
  );
}
