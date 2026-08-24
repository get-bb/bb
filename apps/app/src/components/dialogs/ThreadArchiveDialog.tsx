import type { Thread } from "@bb/domain";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "./ConfirmDeleteDialog";

export interface ThreadArchiveDialogTarget {
  thread: Thread;
  workingThreadCount: number;
}

interface ThreadArchiveDialogProps {
  target: ThreadArchiveDialogTarget | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onArchive: (target: ThreadArchiveDialogTarget) => void;
}

export function ThreadArchiveDialog({
  target,
  pending,
  onOpenChange,
  onArchive,
}: ThreadArchiveDialogProps) {
  return (
    <ConfirmDeleteDialog open={target !== null} onOpenChange={onOpenChange}>
      {target ? (
        <ConfirmDeleteDialogContent
          title="Archive active work?"
          description={`${target.workingThreadCount === 1 ? "A thread is" : `${target.workingThreadCount} threads are`} currently working in this thread tree. Archiving may interrupt the active work.`}
          confirmLabel="Archive anyway"
          pending={pending}
          onConfirm={() => onArchive(target)}
          onCancel={() => onOpenChange(false)}
        />
      ) : null}
    </ConfirmDeleteDialog>
  );
}
