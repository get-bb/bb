import { useNavigate } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { SIDEBAR_RAIL_BUTTON_CLASS } from "@bb/shared-ui/sidebar-row-classes";
import { useAppCommandShortcut } from "@/components/commands/AppCommandProvider";

export function NavRailSettingsButton({
  isSettingsActive,
  settingsRoutePath,
}: {
  isSettingsActive: boolean;
  settingsRoutePath: string;
}) {
  const navigate = useNavigate();
  const settingsShortcut = useAppCommandShortcut("settings.open");
  const label = settingsShortcut
    ? `Settings (${settingsShortcut.label})`
    : "Settings";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-current={isSettingsActive ? "page" : undefined}
          aria-keyshortcuts={settingsShortcut?.ariaKeyshortcuts}
          className={cn(
            SIDEBAR_RAIL_BUTTON_CLASS,
            "my-1 max-md:pointer-coarse:my-0",
          )}
          onClick={() => {
            if (!isSettingsActive) void navigate(settingsRoutePath);
          }}
        >
          <Icon name="Settings" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
