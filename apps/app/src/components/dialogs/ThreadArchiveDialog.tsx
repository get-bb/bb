import type {
  ThreadArchiveWorktree,
  ThreadArchiveQuery,
} from "@bb/server-contract";
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
  worktrees?: ThreadArchiveWorktree[];
}

interface ThreadArchiveDialogProps {
  target: ThreadArchiveDialogTarget | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onArchive: (
    target: ThreadArchiveDialogTarget,
    worktree?: ThreadArchiveQuery["worktree"],
  ) => void;
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
  onArchive: (
    target: ThreadArchiveDialogTarget,
    worktree?: ThreadArchiveQuery["worktree"],
  ) => void;
}

export function ThreadArchiveDialogContent({
  target,
  pending,
  onOpenChange,
  onArchive,
}: ThreadArchiveDialogContentProps) {
  const { childThreadCount, worktrees = [] } = target;
  const unknownCount = worktrees.filter(
    (item) => item.state === "unavailable",
  ).length;
  const hasUnknown = unknownCount > 0;
  const hasWorktreeWarning = worktrees.length > 0;
  const active =
    target.thread.status === "starting" ||
    target.thread.status === "active" ||
    target.thread.status === "stopping";

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending) {
          onArchive(target, hasWorktreeWarning ? "keep" : "auto");
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Archive thread?</DialogTitle>
        <DialogDescription>
          {active ? "This will stop current work. " : null}
          {childThreadCount > 0 ? (
            <>
              The{" "}
              <span className="font-semibold">
                {childThreadCount === 1
                  ? "thread"
                  : `${childThreadCount} threads`}
              </span>{" "}
              under it will be archived too.{" "}
            </>
          ) : null}
          Archived threads stay available and can be unarchived.
        </DialogDescription>
      </DialogHeader>
      {hasWorktreeWarning ? (
        <div className="grid gap-2">
          <p className="text-sm">
            {hasUnknown
              ? unknownCount === 1
                ? "bb couldn't check this worktree for unsaved changes, so it will be kept."
                : `bb couldn't check ${unknownCount} worktrees for unsaved changes, so they will be kept.`
              : worktrees.length === 1
                ? "Archiving clears this thread's worktree, and it has changes that aren't committed or pushed. Keep the worktree, or ask the agent to commit and push first."
                : `${worktrees.length} worktrees in these threads have changes that aren't committed or pushed. Keep them, or ask the agents to commit and push first.`}
          </p>
          {worktrees.map((worktree) => (
            <p
              key={worktree.environmentId}
              className="break-all text-sm text-muted-foreground"
            >
              {worktree.path ?? worktree.environmentId}
            </p>
          ))}
        </div>
      ) : null}
      <DialogFooter className={hasWorktreeWarning ? "sm:flex-wrap" : undefined}>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        {hasWorktreeWarning && !hasUnknown ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onArchive(target, "commit-and-push")}
          >
            Commit and push first
          </Button>
        ) : null}
        <Button type="submit" disabled={pending}>
          {hasWorktreeWarning ? "Keep worktree and archive" : "Archive"}
        </Button>
      </DialogFooter>
    </form>
  );
}
