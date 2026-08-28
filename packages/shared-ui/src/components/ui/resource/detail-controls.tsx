import type { ReactNode } from "react";
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

export function ResourceDetailFacts({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <dl className={cn("flex min-w-0 flex-wrap gap-x-10 gap-y-3", className)}>
      {children}
    </dl>
  );
}

export function ResourceDetailFact({
  label,
  children,
  mono = false,
}: {
  label: ReactNode;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      {}
      <dt className="text-xs leading-snug text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-1 min-w-0 break-words text-sm leading-snug text-foreground",
          mono && "font-mono text-xs",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

export function ResourceLifecycleStatus({
  label,
  tooltip,
  accessibleLabel,
  icon,
  appearance = "default",
}: {
  label: ReactNode;
  tooltip?: ReactNode;
  accessibleLabel?: string;
  icon?: IconName;
  appearance?: "default" | "recessed";
}) {
  const status = (
    <span
      aria-label={accessibleLabel}
      tabIndex={tooltip === undefined ? undefined : 0}
      className={cn(
        "inline-flex h-7 min-w-20 shrink-0 items-center justify-center gap-1 rounded-md border px-2 text-xs font-medium text-muted-foreground",
        appearance === "recessed"
          ? "border-border/45 bg-surface-recessed/75 text-subtle-foreground"
          : "border-border/70 bg-transparent",
      )}
    >
      {icon ? <Icon name={icon} className="size-3.5" aria-hidden /> : null}
      {label}
    </span>
  );
  return withTooltip(status, tooltip);
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
  className,
  onAction,
}: {
  accessibleLabel: string;
  label?: string;
  icon?: IconName;
  pendingLabel?: string;
  pending?: boolean;
  disabled?: boolean;
  presentation?: "label" | "icon";
  tooltip?: ReactNode;
  className?: string;
  onAction: () => void;
}) {
  const control = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        "h-7 shrink-0 justify-center text-xs",
        presentation === "icon" ? "w-7 px-0" : "min-w-20 px-2.5",
        className,
      )}
      disabled={disabled || pending}
      aria-busy={pending}
      aria-label={accessibleLabel}
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
    </Button>
  );
  return withTooltip(control, presentation === "icon" ? tooltip : undefined);
}

export function ResourceInstalledControl({
  accessibleLabel,
  label = "Installed",
  icon = "Check",
  appearance = "installed",
  actionLabel = "Uninstall",
  pendingLabel = "Uninstalling",
  pending = false,
  presentation = "label",
  tooltip,
  className,
  onAction,
}: {
  accessibleLabel: string;
  label?: string;
  icon?: IconName;
  appearance?: "installed" | "provenance";
  actionLabel?: string;
  pendingLabel?: string;
  pending?: boolean;
  presentation?: "label" | "icon";
  tooltip?: ReactNode;
  className?: string;
  onAction?: () => void;
}) {
  const installedContent = (
    <span className="inline-flex items-center gap-1">
      <Icon name={icon} className="size-3.5" aria-hidden />
      {presentation === "label" ? label : null}
    </span>
  );

  if (onAction === undefined) {
    const status = (
      <span
        aria-label={accessibleLabel}
        tabIndex={
          presentation === "icon" && tooltip !== undefined ? 0 : undefined
        }
        className={cn(
          "inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-success/30 bg-success/10 text-xs font-medium text-[color:color-mix(in_oklab,var(--success)_72%,var(--ink))]",
          presentation === "icon" ? "w-7 px-0" : "min-w-20 px-2",
          className,
        )}
      >
        {installedContent}
      </span>
    );
    return withTooltip(status, presentation === "icon" ? tooltip : undefined);
  }

  const control = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        "group/install h-7 shrink-0 justify-center text-xs hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive-text focus-visible:border-destructive/40 focus-visible:bg-destructive/10 focus-visible:text-destructive-text",
        appearance === "installed"
          ? "border-success/30 bg-success/10 text-[color:color-mix(in_oklab,var(--success)_72%,var(--ink))]"
          : "border-border/70 bg-transparent text-muted-foreground",
        presentation === "icon" ? "w-7 px-0" : "min-w-20 px-2",
        className,
      )}
      disabled={pending}
      aria-label={accessibleLabel}
      onClick={onAction}
    >
      {pending ? (
        <span className="inline-flex items-center justify-center gap-1.5">
          <Icon name="Loading" className="size-3.5 animate-spin" aria-hidden />
          {presentation === "label" ? pendingLabel : null}
        </span>
      ) : (
        <span className="grid place-items-center">
          <span className="col-start-1 row-start-1 inline-flex items-center justify-center transition-opacity group-hover/install:opacity-0 group-focus-visible/install:opacity-0">
            {installedContent}
          </span>
          <span className="col-start-1 row-start-1 inline-flex items-center justify-center gap-1 opacity-0 transition-opacity group-hover/install:opacity-100 group-focus-visible/install:opacity-100">
            <Icon name="Trash2" className="size-3.5" aria-hidden />
            {presentation === "label" ? actionLabel : null}
          </span>
        </span>
      )}
    </Button>
  );
  return withTooltip(control, presentation === "icon" ? tooltip : undefined);
}
