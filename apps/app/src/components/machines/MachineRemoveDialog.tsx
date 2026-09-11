import type { Host } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { ConfirmDeleteDialog } from "@/components/dialogs/ConfirmDeleteDialog";
import { useRemoveHost } from "@/hooks/mutations/host-mutations";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

export function machineRemovalConsequences(host: Host): string {
  if (host.type === "ephemeral") {
    return "The compute and its saved snapshots are deleted. Its environments remain as read-only history.";
  }
  if (host.machineProviderId !== null) {
    return "The provider cleans up resources it owns. Its environments remain as read-only history.";
  }
  return "Project checkouts stay on its disk, but its environments become read-only history and it cannot run new work until paired again.";
}

export function MachineRemoveDialog({
  target,
  onOpenChange,
  onRemoved,
}: {
  target: Host | null;
  onOpenChange: (open: boolean) => void;
  onRemoved?: (host: Host) => void;
}) {
  const removeHost = useRemoveHost();

  return (
    <ConfirmDeleteDialog
      modal={false}
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !removeHost.isPending) {
          removeHost.reset();
          onOpenChange(false);
        }
      }}
    >
      {target === null ? null : (
        <>
          <DialogHeader>
            <DialogTitle>Remove {target.name}?</DialogTitle>
            <DialogDescription>
              This revokes {target.name}'s access to this server.{" "}
              {machineRemovalConsequences(target)}
            </DialogDescription>
          </DialogHeader>
          {removeHost.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {getMutationErrorMessage({
                error: removeHost.error,
                fallbackMessage: `Couldn't remove ${target.name}.`,
              })}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="destructive"
              disabled={removeHost.isPending}
              onClick={() =>
                removeHost.mutate(target.id, {
                  onSuccess: () => {
                    onOpenChange(false);
                    onRemoved?.(target);
                  },
                })
              }
            >
              Remove machine
            </Button>
          </DialogFooter>
        </>
      )}
    </ConfirmDeleteDialog>
  );
}
