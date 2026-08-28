import {
  cancelThreadRetention,
  clearArchivedConversationDeletion,
  completeThreadResourceCleanup,
  deleteThread,
  getEnvironment,
  getThread,
  getThreadRetentionSchedule,
  listDueArchivedConversationDeletions,
  listDueThreadResourceCleanups,
  scheduleImmediateThreadResourceCleanup,
  unarchiveThread,
  type DbQueryConnection,
  type ThreadRetentionSchedule,
} from "@bb/db";
import type { Thread } from "@bb/domain";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../../types.js";
import {
  COMMAND_TIMEOUT_MS,
  DEFAULT_THREAD_RETENTION_SWEEP_BATCH_SIZE,
} from "../../constants.js";
import { runLiveHostCommand } from "../hosts/live-command.js";
import {
  isCommandTimeoutError,
  isHostUnavailableError,
  runtimeErrorLogFields,
} from "../lib/error-log-fields.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { emitPluginThreadDeleted } from "../plugins/plugin-thread-events.js";

interface ScheduleImmediateThreadStorageCleanupArgs {
  now?: number;
  thread: Pick<Thread, "environmentId" | "id">;
}

interface RunThreadRetentionSweepArgs {
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
    current.conversationDeleteDueAt === expected.conversationDeleteDueAt &&
    current.resourceCleanupDueAt === expected.resourceCleanupDueAt
  );
}

export function scheduleImmediateThreadStorageCleanup(
  db: DbQueryConnection,
  args: ScheduleImmediateThreadStorageCleanupArgs,
): ThreadRetentionSchedule | null {
  const existing = getThreadRetentionSchedule(db, args.thread.id);
  const environment = args.thread.environmentId
    ? getEnvironment(db, args.thread.environmentId)
    : null;
  return scheduleImmediateThreadResourceCleanup(db, {
    hostId: existing?.hostId ?? environment?.hostId ?? null,
    now: args.now ?? Date.now(),
    threadId: args.thread.id,
  });
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
  if (schedule.conversationDeleteDueAt === null) {
    return { deletedThread: null };
  }
  const conversationDeleteDueAt = schedule.conversationDeleteDueAt;
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
          conversationDeleteDueAt,
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
          conversationDeleteDueAt,
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
        conversationDeleteDueAt,
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
  args: RunThreadRetentionSweepArgs,
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

export async function runThreadResourceCleanupSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: RunThreadRetentionSweepArgs,
): Promise<void> {
  const schedules = listDueThreadResourceCleanups(deps.db, {
    limit: args.limit ?? DEFAULT_THREAD_RETENTION_SWEEP_BATCH_SIZE,
    now: args.now,
  });
  for (const schedule of schedules) {
    if (!schedule.hostId || schedule.resourceCleanupDueAt === null) {
      continue;
    }
    if (!deps.hub.hasDaemonForHost(schedule.hostId)) {
      continue;
    }

    try {
      await runLiveHostCommand(deps, {
        command: {
          type: "thread.storage.delete",
          threadId: schedule.threadId,
        },
        hostId: schedule.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
      });
      completeThreadResourceCleanup(deps.db, {
        archivedAt: schedule.archivedAt,
        resourceCleanupDueAt: schedule.resourceCleanupDueAt,
        threadId: schedule.threadId,
      });
    } catch (error) {
      const fields = {
        hostId: schedule.hostId,
        threadId: schedule.threadId,
        ...runtimeErrorLogFields(deps.config, error),
      };
      if (isHostUnavailableError(error) || isCommandTimeoutError(error)) {
        deps.logger.debug(
          fields,
          "Thread storage cleanup deferred until a later sweep",
        );
      } else {
        deps.logger.warn(fields, "Thread storage cleanup failed");
      }
    }
  }
}
