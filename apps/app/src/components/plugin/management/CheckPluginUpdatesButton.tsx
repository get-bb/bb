import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";
import { appToast } from "@/components/ui/app-toast";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  checkPluginUpdates,
  type PluginUpdatesEntry,
} from "@/hooks/queries/plugin-catalog-queries";
import { pluginAdminErrorMessage } from "@/lib/plugin-admin-error";

/** One-line toast summary of a full update check. */
export function summarizeUpdateCheck(
  results: readonly PluginUpdatesEntry[],
  scope: { pluginId?: string } = {},
): {
  tone: "success" | "message";
  title: string;
  description?: string;
} {
  const available = results.filter(
    (result) => result.outcome === "update-available",
  );
  const blocked = results.filter((result) => result.outcome === "incompatible");
  if (available.length > 0) {
    return {
      tone: "success",
      title:
        available.length === 1
          ? "1 plugin update available"
          : `${available.length} plugin updates available`,
      description: available
        .map((result) => result.id)
        .sort()
        .join(", "),
    };
  }
  return {
    tone: "message",
    title:
      scope.pluginId === undefined
        ? "All plugins are up to date"
        : `${scope.pluginId} is up to date`,
    ...(blocked.length > 0
      ? {
          description:
            blocked.length === 1
              ? `${blocked[0]?.id} has a newer release that needs a newer bb.`
              : `${blocked.length} plugins have newer releases that need a newer bb.`,
        }
      : {}),
  };
}

/**
 * Toolbar key that checks every installed plugin for updates. The server
 * persists what it finds, and the invalidated plugin list surfaces it as the
 * row "Update x.y.z" pills; the toast only summarizes the sweep. Same 32px
 * outline box as the filter and sort keys beside it.
 */
export function CheckPluginUpdatesButton({
  pluginId,
  appearance = "toolbar",
  className,
}: {
  /** Check one plugin instead of all of them. */
  pluginId?: string;
  /** `toolbar`: 32px icon key. `inline`: compact labeled detail-section button. */
  appearance?: "toolbar" | "inline";
  className?: string;
}) {
  const queryClient = useQueryClient();
  const check = useMutation({
    mutationFn: () =>
      checkPluginUpdates(fetch, pluginId === undefined ? {} : { id: pluginId }),
    onSuccess: (results) => {
      const summary = summarizeUpdateCheck(
        results,
        pluginId === undefined ? {} : { pluginId },
      );
      appToast[summary.tone](summary.title, {
        description: summary.description,
      });
    },
    onError: (error) => {
      appToast.error("Checking for plugin updates failed", {
        description: pluginAdminErrorMessage(error),
      });
    },
    onSettled: () => invalidatePluginList({ queryClient }),
  });
  const label = check.isPending ? "Checking for updates…" : "Check for updates";
  if (appearance === "inline") {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="check-plugin-updates"
        className={cn("h-6 px-2 text-xs", className)}
        aria-label={label}
        aria-busy={check.isPending}
        disabled={check.isPending}
        onClick={() => check.mutate()}
      >
        <Icon
          name={check.isPending ? "Spinner" : "RotateCcw"}
          className={cn("size-3.5", check.isPending && "animate-spin")}
          aria-hidden
        />
        Check
      </Button>
    );
  }
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            data-testid="check-plugin-updates"
            className={cn(
              "size-8 shrink-0 rounded-md border border-input bg-background p-0 text-muted-foreground",
              className,
            )}
            aria-label={label}
            aria-busy={check.isPending}
            disabled={check.isPending}
            onClick={() => check.mutate()}
          >
            <Icon
              name={check.isPending ? "Spinner" : "RotateCcw"}
              className={cn("size-4", check.isPending && "animate-spin")}
              aria-hidden
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
