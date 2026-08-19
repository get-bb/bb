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

function namePlugins(ids: readonly string[]): string {
  return [...ids].sort().join(", ");
}

function countPlugins(count: number): string {
  return count === 1 ? "1 plugin" : `${count} plugins`;
}

/**
 * One-line toast summary of an update check. Anything the check could not
 * resolve (registry offline, moved tag, retired source) is a warning, never
 * folded into "up to date": a 200 response still carries per-plugin failures.
 */
export function summarizeUpdateCheck(
  results: readonly PluginUpdatesEntry[],
  scope: { pluginId?: string } = {},
): {
  tone: "success" | "message" | "warning";
  title: string;
  description?: string;
} {
  const available = results.filter(
    (result) => result.outcome === "update-available",
  );
  const unavailable = results.filter(
    (result) => result.outcome === "unavailable",
  );
  // A blocked newer release rides on `current` and `update-available` results
  // too, so read the field rather than the `incompatible` outcome alone.
  const blocked = results.filter(
    (result) => result.outcome === "incompatible" || result.blocked !== null,
  );
  const unavailableNote =
    unavailable.length === 0
      ? null
      : scope.pluginId !== undefined
        ? (unavailable[0]?.detail ?? "The update check did not complete.")
        : `Could not check ${countPlugins(unavailable.length)}: ${namePlugins(unavailable.map((result) => result.id))}.`;
  if (available.length > 0) {
    return {
      tone: unavailableNote === null ? "success" : "warning",
      title:
        available.length === 1
          ? "1 plugin update available"
          : `${available.length} plugin updates available`,
      description: [
        namePlugins(available.map((result) => result.id)),
        unavailableNote,
      ]
        .filter((part) => part !== null)
        .join(" "),
    };
  }
  if (unavailableNote !== null) {
    return {
      tone: "warning",
      title:
        scope.pluginId === undefined
          ? "Update check incomplete"
          : `Could not check ${scope.pluginId} for updates`,
      description: unavailableNote,
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
              : `${countPlugins(blocked.length)} have newer releases that need a newer bb.`,
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
