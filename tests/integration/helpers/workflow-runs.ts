// Workflow-run helpers for the M3 integration suites (tests/integration/fake/
// workflows/). Runs are created through the real server boundary
// (validateWorkflowScriptSource + buildWorkflowRunCreateInput), driven through
// the real lifecycle request*/sweep functions against the harness server, and
// observed straight from the server DB — no production seam is mocked. The
// only test-private levers are the status-forcing helpers (to place a run in
// `running`/`interrupted` without re-running another criterion's whole
// scenario) and the producer-id generator for posting spool envelopes through
// the real internal HTTP route.

import { randomInt } from "node:crypto";
import {
  createWorkflowRun,
  events,
  getWorkflowRun,
  getWorkflowRunOperation,
  appendWorkflowRunEventsInTransaction,
  hostDaemonSessions,
  insertEvents,
  listEvents,
  listWorkflowRunEvents,
  projectSources,
  type DbConnection,
  type WorkflowRunEventRow,
  type WorkflowRunOperationRow,
  type WorkflowRunRow,
} from "@bb/db";
import {
  settleWorkflowRunInTransaction,
  transitionWorkflowRunStatusInTransaction,
} from "@bb/db/internal-lifecycle";
import {
  hostDaemonProducerEventIdSchema,
  threadScope,
  workflowRunEventSchema,
  type HostDaemonProducerEventId,
  type WorkflowRunEvent,
  type WorkflowRunEventType,
  type WorkflowRunOperationKind,
  type WorkflowRunStatus,
  type WorkflowRunTerminalStatus,
} from "@bb/domain";
import {
  hostDaemonWorkflowRunEventBatchResponseSchema,
  workflowStartCommandSchema,
  type HostDaemonCommand,
  type HostDaemonWorkflowRunEventBatchResponse,
  type HostDaemonWorkflowRunEventEnvelope,
} from "@bb/host-daemon-contract";
import { desc, eq } from "drizzle-orm";
import { expect } from "vitest";
import { resolveProjectSourcePath } from "../../../apps/server/src/services/projects/project-source-path.js";
import {
  buildWorkflowRunCreateInput,
  getEffectiveProjectWorkflowPolicy,
} from "../../../apps/server/src/services/workflows/workflow-run-policy.js";
import { validateWorkflowScriptSource } from "../../../apps/server/src/services/workflows/workflow-registry.js";
import type { AppDeps } from "../../../apps/server/src/types.js";
import type { IntegrationHarness } from "./harness.js";
import { scaleTimeoutMs } from "./time.js";

// The server lifecycle surface the workflow suites drive, re-exported so test
// files reach apps/server modules through helpers only (the harness pattern).
export {
  requestWorkflowRunResume,
  requestWorkflowRunStart,
  runWorkflowRunLifecycleSweep,
  WORKFLOW_RUN_HOST_SESSION_EXPIRED_REASON,
} from "../../../apps/server/src/services/workflows/workflow-run-lifecycle.js";
export { WORKFLOW_RUN_DAEMON_RESTARTED_REASON } from "../../../apps/server/src/services/workflows/workflow-run-reconciliation.js";
export { validateWorkflowScriptSource } from "../../../apps/server/src/services/workflows/workflow-registry.js";
export { ApiError } from "../../../apps/server/src/errors.js";
export { runPeriodicSweeps } from "../../../apps/server/src/services/system/periodic-sweeps.js";
export { DAEMON_DISCONNECT_GRACE_MS } from "../../../apps/server/src/constants.js";
// The real per-thread pruning worker the gated production trigger
// (maybePruneActiveThreadEventHistory: ≥250-sequence delta, ≥30s interval)
// delegates to — tests call it directly so the M5 "pruning between pause and
// resume" criterion does not have to manufacture 250 filler events.
export { pruneThreadEventHistory } from "../../../apps/server/src/services/system/event-pruning.js";

/** Whole-run waits: command delivery + runner child spawn (tsx) + fake provider turn + spool flush + ingestion. */
export const WORKFLOW_RUN_SETTLE_TIMEOUT_MS = scaleTimeoutMs(45_000);
/** Operation-state waits: one daemon command round trip. */
export const WORKFLOW_OPERATION_TIMEOUT_MS = scaleTimeoutMs(20_000);

