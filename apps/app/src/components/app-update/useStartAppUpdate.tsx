import { useState, type ReactNode } from "react";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@bb/shared-ui/confirm-delete-dialog";
import {
  runningThreadCountFromError,
  runningThreadsWarning,
} from "@/components/app-update/app-update-presentation";
import { useApplyAppUpdate } from "@/hooks/mutations/app-update-mutations";
import { useAppUpdateStatus } from "@/hooks/queries/app-update-queries";
import { useSystemConfig } from "@/hooks/queries/system-queries";

export interface StartAppUpdate {
  start: () => void;
  pending: boolean;
  confirmDialog: ReactNode;
}

export function useStartAppUpdate(): StartAppUpdate {
  const appUpdate = useAppUpdateStatus().data;
  const applyAppUpdate = useApplyAppUpdate();
  const threadsResumeAfterRestart =
    useSystemConfig().data?.experiments.resumeThreadsAfterRestart === true;
  const [confirmingThreads, setConfirmingThreads] = useState<number | null>(
    null,
  );

  function start(): void {
    const runningThreadCount = appUpdate?.runningThreadCount ?? 0;
    if (runningThreadCount > 0) {
      setConfirmingThreads(runningThreadCount);
      return;
    }
    applyAppUpdate.mutate(
      { confirmInterruptingThreads: false },
      {
        onError: (error) => {
          const count = runningThreadCountFromError(error);
          if (count !== null) setConfirmingThreads(count);
        },
      },
    );
  }

  const confirmDialog = (
    <ConfirmDeleteDialog
      open={confirmingThreads !== null}
      onOpenChange={(open) => {
        if (!open) setConfirmingThreads(null);
      }}
    >
      <ConfirmDeleteDialogContent
        title="Update bb now?"
        description={runningThreadsWarning(
          confirmingThreads ?? 0,
          threadsResumeAfterRestart,
        )}
        confirmLabel="Update and restart"
        pending={applyAppUpdate.isPending}
        onCancel={() => setConfirmingThreads(null)}
        onConfirm={() => {
          applyAppUpdate.mutate(
            { confirmInterruptingThreads: true },
            { onSettled: () => setConfirmingThreads(null) },
          );
        }}
      />
    </ConfirmDeleteDialog>
  );

  return { start, pending: applyAppUpdate.isPending, confirmDialog };
}
