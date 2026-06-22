import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button.js";
import { COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import { Icon } from "@/components/ui/icon.js";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport.js";
import { SplitButton } from "@/components/ui/split-button.js";
import { Pill } from "@/components/ui/pill.js";
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
import { cn } from "@/lib/utils";

const THREAD_HEADER_ACTION_BUTTON_CLASS =
  COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS;

interface ThreadHeaderGitAction {
  label: string;
  target: ThreadGitActionDialogTarget;
}

interface ThreadDetailHeaderProps {
  actionsMenu: ReactNode;
  activeTerminalCount: number;
  /** Pill shown beside the title for side chats and hierarchical child threads. */
  childPillLabel: "child" | "side chat" | null;
  isSecondaryPanelOpen: boolean;
  onOpenThreadGitAction: (target: ThreadGitActionDialogTarget) => void;
  onToggleSecondaryPanel: () => void;
  threadHeaderGitActions: ThreadHeaderGitAction[];
  threadTitle: string;
  workspaceOpenButton?: ReactNode;
}

export function ThreadDetailHeader({
  actionsMenu,
  activeTerminalCount,
  childPillLabel,
  isSecondaryPanelOpen,
  onOpenThreadGitAction,
  onToggleSecondaryPanel,
  threadHeaderGitActions,
  threadTitle,
  workspaceOpenButton,
}: ThreadDetailHeaderProps) {
  const [primaryAction, ...secondaryActions] = threadHeaderGitActions;
  const renderAsDrawer = useIsCompactViewport();
  const [desktopInfo] = useState(getBbDesktopInfo);
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const rightPanelLabel = isSecondaryPanelOpen
    ? "Hide right panel"
    : "Show right panel";
  const rightPanelIconName = renderAsDrawer ? "PanelBottom" : "PanelRight";
  const showRightPanelToggle = renderAsDrawer || !isSecondaryPanelOpen;

  const center = (
    <>
      <p className="min-w-0 truncate text-sm font-semibold">{threadTitle}</p>
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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`${HEADER_ICON_BUTTON_CLASS} relative`}
          aria-label={rightPanelLabel}
          aria-pressed={isSecondaryPanelOpen}
          title={rightPanelLabel}
          onClick={onToggleSecondaryPanel}
        >
          <Icon name={rightPanelIconName} />
          {activeTerminalCount > 0 ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground"
            >
              {activeTerminalCount > 9 ? "9+" : activeTerminalCount}
            </span>
          ) : null}
        </Button>
      ) : null}
    </>
  );

  // Use the stronger vertical-pane seam (not the quieter horizontal `border-seam`)
  // so the chat header's bottom edge matches the chat/panel side borders. Pass
  // `bordered={false}` to drop the default seam, then add the vertical one.
  return (
    <AppPageHeader
      center={center}
      actions={actions}
      bordered={false}
      className="border-b border-border-seam-vertical"
    />
  );
}
