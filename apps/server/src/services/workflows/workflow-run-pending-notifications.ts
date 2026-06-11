// Durable manager-notification delivery for workflow runs (plan §10 M6
// notification polish). Anchored runs record notification intent on the run
// row (`pendingManagerNotification`, set by the lifecycle writers inside the
// transaction that creates the debt) instead of one-shot best-effort pushes:
// every real interruption trigger fires while the manager's host is
// unreachable over the hub socket (reconnect reconciliation runs inside
// /internal/session/open BEFORE the daemon attaches its WS; lease-expiry and
// the backstop sweep fire with no session at all), so an immediate push is
// structurally undeliverable and was silently dropped pre-M6.
//
// The sweep here is the single delivery owner. It is triggered from three
// places — post-interruption / post-cancel-settle (deferred, for promptness
// when the manager's host is online), daemon socket attach (the first moment
// a reconnect-window message becomes deliverable), and the 10s periodic sweep
// (backstop for hosts that return hours later) — and converges them through
// one in-memory in-flight claim per run plus a kind-conditional clear, so a
// notification is queued at most once per recorded intent in normal
// operation. A crash between queueing the manager turn and clearing the
// intent redelivers after restart (at-least-once; accepted, recorded in the
// plan).
//
// The intent is kept (and retried by a later sweep) on exactly the transient
// failure classes: host connectivity (`host_unavailable`, `command_timeout` —
// a degraded-but-open socket in the same reconnect window) and the manager
// thread's in-flight live `thread.start` RPC (dispatching another turn would
// race the start — review finding, recorded in the plan). Permanent guards
// (missing/archived thread, pending interaction) and untyped failures keep
// the pre-M6 best-effort drop.

import {
  getActiveSession,
  getWorkflowRun,
  listWorkflowRunsWithPendingManagerNotification,
  type WorkflowRunRow,
} from "@bb/db";
import { clearWorkflowRunPendingManagerNotification } from "@bb/db/internal-lifecycle";
import {
  isTerminalWorkflowRunStatus,
  type WorkflowRunPendingManagerNotification,
} from "@bb/domain";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { requireThreadEnvironment } from "../lib/entity-lookup.js";
import { queueManagerSystemMessage } from "../threads/manager-system-messages.js";
import {
  buildWorkflowRunPausedManagerMessage,
  buildWorkflowRunSettledManagerMessage,
} from "./workflow-run-anchor.js";

// In-flight delivery claims. All sweep triggers share one event loop, so an
// in-memory set is a sufficient claim against overlapping sweeps (the
// periodic interval is fire-and-forget and may overlap a slow host RPC); the
// durable column carries intent across restarts.
const inFlightRunIds = new Set<string>();

/**
 * Drains every recorded notification intent whose manager host is reachable.
 * Synchronous walk, asynchronous deliveries: each delivery (a manager
 * preferences host RPC + turn queue) runs fire-and-forget under an in-flight
 * claim so a slow host never stalls the periodic sweep chain or a daemon
 * ingress path.
 */
export function runWorkflowRunPendingNotificationSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
): void {
  for (const run of listWorkflowRunsWithPendingManagerNotification(deps.db)) {
    try {
      sweepPendingNotificationForRun(deps, run);
    } catch (error) {
      deps.logger.warn(
        { err: error, runId: run.id },
        "Workflow run pending notification sweep failed for run",
      );
    }
  }
}

/**
 * Defers one sweep pass off the caller's path (route post-commit,
 * reconciliation, daemon socket attach) — manager pushes can wait on host
 * RPCs and must never block their trigger.
 */
export function scheduleWorkflowRunPendingNotificationDelivery(
  deps: LoggedPendingInteractionWorkSessionDeps,
): void {
  setImmediate(() => {
    runWorkflowRunPendingNotificationSweep(deps);
  });
}

