// Workflow run-event ingestion (plan §8 PROGRESS/COMPLETION): the fold owner
// for POST /internal/session/workflow-run-events. Append-always, status-never:
// every owned event lands in workflow_run_events regardless of run status
// (the only rejection is ownership), and status moves only through the
// lifecycle module's hooks (`transitionWorkflowRunForRunStartedInTransaction`,
// `finalizeWorkflowRunInTransaction`). All side effects — snapshot folds,
// status hooks, anchor rows, notifications, manager pushes — key off
// insertedInputIndexes, so redelivered batches re-ack without re-firing
// anything.

import { createHash } from "node:crypto";
import {
  appendWorkflowRunEventsInTransaction,
  getWorkflowRun,
  InvalidWorkflowRunStatusTransitionError,
  listWorkflowRunsByIds,
  type AcceptedWorkflowRunEvent,
  type AppendWorkflowRunEventInput,
  type DbNotifier,
  type DbTransaction,
  type WorkflowRunRow,
} from "@bb/db";
import { updateWorkflowRunProgressSnapshotInTransaction } from "@bb/db/internal-lifecycle";
import {
  canonicalizeWorkflowRunEventPayload,
  getWorkflowRunEventAgentIndex,
  isTerminalWorkflowRunStatus,
  type BackgroundTaskStatus,
  type WorkflowAgentSnapshot,
  type WorkflowProgressSnapshot,
  type WorkflowRunEvent,
  type WorkflowRunEventType,
  type WorkflowRunStatus,
} from "@bb/domain";
import type {
  HostDaemonRejectedWorkflowRunEvent,
  HostDaemonWorkflowRunEventEnvelope,
} from "@bb/host-daemon-contract";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { maybePruneActiveThreadEventHistory } from "../system/event-pruning.js";
import { deferAfterResponse } from "../lib/response-deferral.js";
import {
  finalizeWorkflowRunInTransaction,
  transitionWorkflowRunForRunStartedInTransaction,
  type FinalizeWorkflowRunArgs,
} from "./workflow-run-lifecycle.js";
import {
  appendWorkflowRunAnchorEventInTransaction,
  buildWorkflowRunSettledManagerMessage,
  parseWorkflowRunProgressSnapshotColumn,
  queueWorkflowRunManagerNotificationBestEffort,
  type AppendedWorkflowRunAnchorEvent,
} from "./workflow-run-anchor.js";

/**
 * Minimum gap between anchor `item/backgroundTask/progress` appends per run
 * (the CLAUDE_TASK_PROGRESS_THROTTLE_MS precedent). Every batch still folds
 * the snapshot column; only the anchor-thread event row is throttled. Status
 * transitions bypass the throttle, and the terminal completed row is never
 * throttled, so skipped intermediate rows are never load-bearing.
 */
export const WORKFLOW_RUN_ANCHOR_PROGRESS_THROTTLE_MS = 500;

const MAX_AGENT_RESULT_PREVIEW_LENGTH = 200;

// In-memory per-run throttle state (the event-pruning.ts precedent). A server
// restart resets it — worst case one extra anchor row, which the background
// task progress prune deletes anyway.
const lastAnchorProgressAppendAtByRunId = new Map<string, number>();

/** Test seam: clears the per-run anchor progress throttle. */
export function resetWorkflowRunAnchorProgressThrottle(): void {
  lastAnchorProgressAppendAtByRunId.clear();
}

/**
 * Drops one run's throttle entry so its next event batch appends an anchor
 * progress row immediately. Reconciliation calls this on interruption and
 * revival — a paused → running flip must not be swallowed by the throttle
 * window (the statusChanged-bypass precedent from claude task translation).
 */
export function clearWorkflowRunAnchorProgressThrottle(runId: string): void {
  lastAnchorProgressAppendAtByRunId.delete(runId);
}

export interface IngestWorkflowRunEventBatchArgs {
  events: HostDaemonWorkflowRunEventEnvelope[];
  hostId: string;
}

export interface IngestWorkflowRunEventBatchResult {
  acceptedEvents: AcceptedWorkflowRunEvent[];
  rejectedEvents: HostDaemonRejectedWorkflowRunEvent[];
}

