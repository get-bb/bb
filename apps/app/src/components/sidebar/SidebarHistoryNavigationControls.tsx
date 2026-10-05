import { useCallback } from "react";
import type { AppCommandId } from "@bb/domain";
import { cn } from "@bb/shared-ui/lib/utils";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { useAppCommandShortcut } from "@/components/commands/AppCommandProvider";
import { useRouteStateHistoryNavigation } from "@/lib/app-route-history";

interface SidebarHistoryNavigationControlsProps {
  onNavigate?: () => void;
  className?: string;
}

interface SidebarHistoryNavButtonProps {
  command: AppCommandId;
  icon: IconName;
  label: string;
  disabled: boolean;
  onClick: () => void;
}

const SIDEBAR_HISTORY_NAV_BUTTON_CLASS = cn(
  COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
  "text-muted-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2",
);

function SidebarHistoryNavButton({
  command,
  icon,
  label,
  disabled,
  onClick,
}: SidebarHistoryNavButtonProps) {
  const shortcut = useAppCommandShortcut(command);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            SIDEBAR_HISTORY_NAV_BUTTON_CLASS,
            disabled &&
              "cursor-default opacity-50 hover:bg-transparent hover:text-muted-foreground",
          )}
          onClick={onClick}
          aria-disabled={disabled || undefined}
          aria-label={label}
          aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
        >
          <Icon name={icon} aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <span>{label}</span>
        {shortcut ? ` (${shortcut.label})` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

export function SidebarHistoryNavigationControls({
  onNavigate,
  className,
}: SidebarHistoryNavigationControlsProps) {
  const { canGoBack, canGoForward, goBack, goForward } =
    useRouteStateHistoryNavigation();

  const handleBack = useCallback(() => {
    if (!canGoBack) {
      return;
    }
    goBack();
    onNavigate?.();
  }, [canGoBack, goBack, onNavigate]);

  const handleForward = useCallback(() => {
    if (!canGoForward) {
      return;
    }
    goForward();
    onNavigate?.();
  }, [canGoForward, goForward, onNavigate]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn("flex items-center gap-1", className)}>
        <SidebarHistoryNavButton
          command="history.back"
          icon="ChevronLeft"
          label="Go back"
          disabled={!canGoBack}
          onClick={handleBack}
        />
        <SidebarHistoryNavButton
          command="history.forward"
          icon="ChevronRight"
          label="Go forward"
          disabled={!canGoForward}
          onClick={handleForward}
        />
      </div>
    </TooltipProvider>
  );
}
