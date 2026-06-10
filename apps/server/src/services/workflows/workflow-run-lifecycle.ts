// The workflow-run lifecycle owner (plan §8), copying the thread-lifecycle
// shape: routes and other services may only call the exported `request*`
// functions; every status/operation mutation lives here, driven by the
// transition table in @bb/db (`ALLOWED_WORKFLOW_RUN_STATUS_TRANSITIONS`).
//
// Division of labor with the ingestion/reconciliation owner
// (workflow-run-events.ts and the session-open hooks, built against this
// module):
// - Ingestion appends `workflow_run_events` rows append-always/status-never
//   and calls `transitionWorkflowRunForRunStartedInTransaction` /
//   `finalizeWorkflowRunInTransaction` for inserted status-bearing events.
// - Reconciliation calls `interruptWorkflowRunsForHostInTransaction` (bucket
//   (b) and the lease-expiry trigger) and
//   `requestWorkflowRunCancelForReportedTerminalRun` (bucket (d)).
// - Anchor-thread `item/backgroundTask/*` appends and manager notifications
//   are the ingestion/reconciliation owner's side of those contracts; the
//   return values here carry the rows they need.

import { randomUUID } from "node:crypto";
import {
  getActiveSession,
  getHost,
  getWorkflowRun,
  getWorkflowRunOperation,
  getWorkflowRunOperationByCommandId,
  hasWorkflowRunEventsSince,
  listWorkflowRunOperations,
  listWorkflowRunsByHostAndStatuses,
  type DbNotifier,
  type DbQueryConnection,
  type DbTransaction,
  type WorkflowRunRow,
  type WorkflowRunUsageTotals,
} from "@bb/db";
import {
  cancelWorkflowRunOperationRecord,
  markWorkflowRunOperationRecordCompleted,
  markWorkflowRunOperationRecordFailed,
  markWorkflowRunOperationRecordQueued,
  setWorkflowRunPendingManagerNotification,
  settleWorkflowRunInTransaction,
  transitionWorkflowRunStatusInTransaction,
  upsertWorkflowRunOperationRecord,
} from "@bb/db/internal-lifecycle";
import {
  activeLifecycleOperationStates,
  clampWorkflowSandboxToCeiling,
  isActiveLifecycleOperationState,
  isTerminalWorkflowRunStatus,
  type WorkflowRunOperationKind,
  type WorkflowRunTerminalStatus,
} from "@bb/domain";
import {
  workflowCancelCommandSchema,
  workflowStartCommandSchema,
} from "@bb/host-daemon-contract";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../../types.js";
import { ApiError } from "../../errors.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import {
  emptyCommandResultSideEffects,
  type CommandResultFailureReportForType,
  type CommandResultReportForType,
  type CommandResultSettlementDeps,
  type CommandResultSideEffectsResult,
  type HostDaemonCommandExecutionRecord,
  type HostDaemonCommandForType,
} from "../../internal/command-result-side-effects.js";
import {
  createLiveHostCommandExecution,
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  runLiveHostCommand,
} from "../hosts/live-command.js";
import {
  getEffectiveProjectWorkflowPolicy,
  WORKFLOW_RUN_EXEC_TIMEOUT_MS,
} from "./workflow-run-policy.js";
import {
  appendWorkflowRunAnchorEventInTransaction,
  buildWorkflowRunSettledManagerMessage,
  queueWorkflowRunManagerNotificationBestEffort,
} from "./workflow-run-anchor.js";
import { scheduleWorkflowRunPendingNotificationDelivery } from "./workflow-run-pending-notifications.js";

/**
 * The sweep-backstop interruption reason for runs on hosts whose daemon
 * session lease lapsed with no replacement (the daemon is demonstrably gone;
 * the run may still be revived by reconciliation when it reconnects).
 * Reconnect reconciliation's bucket (b) passes its own
 * `host-daemon-restarted` reason instead.
 */
export const WORKFLOW_RUN_HOST_SESSION_EXPIRED_REASON = "host-session-expired";

interface WorkflowRunLifecycleReadDeps {
  db: DbQueryConnection;
}

interface WorkflowRunSettlementWriteDeps {
  db: DbTransaction;
  hub: DbNotifier;
}

interface WorkflowRunIdentityArgs {
  runId: string;
}

type WorkflowStartLikeOperationKind = Extract<
  WorkflowRunOperationKind,
  "start" | "resume"
>;

function requireWorkflowRun(
  deps: WorkflowRunLifecycleReadDeps,
  runId: string,
): WorkflowRunRow {
  const run = getWorkflowRun(deps.db, runId);
  if (!run) {
    throw new ApiError(404, "workflow_run_not_found", "Workflow run not found");
  }
  return run;
}

function getActiveWorkflowRunOperation(
  deps: WorkflowRunLifecycleReadDeps,
  args: { kind: WorkflowRunOperationKind; runId: string },
) {
  const operation = getWorkflowRunOperation(deps.db, args);
  if (!operation || !isActiveLifecycleOperationState(operation.state)) {
    return null;
  }
  return operation;
}

/**
 * Execution ids (`rpc_<UUID>`, stored on the operation row as `commandId`) of
 * workflow live commands whose RPC is still in flight in this process. Live
 * commands always settle in-process (success, typed failure, disconnect, or
 * timeout all reach the settlement registry), so a `queued` operation whose
 * execution id is NOT in this set is a dispatch lost to a server restart —
 * the advance functions re-dispatch it with a fresh execution id.
 */
const inFlightWorkflowRunCommandExecutionIds = new Set<string>();

function isWorkflowRunOperationCommandInFlight(
  commandId: string | null,
): boolean {
  return (
    commandId !== null && inFlightWorkflowRunCommandExecutionIds.has(commandId)
  );
}

