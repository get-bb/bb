import { z } from "zod";
import {
  listOpenBackgroundTaskItemRowsForHost,
  type OpenBackgroundTaskItemRow,
} from "@bb/db";
import {
  backgroundTaskItemStatus,
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
 * Server backstop for the daemon-crash case of the background-task lifecycle:
 * the adapter settles open tasks on thread/resume and provider process exit,
 * but a daemon restart loses that in-memory state entirely — leaving persisted
 * items nobody will ever complete. Called when a daemon session re-registers
 * with a new instance id; every open backgroundTask item on the host is
 * settled as interrupted (the CLI processes died with the daemon).
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
        const providerThreadId = row.providerThreadId ?? "";
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
                status: backgroundTaskItemStatus("stopped"),
                taskStatus: "stopped",
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
