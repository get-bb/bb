import {
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
import {
  getPanelCollapseTransitionStyle,
  PANEL_COLLAPSE_TRANSITION_CLASS,
  PANEL_RESIZE_HIT_AREA_MARGINS,
  PANEL_RESIZE_HANDLE_LAYER_CLASS,
  PANEL_RESIZE_HIT_TARGET_CLASS,
} from "@/components/secondary-panel/panelTransitionTokens";
import { MACOS_APP_REGION_NO_DRAG_CLASS } from "@/lib/bb-desktop";
import { PluginComposerHostProvider } from "@/components/plugin/plugin-composer-host";
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
  const panelWidthPercent = useAtomValue(secondaryPanelWidthPercentAtom);
  const shortcut = useAppCommandShortcut("panel.toggle");

  // The window has ONE panel visibility: refocusing another pane or switching
  // a pane's thread swaps the panel's content but never opens or closes it.
  // Null until the first pane publishes, so entering a split adopts the
  // focused content's persisted state.
  const [isPanelVisible, setIsPanelVisible] = useState<boolean | null>(null);
  const isOpen = isPanelVisible ?? model?.isOpen ?? false;
  const lastTargetRef = useRef<{
    paneId: string;
    contentKey: string;
    isOpen: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    if (model === null) {
      // A pane whose secondary-panel model is not available yet suppresses the
      // panel while retaining the window-level visibility preference.
      // Focusing a publishing pane restores that remembered state below.
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
      // Only an actual open/close transition on the same target is an
      // intentional change (toggle button, shortcut, "open diff") that moves
      // the window visibility with it. Republished models with an unchanged
      // isOpen — including the stale render that races the imposed toggle
      // below — must not.
      if (model.isOpen !== previousTarget.isOpen) {
        setIsPanelVisible(model.isOpen);
      }
      return;
    }
    // Focus moved or the pane switched threads: impose the window visibility
    // on the new target instead of following its persisted state.
    if (model.isOpen !== isPanelVisible) model.onToggle();
  }, [focusedPaneId, isPanelVisible, model]);

  // A passive effect on purpose: on a pane switch the group applies the
  // freshly mounted panel's defaultSize in react-resizable-panels' own
  // (child) passive effect, and this reassertion must run after it — a layout
  // effect would win the paint but then lose the final layout to it.
  useEffect(() => {
    const group = panelGroupRef.current;
    if (group === null) return;
    // Both panels register with the group asynchronously on mount; until they
    // have, setLayout throws and defaultSize already encodes this state.
    if (group.getLayout().length !== 2) return;
    if (isPaneMaximized) {
      group.setLayout([MAIN_PANEL_OPEN_SIZE_PERCENT, 0]);
      return;
    }
    if (!isOpen) {
      group.setLayout([MAIN_PANEL_OPEN_SIZE_PERCENT, 0]);
      return;
    }
    if (model?.isMainCollapsed) {
      group.setLayout([0, MAIN_PANEL_OPEN_SIZE_PERCENT]);
      return;
    }
    group.setLayout([
      MAIN_PANEL_OPEN_SIZE_PERCENT - panelWidthPercent,
      panelWidthPercent,
    ]);
  }, [
    focusedPaneId,
    isOpen,
    isPaneMaximized,
    model?.isMainCollapsed,
    panelWidthPercent,
  ]);

  // While no panel model is available, the toggle drives window visibility
  // directly so the empty state still opens and closes. A publishing pane
  // re-aligns through the effect above.
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

  // Resizing the empty-state panel mirrors the real panel's persistence: the
  // shared width atom updates on drag end, so the size carries to whichever
  // pane's panel shows next. Dragging it collapsed closes the window panel.
  const setPanelWidthPercent = useSetAtom(secondaryPanelWidthPercentAtom);
  const lastEmptyPanelSizeRef = useRef(0);
  const handleEmptyPanelResize = (size: number) => {
    if (size > 0) lastEmptyPanelSizeRef.current = size;
  };
  const handleEmptyPanelDragging = (isDragging: boolean) => {
    if (isDragging || lastEmptyPanelSizeRef.current <= 0) return;
    setPanelWidthPercent(lastEmptyPanelSizeRef.current);
  };
  const handleEmptyPanelCollapse = () => {
    // A panel that mounts at zero width reports that first layout as a
    // collapse. Honoring it would turn the "adopt the first publisher's state"
    // sentinel into a hard closed, and the next thread would lose its
    // persisted-open panel. Only a collapse after a real width is the user's.
    if (lastEmptyPanelSizeRef.current <= 0) return;
    setIsPanelVisible(false);
  };

  const toggleLabel = isOpen ? "Hide right panel" : "Show right panel";
  // An open pane panel carries the toggle in its own chrome, and a full-screen
  // pane hides it. The empty state has no chrome, so it keeps the button.
  const showsCornerToggle = !isPaneMaximized && !(isOpen && model !== null);
  // The button only lands on a pane header while the panel is closed. Once any
  // panel opens, it sits over that panel, so no pane header reserves for it.
  const pinsCornerToggle = showsCornerToggle && !isOpen;
  const hostLayout = useMemo<SecondaryPanelHostLayout>(
    () => ({ isOpen, isSuppressed: isPaneMaximized, pinsCornerToggle }),
    [isOpen, isPaneMaximized, pinsCornerToggle],
  );

  return (
    // The layout context serves two consumers: a freshly mounted pane panel
    // sizes its resizable Panel to the window visibility (its own persisted
    // state lags one commit behind the alignment above, and a stale-closed
    // defaultSize would collapse the group's panel and misreport a user
    // close), and the right-edge pane headers drop their reserved corner slot
    // while the open panel's chrome hosts the window toggle instead.
    <SecondaryPanelHostLayoutContext.Provider value={hostLayout}>
      <div
        className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
        style={getPanelCollapseTransitionStyle(model?.transitionsReady ?? true)}
      >
        <div
          data-testid="split-workspace-panel-toggle"
          className={cn(
            // right-4 puts the button on the pane header's own action axis
            // (its px-4 edge padding), so the gap to Close pane matches the
            // gaps inside that row instead of reading 6px wider.
            "absolute right-4 top-2.5 z-40",
            !showsCornerToggle && "hidden",
            // This overlay already owns positioning and stacking. Use only
            // the raw app-region token: MACOS_WINDOW_NO_DRAG_CLASS adds
            // `relative z-50`, which tailwind-merge would resolve against
            // `absolute` and move the control back into document flow.
            MACOS_APP_REGION_NO_DRAG_CLASS,
          )}
        >
          <AppCommandShortcutHint
            shortcut={shortcut}
            // Keep the modifier-held hint out of the top chrome row. The
            // reserved header slot is exactly the 28px button footprint; a
            // side-by-side hint would extend left over Close pane or plugin
            // actions. Dropping it below preserves both the stable corner
            // and the action row's hit targets.
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
            <Icon name="PanelRight" />
          </Button>
        </div>
        <PanelGroup
          ref={panelGroupRef}
          direction="horizontal"
          className="@container h-full min-w-0 flex-1"
          style={{ overflow: "clip" }}
        >
          <Panel
            id="split-workspace-main-panel"
            collapsible
            collapsedSize={0}
            defaultSize={
              isPaneMaximized
                ? MAIN_PANEL_OPEN_SIZE_PERCENT
                : model?.isMainCollapsed
                  ? 0
                  : isOpen
                    ? MAIN_PANEL_OPEN_SIZE_PERCENT - panelWidthPercent
                    : MAIN_PANEL_OPEN_SIZE_PERCENT
            }
            minSize={MAIN_PANEL_MIN_SIZE_PERCENT}
            order={1}
            className={cn(
              "min-w-0 overflow-clip transition-[flex-grow,flex-basis]",
              PANEL_COLLAPSE_TRANSITION_CLASS,
            )}
          >
            {/* Panel renders a plain block; the split tree sizes itself with
              flex-1, so restore a full-height flex context for it. */}
            <div className="relative flex h-full min-h-0 min-w-0">
              {children}
            </div>
          </Panel>
          {model === null ? (
            <>
              {/* Working twin of the panel's gutter-style resize handle: the
                  seam keeps the split dividers' body, and the window panel
                  stays resizable even while it shows the empty state. */}
              <PanelResizeHandle
                id="split-workspace-empty-secondary-panel-handle"
                disabled={!isOpen}
                onDragging={handleEmptyPanelDragging}
                hitAreaMargins={PANEL_RESIZE_HIT_AREA_MARGINS}
                className={cn(
                  "relative shrink-0 overflow-visible bg-border-seam transition-[width,opacity,background-color] hover:bg-ring/40 data-[resize-handle-state=drag]:bg-ring/40",
                  PANEL_RESIZE_HANDLE_LAYER_CLASS,
                  PANEL_COLLAPSE_TRANSITION_CLASS,
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
                defaultSize={isOpen ? panelWidthPercent : 0}
                minSize={THREAD_SECONDARY_PANEL_MIN_SIZE_PERCENT}
                maxSize={THREAD_SECONDARY_PANEL_MAX_SIZE_PERCENT}
                onCollapse={handleEmptyPanelCollapse}
                onResize={handleEmptyPanelResize}
                order={2}
                className={cn(
                  "min-w-0 overflow-clip transition-[flex-grow,flex-basis]",
                  PANEL_COLLAPSE_TRANSITION_CLASS,
                )}
              >
                <div
                  data-testid="split-workspace-empty-panel-state"
                  // pt-12 keeps the placeholder clear of the floating window
                  // toggle, which occupies the panel's top chrome corner.
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
