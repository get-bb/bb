import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import type { PluginRowSignal } from "./plugin-status";
import { UPDATE_TINT_STYLE } from "./plugin-ui";

/** The single status/action slot shared by installed plugin rows and galleries. */
export function PluginRowSignalView({
  signal,
  onUpdateClick,
  onStatusClick,
}: {
  signal: PluginRowSignal;
  onUpdateClick: () => void;
  onStatusClick: () => void;
}) {
  if (signal.kind === "update") {
    return (
      <button
        type="button"
        className="shrink-0 rounded-full border px-2.5 py-1 text-2xs font-medium"
        style={UPDATE_TINT_STYLE}
        onClick={onUpdateClick}
      >
        Update {signal.version}
      </button>
    );
  }

  const statusDescription =
    signal.detail === null ? signal.label : `${signal.label}: ${signal.detail}`;
  const accessibleLabel = `View details for ${statusDescription}`;

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "size-7 shrink-0 rounded-full",
              signal.tone === "error"
                ? "text-destructive hover:text-destructive"
                : "text-warning-text hover:text-warning-text",
            )}
            aria-label={accessibleLabel}
            onClick={onStatusClick}
          >
            <Icon name={signal.icon} className="size-4" aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{statusDescription}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