type WorkflowRunLiveCommand =
  | HostDaemonCommandForType<"workflow.start">
  | HostDaemonCommandForType<"workflow.cancel">;

interface StartWorkflowRunOperationLiveCommandArgs {
  command: WorkflowRunLiveCommand;
  execution: HostDaemonCommandExecutionRecord;
  kind: WorkflowRunOperationKind;
  runId: string;
}

/**
 * Fires the operation's live command after its dispatch transaction commits.
 * Settlement (operation completion/failure/retry, run finalize) is owned by
 * the command-result registry entries below — the catch here is
 * observability only. The in-flight registration is synchronous with the
 * caller's transaction, so a concurrent advance never double-dispatches.
 */
function startWorkflowRunOperationLiveCommand(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: StartWorkflowRunOperationLiveCommandArgs,
): void {
  inFlightWorkflowRunCommandExecutionIds.add(args.execution.id);
  void runLiveHostCommand(deps, {
    command: args.command,
    execution: args.execution,
    hostId: args.execution.hostId,
    timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  })
    .catch((error) => {
      deps.logger.warn(
        { err: error, runId: args.runId, operationKind: args.kind },
        "Live workflow run command failed",
      );
    })
    .finally(() => {
      inFlightWorkflowRunCommandExecutionIds.delete(args.execution.id);
    });
}

/**
 * `resume` carries a per-operation nonce (minted here, persisted on the
 * operation payload, stable across redeliveries of the same command): the
 * daemon records it in the run dir so a redelivered resume whose segment
 * already settled acks without re-running, while a fresh resume operation
 * (new nonce) legitimately clears a stale settle record.
 */
function buildWorkflowStartCommandPayload(
  run: WorkflowRunRow,
  resume: { nonce: string } | null,
): HostDaemonCommandForType<"workflow.start"> {
  return workflowStartCommandSchema.parse({
    type: "workflow.start",
    runId: run.id,
    projectId: run.projectId,
    script: {
      name: run.workflowName,
      content: run.scriptSource,
      hash: run.scriptHash,
    },
    argsJson: run.argsJson,
    seed: run.seed,
    keyVersion: run.keyVersion,
    baseTimeMs: run.createdAt,
    defaults: {
      providerId: run.providerId,
      model: run.model,
      effort: run.effort,
      sandbox: run.sandbox,
      concurrency: run.concurrency,
      maxAgents: run.maxAgents,
      maxFanout: run.maxFanout,
      budgetOutputTokens: run.budgetOutputTokens,
    },
    // The launch-time snapshot. Queue time clamps it to the project's
    // CURRENT effective ceiling (advanceWorkflowStartLikeOperationOnce) so a
    // revoked grant reaches held starts and resumes.
    sandboxCeiling: run.sandboxCeiling,
    workspacePath: run.workspacePath,
    execTimeoutMs: WORKFLOW_RUN_EXEC_TIMEOUT_MS,
    resume,
  });
}

function buildWorkflowCancelCommandPayload(
  run: WorkflowRunRow,
): HostDaemonCommandForType<"workflow.cancel"> {
  return workflowCancelCommandSchema.parse({
    type: "workflow.cancel",
    runId: run.id,
  });
}

/**
 * Runs currently holding host execution capacity: `starting`/`running` rows
 * plus `interrupted` rows whose resume operation is already queued (a queued
 * start operation implies `starting`, so it is never double-counted).
 */
function countWorkflowRunsHoldingHostCapacity(
  db: DbQueryConnection,
  hostId: string,
): number {
  const activeRuns = listWorkflowRunsByHostAndStatuses(db, {
    hostId,
    statuses: ["starting", "running"],
  });
  const interruptedRuns = listWorkflowRunsByHostAndStatuses(db, {
    hostId,
    statuses: ["interrupted"],
  });
  if (interruptedRuns.length === 0) {
    return activeRuns.length;
  }
  const queuedResumes = listWorkflowRunOperations(db, {
    kinds: ["resume"],
    states: ["queued"],
    runIds: interruptedRuns.map((run) => run.id),
  });
  return activeRuns.length + new Set(queuedResumes.map((op) => op.runId)).size;
}

interface AdvanceWorkflowStartLikeOperationArgs {
  kind: WorkflowStartLikeOperationKind;
  runId: string;
}

/**
 * Re-entrant advance for `start`/`resume` operations (the prebuilt
 * `workflow.start` command lives on the operation payload). Safe to call from
 * the request path, command-result post-commit work, and the periodic sweep:
 * - inactive operation → no-op;
 * - live command still in flight → returns its execution id;
 * - no active daemon session, destroyed host, or host over the per-run
 *   admission cap → leaves the operation `requested` (the sweep re-admits);
 * - otherwise dispatches the live command, marks the operation queued with
 *   the execution id, and advances run status (`created → starting` for
 *   start; resume leaves the run `interrupted` so a typed resume failure
 *   needs no status rollback). A `queued` operation with no in-flight
 *   execution is a dispatch lost to a server restart and re-dispatches here.
 */
async function advanceWorkflowStartLikeOperation(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: AdvanceWorkflowStartLikeOperationArgs,
): Promise<string | null> {
  return deps.lifecycleDedupers.workflowRunOperationAdvance.run(
    `${args.runId}:${args.kind}`,
    async () => advanceWorkflowStartLikeOperationOnce(deps, args),
  );
}

