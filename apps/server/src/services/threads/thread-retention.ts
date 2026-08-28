import {
  cancelThreadRetention,
  clearArchivedConversationDeletion,
  deleteThread,
  getThread,
  getThreadRetentionSchedule,
  listDueArchivedConversationDeletions,
  unarchiveThread,
  type ThreadRetentionSchedule,
} from "@bb/db";
import type { Thread } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { DEFAULT_THREAD_RETENTION_SWEEP_BATCH_SIZE } from "../../constants.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { emitPluginThreadDeleted } from "../plugins/plugin-thread-events.js";

interface RunArchivedConversationRetentionSweepArgs {
  limit?: number;
  now: number;
}

interface ArchivedConversationDeletionResult {
  deletedThread: Thread | null;
}

function retentionScheduleMatches(
  current: ThreadRetentionSchedule | null,
  expected: ThreadRetentionSchedule,
): boolean {
  if (!current) {
    return false;
  }
  return (
    current.archivedAt === expected.archivedAt &&
    current.conversationDeleteDueAt === expected.conversationDeleteDueAt
  );
}

export function unarchiveThreadAndCancelRetention(
  deps: Pick<AppDeps, "db" | "hub">,
  threadId: string,
): Thread | null {
  const notificationBuffer = new NotificationBuffer();
  const thread = deps.db.transaction(
    (tx) => {
      const unarchived = unarchiveThread(tx, notificationBuffer, threadId);
      if (unarchived) {
        cancelThreadRetention(tx, threadId);
      }
      return unarchived;
    },
    { behavior: "immediate" },
  );
  notificationBuffer.flushInto(deps.hub);
  return thread;
}

function deleteDueArchivedConversation(
  deps: Pick<AppDeps, "db" | "hub">,
  schedule: ThreadRetentionSchedule,
  now: number,
): ArchivedConversationDeletionResult {
  const notificationBuffer = new NotificationBuffer();
  const result = deps.db.transaction(
    (tx): ArchivedConversationDeletionResult => {
      const currentSchedule = getThreadRetentionSchedule(tx, schedule.threadId);
      if (!retentionScheduleMatches(currentSchedule, schedule)) {
        return { deletedThread: null };
      }

      const thread = getThread(tx, schedule.threadId);
      if (!thread) {
        clearArchivedConversationDeletion(tx, {
          archivedAt: schedule.archivedAt,
          conversationDeleteDueAt: schedule.conversationDeleteDueAt,
          threadId: schedule.threadId,
        });
        return { deletedThread: null };
      }

      if (
        thread.archivedAt === null ||
        thread.archivedAt !== schedule.archivedAt
      ) {
        cancelThreadRetention(tx, thread.id);
        return { deletedThread: null };
      }

      if (thread.deletedAt !== null) {
        clearArchivedConversationDeletion(tx, {
          archivedAt: schedule.archivedAt,
          conversationDeleteDueAt: schedule.conversationDeleteDueAt,
          threadId: schedule.threadId,
        });
        return { deletedThread: null };
      }

      const deletedThread: Thread = {
        ...thread,
        deletedAt: now,
        updatedAt: now,
      };
      deleteThread(tx, notificationBuffer, thread.id);
      clearArchivedConversationDeletion(tx, {
        archivedAt: schedule.archivedAt,
        conversationDeleteDueAt: schedule.conversationDeleteDueAt,
        threadId: schedule.threadId,
      });
      return { deletedThread };
    },
    { behavior: "immediate" },
  );
  notificationBuffer.flushInto(deps.hub);
  if (result.deletedThread) {
    emitPluginThreadDeleted(result.deletedThread);
  }
  return result;
}

export async function runArchivedConversationRetentionSweep(
  deps: Pick<AppDeps, "db" | "hub" | "logger">,
  args: RunArchivedConversationRetentionSweepArgs,
): Promise<void> {
  const schedules = listDueArchivedConversationDeletions(deps.db, {
    limit: args.limit ?? DEFAULT_THREAD_RETENTION_SWEEP_BATCH_SIZE,
    now: args.now,
  });
  for (const schedule of schedules) {
    deleteDueArchivedConversation(deps, schedule, args.now);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