/**
 * An inline workflow the real runner executes against the fake provider: one
 * agent turn whose echoed text lands in the run result.
 */
export const INTEGRATION_WORKFLOW_SOURCE = `export const meta = {
  name: "integration-flow",
  description: "M3 integration fixture workflow",
};

const result = await agent("do the integration work");
return { result };
`;

/**
 * Server deps for calling the workflow lifecycle's request/advance/sweep
 * functions from a test: the exact dependency bundle the running server app
 * was built with, so test-driven advances and the server's settlement-driven
 * advances collapse through the same deduper instances.
 */
export function workflowServerDeps(harness: IntegrationHarness): AppDeps {
  return harness.server.deps;
}

export interface CreateIntegrationWorkflowRunArgs {
  anchorThreadId?: string;
  projectId: string;
  source?: string;
}

/**
 * The inline launch path with the host left implicit: server-side validation
 * (no host round-trip), defaults resolved at the boundary, run row persisted.
 */
export function createIntegrationWorkflowRun(
  harness: IntegrationHarness,
  args: CreateIntegrationWorkflowRunArgs,
): WorkflowRunRow {
  const script = validateWorkflowScriptSource(
    args.source ?? INTEGRATION_WORKFLOW_SOURCE,
  );
  const launchTarget = resolveProjectSourcePath(
    { db: harness.db },
    { projectId: args.projectId, hostId: null },
  );
  return createWorkflowRun(
    harness.db,
    buildWorkflowRunCreateInput({
      projectId: args.projectId,
      launchTarget,
      anchorThreadId: args.anchorThreadId ?? null,
      argsJson: null,
      clientRequestId: null,
      overrides: {},
      projectPolicy: getEffectiveProjectWorkflowPolicy(
        harness.db,
        args.projectId,
      ),
      script,
      sourceTier: "inline",
    }),
  );
}

type ForcedWorkflowRunStatus = Extract<
  WorkflowRunStatus,
  "starting" | "running" | "interrupted"
>;

/**
 * Walks a run along legal transition-table edges (created→starting→running→
 * interrupted) so a test can start at the status its criterion is about
 * without replaying another criterion's full scenario. `failureReason`
 * applies to the final step (interruption reasons).
 */
export function forceWorkflowRunStatusSteps(
  harness: IntegrationHarness,
  runId: string,
  steps: readonly ForcedWorkflowRunStatus[],
  failureReason?: string,
): void {
  harness.db.transaction(
    (tx) => {
      for (const [index, newStatus] of steps.entries()) {
        transitionWorkflowRunStatusInTransaction(tx, {
          id: runId,
          newStatus,
          ...(failureReason !== undefined && index === steps.length - 1
            ? { failureReason }
            : {}),
        });
      }
    },
    { behavior: "immediate" },
  );
}

/** Settles a capacity-holding fixture run so admission tests can free a slot. */
export function settleWorkflowRunForTest(
  harness: IntegrationHarness,
  runId: string,
  status: WorkflowRunTerminalStatus,
): void {
  harness.db.transaction(
    (tx) => {
      settleWorkflowRunInTransaction(tx, {
        id: runId,
        status,
        failureReason: null,
        resultJson: null,
        usage: { inputTokens: 0, outputTokens: 0, toolUses: 0, durationMs: 0 },
      });
    },
    { behavior: "immediate" },
  );
}

const PRODUCER_ID_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";

export function nextProducerEventId(): HostDaemonProducerEventId {
  let suffix = "";
  while (suffix.length < 20) {
    suffix += PRODUCER_ID_ALPHABET[randomInt(PRODUCER_ID_ALPHABET.length)];
  }
  return hostDaemonProducerEventIdSchema.parse(`hdevt_${suffix}`);
}

export function buildRunEventEnvelope(
  runId: string,
  event: WorkflowRunEvent,
): HostDaemonWorkflowRunEventEnvelope {
  return { producerEventId: nextProducerEventId(), runId, event };
}

export function requireDaemonSessionId(harness: IntegrationHarness): string {
  const sessionId = harness.daemonApp.connection.sessionId;
  if (!sessionId) {
    throw new Error("Daemon session is not open");
  }
  return sessionId;
}

/**
 * Posts spool envelopes through the real internal ingestion route with the
 * live daemon session's credentials, asserting transport success.
 */
