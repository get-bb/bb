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
    <dl
      className={cn(
        "divide-y divide-border overflow-hidden rounded-md border border-border bg-background",
        className,
      )}
    >
      {children}
    </dl>
  );
}

export function ResourceDetailFact({
  label,
  children,
  mono = false,
  action,
  details,
}: {
  label: ReactNode;
  children: ReactNode;
  mono?: boolean;
  action?: ReactNode;
  details?: ReactNode;
}) {
  return (
    <div className="grid min-w-0 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <dt className="bg-surface-recessed/55 px-3 py-2.5 text-xs font-medium text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 px-3 py-2.5">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={cn(
              "min-w-0 flex-1 break-words text-sm text-foreground",
              mono && "font-mono text-xs",
            )}
          >
            {children}
          </div>
          {action ? (
            <div className="-my-1 flex shrink-0 items-center">{action}</div>
          ) : null}
        </div>
        {details ? <div className="mt-2">{details}</div> : null}
      </dd>
    </div>
  );
}

/** Passive lifecycle status for states that are observed, not changed here. */
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

/** Canonical action for a resource that can be added from a browse surface. */
export function ResourceInstallControl({
  accessibleLabel,
  label = "Install",
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
          <Icon name="Download" className="size-3.5" aria-hidden />
          {presentation === "label" ? label : null}
        </span>
      )}
    </Button>
  );
  return withTooltip(control, presentation === "icon" ? tooltip : undefined);
}

/**
 * Canonical installed state for browse and detail surfaces.
 *
 * With an action it shows the installed or provenance treatment at rest, then
 * reveals the destructive uninstall affordance only while hovered or focused.
 */
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