async function advanceWorkflowStartLikeOperationOnce(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: AdvanceWorkflowStartLikeOperationArgs,
): Promise<string | null> {
  const operation = getActiveWorkflowRunOperation(deps, {
    kind: args.kind,
    runId: args.runId,
  });
  if (!operation) {
    return null;
  }
  if (isWorkflowRunOperationCommandInFlight(operation.commandId)) {
    return operation.commandId;
  }

  const run = getWorkflowRun(deps.db, args.runId);
  if (!run) {
    return null;
  }
  // `starting` is legal for a `start` operation only as lost-dispatch
  // recovery: the first dispatch already transitioned the run, then the
  // server restarted before its RPC settled.
  const expectedStatuses: readonly WorkflowRunRow["status"][] =
    args.kind === "start" ? ["created", "starting"] : ["interrupted"];
  if (!expectedStatuses.includes(run.status)) {
    return null;
  }

  const host = getHost(deps.db, run.hostId);
  if (!host || host.destroyedAt !== null) {
    // Unstartable until the host returns; retention owns true abandonment.
    return null;
  }
  if (!getActiveSession(deps.db, run.hostId)) {
    return null;
  }
  if (
    countWorkflowRunsHoldingHostCapacity(deps.db, run.hostId) >=
    deps.config.workflowMaxConcurrentRunsPerHost
  ) {
    return null;
  }

  const payloadCommand = workflowStartCommandSchema.parse(
    JSON.parse(operation.payload),
  );
  // Ceiling revocation reaches existing runs here, at command-queue time: the
  // run row snapshots the launch-time ceiling so a later policy RAISE never
  // loosens an existing run, but a LOWERED project ceiling must not leave a
  // capacity-held start — or an interrupted run's resume — executing under a
  // revoked grant. Clamping to min(snapshot, current effective ceiling) keeps
  // both directions: resume's cached prefix replays free either way; only the
  // re-run suffix is gated.
  const command: HostDaemonCommandForType<"workflow.start"> = {
    ...payloadCommand,
    sandboxCeiling: clampWorkflowSandboxToCeiling({
      sandbox: payloadCommand.sandboxCeiling,
      ceiling: getEffectiveProjectWorkflowPolicy(deps.db, run.projectId)
        .sandboxCeiling,
    }),
  };
  const execution = createLiveHostCommandExecution(run.hostId);
  deps.db.transaction(
    (tx) => {
      if (operation.state === "queued") {
        // Lost dispatch: reset the operation to `requested` (payload
        // preserved) so the requested→queued guard below holds.
        upsertWorkflowRunOperationRecord(tx, {
          runId: args.runId,
          kind: args.kind,
          payload: operation.payload,
        });
      }
      const queuedOperation = markWorkflowRunOperationRecordQueued(tx, {
        runId: args.runId,
        kind: args.kind,
        commandId: execution.id,
      });
      if (!queuedOperation) {
        throw new Error(
          `Failed to mark workflow run ${args.kind} operation queued for ${args.runId}`,
        );
      }
      if (args.kind === "start" && run.status === "created") {
        transitionWorkflowRunStatusInTransaction(tx, {
          id: args.runId,
          newStatus: "starting",
        });
      }
    },
    { behavior: "immediate" },
  );

  startWorkflowRunOperationLiveCommand(deps, {
    command,
    execution,
    kind: args.kind,
    runId: args.runId,
  });
  if (args.kind === "start" && run.status === "created") {
    deps.hub.notifyWorkflowRun(args.runId, ["run-updated"]);
  }
  return execution.id;
}

export async function advanceWorkflowRunStart(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: WorkflowRunIdentityArgs,
): Promise<string | null> {
  return advanceWorkflowStartLikeOperation(deps, {
    kind: "start",
    runId: args.runId,
  });
}

export async function advanceWorkflowRunResume(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: WorkflowRunIdentityArgs,
): Promise<string | null> {
  return advanceWorkflowStartLikeOperation(deps, {
    kind: "resume",
    runId: args.runId,
  });
}

export async function advanceWorkflowRunCancel(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: WorkflowRunIdentityArgs,
): Promise<string | null> {
  return deps.lifecycleDedupers.workflowRunOperationAdvance.run(
    `${args.runId}:cancel`,
    async () => advanceWorkflowRunCancelOnce(deps, args),
  );
}

async function advanceWorkflowRunCancelOnce(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: WorkflowRunIdentityArgs,
): Promise<string | null> {
  const operation = getActiveWorkflowRunOperation(deps, {
    kind: "cancel",
    runId: args.runId,
  });
  if (!operation) {
    return null;
  }
  if (isWorkflowRunOperationCommandInFlight(operation.commandId)) {
    return operation.commandId;
  }

  const run = getWorkflowRun(deps.db, args.runId);
  if (!run) {
    return null;
  }
  if (!getActiveSession(deps.db, run.hostId)) {
    return null;
  }

  const command = workflowCancelCommandSchema.parse(
    JSON.parse(operation.payload),
  );
  const execution = createLiveHostCommandExecution(run.hostId);
  deps.db.transaction(
    (tx) => {
      if (operation.state === "queued") {
        // Lost dispatch (server restart mid-RPC): reset to `requested` so
        // the requested→queued guard below holds.
        upsertWorkflowRunOperationRecord(tx, {
          runId: args.runId,
          kind: "cancel",
          payload: operation.payload,
        });
      }
      const queuedOperation = markWorkflowRunOperationRecordQueued(tx, {
        runId: args.runId,
        kind: "cancel",
        commandId: execution.id,
      });
      if (!queuedOperation) {
        throw new Error(
          `Failed to mark workflow run cancel operation queued for ${args.runId}`,
        );
      }
    },
    { behavior: "immediate" },
  );

  startWorkflowRunOperationLiveCommand(deps, {
    command,
    execution,
    kind: "cancel",
    runId: args.runId,
  });
  return execution.id;
}

type UpsertOperationOutcome = "existing-active" | "upserted";