export async function postWorkflowRunEvents(
  harness: IntegrationHarness,
  envelopes: HostDaemonWorkflowRunEventEnvelope[],
): Promise<HostDaemonWorkflowRunEventBatchResponse> {
  const response = await harness.internal.session["workflow-run-events"].$post({
    json: {
      sessionId: requireDaemonSessionId(harness),
      events: envelopes,
    },
  });
  expect(response.status).toBe(200);
  return hostDaemonWorkflowRunEventBatchResponseSchema.parse(
    await response.json(),
  );
}

export function requireWorkflowRun(
  harness: IntegrationHarness,
  runId: string,
): WorkflowRunRow {
  const run = getWorkflowRun(harness.db, runId);
  if (!run) {
    throw new Error(`Workflow run ${runId} missing`);
  }
  return run;
}

export function requireWorkflowRunOperation(
  harness: IntegrationHarness,
  runId: string,
  kind: WorkflowRunOperationKind,
): WorkflowRunOperationRow {
  const operation = getWorkflowRunOperation(harness.db, { runId, kind });
  if (!operation) {
    throw new Error(`Workflow run operation ${runId}:${kind} missing`);
  }
  return operation;
}

async function pollUntil<T>(
  read: () => T | null,
  describeFailure: () => string,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== null) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(describeFailure());
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function waitForWorkflowRunStatus(
  harness: IntegrationHarness,
  runId: string,
  status: WorkflowRunStatus,
  timeoutMs: number,
): Promise<WorkflowRunRow> {
  return pollUntil(
    () => {
      const run = requireWorkflowRun(harness, runId);
      return run.status === status ? run : null;
    },
    () =>
      `Timed out waiting for workflow run ${runId} to reach ${status} ` +
      `(currently ${requireWorkflowRun(harness, runId).status})`,
    timeoutMs,
  );
}

export async function waitForWorkflowRunOperation(
  harness: IntegrationHarness,
  runId: string,
  kind: WorkflowRunOperationKind,
  predicate: (operation: WorkflowRunOperationRow) => boolean,
  timeoutMs: number,
): Promise<WorkflowRunOperationRow> {
  return pollUntil(
    () => {
      const operation = getWorkflowRunOperation(harness.db, { runId, kind });
      return operation && predicate(operation) ? operation : null;
    },
    () =>
      `Timed out waiting for workflow run operation ${runId}:${kind} ` +
      `(currently ${getWorkflowRunOperation(harness.db, { runId, kind })?.state ?? "missing"})`,
    timeoutMs,
  );
}

export type WorkflowStartCommand = Extract<
  HostDaemonCommand,
  { type: "workflow.start" }
>;

/**
 * The prebuilt `workflow.start` command a start/resume operation row carries
 * in its payload (commands live on the operation now — there is no command
 * table). A `commandId` of `null` on the same row means the command was never
 * dispatched as a live RPC.
 */
export function parseWorkflowStartOperationCommand(
  operation: WorkflowRunOperationRow,
): WorkflowStartCommand {
  return workflowStartCommandSchema.parse(JSON.parse(operation.payload));
}

/**
 * Asserts the run's start-like operation holds undispatched durable intent:
 * `requested` with no live execution id — the state an offline host or a full
 * admission cap leaves behind for the sweep to re-admit.
 */
export function expectWorkflowStartHeldUndispatched(
  harness: IntegrationHarness,
  runId: string,
  kind: Extract<WorkflowRunOperationKind, "start" | "resume"> = "start",
): WorkflowRunOperationRow {
  const operation = requireWorkflowRunOperation(harness, runId, kind);
  expect(operation.state).toBe("requested");
  expect(operation.commandId).toBeNull();
  return operation;
}

/**
 * Appends an `agent/completed` journal row whose payload does not parse as a
 * run event: the journal route must refuse the whole fetch loudly
 * (`workflow_run_journal_unreadable`), which the daemon maps onto the typed
 * `journal_fetch_failed` resume failure (exit criterion f's lever).
 */
export function appendCorruptJournalEventRow(
  harness: IntegrationHarness,
  runId: string,
): void {
  harness.db.transaction(
    (tx) => {
      appendWorkflowRunEventsInTransaction(tx, [
        {
          runId,
          type: "agent/completed",
          agentIndex: 0,
          payload: JSON.stringify({ type: "agent/completed" }),
          producerEventId: nextProducerEventId(),
          producerEventPayloadHash: "integration-corrupt-journal-row",
        },
      ]);
    },
    { behavior: "immediate" },
  );
}

