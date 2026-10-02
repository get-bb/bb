import { useRef } from "react";
import type { Thread } from "@bb/domain";
import type { ThreadChildSummaryResponse } from "@bb/server-contract";
import { RouteAnchor } from "@/components/ui/app-route-anchor";
import { getThreadRoutePath } from "@/lib/route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";
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
  archiveThreads: ThreadChildSummaryResponse["archiveThreads"];
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
  const { archiveThreads } = target;
  const archivedThreadCount = archiveThreads.length;
  const childThreadCount = archiveThreads.filter(
    (thread) => thread.id !== target.thread.id,
  ).length;
  const active = archiveThreads.some(
    (thread) =>
      thread.status === "starting" ||
      thread.status === "active" ||
      thread.status === "stopping",
  );
  const sentences = [
    active ? "This will stop current work." : null,
    `${childThreadCount} related ${childThreadCount === 1 ? "thread" : "threads"} will be archived with this thread.`,
    "Archived threads stay available and can be unarchived.",
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
      <ul
        aria-label="Threads to archive"
        className="max-h-72 space-y-3 overflow-y-auto"
      >
        {archiveThreads.map((thread) => (
          <li key={thread.id} className="grid gap-1">
            <RouteAnchor
              href={getThreadRoutePath({
                projectId: thread.projectId,
                threadId: thread.id,
              })}
              className="break-words text-sm font-medium underline underline-offset-4"
              onClick={() => onOpenChange(false)}
            >
              {getThreadDisplayTitle(thread)}
            </RouteAnchor>
            <span className="text-xs text-muted-foreground">
              {thread.status}
              {thread.visibility === "hidden" ? " · Hidden" : ""}
              {" · Created "}
              <time dateTime={new Date(thread.createdAt).toISOString()}>
                {new Date(thread.createdAt).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
            </span>
          </li>
        ))}
      </ul>
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
