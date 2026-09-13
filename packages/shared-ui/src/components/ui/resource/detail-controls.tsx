import { useId, type ReactNode } from "react";
import { Button } from "../button";
import { Icon, type IconName } from "../icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../tooltip";
import { cn } from "../../../lib/utils";

function withTooltip(control: ReactNode, tooltip: ReactNode | undefined) {
  if (tooltip === undefined) return control;
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>{control}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ResourceInstallControl({
  accessibleLabel,
  label = "Install",
  icon = "Download",
  pendingLabel = "Installing",
  pending = false,
  disabled = false,
  presentation = "label",
  tooltip,
  count,
  className,
  onAction,
}: {
  accessibleLabel: string;
  label?: string;
  icon?: IconName;
  pendingLabel?: string;
  pending?: boolean;
  disabled?: boolean;
  presentation?: "label" | "icon" | "compact";
  tooltip?: ReactNode;
  count?: { display: string; accessibleLabel: string };
  className?: string;
  onAction: () => void;
}) {
  const countId = useId();
  const control = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        "h-7 shrink-0 justify-center text-xs",
        presentation === "label"
          ? "min-w-20 px-2.5"
          : presentation === "icon"
            ? "w-7 px-0"
            : "min-w-7 gap-1.5 px-2",
        className,
      )}
      disabled={disabled || pending}
      aria-busy={pending}
      aria-label={accessibleLabel}
      aria-describedby={count === undefined ? undefined : countId}
      onClick={onAction}
    >
      {pending ? (
        <span className="inline-flex items-center justify-center gap-1.5">
          <Icon name="Loading" className="size-3.5 animate-spin" aria-hidden />
          {presentation === "label" ? pendingLabel : null}
        </span>
      ) : (
        <span className="inline-flex items-center justify-center gap-1.5">
          <Icon name={icon} className="size-3.5" aria-hidden />
          {presentation === "label" ? label : null}
        </span>
      )}
      {count === undefined ? null : (
        <span
          id={countId}
          aria-label={count.accessibleLabel}
          className="shrink-0 whitespace-nowrap text-2xs text-subtle-foreground"
        >
          {count.display}
        </span>
      )}
    </Button>
  );
  return withTooltip(control, presentation === "label" ? undefined : tooltip);
}

export function ResourceInstalledControl({
  accessibleLabel,
  count,
}: {
  accessibleLabel: string;
  count?: { display: string; accessibleLabel: string };
}) {
  return (
    <span
      aria-label={accessibleLabel}
      className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md border border-success/30 bg-success/10 px-2 text-xs font-medium text-[color:color-mix(in_oklab,var(--success)_72%,var(--ink))]"
    >
      <span className="inline-flex items-center gap-1">
        <Icon name="Check" className="size-3.5" aria-hidden />
        Installed
        {count === undefined ? null : (
          <span
            aria-label={count.accessibleLabel}
            className="shrink-0 whitespace-nowrap text-2xs text-subtle-foreground"
          >
            {count.display}
          </span>
        )}
      </span>
    </span>
  );
}