export interface SeedOpenLocalWorkflowTaskItemArgs {
  environmentId: string | null;
  itemId: string;
  threadId: string;
}

/**
 * Seeds the latest-lifecycle row of an OPEN `local_workflow` background-task
 * item (no completed row exists), mirroring what a claude-native dynamic
 * workflow leaves behind when its daemon dies mid-task. These are exactly the
 * items `settleDanglingBackgroundTasks` still owns after the
 * BB_WORKFLOW_TASK_TYPE carve-out.
 */
export function seedOpenLocalWorkflowTaskItem(
  harness: IntegrationHarness,
  args: SeedOpenLocalWorkflowTaskItemArgs,
): void {
  const latestSequence =
    harness.db
      .select({ sequence: events.sequence })
      .from(events)
      .where(eq(events.threadId, args.threadId))
      .orderBy(desc(events.sequence))
      .limit(1)
      .get()?.sequence ?? 0;
  const result = insertEvents(harness.db, harness.hub, [
    {
      threadId: args.threadId,
      environmentId: args.environmentId,
      providerThreadId: "fake-provider-session",
      scope: threadScope(),
      sequence: latestSequence + 1,
      type: "item/backgroundTask/progress",
      itemId: args.itemId,
      itemKind: "backgroundTask",
      data: JSON.stringify({
        providerThreadId: "fake-provider-session",
        item: {
          id: args.itemId,
          type: "backgroundTask",
          taskType: "local_workflow",
          description: "fixture local workflow",
          status: "pending",
          taskStatus: "running",
          skipTranscript: false,
          workflowName: "fixture-local",
          usage: { totalTokens: 10, toolUses: 1, durationMs: 100 },
        },
      }),
    },
  ]);
  if (result.insertedCount !== 1) {
    throw new Error(
      `Failed to seed open local_workflow item on thread ${args.threadId}`,
    );
  }
}

export interface StoredBackgroundTaskRow {
  createdAt: number;
  itemId: string | null;
  sequence: number;
  taskStatus: string;
  taskType: string;
  type: string;
}

function parseBackgroundTaskRow(row: {
  createdAt: number;
  data: string;
  itemId: string | null;
  sequence: number;
  type: string;
}): StoredBackgroundTaskRow {
  const { item } = JSON.parse(row.data) as {
    item: { taskStatus: string; taskType: string };
  };
  return {
    createdAt: row.createdAt,
    itemId: row.itemId,
    sequence: row.sequence,
    taskStatus: item.taskStatus,
    taskType: item.taskType,
    type: row.type,
  };
}

export function listBackgroundTaskCompletedRows(
  harness: IntegrationHarness,
  threadId: string,
): StoredBackgroundTaskRow[] {
  return listEvents(harness.db, { threadId })
    .filter((row) => row.type === "item/backgroundTask/completed")
    .map(parseBackgroundTaskRow);
}

/** Every lifecycle row (progress or completed) for the item, in sequence order. */
export function listBackgroundTaskRowsForItem(
  harness: IntegrationHarness,
  threadId: string,
  itemId: string,
): StoredBackgroundTaskRow[] {
  return listEvents(harness.db, { threadId })
    .filter(
      (row) =>
        row.itemId === itemId &&
        (row.type === "item/backgroundTask/progress" ||
          row.type === "item/backgroundTask/completed"),
    )
    .map(parseBackgroundTaskRow)
    .sort((a, b) => a.sequence - b.sequence);
}

/** The item's latest lifecycle row (progress or completed), by sequence. */
export function latestBackgroundTaskRowForItem(
  harness: IntegrationHarness,
  threadId: string,
  itemId: string,
): StoredBackgroundTaskRow | null {
  return listBackgroundTaskRowsForItem(harness, threadId, itemId).at(-1) ?? null;
}

export interface BuildSequentialAgentWorkflowSourceArgs {
  name: string;
  prompts: readonly string[];
}

/**
 * A deterministic inline workflow that runs the given prompts as sequential
 * `agent()` turns against the fake provider (a `delay:<ms>` prompt prefix
 * controls turn duration) and returns every echoed result.
 */
