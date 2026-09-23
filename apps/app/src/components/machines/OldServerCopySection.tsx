import { useState } from "react";
import type { Host, LastServerMove } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { ConfirmDeleteDialog } from "@/components/dialogs/ConfirmDeleteDialog";
import { appToast } from "@/components/ui/app-toast";
import {
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section";
import { useDeleteOldServerCopy } from "@/hooks/mutations/server-move-mutations";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

export function hasOldServerCopy(
  host: Host,
  lastMove: LastServerMove | null,
): lastMove is LastServerMove {
  return (
    lastMove !== null &&
    lastMove.fromHostId === host.id &&
    lastMove.oldCopyDeletedAt === null
  );
}

export function oldServerCopyDescription(
  host: Host,
  lastMove: LastServerMove,
): string {
  const base = `The server moved from ${host.name} to ${lastMove.toHostName}. The old server data is still on ${host.name}, locked so bb won't start a server from it. Keep it as a backup, or delete it once the new server works.`;
  return host.status === "connected"
    ? base
    : `${base} ${host.name} has to be online to delete it.`;
}

export function OldServerCopySection({
  host,
  lastMove,
}: {
  host: Host;
  lastMove: LastServerMove;
}) {
  const deleteOldCopy = useDeleteOldServerCopy();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <OldServerCopySectionView
        host={host}
        lastMove={lastMove}
        onDelete={() => {
          deleteOldCopy.reset();
          setConfirmOpen(true);
        }}
      />
      <ConfirmDeleteDialog
        modal={false}
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && !deleteOldCopy.isPending) {
            deleteOldCopy.reset();
            setConfirmOpen(false);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Delete the old server copy?</DialogTitle>
          <DialogDescription>
            This permanently deletes the database, settings and plugin data{" "}
            {host.name} kept when the server moved to {lastMove.toHostName}. The
            server on {lastMove.toHostName} is not affected.
          </DialogDescription>
        </DialogHeader>
        {deleteOldCopy.isError ? (
          <p className="text-sm text-destructive-text" role="alert">
            {getMutationErrorMessage({
              error: deleteOldCopy.error,
              fallbackMessage: `Couldn't delete the old server copy on ${host.name}.`,
            })}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="destructive"
            disabled={deleteOldCopy.isPending}
            onClick={() =>
              deleteOldCopy.mutate(host.id, {
                onSuccess: (result) => {
                  setConfirmOpen(false);
                  appToast.success(
                    result.deleted
                      ? `Deleted the old server copy on ${host.name}`
                      : `No old server copy was left on ${host.name}`,
                  );
                },
              })
            }
          >
            {deleteOldCopy.isPending ? "Deleting…" : "Delete old copy"}
          </Button>
        </DialogFooter>
      </ConfirmDeleteDialog>
    </>
  );
}

export function OldServerCopySectionView({
  host,
  lastMove,
  onDelete,
}: {
  host: Host;
  lastMove: LastServerMove;
  onDelete: () => void;
}) {
  return (
    <SettingsSection
      title="Old server copy"
      description={oldServerCopyDescription(host, lastMove)}
    >
      <SettingsRowList>
        <SettingsRow>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={host.status !== "connected"}
            onClick={onDelete}
          >
            Delete old copy
          </Button>
        </SettingsRow>
      </SettingsRowList>
    </SettingsSection>
  );
}
