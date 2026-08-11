import { useMemo } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { useRestoreThreadRewindBranch } from "@/hooks/mutations/thread-runtime-mutations";
import { useThreadRewindBranchHistory } from "@/hooks/queries/thread-queries";

export interface ThreadRewindRecoveryBannerProps {
  threadId: string;
}

/**
 * Branch recovery banner for threads that have been rewound. It renders only
 * when branch history exists beyond the current branch (i.e. an earlier
 * conversation branch can be restored), and it never exposes provider session
 * ids or checkpoint anchors — the branch list from the server is already
 * stripped of those.
 */
export function ThreadRewindRecoveryBanner({
  threadId,
}: ThreadRewindRecoveryBannerProps) {
  const branchesQuery = useThreadRewindBranchHistory(threadId);
  const restore = useRestoreThreadRewindBranch();
  const history = branchesQuery.data;

  const restoreTarget = useMemo(() => {
    if (!history || history.branches.length === 0) {
      return null;
    }
    const active = history.branches.find(
      (branch) => branch.id === history.activeBranchId,
    );
    if (active === undefined) {
      return null;
    }
    // Restoring the active branch onto itself is a no-op; the banner only
    // offers a target when a different, restorable branch exists.
    const target = history.branches.find(
      (branch) =>
        branch.id !== active.id &&
        branch.lifecycle !== "abandoned" &&
        branch.cleanupStatus !== "pending",
    );
    return target ?? null;
  }, [history]);

  if (
    branchesQuery.isLoading ||
    branchesQuery.isError ||
    restoreTarget === null
  ) {
    return null;
  }

  const handleRestore = () => {
    if (history === undefined || restoreTarget === null) {
      return;
    }
    restore.mutate({
      branchId: restoreTarget.id,
      expectedActiveBranchId: history.activeBranchId ?? restoreTarget.id,
      threadId,
    });
  };

  const branchLabel =
    restoreTarget.creationReason === "rewind"
      ? "before the last rewind"
      : "the previous conversation branch";

  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs",
      )}
      data-testid="thread-rewind-banner"
    >
      <Icon
        name="ArrowTurnBackward"
        className="size-3.5 shrink-0 text-timeline-accent"
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        This conversation was rewound. Restore {branchLabel} to recover the
        earlier thread state.
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={restore.isPending}
        onClick={handleRestore}
      >
        <Icon name="GitBranch" className="size-3.5" aria-hidden />
        {restore.isPending ? "Restoring…" : "Restore previous branch"}
      </Button>
    </div>
  );
}