/**
 * sha256 over the protocol-version-INDEPENDENT canonical form — must match
 * the daemon spool's hash exactly, or every redelivery 409s.
 */
export function hashWorkflowRunEventPayload(args: {
  event: WorkflowRunEvent;
  runId: string;
}): string {
  return createHash("sha256")
    .update(canonicalizeWorkflowRunEventPayload(args))
    .digest("hex");
}

interface ManagerNotificationFollowUp {
  managerThreadId: string;
  messageText: string;
  runId: string;
}

interface IngestionSideEffectCollector {
  /**
   * Per-run throttle-map updates (timestamp = anchor row appended, null =
   * clear on terminal), applied only after the batch transaction commits.
   * Mutating the in-memory map inside the transaction would desynchronize it
   * from the database on rollback: the throttle would suppress the retried
   * batch's anchor row even though no row ever landed.
   */
  anchorThrottleUpdates: Map<string, number | null>;
  followUps: ManagerNotificationFollowUp[];
  pruneCandidates: AppendedWorkflowRunAnchorEvent[];
}

/**
 * One immediate transaction per batch: producer-idempotent append, snapshot
 * fold, lifecycle status hooks, throttled anchor progress rows, and the single
 * anchor completed row on settle — notifications buffered and flushed
 * post-commit, manager pushes deferred off the daemon-ingress path.
 */
export function ingestWorkflowRunEventBatch(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: IngestWorkflowRunEventBatchArgs,
): IngestWorkflowRunEventBatchResult {
  const runIds = [...new Set(args.events.map((entry) => entry.runId))];
  const ownedRunIds = new Set(
    listWorkflowRunsByIds(deps.db, runIds)
      .filter((run) => run.hostId === args.hostId)
      .map((run) => run.id),
  );

  const ownedEntries: HostDaemonWorkflowRunEventEnvelope[] = [];
  const rejectedEvents: HostDaemonRejectedWorkflowRunEvent[] = [];
  for (const entry of args.events) {
    if (ownedRunIds.has(entry.runId)) {
      ownedEntries.push(entry);
    } else {
      rejectedEvents.push({
        producerEventId: entry.producerEventId,
        runId: entry.runId,
        reason: "run_not_owned_by_host",
      });
    }
  }

  const eventInputs: AppendWorkflowRunEventInput[] = ownedEntries.map(
    (entry) => ({
      runId: entry.runId,
      type: entry.event.type,
      agentIndex: getWorkflowRunEventAgentIndex(entry.event),
      payload: JSON.stringify(entry.event),
      producerEventId: entry.producerEventId,
      producerEventPayloadHash: hashWorkflowRunEventPayload({
        event: entry.event,
        runId: entry.runId,
      }),
    }),
  );

  const notificationBuffer = new NotificationBuffer();
  const collector: IngestionSideEffectCollector = {
    anchorThrottleUpdates: new Map(),
    followUps: [],
    pruneCandidates: [],
  };
  const acceptedEvents = deps.db.transaction(
    (tx) => {
      const appendResult = appendWorkflowRunEventsInTransaction(
        tx,
        eventInputs,
      );

      const insertedEventsByRunId = new Map<string, WorkflowRunEvent[]>();
      for (const index of appendResult.insertedInputIndexes) {
        const entry = ownedEntries[index];
        if (!entry) {
          throw new Error("Missing owned entry for inserted run event index");
        }
        const events = insertedEventsByRunId.get(entry.runId) ?? [];
        events.push(entry.event);
        insertedEventsByRunId.set(entry.runId, events);
      }

      for (const [runId, insertedEvents] of insertedEventsByRunId) {
        applyInsertedRunEventsInTransaction(
          { db: tx, hub: notificationBuffer, logger: deps.logger },
          { collector, insertedEvents, runId },
        );
      }
      return appendResult.acceptedEvents;
    },
    { behavior: "immediate" },
  );
  notificationBuffer.flushInto(deps.hub);

  for (const [runId, lastAppendAt] of collector.anchorThrottleUpdates) {
    if (lastAppendAt === null) {
      lastAnchorProgressAppendAtByRunId.delete(runId);
    } else {
      lastAnchorProgressAppendAtByRunId.set(runId, lastAppendAt);
    }
  }
  for (const candidate of collector.pruneCandidates) {
    maybePruneActiveThreadEventHistory(deps, {
      threadId: candidate.threadId,
      latestPrunableSequence: candidate.sequence,
    });
  }
  deferWorkflowRunManagerNotifications(deps, collector.followUps);

  return { acceptedEvents, rejectedEvents };
}

