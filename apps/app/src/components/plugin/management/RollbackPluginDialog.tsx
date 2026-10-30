import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PluginRollbackPoint } from "@bb/server-contract";
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
import { applyPluginUpdateJob } from "@/hooks/cache-owners/plugin-cache-owner";
import { startPluginRollback } from "@/hooks/queries/plugin-update-job-queries";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import { pluginAdminErrorMessage } from "@/lib/plugin-admin-error";
import {
  DetailsDisclosure,
  formatAbsoluteDate,
  KeyValueGrid,
  RollbackNote,
} from "./plugin-ui";

export function PluginDetailRollback({ plugin }: { plugin: PluginListItem }) {
  const [open, setOpen] = useState(false);
  const point = plugin.updateState.rollback;
  if (point === null) return null;
  const label = point.label;
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
      <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
        The last update replaced{" "}
        <span className="font-mono text-foreground">{label}</span>. You can
        return to it until {formatAbsoluteDate(point.until)}.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-6 px-2 text-xs"
        onClick={() => setOpen(true)}
      >
        <Icon name="RotateCcw" className="size-3.5" aria-hidden />
        Roll back to {label}
      </Button>
      <RollbackPluginDialog
        plugin={plugin}
        point={point}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}

interface RollbackPluginDialogProps {
  plugin: PluginListItem;
  point: PluginRollbackPoint;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RollbackPluginDialog({
  plugin,
  point,
  open,
  onOpenChange,
}: RollbackPluginDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <RollbackPluginDialogContent
            plugin={plugin}
            point={point}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RollbackPluginDialogContent({
  plugin,
  point,
  onOpenChange,
}: Omit<RollbackPluginDialogProps, "open">) {
  const queryClient = useQueryClient();
  const notificationAction = usePluginNotificationAction();
  const name = plugin.name ?? plugin.id;
  const current = plugin.version;
  const label = point.label;
  const rollback = useMutation({
    meta: { showErrorToast: false },
    mutationFn: () =>
      startPluginRollback({
        pluginId: plugin.id,
        expectedVersion: point.version,
      }),
    onSuccess: (job) => {
      applyPluginUpdateJob({ queryClient, job });
      onOpenChange(false);
    },
    onError: (error) => {
      appToast.error("Plugin rollback failed", {
        description: `${name} — ${pluginAdminErrorMessage(error)}`,
        action: notificationAction(plugin.id, "installed"),
      });
    },
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Roll back {name} to {label}?
        </DialogTitle>
        <DialogDescription>
          Currently {current}. Available until {formatAbsoluteDate(point.until)}
          .
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="flex items-start gap-2 text-sm">
          <Icon
            name="AlertTriangle"
            className="mt-0.5 size-4 shrink-0 text-warning"
            aria-hidden
          />
          <span>
            {name}&rsquo;s settings, stored data, secrets, and schedules go back
            to how they were before the update to {current}. Changes made since
            then are discarded.
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Its source range stays the same, so bb can offer {current} as an
          update again.
        </p>
        <DetailsDisclosure summary="Details — source, versions">
          <KeyValueGrid
            entries={[
              { key: "Source", value: plugin.sourceDisplay },
              { key: "Current", value: plugin.version },
              { key: "Roll back to", value: point.display },
            ]}
          />
        </DetailsDisclosure>
        <RollbackNote fromVersion={current} toVersion={label} />
      </div>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={rollback.isPending}
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button
          type="button"
          disabled={rollback.isPending}
          aria-busy={rollback.isPending}
          onClick={() => rollback.mutate()}
        >
          {rollback.isPending ? (
            <Icon name="Spinner" className="animate-spin" />
          ) : (
            <Icon name="RotateCcw" aria-hidden />
          )}
          Roll back
        </Button>
      </DialogFooter>
    </>
  );
}
