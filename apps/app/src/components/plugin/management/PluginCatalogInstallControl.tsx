import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";

type PluginCatalogInstallControlProps = {
  displayName: string;
  count?: { display: string; accessibleLabel: string };
} & (
  | { installed: true; included: boolean; onUninstall?: () => void }
  | { installed: false; disabled: boolean; onInstall: () => void }
);

export function PluginCatalogInstallControl(
  props: PluginCatalogInstallControlProps,
) {
  const { displayName, installed, count } = props;
  const included = installed && props.included;
  const disabled = installed
    ? included || props.onUninstall === undefined
    : props.disabled;
  const tooltip = included
    ? "Included with BB; cannot be uninstalled."
    : installed
      ? "Installed"
      : `Install ${displayName}`;

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={installed ? "ghost" : "outline"}
            size="sm"
            aria-disabled={disabled}
            aria-label={`${installed ? `${displayName} installed` : `Install ${displayName}`}${
              count === undefined ? "" : ` — ${count.accessibleLabel}`
            }`}
            className={cn(
              "group/install h-7 min-w-7 shrink-0 gap-1.5 px-2 text-xs shadow-none",
              installed
                ? "font-normal text-subtle-foreground"
                : "border-border/80 bg-background text-foreground hover:bg-state-hover",
              installed && !disabled && "hover:text-destructive-text",
              disabled &&
                "cursor-not-allowed hover:bg-transparent hover:text-subtle-foreground",
              !installed && disabled && "opacity-50",
            )}
            onClick={() => {
              if (disabled) return;
              if (props.installed) props.onUninstall?.();
              else props.onInstall();
            }}
          >
            <span className="grid place-items-center" aria-hidden>
              <Icon
                name="Download"
                className={cn(
                  "col-start-1 row-start-1 size-3.5",
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
            {count === undefined ? null : (
              <span aria-hidden>{count.display}</span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