/**
 * Queues the manager terminal notifications off the daemon-ingress path (the
 * deferEventFollowUpBatch pattern): manager pushes may queue daemon commands
 * and must never block the spool's batch response.
 */
function deferWorkflowRunManagerNotifications(
  deps: LoggedPendingInteractionWorkSessionDeps,
  followUps: ManagerNotificationFollowUp[],
): void {
  if (followUps.length === 0) {
    return;
  }
  deferAfterResponse({
    config: deps.config,
    logger: deps.logger,
    name: "Workflow run manager notification scheduling",
    work: async () => {
      await Promise.all(
        followUps.map((followUp) =>
          queueWorkflowRunManagerNotificationBestEffort(deps, followUp),
        ),
      );
    },
  });
}

interface ApplyInsertedRunEventsDeps {
  db: DbTransaction;
  hub: DbNotifier;
  logger: LoggedPendingInteractionWorkSessionDeps["logger"];
}

interface ApplyInsertedRunEventsArgs {
  collector: IngestionSideEffectCollector;
  insertedEvents: readonly WorkflowRunEvent[];
  runId: string;
}

function applyInsertedRunEventsInTransaction(
  deps: ApplyInsertedRunEventsDeps,
  args: ApplyInsertedRunEventsArgs,
): void {
  let run = getWorkflowRun(deps.db, args.runId);
  if (!run) {
    return;
  }
  deps.hub.notifyWorkflowRun(args.runId, ["events-appended"]);

  // 1. run/started → running (normal start, resume, or events-outran-
  //    reconciliation revival). The hook no-ops for any other current status.
  let statusChanged = false;
  if (args.insertedEvents.some((event) => event.type === "run/started")) {
    const transitioned = transitionWorkflowRunForRunStartedInTransaction(
      { db: deps.db, hub: deps.hub },
      { runId: args.runId },
    );
    if (transitioned) {
      run = transitioned;
      statusChanged = true;
    }
  }

  // 2. Superseding snapshot fold. The writer refuses terminal rows, so a late
  //    batch for a settled run appends event rows without rewriting the
  //    settled snapshot.
  const foldableEvents = args.insertedEvents.filter((event) =>
    isSnapshotFoldEventType(event.type),
  );
  if (foldableEvents.length > 0) {
    const now = Date.now();
    const snapshot = parseProgressSnapshot(run.progressSnapshot);
    for (const event of foldableEvents) {
      foldWorkflowRunEventIntoSnapshot(snapshot, event, now);
    }
    const updated = updateWorkflowRunProgressSnapshotInTransaction(deps.db, {
      id: args.runId,
      progressSnapshot: JSON.stringify(snapshot),
    });
    if (updated) {
      run = updated;
    }
  }

  // 3. Terminal finalize — the first terminal event wins; duplicates and
  //    late terminals return `already-terminal` and trigger nothing.
  const terminalEvent = args.insertedEvents.find(isRunTerminalEvent);
  if (terminalEvent) {
    applyTerminalRunEventInTransaction(deps, {
      collector: args.collector,
      event: terminalEvent,
      run,
    });
    return;
  }

  // 4. Throttled anchor progress for non-terminal batches. Late events for an
  //    already-terminal run never re-open the anchor item.
  if (isTerminalWorkflowRunStatus(run.status)) {
    return;
  }
  const now = Date.now();
  const lastAppendAt = lastAnchorProgressAppendAtByRunId.get(args.runId);
  if (
    lastAppendAt !== undefined &&
    !statusChanged &&
    now - lastAppendAt < WORKFLOW_RUN_ANCHOR_PROGRESS_THROTTLE_MS
  ) {
    return;
  }
  const appended = appendWorkflowRunAnchorEventInTransaction(
    { db: deps.db, hub: deps.hub },
    {
      kind: "progress",
      run,
      taskStatus: anchorTaskStatusForRunStatus(run.status),
    },
  );
  if (appended) {
    args.collector.anchorThrottleUpdates.set(args.runId, now);
    args.collector.pruneCandidates.push(appended);
  }
}