/**
 * Atomic active-op-check + upsert. `upsertWorkflowRunOperationRecord` resets
 * ANY existing row back to `requested` (clearing its commandId), so the guard
 * and the write must share one immediate transaction or a concurrent request
 * could orphan a freshly-queued command.
 */
function upsertWorkflowRunOperationIfInactive(
  deps: Pick<AppDeps, "db">,
  args: { kind: WorkflowRunOperationKind; payload: string; runId: string },
): UpsertOperationOutcome {
  return deps.db.transaction(
    (tx) => {
      if (
        getActiveWorkflowRunOperation(
          { db: tx },
          { kind: args.kind, runId: args.runId },
        )
      ) {
        return "existing-active";
      }
      upsertWorkflowRunOperationRecord(tx, {
        runId: args.runId,
        kind: args.kind,
        payload: args.payload,
      });
      return "upserted";
    },
    { behavior: "immediate" },
  );
}

/**
 * Request that a `created` run start on its host. Idempotent: an active start
 * operation (or a run already past `created`) advances/no-ops instead of
 * re-requesting. The operation may hold in `requested` (host offline or over
 * the admission cap); the periodic sweep re-advances it.
 */
export async function requestWorkflowRunStart(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: WorkflowRunIdentityArgs,
): Promise<void> {
  const run = requireWorkflowRun(deps, args.runId);
  if (
    getActiveWorkflowRunOperation(deps, { kind: "start", runId: args.runId })
  ) {
    await advanceWorkflowRunStart(deps, args);
    return;
  }
  if (run.status === "starting" || run.status === "running") {
    return;
  }
  if (run.status !== "created") {
    throw new ApiError(
      409,
      "workflow_run_not_startable",
      `Workflow run is ${run.status} and cannot be started`,
    );
  }

  upsertWorkflowRunOperationIfInactive(deps, {
    runId: args.runId,
    kind: "start",
    payload: JSON.stringify(buildWorkflowStartCommandPayload(run, null)),
  });
  await advanceWorkflowRunStart(deps, args);
}

/**
 * Request an explicit resume of an `interrupted` run. Idempotent under
 * `unique(runId, kind)` + the advance deduper: concurrent requests collapse
 * onto one operation and one queued command. The run stays `interrupted`
 * while the resume command is in flight — a typed resume failure
 * (`journal_fetch_failed`, `resume_preconditions_failed`) only fails the
 * operation, leaving the run resumable.
 *
 * Divergence from plan §8 RESUME's "allowed from interrupted|failed|cancelled":
 * the plan's own transition table (implemented in @bb/db) makes `failed` and
 * `cancelled` immutable, so resume-from-terminal cannot work end to end.
 * M4 decision (recorded in the plan): the public resume route keeps this
 * `interrupted`-only gate — terminal statuses stay immutable forever.
 */
export async function requestWorkflowRunResume(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: WorkflowRunIdentityArgs,
): Promise<void> {
  const run = requireWorkflowRun(deps, args.runId);
  if (run.retention === "archived") {
    // The retention sweep pruned the journal payloads: a resume would replay
    // nothing and re-bill everything. Archived runs are never resumable.
    throw new ApiError(
      409,
      "workflow_run_archived",
      "Workflow run is archived and no longer resumable",
    );
  }
  if (
    getActiveWorkflowRunOperation(deps, { kind: "resume", runId: args.runId })
  ) {
    await advanceWorkflowRunResume(deps, args);
    return;
  }
  if (run.status !== "interrupted") {
    throw new ApiError(
      409,
      "workflow_run_not_resumable",
      `Workflow run is ${run.status} and cannot be resumed`,
    );
  }

  upsertWorkflowRunOperationIfInactive(deps, {
    runId: args.runId,
    kind: "resume",
    payload: JSON.stringify(
      buildWorkflowStartCommandPayload(run, { nonce: randomUUID() }),
    ),
  });
  await advanceWorkflowRunResume(deps, args);
}

/**
 * Request cancellation of any non-terminal run. Terminal runs no-op (already
 * converged); archived runs reject 409 `workflow_run_archived` (archiving an
 * interrupted run already settled its anchor item — a cancel would append a
 * second completed row).
 *
 * Three convergence shapes, decided on the status re-read INSIDE the
 * transaction (a concurrent revival/admission/settle must route the cancel
 * correctly):
 * - `created` / `interrupted` (M4 decision, plan §8 CANCEL note (2)/(3)): no
 *   daemon holds a live runner — never admitted, or the interruption already
 *   proved the runner gone — so the cancellation settles entirely
 *   server-side via the explicit user-cancel edges (`created → cancelled`,
 *   `interrupted → cancelled`). Finalize cancels active operations (a held
 *   `requested` start, a pending resume); if a
 *   surviving runner ever reports the run live again, reconciliation bucket
 *   (d) queues the durable `workflow.cancel` to converge the host. Distinct
 *   from bucket (d) itself, which still never cancels `interrupted` runs.
 * - `starting` with no in-flight start RPC: the start's delivery was never
 *   confirmed — start operation cancelled, run settles via
 *   `starting → cancelled`, no round-trip.
 * - otherwise (`running`, or `starting` with the start RPC in flight): a
 *   durable `workflow.cancel` rides the cancel operation; the daemon aborts
 *   the runner, the runner exits with `run/cancelled`, and ingestion
 *   finalizes.
 *
 * The active-cancel-op check comes BEFORE everything else: an in-flight
 * cancel survives interruption (see
 * `interruptWorkflowRunsForHostInTransaction`), so repeating a cancel whose
 * intent is still pending no-ops/advances onto the surviving operation.
 *
 * A server-side settle records the anchored run's "settled" manager
 * notification intent in the same transaction and triggers the
 * pending-notification delivery sweep post-commit (M6 decision, aligning
 * with daemon-converged cancels which notify via ingestion).
 */
