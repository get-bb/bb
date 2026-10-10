import { useRef } from "react";
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
  workspaceRemovalDelayMs: number | null;
}

const WORKSPACE_REMOVAL_DELAY_UNITS = [
  { label: "day", ms: 86_400_000 },
  { label: "hour", ms: 3_600_000 },
  { label: "minute", ms: 60_000 },
  { label: "second", ms: 1_000 },
] as const;

function formatWorkspaceRemovalSentence(delayMs: number): string {
  const unit = WORKSPACE_REMOVAL_DELAY_UNITS.find(
    (candidate) => delayMs >= candidate.ms,
  );
  if (unit === undefined) return "Its workspace is removed after archiving.";
  const count = Math.round(delayMs / unit.ms);
  return `Its workspace is removed ${count} ${unit.label}${count === 1 ? "" : "s"} after archiving.`;
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
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current
            ?.querySelector<HTMLButtonElement>('button[type="submit"]')
            ?.focus();
        }}
      >
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
  const { childThreadCount, workspaceRemovalDelayMs } = target;
  const archivedThreadCount = childThreadCount + 1;
  const active =
    target.thread.status === "starting" ||
    target.thread.status === "active" ||
    target.thread.status === "stopping";
  const sentences = [
    active ? "This will stop current work." : null,
    `${childThreadCount} child ${childThreadCount === 1 ? "thread" : "threads"} will be archived with this thread.`,
    "Archived threads stay available and can be unarchived.",
    workspaceRemovalDelayMs === null
      ? null
      : formatWorkspaceRemovalSentence(workspaceRemovalDelayMs),
  ].filter((sentence): sentence is string => sentence !== null);

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending) {
          onArchive(target);
        }
      }}
    >
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
        <Button type="submit" disabled={pending}>
          Archive {archivedThreadCount} threads
        </Button>
      </DialogFooter>
    </form>
  );
}
