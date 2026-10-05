import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";
import type { ActivePluginInstallJob } from "@/hooks/queries/plugin-install-job-queries";
import {
  NEW_TEXT_STYLE,
  type PluginInstallCountPresentation,
} from "./plugin-ui";

const INSTALL_JOB_LABELS = {
  queued: "Queued",
  running: "Installing…",
  cancelling: "Cancelling…",
} as const;

function PluginInstallJobControl({
  displayName,
  job,
  onCancel,
}: {
  displayName: string;
  job: ActivePluginInstallJob;
  onCancel: () => void;
}) {
  const cancelling = job.state === "cancelling";
  const tooltip = cancelling
    ? `Cancelling the ${displayName} install`
    : job.state === "queued"
      ? "Waiting for another install to finish. Click to cancel."
      : `Installing ${displayName}. Click to cancel.`;
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-disabled={cancelling}
            aria-label={
              cancelling
                ? `Cancelling ${displayName} install`
                : `Cancel installing ${displayName}`
            }
            className={cn(
              "group/install h-7 min-w-7 shrink-0 gap-1.5 px-2 text-xs font-normal text-subtle-foreground shadow-none",
              cancelling
                ? "cursor-not-allowed hover:bg-transparent"
                : "hover:text-destructive-text",
            )}
            onClick={() => {
              if (!cancelling) onCancel();
            }}
          >
            <span className="grid place-items-center" aria-hidden>
              <Icon
                name="Spinner"
                className={cn(
                  "col-start-1 row-start-1 size-3.5 animate-spin",
                  !cancelling &&
                    "group-hover/install:opacity-0 group-focus-visible/install:opacity-0",
                )}
              />
              {cancelling ? null : (
                <Icon
                  name="X"
                  className="col-start-1 row-start-1 size-3.5 opacity-0 group-hover/install:opacity-100 group-focus-visible/install:opacity-100"
                />
              )}
            </span>
            {INSTALL_JOB_LABELS[job.state]}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

type PluginCatalogInstallControlProps = {
  displayName: string;
  count?: PluginInstallCountPresentation;
  showLabel?: boolean;
  subtle?: boolean;
} & (
  | { installed: true; included: boolean; onUninstall?: () => void }
  | {
      installed: false;
      disabled: boolean;
      unavailableReason?: string | null;
      onInstall: () => void;
      installJob: ActivePluginInstallJob | null;
      onCancelInstall: (jobId: string) => void;
    }
);

export function PluginCatalogInstallControl(
  props: PluginCatalogInstallControlProps,
) {
  const { displayName, installed, count } = props;
  if (!props.installed && props.installJob !== null) {
    const { installJob, onCancelInstall } = props;
    return (
      <PluginInstallJobControl
        displayName={displayName}
        job={installJob}
        onCancel={() => onCancelInstall(installJob.id)}
      />
    );
  }
  const included = installed && props.included;
  const disabled = installed
    ? included || props.onUninstall === undefined
    : props.disabled;
  const tooltip = included
    ? "Included with BB"
    : installed
      ? "Installed"
      : disabled
        ? (props.unavailableReason ?? "Unavailable for this version of BB.")
        : `Install ${displayName}`;
  const stateIcon = installed
    ? "Check"
    : disabled
      ? "AlertTriangle"
      : "Download";

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={installed || props.subtle ? "ghost" : "outline"}
            size="sm"
            aria-disabled={disabled}
            aria-label={`${installed ? `${displayName} installed` : `Install ${displayName}`}${
              count === undefined ? "" : ` — ${count.accessibleLabel}`
            }`}
            className={cn(
              "group/install h-7 min-w-7 shrink-0 gap-1.5 px-2 text-xs shadow-none",
              installed || props.subtle
                ? "font-normal text-subtle-foreground"
                : "border-border/80 bg-background text-foreground hover:bg-state-hover",
              installed && !disabled && "hover:text-destructive-text",
              disabled &&
                "cursor-not-allowed hover:bg-transparent hover:text-subtle-foreground",
              installed &&
                "opacity-50 hover:opacity-100 focus-visible:opacity-100",
            )}
            onClick={() => {
              if (disabled) return;
              if (props.installed) props.onUninstall?.();
              else props.onInstall();
            }}
          >
            <span
              className={cn(
                "grid place-items-center",
                count?.tone === "builtin" && "hidden",
              )}
              aria-hidden
            >
              <Icon
                name={stateIcon}
                className={cn(
                  "col-start-1 row-start-1 size-3.5",
                  !installed && disabled && "text-warning-text",
                  installed &&
                    !disabled &&
                    "group-hover/install:opacity-0 group-focus-visible/install:opacity-0",
                )}
              />
              {installed && !disabled ? (
                <Icon
                  name="Trash2"
                  className="col-start-1 row-start-1 size-3.5 opacity-0 group-hover/install:opacity-100 group-focus-visible/install:opacity-100"
                />
              ) : null}
            </span>
            {props.showLabel ? (installed ? "Installed" : "Install") : null}
            {count === undefined ? null : (
              <span
                aria-hidden
                className={cn(
                  "text-2xs",
                  count.tone === "new" && "font-semibold",
                )}
                style={count.tone === "new" ? NEW_TEXT_STYLE : undefined}
              >
                {count.display}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