export async function requestWorkflowRunCancel(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: WorkflowRunIdentityArgs,
): Promise<void> {
  const run = requireWorkflowRun(deps, args.runId);
  if (isTerminalWorkflowRunStatus(run.status)) {
    return;
  }
  if (
    getActiveWorkflowRunOperation(deps, { kind: "cancel", runId: args.runId })
  ) {
    await advanceWorkflowRunCancel(deps, args);
    return;
  }
  if (run.retention === "archived") {
    throw new ApiError(
      409,
      "workflow_run_archived",
      "Workflow run is archived and no longer cancellable",
    );
  }

  const notificationBuffer = new NotificationBuffer();
  const outcome = deps.db.transaction(
    (tx) => {
      const txDeps = { db: tx };
      if (
        getActiveWorkflowRunOperation(txDeps, {
          kind: "cancel",
          runId: args.runId,
        })
      ) {
        return "advance" as const;
      }
      const current = getWorkflowRun(tx, args.runId);
      if (!current || isTerminalWorkflowRunStatus(current.status)) {
        // Raced a concurrent settle: already converged, nothing to cancel.
        return "noop" as const;
      }
      if (current.retention === "archived") {
        // The pre-transaction archived gate re-applied on the in-transaction
        // re-read: the retention sweep may archive an abandoned interrupted
        // run (settling its anchor item as "stopped") between the route's
        // read and this transaction — a server-side cancel settle here would
        // append a second completed row, breaking the one-terminal-
        // notification-per-run invariant.
        throw new ApiError(
          409,
          "workflow_run_archived",
          "Workflow run is archived and no longer cancellable",
        );
      }

      if (current.status === "created" || current.status === "interrupted") {
        return settleWorkflowRunCancelledServerSide(
          { db: tx, hub: notificationBuffer },
          current,
        );
      }

      // A `starting` run whose start command has no live in-flight RPC never
      // had its delivery confirmed: the operation is `requested` (reset
      // after a connectivity failure) or `queued` from a dispatch lost to a
      // server restart — cancellation converges entirely server-side
      // (finalize cancels the start operation so it never re-dispatches). If
      // the daemon secretly did receive the start, reconnect reconciliation
      // bucket (d) queues the durable `workflow.cancel` once it reports the
      // run live. (A queued resume cannot be in this state — resume
      // acceptance completes the operation before the run ever shows
      // `starting`.)
      const startOperation =
        current.status === "starting"
          ? getActiveWorkflowRunOperation(txDeps, {
              kind: "start",
              runId: args.runId,
            })
          : null;
      if (
        startOperation &&
        !isWorkflowRunOperationCommandInFlight(startOperation.commandId)
      ) {
        return settleWorkflowRunCancelledServerSide(
          { db: tx, hub: notificationBuffer },
          current,
        );
      }

      upsertWorkflowRunOperationRecord(tx, {
        runId: args.runId,
        kind: "cancel",
        payload: JSON.stringify(buildWorkflowCancelCommandPayload(current)),
      });
      return "advance" as const;
    },
    { behavior: "immediate" },
  );
  notificationBuffer.flushInto(deps.hub);

  if (outcome === "settled") {
    // Prompt delivery for the host-online case; the durable intent written in
    // the settle transaction carries the offline case (the common one — an
    // interrupted run whose host died) to the socket-attach/periodic retries.
    scheduleWorkflowRunPendingNotificationDelivery(deps);
  }
  if (outcome === "advance") {
    await advanceWorkflowRunCancel(deps, args);
  }
}

/**
 * The server-side cancel settle shared by the created/interrupted user-cancel
 * edges and the cancel-before-start convergence: finalize `cancelled` (which
 * also cancels the run's active operations),
 * append the anchor item's single completed row, and record the anchored
 * run's "settled" manager-notification intent — no `run/cancelled` event will
 * ever arrive to do any of it (ingestion's already-terminal guard makes a
 * second notification structurally impossible). Finalize cleared any pending
 * "paused" intent, so an UNDELIVERED paused message is normally superseded by
 * the terminal one here — but a paused delivery already past its pre-queue
 * re-read (mid-host-RPC, window ≈ one round trip) can still land first; the
 * terminal message follows it, so ordering holds even when supersession
 * narrowly misses (recorded residual). Token usage is honestly zero
 * (the never-emitted terminal event was the only run-level usage source);
 * durationMs records wall clock for runs that ever reached `running`.
 */
function settleWorkflowRunCancelledServerSide(
  deps: WorkflowRunSettlementWriteDeps,
  run: WorkflowRunRow,
): "settled" {
  const finalized = finalizeWorkflowRunInTransaction(deps, {
    runId: run.id,
    status: "cancelled",
    failureReason: null,
    resultJson: null,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      toolUses: 0,
      durationMs:
        run.startedAt !== null ? Math.max(0, Date.now() - run.startedAt) : 0,
    },
  });
  if (finalized.outcome !== "settled") {
    throw new Error(
      `Expected server-side cancel of ${run.status} run ${run.id} to settle, got ${finalized.outcome}`,
    );
  }
  appendWorkflowRunAnchorEventInTransaction(deps, {
    kind: "completed",
    run: finalized.run,
    taskStatus: "stopped",
  });
  if (finalized.run.anchorThreadId !== null) {
    setWorkflowRunPendingManagerNotification(deps.db, {
      id: finalized.run.id,
      kind: "settled",
    });
  }
  return "settled";
}

/**
 * Reconciliation bucket (d): the server holds a real terminal outcome
 * (`cancelled|completed|failed`) but the daemon reported the run as live —
 * queue a durable `workflow.cancel` so the host converges on the stored
 * truth. Reserved for terminal runs; never call it for `interrupted` runs
 * (revival, bucket (c), owns those).
 */