function sweepPendingNotificationForRun(
  deps: LoggedPendingInteractionWorkSessionDeps,
  run: WorkflowRunRow,
): void {
  const kind = run.pendingManagerNotification;
  if (kind === null || inFlightRunIds.has(run.id)) {
    return;
  }
  if (run.anchorThreadId === null) {
    // The anchor thread was deleted after the intent was recorded
    // (ON DELETE SET NULL): nobody left to notify.
    clearWorkflowRunPendingManagerNotification(deps.db, { id: run.id, kind });
    return;
  }
  // Status/retention gates (defensive — the lifecycle writers clear stale
  // intent on every transition out of `interrupted`, on terminal settle, and
  // at retention archive): "paused" instructs "resume it" and is only true
  // while the run is still interrupted and live; "settled" announces a
  // terminal outcome; an archived run's anchor item was already settled by
  // the retention sweep, so nothing is owed.
  if (
    run.retention !== "live" ||
    (kind === "paused" && run.status !== "interrupted") ||
    (kind === "settled" && !isTerminalWorkflowRunStatus(run.status))
  ) {
    clearWorkflowRunPendingManagerNotification(deps.db, { id: run.id, kind });
    return;
  }

  const managerThreadId = run.anchorThreadId;
  // Delivery depends on the MANAGER thread's environment host (preferences
  // RPC + turn.submit), which can differ from the run's host on multi-host
  // setups — never gate on run.hostId.
  let managerHostId: string;
  try {
    managerHostId = requireThreadEnvironment(deps.db, managerThreadId)
      .environment.hostId;
  } catch (error) {
    // Thread or environment permanently gone/destroyed: undeliverable.
    clearWorkflowRunPendingManagerNotification(deps.db, { id: run.id, kind });
    deps.logger.warn(
      { err: error, managerThreadId, runId: run.id },
      "Dropped workflow run manager notification for unavailable anchor thread",
    );
    return;
  }
  if (
    !getActiveSession(deps.db, managerHostId) ||
    !deps.hub.hasDaemonForHost(managerHostId)
  ) {
    // Manager host offline OR in the session-open → WS-attach window (the
    // session row is active but the hub socket is not attached yet, so the
    // manager turn's live dispatch would fail) — the exact conditions the
    // durable intent exists for. Skip silently; the host's socket attach (or
    // the periodic sweep) retries.
    return;
  }

  inFlightRunIds.add(run.id);
  void deliverPendingNotification(deps, {
    kind,
    managerThreadId,
    runId: run.id,
  }).finally(() => {
    inFlightRunIds.delete(run.id);
  });
}

interface DeliverPendingNotificationArgs {
  kind: WorkflowRunPendingManagerNotification;
  managerThreadId: string;
  runId: string;
}

/** True when the recorded intent is still the one this delivery claimed. */
function pendingNotificationStillCurrent(
  run: WorkflowRunRow,
  kind: WorkflowRunPendingManagerNotification,
): boolean {
  return (
    run.pendingManagerNotification === kind &&
    run.retention === "live" &&
    (kind === "paused"
      ? run.status === "interrupted"
      : isTerminalWorkflowRunStatus(run.status))
  );
}

async function deliverPendingNotification(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: DeliverPendingNotificationArgs,
): Promise<void> {
  // Re-read immediately before queueing: a cancel settle, revival, or archive
  // landing since the sweep listed this run supersedes the claimed intent —
  // abort without consuming (the next sweep owns whatever replaced it) and
  // build the message from the fresh row. The residual staleness window is
  // the host RPC inside queueManagerSystemMessage (~one round trip; recorded
  // in the plan).
  const run = getWorkflowRun(deps.db, args.runId);
  if (!run || !pendingNotificationStillCurrent(run, args.kind)) {
    return;
  }
  const messageText =
    args.kind === "paused"
      ? buildWorkflowRunPausedManagerMessage(run)
      : buildWorkflowRunSettledManagerMessage(run);

  try {
    const outcome = await queueManagerSystemMessage(deps, {
      managerThreadId: args.managerThreadId,
      messageText,
    });
    if (outcome === "skipped-pending-command") {
      // Transient: the manager thread's live `thread.start` RPC is still in
      // flight, so the turn cannot dispatch yet. Keep the durable intent; a
      // later sweep delivers once the start settles — dropping here would
      // eat the run's terminal notification forever (review finding).
      deps.logger.info(
        {
          kind: args.kind,
          managerThreadId: args.managerThreadId,
          runId: args.runId,
        },
        "Workflow run manager notification deferred behind a pending manager command",
      );
      return;
    }
    // Either queued, or skipped by an accepted permanent best-effort guard
    // (non-manager/archived/deleted thread, pending interaction): the intent
    // is consumed both ways, preserving the pre-M6 best-effort semantics for
    // everything except the transient classes kept above and below.
    clearWorkflowRunPendingManagerNotification(deps.db, {
      id: args.runId,
      kind: args.kind,
    });
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.body.code === "host_unavailable" ||
        error.body.code === "command_timeout")
    ) {
      // The M6 drop class being fixed: the manager host's session exists but
      // its hub socket is not attached (the session-open → WS-attach window),
      // it dropped mid-delivery, or the just-attached socket stalled into the
      // RPC timeout. Keep the durable intent; the socket-attach trigger or
      // the periodic sweep retries.
      deps.logger.info(
        {
          code: error.body.code,
          kind: args.kind,
          managerThreadId: args.managerThreadId,
          runId: args.runId,
        },
        "Workflow run manager notification deferred until the manager host reconnects",
      );
      return;
    }
    // Any other failure keeps the pre-M6 best-effort stance: log and drop
    // rather than retry a non-connectivity failure forever.
    clearWorkflowRunPendingManagerNotification(deps.db, {
      id: args.runId,
      kind: args.kind,
    });
    deps.logger.error(
      {
        err: error,
        kind: args.kind,
        managerThreadId: args.managerThreadId,
        runId: args.runId,
      },
      "Failed to queue workflow run manager notification",
    );
  }
}
