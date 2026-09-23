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
import { useMachineThreadPreview } from "@/hooks/queries/thread-queries";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { getThreadDisplayTitle } from "@/lib/thread-title";

const MACHINE_THREAD_PREVIEW_LIMIT = 5;

export function serverMachineRemoveDisabledReason(
  serverMoveEnabled: boolean,
): string {
  return serverMoveEnabled
    ? "The server machine can't be removed. Move the server to another machine first."
    : "The server machine can't be removed.";
}

export function machineRemovalConsequences(host: Host): string {
  if (host.type === "ephemeral") {
    return "The compute and its saved snapshots are deleted. Its environments remain as read-only history.";
  }
  if (host.machineProviderId !== null) {
    return "The provider cleans up resources it owns. Its environments remain as read-only history.";
  }
  return "Project checkouts stay on its disk, but its environments become read-only history and it cannot run new work until paired again.";
}

function MachineThreadPreviewList({ hostId }: { hostId: string }) {
  const preview = useMachineThreadPreview({
    hostId,
    limit: MACHINE_THREAD_PREVIEW_LIMIT,
  });
  if (preview.data === undefined || preview.data.total === 0) return null;
  const { threads, total } = preview.data;
  const hiddenCount = total - threads.length;
  const summary =
    total === 1
      ? "1 unarchived thread on this machine:"
      : `${total} unarchived threads on this machine:`;
  return (
    <div className="space-y-1 text-sm text-muted-foreground">
      <p>{summary}</p>
      <ul className="list-disc space-y-0.5 pl-5 text-foreground marker:text-subtle-foreground">
        {threads.map((thread) => (
          <li key={thread.id}>
            <span className="block truncate">
              {getThreadDisplayTitle(thread)}
            </span>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 ? <p>and {hiddenCount} more</p> : null}
    </div>
  );
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
          <MachineThreadPreviewList hostId={target.id} />
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
