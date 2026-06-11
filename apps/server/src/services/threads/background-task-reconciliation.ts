import { z } from "zod";
import {
  listOpenBackgroundTaskItemRowsForHost,
  type OpenBackgroundTaskItemRow,
} from "@bb/db";
import {
  backgroundTaskItemStatus,
  BB_WORKFLOW_TASK_TYPE,
  isSettledBackgroundTaskStatus,
  threadEventBackgroundTaskItemSchema,
  threadScope,
} from "@bb/domain";
import type { ThreadEventBackgroundTaskItem } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { appendThreadEventsInTransaction } from "./thread-events.js";

export interface SettleDanglingBackgroundTasksArgs {
  hostId: string;
}

type SettleDanglingBackgroundTasksDeps = Pick<AppDeps, "db" | "hub" | "logger">;

const storedBackgroundTaskEventDataSchema = z.object({
  item: threadEventBackgroundTaskItemSchema,
});

function parseStoredBackgroundTaskItem(
  row: OpenBackgroundTaskItemRow,
): ThreadEventBackgroundTaskItem | null {
  try {
    const parsed = storedBackgroundTaskEventDataSchema.safeParse(
      JSON.parse(row.data),
    );
    return parsed.success ? parsed.data.item : null;
  } catch {
    return null;
  }
}

/**
 * Server backstop for the lost-daemon cases of the background-task lifecycle:
 * the adapter settles open tasks on thread/resume and provider process exit,
 * but a daemon crash loses that in-memory state entirely — leaving persisted
 * items nobody will ever complete. Called when a daemon session re-registers
 * with a new instance id, when a host's session lease expires with no active
 * replacement, and when the disconnect grace elapses without a reconnect.
 * Open items whose latest snapshot already reports a finished task status
 * (completed/failed/killed) keep it — only the terminal notification was
 * lost, not the outcome — while genuinely open items are settled as
 * interrupted ("stopped"). Idempotent: items with a completed row are not
 * open, so repeated triggers (grace + lease expiry + re-register) no-op.
 */
export function settleDanglingBackgroundTasks(
  deps: SettleDanglingBackgroundTasksDeps,
  args: SettleDanglingBackgroundTasksArgs,
): void {
  const rows = listOpenBackgroundTaskItemRowsForHost(deps.db, {
    hostId: args.hostId,
  });
  if (rows.length === 0) {
    return;
  }

  const settledThreadIds = new Set<string>();
  deps.db.transaction(
    (tx) => {
      for (const row of rows) {
        const item = parseStoredBackgroundTaskItem(row);
        if (!item) {
          deps.logger.warn(
            { itemId: row.itemId, threadId: row.threadId },
            "Skipping dangling background task with unparsable item payload",
          );
          continue;
        }
        if (item.taskType === BB_WORKFLOW_TASK_TYPE) {
          // bb workflow anchor items are owned end-to-end by the server
          // workflow lifecycle (a paused item is resumable and a completed
          // row is terminal forever): interruption pauses them via
          // workflow-run-reconciliation, and only the run's true terminal —
          // or the retention sweep archiving an abandoned run — settles them.
          continue;
        }
        const providerThreadId = row.providerThreadId ?? "";
        const taskStatus = isSettledBackgroundTaskStatus(item.taskStatus)
          ? item.taskStatus
          : "stopped";
        appendThreadEventsInTransaction(tx, [
          {
            threadId: row.threadId,
            environmentId: row.environmentId,
            providerThreadId,
            type: "item/backgroundTask/completed",
            scope: threadScope(),
            data: {
              providerThreadId,
              item: {
                ...item,
                status: backgroundTaskItemStatus(taskStatus),
                taskStatus,
              },
            },
          },
        ]);
        settledThreadIds.add(row.threadId);
      }
    },
    { behavior: "immediate" },
  );

  for (const threadId of settledThreadIds) {
    deps.hub.notifyThread(threadId, ["events-appended"], {
      eventTypes: ["item/backgroundTask/completed"],
    });
  }
}
