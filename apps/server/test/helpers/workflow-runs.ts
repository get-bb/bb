import { setTimeout as sleep } from "node:timers/promises";
import {
  appendWorkflowRunEventsInTransaction,
  createWorkflowRun,
  getWorkflowRun,
  getWorkflowRunOperation,
  type WorkflowRunRow,
} from "@bb/db";
import { transitionWorkflowRunStatusInTransaction } from "@bb/db/internal-lifecycle";
import {
  hostDaemonProducerEventIdSchema,
  type HostDaemonProducerEventId,
  type WorkflowRunEvent,
  type WorkflowRunOperationKind,
} from "@bb/domain";
import type { HostDaemonWorkflowRunEventEnvelope } from "@bb/host-daemon-contract";
import { resolveProjectSourcePath } from "../../src/services/projects/project-source-path.js";
import { requestWorkflowRunStart } from "../../src/services/workflows/workflow-run-lifecycle.js";
import {
  buildWorkflowRunCreateInput,
  getEffectiveProjectWorkflowPolicy,
} from "../../src/services/workflows/workflow-run-policy.js";
import { validateWorkflowScriptSource } from "../../src/services/workflows/workflow-registry.js";
import {
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  type QueuedCommand,
} from "./commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "./seed.js";
import type { TestAppHarness } from "./test-app.js";

export const WORKFLOW_SOURCE = `export const meta = {
  name: "lifecycle-flow",
  description: "Lifecycle test fixture",
};

const result = await agent("Do the work");
log(String(result));
`;

export const ZERO_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  toolUses: 0,
  durationMs: 0,
};

const PRODUCER_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";
let producerCounter = 0;

export function nextProducerEventId(): HostDaemonProducerEventId {
  producerCounter += 1;
  let value = producerCounter;
  let suffix = "";
  while (suffix.length < 20) {
    suffix += PRODUCER_ALPHABET[value % PRODUCER_ALPHABET.length];
    value = Math.floor(value / PRODUCER_ALPHABET.length);
  }
  return hostDaemonProducerEventIdSchema.parse(`hdevt_${suffix}`);
}

export function buildRunEventEnvelope(
  runId: string,
  event: WorkflowRunEvent,
): HostDaemonWorkflowRunEventEnvelope {
  return { producerEventId: nextProducerEventId(), runId, event };
}

export interface WorkflowFixture {
  hostId: string;
  projectId: string;
  sessionId: string;
}

export function seedWorkflowFixture(
  harness: TestAppHarness,
  key: string,
): WorkflowFixture {
  const { host, session } = seedHostSession(harness.deps, {
    id: `host-${key}`,
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: `/tmp/wf-${key}`,
  });
  return { hostId: host.id, projectId: project.id, sessionId: session.id };
}

/** An environment + thread on the fixture's host/project to anchor runs to. */
export function seedAnchorThread(
  harness: TestAppHarness,
  fixture: Pick<WorkflowFixture, "hostId" | "projectId">,
) {
  const environment = seedEnvironment(harness.deps, {
    hostId: fixture.hostId,
    projectId: fixture.projectId,
  });
  const thread = seedThread(harness.deps, {
    projectId: fixture.projectId,
    environmentId: environment.id,
  });
  return { environment, thread };
}

export function createRun(
  harness: TestAppHarness,
  fixture: Pick<WorkflowFixture, "projectId">,
  args: { anchorThreadId?: string | null; clientRequestId?: string } = {},
): WorkflowRunRow {
  const script = validateWorkflowScriptSource(WORKFLOW_SOURCE);
  const launchTarget = resolveProjectSourcePath(harness.deps, {
    projectId: fixture.projectId,
    hostId: null,
  });
  return createWorkflowRun(
    harness.db,
    buildWorkflowRunCreateInput({
      projectId: fixture.projectId,
      launchTarget,
      anchorThreadId: args.anchorThreadId ?? null,
      argsJson: null,
      clientRequestId: args.clientRequestId ?? null,
      overrides: {},
      projectPolicy: getEffectiveProjectWorkflowPolicy(
        harness.db,
        fixture.projectId,
      ),
      script,
      sourceTier: "inline",
    }),
  );
}

export function requireRun(
  harness: TestAppHarness,
  runId: string,
): WorkflowRunRow {
  const run = getWorkflowRun(harness.db, runId);
  if (!run) {
    throw new Error(`run ${runId} missing`);
  }
  return run;
}