export async function requestWorkflowRunCancelForReportedTerminalRun(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: WorkflowRunIdentityArgs,
): Promise<void> {
  const run = requireWorkflowRun(deps, args.runId);
  if (!isTerminalWorkflowRunStatus(run.status)) {
    throw new ApiError(
      409,
      "workflow_run_not_terminal",
      `Workflow run is ${run.status}; terminal-run cancel convergence does not apply`,
    );
  }
  upsertWorkflowRunOperationIfInactive(deps, {
    runId: args.runId,
    kind: "cancel",
    payload: JSON.stringify(buildWorkflowCancelCommandPayload(run)),
  });
  await advanceWorkflowRunCancel(deps, args);
}

/**
 * Connectivity-class live-command failures whose delivery was never
 * confirmed: the daemon dropped (or never held) the socket before answering.
 * The row-based dispatch kept the command pending for redelivery here; the
 * live port preserves that durable intent by resetting the operation to
 * `requested` (payload intact) so the lifecycle sweep re-dispatches once the
 * host session returns.
 */
function isRetryableWorkflowCommandFailure(
  report: CommandResultFailureReportForType<"workflow.start" | "workflow.cancel">,
): boolean {
  return report.errorCode === "host_unavailable";
}

function resetWorkflowRunOperationForRetry(
  deps: CommandResultSettlementDeps,
  operation: { kind: WorkflowRunOperationKind; payload: string; runId: string },
): void {
  upsertWorkflowRunOperationRecord(deps.db, {
    runId: operation.runId,
    kind: operation.kind,
    payload: operation.payload,
  });
}

interface SettleWorkflowStartCommandResultArgs {
  command: HostDaemonCommandForType<"workflow.start">;
  deps: CommandResultSettlementDeps;
  execution: HostDaemonCommandExecutionRecord;
  report: CommandResultReportForType<"workflow.start">;
}

/**
 * Settle the acceptance-only `workflow.start` ack for both `start` and
 * `resume` operations (the operation row's kind disambiguates):
 * - ok → operation completed; a resume acceptance moves a still-`interrupted`
 *   run to `starting` (run/started ingestion may already have raced it to
 *   `running` — then no transition is needed or legal).
 * - any failure with a `workflow_run_events` row since the operation's
 *   queuedAt → the run demonstrably started (the RPC dropped or timed out
 *   after delivery); operation completed and reconciliation owns the rest.
 * - `host_unavailable` with zero events → delivery never confirmed; the
 *   operation resets to `requested` and the sweep re-dispatches when the
 *   host returns (the live-dispatch analogue of row redelivery).
 * - any other failure → operation failed; a `start` run finalizes `failed`
 *   (failureReason = the daemon errorCode, e.g. `script_invalid`); a
 *   `resume` run stays `interrupted` and remains resumable
 *   (`journal_fetch_failed` etc.).
 */
export function settleWorkflowStartCommandResult(
  args: SettleWorkflowStartCommandResultArgs,
): CommandResultSideEffectsResult {
  const operation = getWorkflowRunOperationByCommandId(
    args.deps.db,
    args.execution.id,
  );
  if (
    !operation ||
    !isActiveLifecycleOperationState(operation.state) ||
    (operation.kind !== "start" && operation.kind !== "resume")
  ) {
    return emptyCommandResultSideEffects();
  }
  const run = getWorkflowRun(args.deps.db, args.command.runId);
  if (!run) {
    return emptyCommandResultSideEffects();
  }

  if (args.report.ok) {
    markWorkflowRunOperationRecordCompleted(args.deps.db, {
      runId: operation.runId,
      kind: operation.kind,
    });
    if (operation.kind === "resume" && run.status === "interrupted") {
      transitionWorkflowRunStatusInTransaction(args.deps.db, {
        id: run.id,
        newStatus: "starting",
      });
      args.deps.hub.notifyWorkflowRun(run.id, ["run-updated"]);
    }
    return emptyCommandResultSideEffects();
  }

  if (
    hasWorkflowRunEventsSince(args.deps.db, {
      runId: run.id,
      since: operation.queuedAt ?? operation.requestedAt,
    })
  ) {
    markWorkflowRunOperationRecordCompleted(args.deps.db, {
      runId: operation.runId,
      kind: operation.kind,
    });
    return emptyCommandResultSideEffects();
  }

  if (isRetryableWorkflowCommandFailure(args.report)) {
    resetWorkflowRunOperationForRetry(args.deps, operation);
    return emptyCommandResultSideEffects();
  }

  markWorkflowRunOperationRecordFailed(args.deps.db, {
    runId: operation.runId,
    kind: operation.kind,
    failureReason: args.report.errorMessage,
  });
  if (operation.kind === "start" && run.status === "starting") {
    const finalized = finalizeWorkflowRunInTransaction(
      { db: args.deps.db, hub: args.deps.hub },
      {
        runId: run.id,
        status: "failed",
        failureReason: args.report.errorCode,
        resultJson: null,
        usage: { inputTokens: 0, outputTokens: 0, toolUses: 0, durationMs: 0 },
      },
    );
    if (finalized.outcome === "settled") {
      // The run never produced a terminal event, so the settle owns the
      // anchor contract: the single completed row + manager notification.
      appendWorkflowRunAnchorEventInTransaction(
        { db: args.deps.db, hub: args.deps.hub },
        { kind: "completed", run: finalized.run, taskStatus: "failed" },
      );
      const settledRun = finalized.run;
      if (settledRun.anchorThreadId !== null) {
        const managerThreadId = settledRun.anchorThreadId;
        return {
          postCommitActions: [
            {
              name: "workflow-run-start-failure-manager-notification",
              context: { threadId: managerThreadId },
              run: (postCommitDeps) =>
                queueWorkflowRunManagerNotificationBestEffort(postCommitDeps, {
                  managerThreadId,
                  messageText:
                    buildWorkflowRunSettledManagerMessage(settledRun),
                  runId: settledRun.id,
                }),
            },
          ],
        };
      }
    }
  } else {
    args.deps.hub.notifyWorkflowRun(run.id, ["run-updated"]);
  }
  return emptyCommandResultSideEffects();
}

