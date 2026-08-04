import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAtomValue } from "jotai";
import {
  Panel,
  PanelGroup,
  type ImperativePanelGroupHandle,
} from "react-resizable-panels";
import { Button } from "@bb/shared-ui/button";
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
  SecondaryPanelHostLayoutContext,
  type SecondaryPanelHostLayout,
} from "@/components/secondary-panel/SecondaryPanelHostLayoutContext";
import {
  PANEL_COLLAPSE_TRANSITION_CLASS,
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
  const isOpen = model !== null && (isPanelVisible ?? model.isOpen);
  const lastTargetRef = useRef<{
    paneId: string;
    contentKey: string;
    isOpen: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    if (model === null) {
      // A pane with no secondary panel (plugin pane) suppresses the panel while
      // retaining the window-level visibility preference. Focusing back to a
      // publishing pane restores that remembered state below.
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

  // The remembered window visibility is intentionally left unchanged while a
  // plugin pane is focused, so returning to a thread restores its app panel.
  const toggleWindowPanel = () => {
    model?.onToggle();
  };
  useAppCommandHandler("panel.toggle", () => {
    return model === null;
  });

  const toggleLabel =
    model === null
      ? "Right panel unavailable"
      : isOpen
        ? "Hide right panel"
        : "Show right panel";
  const hostLayout = useMemo<SecondaryPanelHostLayout>(
    () => ({ isOpen, isSuppressed: isPaneMaximized }),
    [isOpen, isPaneMaximized],
  );

  if (model === null) {
    return (
      <SecondaryPanelHostLayoutContext.Provider value={hostLayout}>
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          {children}
        </div>
      </SecondaryPanelHostLayoutContext.Provider>
    );
  }

  return (
    // The layout context serves two consumers: a freshly mounted pane panel
    // sizes its resizable Panel to the window visibility (its own persisted
    // state lags one commit behind the alignment above, and a stale-closed
    // defaultSize would collapse the group's panel and misreport a user
    // close), and the right-edge pane headers drop their reserved corner slot
    // while the open panel's chrome hosts the window toggle instead.
    <SecondaryPanelHostLayoutContext.Provider value={hostLayout}>
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div
          data-testid="split-workspace-panel-toggle"
          className={cn(
            "absolute right-2.5 top-2.5 z-40",
            (isOpen || isPaneMaximized) && "hidden",
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
          <PluginComposerHostProvider
            key={focusedPaneId}
            value={model.composerHost}
          >
            {model.panel}
          </PluginComposerHostProvider>
        </PanelGroup>
      </div>
    </SecondaryPanelHostLayoutContext.Provider>
  );
}
