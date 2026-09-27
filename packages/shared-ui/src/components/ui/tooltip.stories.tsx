import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip.js";
import { Button } from "./button.js";
import { Icon } from "./icon.js";
import { Switch } from "./switch.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Tooltip",
};

function IconButtonTooltipDemo() {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Refresh tasks"
          >
            <Icon name="RotateCcw" className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Refresh tasks</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function DisabledControlTooltipDemo() {
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-flex cursor-not-allowed rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            tabIndex={0}
            aria-label="Run automation on schedule. Disabled: no environment variables configured."
          >
            <Switch
              checked={false}
              disabled
              aria-label="Run automation on schedule"
            />
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-64">
          Disabled: no environment variables configured.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Icon button"
        hint="plugins/tasks/shell/topbar.tsx — a ghost icon button with a bottom tooltip repeating its own aria-label, disableHoverableContent"
      >
        <IconButtonTooltipDemo />
      </StoryRow>
      <StoryRow
        label="Disabled control"
        hint="plugins/automations/detail-view.tsx — a focusable span wraps a disabled Switch; hovering the disabled control itself may not open it (browsers suppress pointer events on disabled form elements), but Tab-focusing the wrapping span always does"
      >
        <DisabledControlTooltipDemo />
      </StoryRow>
    </StoryCard>
  );
}
