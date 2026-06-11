// Reconnect/disconnect reconciliation for workflow runs (plan §8 DISCONNECT/
// RECONNECT): the four-bucket session-open reconcile, the lease-expiry
// interrupt trigger, and the periodic no-replacement-session backstop sweep.
// Owns the carved-out anchor reconciliation for BB_WORKFLOW_TASK_TYPE items
// (settleDanglingBackgroundTasks skips them): interruption appends the paused
// anchor snapshot — never a completed row — and revival lets the run's next
// spooled progress event fold the anchor back to running.
//
// Disconnect-grace expiry deliberately has NO hook here: runs stay `running`
// through brief disconnects (bb never interrupts on connection loss alone);
// only an unreported run at session re-open (bucket (b)) or a lapsed lease
// with no replacement session interrupts.

import {
  getActiveSession,
  getLatestSessionForHost,
  listWorkflowRunsByHostAndStatuses,
  workflowRuns,
  type DbQueryConnection,
  type WorkflowRunRow,
} from "@bb/db";
import { eq } from "drizzle-orm";
import { setWorkflowRunPendingManagerNotification } from "@bb/db/internal-lifecycle";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import {
  cancelActiveWorkflowRunOperationsInTransaction,
  interruptWorkflowRunsForHostInTransaction,
  requestWorkflowRunCancelForReportedTerminalRun,
  transitionWorkflowRunForRunStartedInTransaction,
  WORKFLOW_RUN_HOST_SESSION_EXPIRED_REASON,
} from "./workflow-run-lifecycle.js";
import { appendWorkflowRunAnchorEventInTransaction } from "./workflow-run-anchor.js";
import { clearWorkflowRunAnchorProgressThrottle } from "./workflow-run-events.js";
import { scheduleWorkflowRunPendingNotificationDelivery } from "./workflow-run-pending-notifications.js";

/** Reconciliation bucket (b)'s interruption reason (the M3 exit-criterion (b) check). */
export const WORKFLOW_RUN_DAEMON_RESTARTED_REASON = "host-daemon-restarted";

export interface ReconcileDaemonReportedWorkflowRunsArgs {
  activeWorkflowRunIds: readonly string[];
  hostId: string;
}

/**
 * The four buckets, mirroring reconcileDaemonReportedThreads. The daemon's
 * report is heartbeat-verified (live runner handle OR fresh run-dir
 * heartbeat), so a reported run is demonstrably alive whether the reconnect
 * is same-instance or not:
 * - (a) `running` + reported → no-op (implicit).
 * - (b) `running` + NOT reported → interrupt with reason
 *   `host-daemon-restarted` + paused anchor row + manager paused message.
 * - (c) `interrupted` + reported → revive to `running` (the transition table
 *   guards revival structurally: terminal statuses can never revive). No
 *   synthetic anchor row — the run's next spooled progress event folds the
 *   anchor item back to running. Revival also cancels any still-active
 *   resume operation: the revived run makes it permanently unreachable, and
 *   a leaked `requested` resume op would
 *   silently auto-resume — and re-bill — on the NEXT interruption,
 *   violating the explicit-resume-only contract (plan §2). Active cancel
 *   operations survive so the user's pending cancel finally delivers.
 * - (d) terminal + reported → queue `workflow.cancel` so the host converges
 *   on the stored truth. Reserved for true terminals, never `interrupted`.
 */
export async function reconcileDaemonReportedWorkflowRuns(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: ReconcileDaemonReportedWorkflowRunsArgs,
): Promise<void> {
  // Bucket (b): running but unreported.
  interruptWorkflowRunsWithAnchors(deps, {
    excludeReportedRunIds: args.activeWorkflowRunIds,
    hostId: args.hostId,
    reason: WORKFLOW_RUN_DAEMON_RESTARTED_REASON,
  });

  // Bucket (c): interrupted but demonstrably alive — revive.
  const revivableRuns = listWorkflowRunsByHostAndStatuses(deps.db, {
    hostId: args.hostId,
    statuses: ["interrupted"],
    runIds: args.activeWorkflowRunIds,
  });
  if (revivableRuns.length > 0) {
    const notificationBuffer = new NotificationBuffer();
    deps.db.transaction(
      (tx) => {
        for (const run of revivableRuns) {
          transitionWorkflowRunForRunStartedInTransaction(
            { db: tx, hub: notificationBuffer },
            { runId: run.id },
          );
        }
        cancelActiveWorkflowRunOperationsInTransaction(tx, {
          runIds: revivableRuns.map((run) => run.id),
          kinds: ["resume"],
        });
      },
      { behavior: "immediate" },
    );
    notificationBuffer.flushInto(deps.hub);
    for (const run of revivableRuns) {
      // Let the next spooled progress batch flip the anchor item back to
      // running immediately instead of waiting out the fold throttle.
      clearWorkflowRunAnchorProgressThrottle(run.id);
    }
  }

  // Bucket (d): server truth is terminal, daemon still reports the run live.
  const staleTerminalRuns = listWorkflowRunsByHostAndStatuses(deps.db, {
    hostId: args.hostId,
    statuses: ["completed", "failed", "cancelled"],
    runIds: args.activeWorkflowRunIds,
  });
  for (const run of staleTerminalRuns) {
    try {
      await requestWorkflowRunCancelForReportedTerminalRun(deps, {
        runId: run.id,
      });
    } catch (error) {
      deps.logger.warn(
        { err: error, runId: run.id, hostId: args.hostId },
        "Failed to queue workflow.cancel for daemon-reported terminal run",
      );
    }
  }
}