export function requireOperation(
  harness: TestAppHarness,
  runId: string,
  kind: WorkflowRunOperationKind,
) {
  const operation = getWorkflowRunOperation(harness.db, { runId, kind });
  if (!operation) {
    throw new Error(`operation ${runId}:${kind} missing`);
  }
  return operation;
}

export function forceRunStatus(
  harness: TestAppHarness,
  runId: string,
  newStatus: "starting" | "running" | "interrupted",
  failureReason?: string | null,
): void {
  harness.db.transaction(
    (tx) => {
      transitionWorkflowRunStatusInTransaction(tx, {
        id: runId,
        newStatus,
        ...(failureReason !== undefined ? { failureReason } : {}),
      });
    },
    { behavior: "immediate" },
  );
}

export interface WaitForWorkflowStartCommandArgs {
  kind?: "start" | "resume";
  runId: string;
}

/**
 * Waits for the live `workflow.start` RPC dispatched for the run. The
 * operation row stores the execution id (`rpc_*`), not the RPC request id, so
 * the capture is matched on command content: `resume: null` is a start,
 * non-null a resume.
 */
export async function waitForWorkflowStartCommand(
  harness: TestAppHarness,
  args: WaitForWorkflowStartCommandArgs,
): Promise<QueuedCommand> {
  const kind = args.kind ?? "start";
  return waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "workflow.start" &&
      command.runId === args.runId &&
      (kind === "resume" ? command.resume !== null : command.resume === null),
  );
}

/**
 * Live-command settlement runs as promise continuations after the test
 * records the RPC response; every settle path moves the operation out of
 * `queued` (completed, failed, or reset to `requested` for retryable
 * failures), so polling for that transition is a deterministic barrier.
 */
async function waitForOperationToLeaveQueued(
  harness: TestAppHarness,
  runId: string,
  kind: WorkflowRunOperationKind,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const operation = getWorkflowRunOperation(harness.db, { runId, kind });
    if (!operation || operation.state !== "queued") {
      return;
    }
    await sleep(5);
  }
  throw new Error(
    `Timed out waiting for workflow run ${kind} operation of ${runId} to settle`,
  );
}

export interface ReportStartResultArgs {
  errorCode?: string;
  kind?: "start" | "resume";
  ok: boolean;
  runId: string;
}

export async function reportStartCommandResult(
  harness: TestAppHarness,
  args: ReportStartResultArgs,
): Promise<void> {
  const kind = args.kind ?? "start";
  const queued = await waitForWorkflowStartCommand(harness, {
    kind,
    runId: args.runId,
  });
  if (args.ok) {
    await reportQueuedCommandSuccess(harness, queued, { accepted: true });
  } else {
    const errorCode = args.errorCode ?? "command_failed";
    await reportQueuedCommandError(harness, queued, {
      errorCode,
      errorMessage: `daemon reported ${errorCode}`,
    });
  }
  await waitForOperationToLeaveQueued(harness, args.runId, kind);
}

/** Answers the run's live `workflow.cancel` RPC with `accepted: true`. */
export async function reportCancelCommandAccepted(
  harness: TestAppHarness,
  runId: string,
): Promise<void> {
  const queued = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "workflow.cancel" && command.runId === runId,
  );
  await reportQueuedCommandSuccess(harness, queued, { accepted: true });
  await waitForOperationToLeaveQueued(harness, runId, "cancel");
}

export function appendRunStartedEvent(
  harness: TestAppHarness,
  runId: string,
): void {
  harness.db.transaction(
    (tx) => {
      appendWorkflowRunEventsInTransaction(tx, [
        {
          runId,
          type: "run/started",
          agentIndex: null,
          payload: JSON.stringify({ type: "run/started", runId }),
          producerEventId: nextProducerEventId(),
          producerEventPayloadHash: "test-hash",
        },
      ]);
    },
    { behavior: "immediate" },
  );
}

/** Drive a freshly-created run to `running` through the real start path. */
export async function startRunToRunning(
  harness: TestAppHarness,
  runId: string,
): Promise<void> {
  await requestWorkflowRunStart(harness.deps, { runId });
  await reportStartCommandResult(harness, { runId, ok: true });
  forceRunStatus(harness, runId, "running");
}
