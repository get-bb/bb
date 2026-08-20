import type { ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";

/**
 * Connection-status dot for a machine (host): filled success dot when the
 * daemon is connected, hollow ring when offline. Shared by the environment
 * picker's machine menu, Settings → Machines, and project source rows.
 */
export function MachineStatusDot({
  connected,
  className,
}: {
  connected: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        connected ? "bg-success" : "border border-muted-foreground",
        className,
      )}
    />
  );
}

/** Accessible connection state for surfaces where a dot alone is ambiguous. */
export function MachineStatusIcon({
  connected,
  tooltip,
  className,
}: {
  connected: boolean;
  tooltip?: ReactNode;
  className?: string;
}) {
  const label = connected ? "Online" : "Offline";
  const icon = connected ? "Cloud" : "CloudOff";
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label={label}
            className={cn(
              "inline-flex size-5 shrink-0 items-center justify-center text-muted-foreground",
              className,
            )}
          >
            <Icon aria-hidden name={icon} className="size-4" />
          </span>
        </TooltipTrigger>
        <TooltipContent>{tooltip ?? label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
