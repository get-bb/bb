import type { ReactNode } from "react";
import { Button } from "@/components/ui/button.js";
import { COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import { Icon } from "@/components/ui/icon.js";
import { SplitButton } from "@/components/ui/split-button.js";
import { Pill } from "@/components/ui/pill.js";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport.js";
import {
  AppPageHeader,
  HEADER_ICON_BUTTON_CLASS,
} from "@/components/layout/AppPageHeader";
import { resolvePanelToggleControl } from "@/components/secondary-panel/panelToggleControlState";
import type { ThreadGitActionDialogTarget } from "@/components/dialogs/ThreadGitActionDialog";

const THREAD_HEADER_ACTION_BUTTON_CLASS =
  COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS;

interface ThreadHeaderGitAction {
  label: string;
  target: ThreadGitActionDialogTarget;
}

interface ThreadDetailHeaderProps {
  actionsMenu: ReactNode;
  activeTerminalCount: number;
  isConversationCollapsed: boolean;
  isManagedThread: boolean;
  isManagerThread: boolean;
  isSecondaryPanelOpen: boolean;
  isTerminalPanelOpen: boolean;
  isThreadGitActionPending: boolean;
  onOpenThreadGitAction: (target: ThreadGitActionDialogTarget) => void;
  onToggleConversationCollapse: () => void;
  onToggleSecondaryPanel: () => void;
  onToggleTerminalPanel: () => void;
  showTerminalPanelToggle: boolean;
  threadHeaderGitActions: ThreadHeaderGitAction[];
  threadTitle: string;
  workspaceOpenButton?: ReactNode;
}

export function ThreadDetailHeader({
  actionsMenu,
  activeTerminalCount,
  isConversationCollapsed,
  isManagedThread,
  isManagerThread,
  isSecondaryPanelOpen,
  isTerminalPanelOpen,
  isThreadGitActionPending,
  onOpenThreadGitAction,
  onToggleConversationCollapse,
  onToggleSecondaryPanel,
  onToggleTerminalPanel,
  showTerminalPanelToggle,
  threadHeaderGitActions,
  threadTitle,
  workspaceOpenButton,
}: ThreadDetailHeaderProps) {
  const [primaryAction, ...secondaryActions] = threadHeaderGitActions;
  const renderAsDrawer = useIsCompactViewport();

  // The header chevron unifies what used to be a separate "Show panel" header
  // button and a centered seam arrow into one directional affordance whose
  // copy/handler flips with state — see resolvePanelToggleControl. Only
  // rendered on a wide viewport; the drawer layout uses a simple open/close
  // toggle below.
  const panelToggle = resolvePanelToggleControl({
    isSecondaryPanelOpen,
    isConversationCollapsed,
    onToggleSecondaryPanel,
    onToggleConversationCollapse,
  });

  const center = (
    <>
      <p className="truncate text-sm font-semibold">{threadTitle}</p>
      {isManagerThread ? <Pill variant="outline">manager</Pill> : null}
      {!isManagerThread && isManagedThread ? (
        <Pill variant="outline">managed</Pill>
      ) : null}
    </>
  );

  const actions = (
    <>
      {workspaceOpenButton}
      {primaryAction && secondaryActions.length > 0 ? (
        <SplitButton
          disabled={isThreadGitActionPending}
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
          disabled={isThreadGitActionPending}
          className={THREAD_HEADER_ACTION_BUTTON_CLASS}
          onClick={() => onOpenThreadGitAction(primaryAction.target)}
        >
          {primaryAction.label}
        </Button>
      ) : null}
      {showTerminalPanelToggle ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`${HEADER_ICON_BUTTON_CLASS} relative`}
          aria-label={
            isTerminalPanelOpen ? "Hide terminal panel" : "Show terminal panel"
          }
          aria-pressed={isTerminalPanelOpen}
          title={
            isTerminalPanelOpen ? "Hide terminal panel" : "Show terminal panel"
          }
          onClick={onToggleTerminalPanel}
        >
          <Icon name="Terminal" />
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
      {!renderAsDrawer ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={HEADER_ICON_BUTTON_CLASS}
          aria-label={panelToggle.label}
          aria-expanded={panelToggle.isExpanded}
          title={panelToggle.label}
          onClick={panelToggle.onClick}
        >
          <Icon
            name={panelToggle.pointsRight ? "ChevronRight" : "ChevronLeft"}
          />
        </Button>
      ) : null}
      {actionsMenu}
      {/*
        On a compact/drawer viewport the secondary panel opens as a drawer with
        no seam, so the header keeps a simple open/close toggle here. On a wide
        viewport the chevron above handles open/expand and the rail handles
        restore-when-collapsed.
      */}
      {renderAsDrawer ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={HEADER_ICON_BUTTON_CLASS}
          aria-label={
            isSecondaryPanelOpen
              ? "Hide secondary panel"
              : "Show secondary panel"
          }
          aria-pressed={isSecondaryPanelOpen}
          title={
            isSecondaryPanelOpen
              ? "Hide secondary panel"
              : "Show secondary panel"
          }
          onClick={onToggleSecondaryPanel}
        >
          <Icon name="PanelBottom" />
        </Button>
      ) : null}
    </>
  );

  return <AppPageHeader center={center} actions={actions} />;
}