interface SettleWorkflowCancelCommandResultArgs {
  command: HostDaemonCommandForType<"workflow.cancel">;
  deps: CommandResultSettlementDeps;
  execution: HostDaemonCommandExecutionRecord;
  report: CommandResultReportForType<"workflow.cancel">;
}

/**
 * `workflow.cancel` settle: `accepted: false` means the daemon held no live
 * run — convergence already happened (run settled, never started, or daemon
 * restarted) and other owners (ingestion terminal events, reconnect
 * reconciliation) carry the run's status, so the operation simply completes
 * either way. A `host_unavailable` failure resets the operation to
 * `requested` — the user's durable cancel intent must survive a daemon drop
 * mid-cancel; the sweep re-dispatches when the host returns. Other failures
 * fail the operation; repeated cancel requests may re-upsert it.
 */
export function settleWorkflowCancelCommandResult(
  args: SettleWorkflowCancelCommandResultArgs,
): CommandResultSideEffectsResult {
  const operation = getWorkflowRunOperationByCommandId(
    args.deps.db,
    args.execution.id,
  );
  if (
    !operation ||
    !isActiveLifecycleOperationState(operation.state) ||
    operation.kind !== "cancel"
  ) {
    return emptyCommandResultSideEffects();
  }

  if (args.report.ok) {
    markWorkflowRunOperationRecordCompleted(args.deps.db, {
      runId: operation.runId,
      kind: operation.kind,
    });
  } else if (isRetryableWorkflowCommandFailure(args.report)) {
    resetWorkflowRunOperationForRetry(args.deps, operation);
  } else {
    markWorkflowRunOperationRecordFailed(args.deps.db, {
      runId: operation.runId,
      kind: operation.kind,
      failureReason: args.report.errorMessage,
    });
  }
  return emptyCommandResultSideEffects();
}

/**
 * Ingestion's status hook for an inserted `run/started` event: `starting`
 * (normal start, resume acceptance) and `interrupted` (revived run whose
 * events outran reconciliation, or a resume whose acceptance ack is still in
 * flight) both legally move to `running`; any other current status is a
 * deliberate no-op — terminal statuses are never changed by late events, and
 * a duplicate `run/started` for an already-`running` run must not throw.
 * Returns the updated row, or null when no transition applied.
 */
export function transitionWorkflowRunForRunStartedInTransaction(
  deps: WorkflowRunSettlementWriteDeps,
  args: WorkflowRunIdentityArgs,
): WorkflowRunRow | null {
  const run = getWorkflowRun(deps.db, args.runId);
  if (!run || (run.status !== "starting" && run.status !== "interrupted")) {
    return null;
  }
  const updated = transitionWorkflowRunStatusInTransaction(deps.db, {
    id: args.runId,
    newStatus: "running",
    failureReason: null,
  });
  deps.hub.notifyWorkflowRun(args.runId, ["run-updated"]);
  return updated;
}

export interface CancelActiveWorkflowRunOperationsArgs {
  /** Operation kinds to cancel — callers name the kinds they make unreachable. */
  kinds: readonly WorkflowRunOperationKind[];
  runIds: readonly string[];
}

/**
 * Cancels the named runs' still-active operations of the given kinds. The
 * shared cleanup primitive behind terminal finalize (all kinds — a settled
 * run can never honor any of them), interruption (start/resume only — see
 * `interruptWorkflowRunsForHostInTransaction`), revival (resume only — a
 * revived run makes a pending resume permanently unreachable, and a leaked
 * `requested` resume op would otherwise silently auto-resume on the NEXT
 * interruption), and the retention archive sweep. An operation's still
 * in-flight live RPC (if any) is left to settle on its own — settlement
 * guards on the operation still being active, so it lands as a no-op.
 */
export function cancelActiveWorkflowRunOperationsInTransaction(
  db: DbTransaction,
  args: CancelActiveWorkflowRunOperationsArgs,
): void {
  if (args.runIds.length === 0 || args.kinds.length === 0) {
    return;
  }
  const activeOperations = listWorkflowRunOperations(db, {
    runIds: [...args.runIds],
    kinds: [...args.kinds],
    states: [...activeLifecycleOperationStates],
  });
  for (const operation of activeOperations) {
    cancelWorkflowRunOperationRecord(db, {
      runId: operation.runId,
      kind: operation.kind,
    });
  }
}

const ALL_WORKFLOW_RUN_OPERATION_KINDS: readonly WorkflowRunOperationKind[] = [
  "start",
  "resume",
  "cancel",
];

export interface FinalizeWorkflowRunArgs {
  /** Null for completed/cancelled outcomes; the reason for failed runs. */
  failureReason: string | null;
  /** Null when the run produced no result. */
  resultJson: string | null;
  runId: string;
  settledAt?: number;
  status: WorkflowRunTerminalStatus;
  usage: WorkflowRunUsageTotals;
}

export type WorkflowRunFinalizeResult =
  | { outcome: "already-terminal"; run: WorkflowRunRow }
  | { outcome: "not-found" }
  | { outcome: "settled"; run: WorkflowRunRow };

