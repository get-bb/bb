// Workflow run retention (plan §8 RETENTION): journal payloads are exempt
// from the thread-event 7d/32KB output truncation structurally (they live in
// workflow_run_events, a separate table the truncation sweep never scans).
// This sweep is the only path that destroys them: after the retention window
// it flips `retention` to `archived`, prunes the journal-entry payloads
// (resultText/structured), and — for abandoned `interrupted` runs — settles
// the anchor item as "stopped", the lifecycle module's one sanctioned settle
// for a run that will never resume. Archived runs keep status, snapshot,
// result, and usage forever; they lose per-agent timelines and resumability
// (the resume gate and the journal route refuse archived runs). The
// companion run-dir prune sweep below then deletes the daemon-side run dir
// (per-agent event logs included) once the run's host is reachable.

import {
  listArchivableWorkflowRuns,
  listConnectedHostIds,
  listWorkflowRunsAwaitingRunDirPrune,
  type WorkflowRunRow,
} from "@bb/db";
import {
  archiveWorkflowRunInTransaction,
  clearWorkflowRunPendingManagerNotification,
  markWorkflowRunRunDirPruned,
  pruneWorkflowRunJournalEventPayloadsInTransaction,
} from "@bb/db/internal-lifecycle";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { appendWorkflowRunAnchorEventInTransaction } from "./workflow-run-anchor.js";
import { cancelActiveWorkflowRunOperationsInTransaction } from "./workflow-run-lifecycle.js";

/** Terminal/abandoned runs archive after this window (plan default: 30 days). */
export const WORKFLOW_RUN_ARCHIVE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

const WORKFLOW_RUN_ARCHIVE_SWEEP_BATCH_SIZE = 50;

/** Per-host, per-pass bound on run-dir prune RPCs. */
const WORKFLOW_RUN_DIR_PRUNE_SWEEP_BATCH_SIZE = 25;

/**
 * Bounded periodic archive sweep. Each run archives in its own immediate
 * transaction so one failure cannot wedge the batch:
 * - terminal runs settled past the window: retention flip + journal prune
 *   (their anchor completed row landed at finalize — no anchor work);
 * - `interrupted` runs untouched past the window (abandoned): additionally
 *   settle the open anchor item as "stopped" — by construction no completed
 *   row exists for an interrupted run, since finalize is the only other
 *   completed-row writer and it always makes the run terminal.
 *
 * Every archived run gets its still-active operations cancelled — the final
 * backstop for operation rows leaked by any path that made them unreachable
 * without settling them.
 */
export function runWorkflowRunRetentionSweep(
  deps: LoggedWorkSessionDeps,
): void {
  const archiveBefore = Date.now() - WORKFLOW_RUN_ARCHIVE_AFTER_MS;
  const archivableRuns = listArchivableWorkflowRuns(deps.db, {
    archiveBefore,
    limit: WORKFLOW_RUN_ARCHIVE_SWEEP_BATCH_SIZE,
  });

  for (const run of archivableRuns) {
    try {
      archiveWorkflowRun(deps, run);
    } catch (error) {
      deps.logger.warn(
        { err: error, runId: run.id },
        "Workflow run retention sweep failed to archive run",
      );
    }
  }
}

/**
 * The daemon half of archiving (plan §8/M7): delete archived runs' run dirs
 * (per-agent event logs, worktree checkouts, journal hot cache) via the
 * `workflow.prune` online RPC. The retention sweep is the lifecycle owner;
 * `workflow_runs.runDirPrunedAt` is the durable marker it converges on:
 * - lost results / offline hosts: the marker stays null and a later pass
 *   re-sends — the daemon prune is idempotent (missing dir = pruned);
 * - refused prunes (`pruned: false` — the daemon still holds a live handle
 *   or fresh heartbeat for the run): marker stays null, retried later;
 * - repeated requests: harmless by idempotency, and the marker stops them;
 * - destroyed/offline hosts never starve a batch: work is listed per
 *   CONNECTED host only (their run dirs are unreachable anyway);
 * - a connected-but-unresponsive host cannot stall the sweep for the whole
 *   batch: the first connectivity-class failure (`host_unavailable` /
 *   `command_timeout`) abandons that host's remaining batch for this pass —
 *   the rest would fail identically, and the next pass retries — bounding a
 *   stalled host's wall-clock cost to one RPC timeout per pass.
 * Preserved dirty-worktree branches survive pruning — they live in the
 * project repo's refs (`wf/<runId>-…`), not the run dir.
 */
export async function runWorkflowRunDirPruneSweep(
  deps: LoggedWorkSessionDeps,
): Promise<void> {
  for (const hostId of listConnectedHostIds(deps.db)) {
    const runs = listWorkflowRunsAwaitingRunDirPrune(deps.db, {
      hostId,
      limit: WORKFLOW_RUN_DIR_PRUNE_SWEEP_BATCH_SIZE,
    });
    for (const run of runs) {
      try {
        const result = await callHostOnlineRpc(deps, {
          hostId,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command: { type: "workflow.prune", runId: run.id },
        });
        if (result.pruned) {
          markWorkflowRunRunDirPruned(deps.db, { id: run.id });
        } else {
          deps.logger.warn(
            { runId: run.id, hostId },
            "Workflow run dir prune refused (run still live on host); will retry",
          );
        }
      } catch (error) {
        deps.logger.warn(
          { err: error, runId: run.id, hostId },
          "Workflow run dir prune failed; will retry",
        );
        if (
          error instanceof ApiError &&
          (error.body.code === "host_unavailable" ||
            error.body.code === "command_timeout")
        ) {
          // Connectivity-class failure: the host's socket is gone or stalled,
          // so the remaining runs in this batch would burn the same timeout
          // each. Move on to the next host; a later pass retries this one.
          break;
        }
      }
    }
  }
}

function archiveWorkflowRun(
  deps: LoggedWorkSessionDeps,
  run: WorkflowRunRow,
): void {
  const notificationBuffer = new NotificationBuffer();
  deps.db.transaction(
    (tx) => {
      const archived = archiveWorkflowRunInTransaction(tx, { id: run.id });
      if (!archived) {
        // Already archived by a concurrent sweep pass.
        return;
      }
      pruneWorkflowRunJournalEventPayloadsInTransaction(tx, { runId: run.id });
      cancelActiveWorkflowRunOperationsInTransaction(tx, {
        runIds: [run.id],
        kinds: ["start", "resume", "cancel"],
      });
      if (archived.pendingManagerNotification !== null) {
        // Archiving invalidates an undelivered notification intent: a paused
        // "resume it" message is wrong once resumability is gone (the resume
        // route now 409s), and a 30-day-stale settled message has no value.
        // Every writer that invalidates intent clears it — the staleness
        // invariant this sweep was missing (review finding, recorded).
        clearWorkflowRunPendingManagerNotification(tx, {
          id: run.id,
          kind: archived.pendingManagerNotification,
        });
      }

      if (run.status === "interrupted") {
        appendWorkflowRunAnchorEventInTransaction(
          { db: tx, hub: notificationBuffer },
          { kind: "completed", run: archived, taskStatus: "stopped" },
        );
      }
      notificationBuffer.notifyWorkflowRun(run.id, ["run-updated"]);
    },
    { behavior: "immediate" },
  );
  notificationBuffer.flushInto(deps.hub);
}