type RunTerminalEvent = Extract<
  WorkflowRunEvent,
  { type: "run/cancelled" | "run/completed" | "run/failed" }
>;

function isRunTerminalEvent(event: WorkflowRunEvent): event is RunTerminalEvent {
  return (
    event.type === "run/completed" ||
    event.type === "run/failed" ||
    event.type === "run/cancelled"
  );
}

interface ApplyTerminalRunEventArgs {
  collector: IngestionSideEffectCollector;
  event: RunTerminalEvent;
  run: WorkflowRunRow;
}

function applyTerminalRunEventInTransaction(
  deps: ApplyInsertedRunEventsDeps,
  args: ApplyTerminalRunEventArgs,
): void {
  if (args.run.status === "interrupted" && args.event.type === "run/cancelled") {
    // Late spooled run/cancelled events never settle an interrupted run
    // (plan §8: revival and the real-outcome supersede own interrupted runs).
    // The `interrupted → cancelled` table edge is reserved for the explicit
    // user-cancel request path; a spool-delayed run/cancelled lands as
    // history only — the run stays interrupted and resumable.
    return;
  }

  let result;
  try {
    result = finalizeWorkflowRunInTransaction(
      { db: deps.db, hub: deps.hub },
      buildFinalizeArgsForTerminalEvent(args.run, args.event),
    );
  } catch (error) {
    if (error instanceof InvalidWorkflowRunStatusTransitionError) {
      // At-least-once ingress must never wedge the daemon spool on a status
      // the table refuses: keep the appended rows as history and move on.
      deps.logger.warn(
        {
          currentStatus: error.currentStatus,
          newStatus: error.newStatus,
          runId: error.runId,
        },
        "Skipped workflow run terminal event with illegal status transition",
      );
      return;
    }
    throw error;
  }
  if (result.outcome !== "settled") {
    return;
  }

  const appended = appendWorkflowRunAnchorEventInTransaction(
    { db: deps.db, hub: deps.hub },
    {
      kind: "completed",
      run: result.run,
      taskStatus: terminalAnchorTaskStatus(result.run.status),
    },
  );
  if (appended) {
    args.collector.pruneCandidates.push(appended);
  }
  args.collector.anchorThrottleUpdates.set(args.run.id, null);
  if (result.run.anchorThreadId !== null) {
    args.collector.followUps.push({
      managerThreadId: result.run.anchorThreadId,
      messageText: buildWorkflowRunSettledManagerMessage(result.run),
      runId: result.run.id,
    });
  }
}

function buildFinalizeArgsForTerminalEvent(
  run: WorkflowRunRow,
  event: RunTerminalEvent,
): FinalizeWorkflowRunArgs {
  // Wall-clock run duration; the runtime reports token usage only, and
  // run-level tool uses are not tracked (honest zero, not a placeholder).
  const durationMs =
    run.startedAt !== null ? Math.max(0, Date.now() - run.startedAt) : 0;
  const usage = {
    inputTokens: event.usage.inputTokens,
    outputTokens: event.usage.outputTokens,
    toolUses: 0,
    durationMs,
  };
  switch (event.type) {
    case "run/completed":
      return {
        runId: run.id,
        status: "completed",
        failureReason: null,
        resultJson: JSON.stringify(event.result),
        usage,
      };
    case "run/failed":
      return {
        runId: run.id,
        status: "failed",
        failureReason: event.error,
        resultJson: null,
        usage,
      };
    case "run/cancelled":
      return {
        runId: run.id,
        status: "cancelled",
        failureReason: null,
        resultJson: null,
        usage,
      };
  }
}

function anchorTaskStatusForRunStatus(
  status: WorkflowRunStatus,
): BackgroundTaskStatus {
  switch (status) {
    case "running":
      return "running";
    case "interrupted":
      return "paused";
    default:
      return "pending";
  }
}

function terminalAnchorTaskStatus(
  status: WorkflowRunStatus,
): BackgroundTaskStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "stopped";
  }
}

const SNAPSHOT_FOLD_EVENT_TYPES: readonly WorkflowRunEventType[] = [
  "phase/started",
  "agent/queued",
  "agent/started",
  "agent/progress",
  "agent/completed",
  "agent/failed",
];

