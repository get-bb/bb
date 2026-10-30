import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UPDATE_ACTION_ICON } from "@bb/domain/update-state";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";
import { usePluginNotificationAction } from "@/components/plugin/PluginNotificationDescription";
import { appToast } from "@/components/ui/app-toast";
import { pluginAdminErrorMessage } from "@/lib/plugin-admin-error";
import { applyPluginUpdateJob } from "@/hooks/cache-owners/plugin-cache-owner";
import { startPluginUpdate } from "@/hooks/queries/plugin-update-job-queries";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import {
  DetailsDisclosure,
  formatAbsoluteDate,
  KeyValueGrid,
  RollbackNote,
  SUCCESS_TEXT_STYLE,
} from "./plugin-ui";

interface UpdatePluginDialogProps {
  plugin: PluginListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UpdatePluginDialog({
  plugin,
  open,
  onOpenChange,
}: UpdatePluginDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <UpdatePluginDialogContent
            plugin={plugin}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function UpdatePluginDialogContent({
  plugin,
  onOpenChange,
}: {
  plugin: PluginListItem;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const notificationAction = usePluginNotificationAction();
  const name = plugin.name ?? plugin.id;
  const state = plugin.updateState;
  const update = useMutation({
    meta: { showErrorToast: false },
    mutationFn: (expectedVersion: string) =>
      startPluginUpdate({ pluginId: plugin.id, expectedVersion }),
    onSuccess: (job) => {
      applyPluginUpdateJob({ queryClient, job });
      onOpenChange(false);
    },
    onError: (error) => {
      appToast.error("Plugin update failed", {
        description: `${plugin.name ?? plugin.id} — ${pluginAdminErrorMessage(error)}`,
        action: notificationAction(plugin.id, "installed"),
      });
    },
  });

  const fromLine = `Currently ${plugin.version}`;
  const failure = state.lastFailure;

  if (failure !== null) {
    const retryVersion = state.availableVersion;
    const retryLabel = state.availableLabel;
    return (
      <>
        <DialogHeader>
          <DialogTitle>Update failed</DialogTitle>
          <DialogDescription>
            {failure.at === null
              ? "The update couldn’t be completed."
              : `Failed on ${formatAbsoluteDate(failure.at)}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-start gap-2 text-sm">
            <Icon
              name="CircleX"
              className="mt-0.5 size-4 shrink-0 text-destructive"
              aria-hidden
            />
            <span>
              bb couldn&rsquo;t activate {failure.label}. It restored{" "}
              {plugin.version} and its data.
            </span>
          </div>
          {failure.detail.length > 0 ? (
            <DetailsDisclosure
              key="failure-details"
              summary="Technical details"
              defaultExpanded
            >
              <p className="break-words font-mono text-foreground">
                {failure.detail}
              </p>
            </DetailsDisclosure>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {retryVersion === null || retryLabel === null
              ? `The restored version can keep running. Try again when a compatible update becomes available.`
              : `A compatible update to ${retryLabel} is still available. Retry when you’re ready.`}
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          {retryVersion === null || retryLabel === null ? null : (
            <Button
              type="button"
              disabled={update.isPending}
              aria-busy={update.isPending}
              aria-label={`Retry update to ${retryLabel}`}
              onClick={() => update.mutate(retryVersion)}
            >
              {update.isPending ? (
                <Icon name="Spinner" className="animate-spin" />
              ) : null}
              Retry update
            </Button>
          )}
        </DialogFooter>
      </>
    );
  }

  if (state.availableVersion !== null && state.availableLabel !== null) {
    const candidate = state.availableVersion;
    const candidateLabel = state.availableLabel;
    return (
      <>
        <DialogHeader>
          <DialogTitle>
            Update {name} to {candidateLabel}?
          </DialogTitle>
          <DialogDescription>{fromLine}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium" style={SUCCESS_TEXT_STYLE}>
              ✓
            </span>
            <span>Compatible with your bb and plugin SDK</span>
          </div>
          {state.availableBreaking ? (
            <div className="flex items-start gap-2 text-sm">
              <Icon
                name="AlertTriangle"
                className="mt-0.5 size-4 shrink-0 text-warning"
                aria-hidden
              />
              <span>
                {candidateLabel} may include breaking changes: it moves to a new
                major version, a new minor version before 1.0, or a new patch
                version before 0.1. bb doesn&rsquo;t check that this
                plugin&rsquo;s settings and data carry over.
              </span>
            </div>
          ) : null}
          <DetailsDisclosure summary="Details — source, versions">
            <KeyValueGrid
              entries={[
                { key: "Source", value: plugin.sourceDisplay },
                { key: "Current", value: plugin.version },
                {
                  key: "Candidate",
                  value: state.availableDisplay ?? candidateLabel,
                },
              ]}
            />
          </DetailsDisclosure>
          <RollbackNote
            fromVersion={plugin.version}
            toVersion={candidateLabel}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={update.isPending}
            onClick={() => onOpenChange(false)}
          >
            Not now
          </Button>
          <Button
            type="button"
            disabled={update.isPending}
            aria-busy={update.isPending}
            onClick={() => update.mutate(candidate)}
          >
            {update.isPending ? (
              <Icon name="Spinner" className="animate-spin" />
            ) : (
              <Icon name={UPDATE_ACTION_ICON} aria-hidden />
            )}
            Update
          </Button>
        </DialogFooter>
      </>
    );
  }

  if (state.blockedLabel !== null) {
    const blocked = state.blockedLabel;
    return (
      <>
        <DialogHeader>
          <DialogTitle>
            Update {name} to {blocked}?
          </DialogTitle>
          <DialogDescription>{fromLine}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Icon
              name="AlertTriangle"
              className="size-4 shrink-0 text-warning"
              aria-hidden
            />
            <span>{blocked} isn&rsquo;t compatible with this bb</span>
          </div>
          <DetailsDisclosure summary="Details" defaultExpanded>
            <div className="space-y-1.5">
              {state.blockedReasons.length > 0 ? (
                <ul className="space-y-1">
                  {state.blockedReasons.map((reason) => (
                    <li key={reason} className="text-foreground">
                      {reason}
                    </li>
                  ))}
                </ul>
              ) : null}
              <KeyValueGrid
                entries={[
                  {
                    key: "Newest compatible",
                    value: `${plugin.version} — already installed`,
                  },
                ]}
              />
            </div>
          </DetailsDisclosure>
          <p className="text-xs text-subtle-foreground">
            Keep using {plugin.version} and check again when a compatible plugin
            version is available.
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          <Button type="button" disabled>
            <Icon name={UPDATE_ACTION_ICON} aria-hidden />
            Update
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{name} is up to date</DialogTitle>
        <DialogDescription>{fromLine}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          Close
        </Button>
      </DialogFooter>
    </>
  );
}
