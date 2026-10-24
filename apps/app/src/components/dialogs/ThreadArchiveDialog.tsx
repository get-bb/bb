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
import { formatChildThreadCount } from "@/lib/child-thread-copy";

export interface ThreadArchiveDialogTarget {
  threads: readonly Thread[];
  childThreadCount: number;
}

interface ThreadArchiveDialogProps<Target extends ThreadArchiveDialogTarget> {
  target: Target | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onArchive: (target: Target) => void;
}

export function ThreadArchiveDialog<Target extends ThreadArchiveDialogTarget>({
  target,
  pending,
  onOpenChange,
  onArchive,
}: ThreadArchiveDialogProps<Target>) {
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

interface ThreadArchiveDialogContentProps<
  Target extends ThreadArchiveDialogTarget,
> {
  target: Target;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onArchive: (target: Target) => void;
}

export function ThreadArchiveDialogContent<
  Target extends ThreadArchiveDialogTarget,
>({
  target,
  pending,
  onOpenChange,
  onArchive,
}: ThreadArchiveDialogContentProps<Target>) {
  const { childThreadCount, threads } = target;
  const single = threads.length === 1;
  const active = threads.some(
    (thread) =>
      thread.status === "starting" ||
      thread.status === "active" ||
      thread.status === "stopping",
  );

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
        <DialogTitle>
          {single ? "Archive thread?" : `Archive ${threads.length} threads?`}
        </DialogTitle>
        <DialogDescription>
          {active ? "This will stop current work. " : null}
          {single ? "Its" : "Their"}{" "}
          <span className="font-semibold">
            {formatChildThreadCount(childThreadCount)}
          </span>{" "}
          will be archived too. Archived threads stay available and can be
          unarchived.
        </DialogDescription>
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
          Archive
        </Button>
      </DialogFooter>
    </form>
  );
}