function isSnapshotFoldEventType(type: WorkflowRunEventType): boolean {
  return SNAPSHOT_FOLD_EVENT_TYPES.includes(type);
}

function parseProgressSnapshot(
  progressSnapshot: string | null,
): WorkflowProgressSnapshot {
  return (
    parseWorkflowRunProgressSnapshotColumn(progressSnapshot) ?? {
      phases: [],
      agents: [],
    }
  );
}

type AgentScopedRunEvent = Extract<
  WorkflowRunEvent,
  { agentIndex: number; label: string }
>;

function upsertSnapshotAgent(
  snapshot: WorkflowProgressSnapshot,
  event: AgentScopedRunEvent,
  now: number,
): WorkflowAgentSnapshot {
  let agent = snapshot.agents.find((entry) => entry.index === event.agentIndex);
  if (!agent) {
    agent = {
      index: event.agentIndex,
      label: event.label,
      state: "queued",
      model: event.model ?? "",
      attempt: 1,
      cached: false,
      lastProgressAt: now,
    };
    snapshot.agents.push(agent);
    snapshot.agents.sort((a, b) => a.index - b.index);
  }
  agent.label = event.label;
  agent.lastProgressAt = now;
  if (event.model !== undefined) {
    agent.model = event.model;
  }
  if (event.phaseIndex !== undefined) {
    agent.phaseIndex = event.phaseIndex;
  }
  if (event.phaseTitle !== undefined) {
    agent.phaseTitle = event.phaseTitle;
  }
  return agent;
}

function truncateResultPreview(resultText: string): string {
  return resultText.length > MAX_AGENT_RESULT_PREVIEW_LENGTH
    ? `${resultText.slice(0, MAX_AGENT_RESULT_PREVIEW_LENGTH)}…`
    : resultText;
}

/**
 * Folds one run event into the superseding WorkflowProgressSnapshot (the
 * shape the timeline's workflow row renders). Mutates in place; the caller
 * persists the result once per batch. Exported for direct fold tests.
 */
export function foldWorkflowRunEventIntoSnapshot(
  snapshot: WorkflowProgressSnapshot,
  event: WorkflowRunEvent,
  now: number,
): void {
  switch (event.type) {
    case "phase/started": {
      const existing = snapshot.phases.find(
        (phase) => phase.index === event.phaseIndex,
      );
      if (existing) {
        existing.title = event.title;
        return;
      }
      snapshot.phases.push({ index: event.phaseIndex, title: event.title });
      snapshot.phases.sort((a, b) => a.index - b.index);
      return;
    }
    case "agent/queued": {
      const agent = upsertSnapshotAgent(snapshot, event, now);
      agent.state = "queued";
      agent.queuedAt = now;
      agent.promptPreview = event.promptPreview;
      return;
    }
    case "agent/started": {
      const agent = upsertSnapshotAgent(snapshot, event, now);
      agent.state = "running";
      agent.startedAt = now;
      return;
    }
    case "agent/progress": {
      const agent = upsertSnapshotAgent(snapshot, event, now);
      if (event.lastToolName !== undefined) {
        agent.lastToolName = event.lastToolName;
      }
      if (event.inputTokens !== undefined || event.outputTokens !== undefined) {
        agent.tokens = (event.inputTokens ?? 0) + (event.outputTokens ?? 0);
      }
      return;
    }
    case "agent/completed": {
      const agent = upsertSnapshotAgent(snapshot, event, now);
      agent.state = "done";
      agent.cached = event.cached;
      agent.resultPreview = truncateResultPreview(event.entry.resultText);
      agent.tokens =
        event.entry.usage.inputTokens + event.entry.usage.outputTokens;
      agent.durationMs = event.entry.durationMs;
      return;
    }
    case "agent/failed": {
      const agent = upsertSnapshotAgent(snapshot, event, now);
      agent.state = "failed";
      agent.error = event.error;
      agent.tokens =
        event.entry.usage.inputTokens + event.entry.usage.outputTokens;
      agent.durationMs = event.entry.durationMs;
      return;
    }
    case "run/started":
    case "log":
    case "run/completed":
    case "run/failed":
    case "run/cancelled":
      return;
  }
}
