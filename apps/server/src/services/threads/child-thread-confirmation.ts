import { countNonDeletedAssignedChildThreads } from "@bb/db";
import type { Thread } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";

export type ChildThreadsDestructiveAction = "archive" | "delete";

export interface RequireChildThreadsConfirmationRequest {
  action: ChildThreadsDestructiveAction;
  confirmed: boolean;
  deps: AppDeps;
  thread: Thread;
}

function childThreadsConfirmationMessage(
  action: ChildThreadsDestructiveAction,
): string {
  const actionLabel = action === "archive" ? "Archiving" : "Deleting";
  return `${actionLabel} this thread requires confirmation because it has non-deleted child threads.`;
}

export function requireChildThreadsConfirmation({
  action,
  confirmed,
  deps,
  thread,
}: RequireChildThreadsConfirmationRequest): void {
  if (confirmed) {
    return;
  }

  const nonDeletedChildCount = countNonDeletedAssignedChildThreads(
    deps.db,
    {
      parentThreadId: thread.id,
    },
  );
  if (nonDeletedChildCount === 0) {
    return;
  }

  throw new ApiError(
    409,
    "child_threads_confirmation_required",
    childThreadsConfirmationMessage(action),
  );
}