/**
 * The single terminal-finalize writer (plan §8 COMPLETION), honoring the
 * transition table — including the `interrupted → completed|failed`
 * late-supersede when a partitioned daemon's spool flushes the real outcome
 * after a synthetic interruption. Idempotent for ingestion: an
 * already-terminal run returns `already-terminal` unchanged (late terminal
 * events still append as rows, they just change nothing).
 *
 * Settling also cancels the run's remaining active operations (mirroring
 * interruption): a terminal run can never honor an in-flight
 * start/resume/cancel, and a queued resume left active would be re-dispatched
 * by the sweep after a late-supersede settle and silently re-run — and
 * re-bill — a now-terminal run.
 *
 * Contract for the ingestion/reconciliation owner calling this from the
 * event-batch transaction: act only on inserted (never re-acked) terminal
 * events, and only on `outcome === "settled"` append the run's single anchor
 * `item/backgroundTask/completed` row in the same transaction and queue the
 * one manager terminal notification post-commit. `already-terminal` must
 * trigger neither.
 */
export function finalizeWorkflowRunInTransaction(
  deps: WorkflowRunSettlementWriteDeps,
  args: FinalizeWorkflowRunArgs,
): WorkflowRunFinalizeResult {
  const run = getWorkflowRun(deps.db, args.runId);
  if (!run) {
    return { outcome: "not-found" };
  }
  if (isTerminalWorkflowRunStatus(run.status)) {
    return { outcome: "already-terminal", run };
  }

  const settled = settleWorkflowRunInTransaction(deps.db, {
    id: args.runId,
    status: args.status,
    failureReason: args.failureReason,
    resultJson: args.resultJson,
    usage: args.usage,
    settledAt: args.settledAt,
  });
  cancelActiveWorkflowRunOperationsInTransaction(deps.db, {
    runIds: [args.runId],
    kinds: ALL_WORKFLOW_RUN_OPERATION_KINDS,
  });
  deps.hub.notifyWorkflowRun(args.runId, ["run-updated"]);
  return { outcome: "settled", run: settled };
}

export interface InterruptWorkflowRunsForHostArgs {
  /** Daemon-reported live run ids to leave untouched (reconciliation bucket (a)). */
  excludeReportedRunIds: readonly string[];
  hostId: string;
  reason: string;
}

/**
 * THE place `running` runs become `interrupted` (plan §8 bucket (b) and the
 * lease-expiry/sweep backstop): every running run on the host not reported
 * live is transitioned with the given failureReason, its active
 * `start`/`resume` operations are cancelled (a dead daemon can never honor a
 * start), and a `run-updated` notification is emitted. `starting` runs are
 * deliberately untouched — their `workflow.start` command is owned by the
 * live-RPC settle (failure resets or fails the operation).
 *
 * Active `cancel` operations deliberately SURVIVE interruption: the user's
 * durable cancel intent must not evaporate when the daemon dies mid-cancel.
 * A surviving cancel op is safe in every downstream state — for a
 * still-interrupted run the daemon's cancelRun answers `accepted: false` and
 * the op completes harmlessly; for a bucket-(c)-revived run the cancel's
 * `host_unavailable` settle reset it to `requested`, so the sweep finally
 * delivers it over the new session; for a late-supersede settle, finalize
 * cancels it.
 *
 * Returns the interrupted rows: the reconciliation owner appends each run's
 * paused anchor `item/backgroundTask/progress` row in the same transaction
 * and queues the manager "run paused" informational message post-commit.
 */
export function interruptWorkflowRunsForHostInTransaction(
  deps: WorkflowRunSettlementWriteDeps,
  args: InterruptWorkflowRunsForHostArgs,
): WorkflowRunRow[] {
  const runningRuns = listWorkflowRunsByHostAndStatuses(deps.db, {
    hostId: args.hostId,
    statuses: ["running"],
    excludeRunIds: args.excludeReportedRunIds,
  });
  if (runningRuns.length === 0) {
    return [];
  }

  cancelActiveWorkflowRunOperationsInTransaction(deps.db, {
    runIds: runningRuns.map((run) => run.id),
    kinds: ["start", "resume"],
  });

  const interrupted: WorkflowRunRow[] = [];
  for (const run of runningRuns) {
    interrupted.push(
      transitionWorkflowRunStatusInTransaction(deps.db, {
        id: run.id,
        newStatus: "interrupted",
        failureReason: args.reason,
      }),
    );
    deps.hub.notifyWorkflowRun(run.id, ["run-updated"]);
  }
  return interrupted;
}

/**
 * The periodic workflow-run operation sweep (registered in `runPeriodicSweeps`
 * beside the thread lifecycle sweep): re-advances every active operation —
 * capacity-held `requested` starts admit as host capacity frees, and
 * operations stranded by a server restart or an offline host re-queue once a
 * session is back. The no-replacement-session interruption backstop lives in
 * workflow-run-reconciliation.ts (`runWorkflowRunInterruptionBackstopSweep`),
 * which owns the paused-anchor/manager-message side of interruption.
 */
export async function runWorkflowRunLifecycleSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
): Promise<void> {
  for (const operation of listWorkflowRunOperations(deps.db, {
    states: [...activeLifecycleOperationStates],
  })) {
    try {
      switch (operation.kind) {
        case "start":
          await advanceWorkflowRunStart(deps, { runId: operation.runId });
          break;
        case "resume":
          await advanceWorkflowRunResume(deps, { runId: operation.runId });
          break;
        case "cancel":
          await advanceWorkflowRunCancel(deps, { runId: operation.runId });
          break;
      }
    } catch (error) {
      deps.logger.warn(
        {
          err: error,
          runId: operation.runId,
          operationKind: operation.kind,
        },
        "Workflow run operation sweep failed",
      );
    }
  }
}
