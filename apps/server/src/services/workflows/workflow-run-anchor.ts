// Anchor-thread projection for thread-anchored workflow runs (plan §7):
// server-authored, thread-scoped `item/backgroundTask/progress|completed`
// rows whose item id IS the wfr_ run id and whose taskType is
// BB_WORKFLOW_TASK_TYPE. The paused/running/completed lifecycle rides the
// existing background-task fold contract — progress rows supersede each
// other, exactly one completed row lands at the true terminal, and
// `settleDanglingBackgroundTasks` skips these items because the workflow
// lifecycle owns them end to end.
//
// Shared low-level helpers for the three writers (event ingestion,
// reconnect/lease reconciliation, command-settle finalize). Deliberately free
// of lifecycle imports so both the lifecycle module and its consumers can use
// it without cycles.

import {
  getThread,
  type DbNotifier,
  type DbTransaction,
  type WorkflowRunRow,
} from "@bb/db";
import { setWorkflowRunPendingManagerNotification } from "@bb/db/internal-lifecycle";
import {
  backgroundTaskItemStatus,
  BB_WORKFLOW_TASK_TYPE,
  threadScope,
  workflowProgressSnapshotSchema,
  type BackgroundTaskStatus,
  type ThreadEventBackgroundTaskItem,
  type WorkflowProgressSnapshot,
} from "@bb/domain";
import { renderTemplate } from "@bb/templates";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { appendThreadEventsInTransaction } from "../threads/thread-events.js";
import { queueManagerSystemMessage } from "../threads/manager-system-messages.js";

interface WorkflowRunAnchorWriteDeps {
  db: DbTransaction;
  hub: DbNotifier;
}

export interface AppendWorkflowRunAnchorEventArgs {
  kind: "completed" | "progress";
  run: WorkflowRunRow;
  taskStatus: BackgroundTaskStatus;
}

export interface AppendedWorkflowRunAnchorEvent {
  sequence: number;
  threadId: string;
}

/**
 * The one tolerant reader of the `progressSnapshot` column. Corrupt JSON is
 * treated exactly like a schema-invalid snapshot — recoverable, never thrown:
 * this parse runs inside daemon-ingress transactions, and the daemon spool
 * posts whole batches and fails closed after repeated non-retryable
 * responses, so one corrupt row throwing here would wedge workflow event
 * delivery for the entire host.
 */
