// bb-fork(parent-mute): parent notification mute toggle for the Parent row
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";

const MUTE_ICON_BUTTON_CLASS = [
  "size-3.5 shrink-0 rounded-full p-0 text-muted-foreground hover:bg-transparent",
  "hover:text-foreground [&_[data-icon-root]]:size-3",
  "max-md:pointer-coarse:h-9 max-md:pointer-coarse:w-9",
  "max-md:pointer-coarse:[&_[data-icon-root]]:size-5",
].join(" ");

interface ParentNotificationsMuteToggleProps {
  disabled: boolean;
  muted: boolean;
  onChange: (next: boolean) => void;
}

export function ParentNotificationsMuteToggle({
  disabled,
  muted,
  onChange,
}: ParentNotificationsMuteToggleProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={MUTE_ICON_BUTTON_CLASS}
          disabled={disabled}
          onClick={() => onChange(!muted)}
          aria-label={
            muted ? "Unmute parent notifications" : "Mute parent notifications"
          }
          aria-pressed={muted}
        >
          <Icon
            name={muted ? "NotificationOff" : "Notification"}
            className={muted ? "text-foreground" : undefined}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {muted
          ? "Parent notifications muted: this thread does not notify its parent"
          : "Mute parent notifications to work here without pinging the parent thread"}
      </TooltipContent>
    </Tooltip>
  );
}
