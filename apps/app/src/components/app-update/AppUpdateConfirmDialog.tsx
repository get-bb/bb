import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { appUpdateConfirmDescription } from "./app-update-presentation";

interface AppUpdateConfirmActions {
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function AppUpdateConfirmDialogContent({
  runningThreadCount,
  pending,
  onCancel,
  onConfirm,
}: AppUpdateConfirmActions & { runningThreadCount: number }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Update bb?</DialogTitle>
        <DialogDescription>
          {appUpdateConfirmDescription(runningThreadCount)}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onCancel}
        >
          Not now
        </Button>
        <Button type="button" disabled={pending} onClick={onConfirm}>
          Update
        </Button>
      </DialogFooter>
    </>
  );
}

export function AppUpdateConfirmDialog({
  runningThreadCount,
  ...actions
}: AppUpdateConfirmActions & { runningThreadCount: number | null }) {
  return (
    <Dialog
      open={runningThreadCount !== null}
      onOpenChange={(open) => {
        if (!open) actions.onCancel();
      }}
    >
      <DialogContent>
        {runningThreadCount === null ? null : (
          <AppUpdateConfirmDialogContent
            runningThreadCount={runningThreadCount}
            {...actions}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