export interface InterruptAbandonedWorkflowRunsArgs {
  hostId: string;
  reason: string;
}

/**
 * The lease-expiry trigger and sweep-backstop entry point: interrupts every
 * `running` run on the host (no daemon report exists in these contexts), with
 * the full anchor/notification contract applied.
 */
export function interruptAbandonedWorkflowRuns(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: InterruptAbandonedWorkflowRunsArgs,
): WorkflowRunRow[] {
  return interruptWorkflowRunsWithAnchors(deps, {
    excludeReportedRunIds: [],
    hostId: args.hostId,
    reason: args.reason,
  });
}

interface InterruptWorkflowRunsWithAnchorsArgs {
  excludeReportedRunIds: readonly string[];
  hostId: string;
  reason: string;
}

/**
 * The full interruption job around the lifecycle module's
 * `interruptWorkflowRunsForHostInTransaction` primitive: one immediate
 * transaction for status + operation/command cancellation + the paused anchor
 * snapshot (never a completed row — the anchor item stays open/resumable) +
 * the durable "paused" manager-notification intent for anchored runs. The
 * message itself is delivered by the pending-notification sweep (deferred
 * here for promptness, retried on daemon socket attach and the periodic
 * sweep): every real interruption trigger fires while the manager's host is
 * unreachable over the hub socket, so an immediate push would always drop.
 */
function interruptWorkflowRunsWithAnchors(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: InterruptWorkflowRunsWithAnchorsArgs,
): WorkflowRunRow[] {
  const notificationBuffer = new NotificationBuffer();
  const interrupted = deps.db.transaction(
    (tx) => {
      const runs = interruptWorkflowRunsForHostInTransaction(
        { db: tx, hub: notificationBuffer },
        {
          excludeReportedRunIds: args.excludeReportedRunIds,
          hostId: args.hostId,
          reason: args.reason,
        },
      );
      for (const run of runs) {
        appendWorkflowRunAnchorEventInTransaction(
          { db: tx, hub: notificationBuffer },
          { kind: "progress", run, taskStatus: "paused" },
        );
        if (run.anchorThreadId !== null) {
          setWorkflowRunPendingManagerNotification(tx, {
            id: run.id,
            kind: "paused",
          });
        }
      }
      return runs;
    },
    { behavior: "immediate" },
  );
  notificationBuffer.flushInto(deps.hub);

  for (const run of interrupted) {
    clearWorkflowRunAnchorProgressThrottle(run.id);
  }
  if (interrupted.some((run) => run.anchorThreadId !== null)) {
    scheduleWorkflowRunPendingNotificationDelivery(deps);
  }
  return interrupted;
}

function listHostIdsWithRunningWorkflowRuns(db: DbQueryConnection): string[] {
  return db
    .selectDistinct({ hostId: workflowRuns.hostId })
    .from(workflowRuns)
    .where(eq(workflowRuns.status, "running"))
    .all()
    .map((row) => row.hostId);
}

/**
 * The periodic no-replacement-session interruption backstop (registered in
 * runPeriodicSweeps beside the workflow operation sweep): hosts with
 * `running` runs whose latest daemon session lapsed past its lease window
 * (covering leases that expired while the server was down) get their runs
 * interrupted, so lost runs never dangle as `running` forever. Brief
 * disconnects within the lease window are never touched — bb does not
 * interrupt on connection loss alone.
 */
export function runWorkflowRunInterruptionBackstopSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
): void {
  const now = Date.now();
  for (const hostId of listHostIdsWithRunningWorkflowRuns(deps.db)) {
    try {
      if (getActiveSession(deps.db, hostId)) {
        continue;
      }
      const latestSession = getLatestSessionForHost(deps.db, { hostId });
      if (!latestSession || latestSession.leaseExpiresAt > now) {
        // Within the lease window (or no session has ever existed): not
        // demonstrably gone — leave the runs running.
        continue;
      }
      interruptAbandonedWorkflowRuns(deps, {
        hostId,
        reason: WORKFLOW_RUN_HOST_SESSION_EXPIRED_REASON,
      });
    } catch (error) {
      deps.logger.warn(
        { err: error, hostId },
        "Workflow run interruption backstop sweep failed",
      );
    }
  }
}