export function buildSequentialAgentWorkflowSource(
  args: BuildSequentialAgentWorkflowSourceArgs,
): string {
  return [
    `export const meta = { name: ${JSON.stringify(args.name)}, description: "M3 integration fixture workflow" };`,
    "",
    "const results = [];",
    ...args.prompts.map(
      (prompt) => `results.push(await agent(${JSON.stringify(prompt)}));`,
    ),
    "return { results };",
    "",
  ].join("\n");
}

export function listWorkflowRunEventRows(
  harness: IntegrationHarness,
  runId: string,
): WorkflowRunEventRow[] {
  return listWorkflowRunEvents(harness.db, { runId });
}

export function parseWorkflowRunEventRow(
  row: WorkflowRunEventRow,
): WorkflowRunEvent {
  return workflowRunEventSchema.parse(JSON.parse(row.payload));
}

export type AgentCompletedRunEvent = Extract<
  WorkflowRunEvent,
  { type: "agent/completed" }
>;

/** Parsed agent/completed payloads (journal entries + cached flags), in sequence order. */
export function listAgentCompletedRunEvents(
  harness: IntegrationHarness,
  runId: string,
): AgentCompletedRunEvent[] {
  return listWorkflowRunEvents(harness.db, {
    runId,
    types: ["agent/completed"],
  })
    .map(parseWorkflowRunEventRow)
    .filter(
      (event): event is AgentCompletedRunEvent =>
        event.type === "agent/completed",
    );
}

export function countWorkflowRunEventsOfType(
  harness: IntegrationHarness,
  runId: string,
  type: WorkflowRunEventType,
): number {
  return listWorkflowRunEvents(harness.db, { runId, types: [type] }).length;
}

export async function waitForWorkflowRunEventCount(
  harness: IntegrationHarness,
  runId: string,
  type: WorkflowRunEventType,
  minCount: number,
  timeoutMs: number,
): Promise<void> {
  await pollUntil(
    () =>
      countWorkflowRunEventsOfType(harness, runId, type) >= minCount
        ? true
        : null,
    () =>
      `Timed out waiting for ${minCount} ${type} events on workflow run ${runId} ` +
      `(currently ${countWorkflowRunEventsOfType(harness, runId, type)})`,
    timeoutMs,
  );
}

/**
 * Clears the project's default-source flag. The public surface cannot
 * produce a default-less project (creation always seeds a default source and
 * the last source cannot be deleted), so the launch-resolution 409 criterion
 * ("a project with no default source yields the 409") needs this lever.
 */
export function clearDefaultProjectSourceFlag(
  db: DbConnection,
  projectId: string,
): void {
  db.update(projectSources)
    .set({ isDefault: false })
    .where(eq(projectSources.projectId, projectId))
    .run();
}

/**
 * Backdates every daemon-session lease for the host so the periodic sweep's
 * no-replacement-session backstop sees the lease as lapsed — "advance past
 * the 30s lease" without waiting it out in real time.
 */
export function expireHostSessionLeases(
  db: DbConnection,
  hostId: string,
): void {
  db.update(hostDaemonSessions)
    .set({ leaseExpiresAt: Date.now() - 60_000 })
    .where(eq(hostDaemonSessions.hostId, hostId))
    .run();
}

/**
 * Re-activates the host's most recent daemon session row with a fresh lease.
 * The server closes the row the moment it sees the WS close, so a plain
 * socket drop holds dispatches at the no-session gate; reviving the row
 * recreates the network-partition shape — the socket is gone but the server
 * has not noticed yet — where the live dispatch really fires into the missing
 * socket and fails `host_unavailable`. The next real session open closes the
 * revived row as "replaced".
 */
export function reviveClosedHostSession(
  db: DbConnection,
  hostId: string,
): void {
  const latest = db
    .select()
    .from(hostDaemonSessions)
    .where(eq(hostDaemonSessions.hostId, hostId))
    .orderBy(desc(hostDaemonSessions.createdAt))
    .limit(1)
    .get();
  if (!latest) {
    throw new Error(`No daemon session recorded for host ${hostId}`);
  }
  db.update(hostDaemonSessions)
    .set({
      status: "active",
      leaseExpiresAt: Date.now() + 60_000,
      closedAt: null,
      closeReason: null,
    })
    .where(eq(hostDaemonSessions.id, latest.id))
    .run();
}
