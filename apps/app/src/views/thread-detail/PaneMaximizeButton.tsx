import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { useAppCommandShortcut } from "@/components/commands/AppCommandProvider";
import { HEADER_MAXIMIZE_ICON_BUTTON_CLASS } from "@/components/layout/AppPageHeader";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@/components/ui/chromeStyleTokens";
import { cn } from "@bb/shared-ui/lib/utils";
import { usePaneContext } from "./PaneContext";

export function PaneMaximizeButton() {
  const { isMaximized, onToggleMaximize } = usePaneContext();
  const shortcut = useAppCommandShortcut("pane.maximize.toggle");

  if (onToggleMaximize === null) return null;

  const label = isMaximized ? "Restore pane" : "Maximize pane";
  const accessibleLabel = shortcut ? `${label} (${shortcut.label})` : label;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            HEADER_MAXIMIZE_ICON_BUTTON_CLASS,
            CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
          )}
          aria-label={accessibleLabel}
          aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
          aria-pressed={isMaximized}
          onClick={onToggleMaximize}
        >
          <Icon name={isMaximized ? "Minimize2" : "Maximize2"} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        {shortcut ? ` (${shortcut.label})` : ""}
      </TooltipContent>
    </Tooltip>
  );
}
