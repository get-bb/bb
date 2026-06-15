import type {
  ThreadTimelinePendingTodos,
  ThreadTimelinePendingTodoItem,
  ThreadTimelinePendingTodoItemStatus,
} from "@bb/domain";
import type { BbSdk } from "@bb/sdk";

export interface FetchThreadPendingTodosArgs {
  sdk: Pick<BbSdk, "threads">;
  threadId: string;
}

/**
 * Best-effort fetch — returns null if the timeline feed endpoint is
 * unreachable or fails. Pending TODOs are a context surface, not a primary
 * signal, so a failure here should not break the wrapping command.
 *
 * Uses `summaryOnly=true` so the response omits timeline rows; the CLI only
 * consumes `pendingTodos`, not the full timeline.
 */
export async function fetchThreadPendingTodos(
  args: FetchThreadPendingTodosArgs,
): Promise<ThreadTimelinePendingTodos | null> {
  try {
    const response = await args.sdk.threads.timelineFeed({
      threadId: args.threadId,
      summaryOnly: "true",
    });
    return response.pendingTodos;
  } catch {
    return null;
  }
}

const STATUS_BULLET: Record<ThreadTimelinePendingTodoItemStatus, string> = {
  in_progress: "[>]",
  pending: "[ ]",
  completed: "[x]",
};

const STATUS_RANK: Record<ThreadTimelinePendingTodoItemStatus, number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
};

interface TodoCounts {
  active: number;
  completed: number;
  total: number;
}

function countTodos(
  items: readonly ThreadTimelinePendingTodoItem[],
): TodoCounts {
  let active = 0;
  let completed = 0;
  for (const item of items) {
    if (item.status === "completed") completed += 1;
    else active += 1;
  }
  return { active, completed, total: items.length };
}

/**
 * Prints the pending-TODOs section to stdout. The projection only emits a
 * snapshot during an active turn; once items exist we keep the section
 * visible (showing `M/M done` if every item is completed) until the turn
 * ends — matches the banner UI behavior.
 */
export function printPendingTodos(
  pendingTodos: ThreadTimelinePendingTodos | null,
): void {
  if (!pendingTodos || pendingTodos.items.length === 0) return;
  const counts = countTodos(pendingTodos.items);

  console.log("");
  const heading =
    counts.completed === 0
      ? `TODOs (${counts.total}):`
      : `TODOs (${counts.completed}/${counts.total} done):`;
  console.log(heading);
  const ordered = [...pendingTodos.items].sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status],
  );
  for (const item of ordered) {
    console.log(`  ${STATUS_BULLET[item.status]} ${item.text}`);
  }
}
