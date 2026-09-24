import type { Thread } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";

export interface ThreadArchiveDialogTarget {
  thread: Thread;
  childThreadCount: number;
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
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {target ? (
          <ThreadArchiveDialogContent
            target={target}
            pending={pending}
            onOpenChange={onOpenChange}
            onArchive={onArchive}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

interface ThreadArchiveDialogContentProps {
  target: ThreadArchiveDialogTarget;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onArchive: (target: ThreadArchiveDialogTarget) => void;
}

export function ThreadArchiveDialogContent({
  target,
  pending,
  onOpenChange,
  onArchive,
}: ThreadArchiveDialogContentProps) {
  const { childThreadCount } = target;
  const archivedThreadCount = childThreadCount + 1;
  const active =
    target.thread.status === "starting" ||
    target.thread.status === "active" ||
    target.thread.status === "stopping";
  const sentences = [
    active ? "This will stop current work." : null,
    `${childThreadCount} child ${childThreadCount === 1 ? "thread" : "threads"} will be archived with this thread.`,
    "Archived threads stay available and can be unarchived.",
  ].filter((sentence): sentence is string => sentence !== null);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Archive {archivedThreadCount} threads?</DialogTitle>
        <DialogDescription>{sentences.join(" ")}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button
          type="button"
          disabled={pending}
          onClick={() => onArchive(target)}
        >
          Archive {archivedThreadCount} threads
        </Button>
      </DialogFooter>
    </>
  );
}
