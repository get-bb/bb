import {
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { SplitButton } from "@/components/ui/split-button.js";
import { Pill } from "@bb/shared-ui/pill";
import {
  AppPageHeader,
  HEADER_ICON_BUTTON_CLASS,
} from "@/components/layout/AppPageHeader";
import type { ThreadGitActionDialogTarget } from "@/components/dialogs/ThreadGitActionDialog";
import {
  getBbDesktopInfo,
  MACOS_WINDOW_NO_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { cn } from "@bb/shared-ui/lib/utils";
import { useAppCommandShortcut } from "@/components/commands/AppCommandProvider";
import { AppCommandShortcutHint } from "@/components/commands/AppCommandShortcutHint";
import { usePaneContext } from "./PaneContext";

const THREAD_HEADER_ACTION_BUTTON_CLASS =
  COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS;

interface ThreadHeaderGitAction {
  label: string;
  target: ThreadGitActionDialogTarget;
}

interface ThreadDetailHeaderProps {
  actionsMenu: ReactNode;
  /** Pill shown beside the title for side chats and hierarchical child threads. */
  childPillLabel: "child" | "side chat" | null;
  isSecondaryPanelOpen: boolean;
  /** Closes this pane; only provided when the layout is split (>1 pane). */
  onClosePane?: () => void;
  onOpenThreadGitAction: (target: ThreadGitActionDialogTarget) => void;
  onToggleSecondaryPanel: () => void;
  /** Plugin-contributed thread action buttons (design §4.9); optional. */
  pluginActions?: ReactNode;
  threadHeaderGitActions: ThreadHeaderGitAction[];
  threadTitle: string;
  workspaceOpenButton?: ReactNode;
}

export function ThreadDetailHeader({
  actionsMenu,
  childPillLabel,
  isSecondaryPanelOpen,
  onClosePane,
  onOpenThreadGitAction,
  onToggleSecondaryPanel,
  pluginActions,
  threadHeaderGitActions,
  threadTitle,
  workspaceOpenButton,
}: ThreadDetailHeaderProps) {
  const [primaryAction, ...secondaryActions] = threadHeaderGitActions;
  const renderAsDrawer = useIsCompactViewport();
  const [desktopInfo] = useState(getBbDesktopInfo);
  const panelShortcut = useAppCommandShortcut("panel.toggle");
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  // The title doubles as the pane-reorder drag handle when the layout is split;
  // beginPaneDrag is undefined on the single-pane, page, and popout surfaces.
  const { beginPaneDrag, isBoundedPane } = usePaneContext();
  const handleTitlePointerDown = (event: ReactPointerEvent) => {
    if (!beginPaneDrag || event.button !== 0) {
      return;
    }
    beginPaneDrag(event, threadTitle);
  };
  const rightPanelLabel = isSecondaryPanelOpen
    ? "Hide right panel"
    : "Show right panel";
  const rightPanelIconName = renderAsDrawer ? "PanelBottom" : "PanelRight";
  // The header is a full-width bar, so the toggle holds a stable position at the
  // window edge — keep it mounted across open/close on wide layouts (the panel no
  // longer renders its own inline hide control). The drawer still hides it while
  // open, since the drawer carries its own close affordance.
  const showRightPanelToggle = !renderAsDrawer || !isSecondaryPanelOpen;

  const center = (
    <>
      <p
        className={cn(
          "min-w-0 truncate text-sm font-medium",
          beginPaneDrag &&
            cn(
              "cursor-grab touch-none select-none",
              // Opt the drag handle out of the macOS title-bar drag region so a
              // pane-reorder gesture isn't swallowed as a window drag.
              usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
            ),
        )}
        onPointerDown={beginPaneDrag ? handleTitlePointerDown : undefined}
      >
        {threadTitle}
      </p>
      {childPillLabel ? (
        <Pill variant="outline" size="sm">
          {childPillLabel}
        </Pill>
      ) : null}
      {/*
        The header's center slot sits inside the macOS title-bar drag region
        (AppPageHeader only exempts the actions slot), so the interactive
        actions menu must opt out of dragging or its clicks are swallowed as
        window drags. Gated on desktop chrome like every other no-drag site —
        the class also carries `relative z-50`, which must not leak into the
        web build.
      */}
      {actionsMenu == null ? null : (
        <span
          data-testid="thread-detail-header-actions-menu"
          className={cn(
            "flex items-center",
            usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
          )}
        >
          {actionsMenu}
        </span>
      )}
    </>
  );

  const actions = (
    <>
      {pluginActions}
      {workspaceOpenButton}
      {primaryAction && secondaryActions.length > 0 ? (
        <SplitButton
          primaryAction={{
            label: primaryAction.label,
            onSelect: () => onOpenThreadGitAction(primaryAction.target),
          }}
          secondaryActions={secondaryActions.map((action) => ({
            label: action.label,
            onSelect: () => onOpenThreadGitAction(action.target),
          }))}
        />
      ) : primaryAction ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={THREAD_HEADER_ACTION_BUTTON_CLASS}
          onClick={() => onOpenThreadGitAction(primaryAction.target)}
        >
          {primaryAction.label}
        </Button>
      ) : null}
      {showRightPanelToggle ? (
        <span className="inline-flex items-center gap-1.5">
          <AppCommandShortcutHint shortcut={panelShortcut} />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={HEADER_ICON_BUTTON_CLASS}
            aria-label={
              panelShortcut
                ? `${rightPanelLabel} (${panelShortcut.label})`
                : rightPanelLabel
            }
            aria-keyshortcuts={panelShortcut?.ariaKeyshortcuts}
            aria-pressed={isSecondaryPanelOpen}
            onClick={onToggleSecondaryPanel}
          >
            <Icon name={rightPanelIconName} />
          </Button>
        </span>
      ) : null}
      {onClosePane ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={HEADER_ICON_BUTTON_CLASS}
          aria-label="Close pane"
          onClick={onClosePane}
        >
          <Icon name="X" />
        </Button>
      ) : null}
    </>
  );

  // Keep the thread header seam in the vertical-pane family, but soften it so
  // the top nav does not compete with the title and controls.
  return (
    <AppPageHeader
      center={center}
      actions={actions}
      bordered={false}
      disableSidebarTriggerReserve={isBoundedPane}
      className="border-b border-border-seam-vertical/60"
    />
  );
}