export function parseWorkflowRunProgressSnapshotColumn(
  progressSnapshot: string | null,
): WorkflowProgressSnapshot | undefined {
  if (progressSnapshot === null) {
    return undefined;
  }
  try {
    const parsed = workflowProgressSnapshotSchema.safeParse(
      JSON.parse(progressSnapshot),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function buildWorkflowRunAnchorTaskItem(
  args: Pick<AppendWorkflowRunAnchorEventArgs, "kind" | "run" | "taskStatus">,
): ThreadEventBackgroundTaskItem {
  const { kind, run, taskStatus } = args;
  const workflow = parseWorkflowRunProgressSnapshotColumn(run.progressSnapshot);
  return {
    type: "backgroundTask",
    // The run-page deep link rides the existing id field (plan §7).
    id: run.id,
    taskType: BB_WORKFLOW_TASK_TYPE,
    description: run.workflowName,
    status: backgroundTaskItemStatus(taskStatus),
    taskStatus,
    skipTranscript: false,
    workflowName: run.workflowName,
    ...(workflow !== undefined ? { workflow } : {}),
    // Usage totals exist on the row only once the run settles; progress rows
    // omit usage rather than reporting zeros.
    ...(kind === "completed"
      ? {
          usage: {
            totalTokens: run.usageInputTokens + run.usageOutputTokens,
            toolUses: run.usageToolUses,
            durationMs: run.usageDurationMs,
          },
        }
      : {}),
    ...(taskStatus === "failed" && run.failureReason !== null
      ? { error: run.failureReason }
      : {}),
  };
}

/**
 * Appends one anchor lifecycle row for the run inside the caller's
 * transaction and buffers the thread notification. No-op (returns null) for
 * unanchored runs and for anchor threads that no longer exist or are deleted.
 * Thread-scoped by design: post-launch lifecycle rows never need an active
 * turn, and the projection materializes a message from a bare thread-scoped
 * progress row.
 */
export function appendWorkflowRunAnchorEventInTransaction(
  deps: WorkflowRunAnchorWriteDeps,
  args: AppendWorkflowRunAnchorEventArgs,
): AppendedWorkflowRunAnchorEvent | null {
  if (args.run.anchorThreadId === null) {
    return null;
  }
  const thread = getThread(deps.db, args.run.anchorThreadId);
  if (!thread || thread.deletedAt !== null) {
    return null;
  }

  const type =
    args.kind === "completed"
      ? ("item/backgroundTask/completed" as const)
      : ("item/backgroundTask/progress" as const);
  const [sequence] = appendThreadEventsInTransaction(deps.db, [
    {
      threadId: thread.id,
      environmentId: thread.environmentId,
      // Server-authored row: the COLUMN must stay NULL. An empty string here
      // would become the thread's "latest provider thread id"
      // (`getLastStoredProviderThreadId` filters on IS NOT NULL), making the
      // next manager system message dispatch as a fresh `thread.start`
      // instead of `turn.submit` — wedging every later notification on
      // "still starting". The DATA payload keeps the schema-required "".
      providerThreadId: null,
      type,
      scope: threadScope(),
      data: {
        providerThreadId: "",
        item: buildWorkflowRunAnchorTaskItem(args),
      },
    },
  ]);
  if (sequence === undefined) {
    throw new Error("Expected one appended workflow anchor event sequence");
  }
  deps.hub.notifyThread(thread.id, ["events-appended"], {
    eventTypes: [type],
  });
  return { sequence, threadId: thread.id };
}

/**
 * The "run paused" informational message for interruption (reconciliation
 * bucket (b) and the lease/sweep backstops) — a different message about a
 * different transition than the single terminal notification, so no dedupe
 * machinery is needed. Rendered from @bb/templates like every other manager
 * system message, so it carries the `[bb system]` prefix the manager
 * instructions teach.
 */
export function buildWorkflowRunPausedManagerMessage(
  run: WorkflowRunRow,
): string {
  return renderTemplate("systemMessageWorkflowRunPaused", {
    runId: run.id,
    workflowName: run.workflowName,
    reason: run.failureReason ?? "host daemon unavailable",
  });
}

/** The single terminal notification for a settled run (plan §8 COMPLETION). */
export function buildWorkflowRunSettledManagerMessage(
  run: WorkflowRunRow,
): string {
  const variables = { runId: run.id, workflowName: run.workflowName };
  switch (run.status) {
    case "completed":
      return renderTemplate("systemMessageWorkflowRunCompleted", variables);
    case "failed":
      return renderTemplate("systemMessageWorkflowRunFailed", {
        ...variables,
        failureSuffix:
          run.failureReason !== null ? `: ${run.failureReason}` : "",
      });
    default:
      return renderTemplate("systemMessageWorkflowRunCancelled", variables);
  }
}

export interface QueueWorkflowRunManagerNotificationArgs {
  managerThreadId: string;
  messageText: string;
  runId: string;
}

/**
 * Best-effort manager push (the queueManagedThreadTurnNotificationBestEffort
 * pattern) for TERMINAL settle paths whose trigger proves the run's host is
 * online (daemon-converged terminal events, start-command failure results).
 * queueManagerSystemMessage self-guards: missing, archived, or deleted
 * anchor threads simply skip, so callers may pass any anchor thread id; a
 * manager with a pending interaction also skips the message — accepted
 * best-effort semantics. One skip is NOT dropped: the manager thread's
 * in-flight live `thread.start` RPC is transient, so
 * the wrapper records durable "settled" intent instead and the periodic
 * pending-notification sweep delivers once the start settles. (Recording,
 * not scheduling: this module stays lifecycle-import-free by design, and the
 * 10s sweep owns delivery.) Notifications whose trigger coincides with an
 * unreachable host (interruption, server-side cancel settle) must NOT use
 * this one-shot wrapper — they ride the durable pending-notification sweep
 * end to end (workflow-run-pending-notifications.ts, M6 decision).
 */
export async function queueWorkflowRunManagerNotificationBestEffort(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueueWorkflowRunManagerNotificationArgs,
): Promise<void> {
  try {
    const outcome = await queueManagerSystemMessage(deps, {
      managerThreadId: args.managerThreadId,
      messageText: args.messageText,
    });
    if (outcome === "skipped-pending-command") {
      setWorkflowRunPendingManagerNotification(deps.db, {
        id: args.runId,
        kind: "settled",
      });
      deps.logger.info(
        {
          managerThreadId: args.managerThreadId,
          runId: args.runId,
        },
        "Workflow run manager notification deferred behind a pending manager command",
      );
    }
  } catch (error) {
    deps.logger.error(
      {
        err: error,
        managerThreadId: args.managerThreadId,
        runId: args.runId,
      },
      "Failed to queue workflow run manager notification",
    );
  }
}
