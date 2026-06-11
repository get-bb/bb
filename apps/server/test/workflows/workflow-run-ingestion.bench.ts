// Deterministic micro-bench for the daemon-ingress fold (M7; recorded in
// docs/workflows-local-workflow-convergence.md §8): `ingestWorkflowRunEventBatch`
// against in-memory SQLite with synthetic large-fan-out batches — the
// wire-free half of the ingress measurement (the gated integration soak in
// tests/integration/soak/ingress-p95.test.ts times the full daemon→server
// round trip). Runs only under `vitest bench` (the turbo `bench` task, like
// timeline-performance.bench.ts); never part of the default test task.
//
// Two production batch shapes:
// - a 90-agent progress batch against an anchored running run (append +
//   snapshot fold + the throttled anchor-progress path);
// - a 30-completion journal batch with 1KB results (the journal-entry write
//   path resume depends on).
// Every iteration uses fresh producer ids so the producer-idempotent append
// actually inserts (a redelivered batch would re-ack without folding).
//
// Setup happens at module scope (the timeline-performance.bench.ts
// precedent): vitest's benchmark runner does not await async beforeAll
// before warming up benches.

import { afterAll, bench, describe } from "vitest";
import type { WorkflowRunEvent } from "@bb/domain";
import { ingestWorkflowRunEventBatch } from "../../src/services/workflows/workflow-run-events.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";
import {
  buildRunEventEnvelope,
  createRun,
  forceRunStatus,
  seedAnchorThread,
  seedWorkflowFixture,
  type WorkflowFixture,
} from "../helpers/workflow-runs.js";

const PROGRESS_AGENT_COUNT = 90;
const COMPLETION_BATCH_SIZE = 30;
const COMPLETION_RESULT_TEXT = "x".repeat(1024);

interface BenchContext {
  completionRunId: string;
  fixture: WorkflowFixture;
  harness: TestAppHarness;
  progressRunId: string;
}

function agentMeta(agentIndex: number) {
  return {
    agentIndex,
    label: `bench-agent-${agentIndex}`,
    provider: "fake-provider",
  };
}

function ingest(
  context: BenchContext,
  runId: string,
  events: WorkflowRunEvent[],
): void {
  ingestWorkflowRunEventBatch(context.harness.deps, {
    hostId: context.fixture.hostId,
    events: events.map((event) => buildRunEventEnvelope(runId, event)),
  });
}

function createRunningAnchoredRun(
  harness: TestAppHarness,
  fixture: WorkflowFixture,
  anchorThreadId: string,
): string {
  const run = createRun(harness, fixture, { anchorThreadId });
  forceRunStatus(harness, run.id, "starting");
  forceRunStatus(harness, run.id, "running");
  return run.id;
}

async function createBenchContext(): Promise<BenchContext> {
  const harness = await createTestAppHarness();
  const fixture = seedWorkflowFixture(harness, "ingest-bench");
  const { thread } = seedAnchorThread(harness, fixture);
  const progressRunId = createRunningAnchoredRun(harness, fixture, thread.id);
  const completionRunId = createRunningAnchoredRun(
    harness,
    fixture,
    thread.id,
  );
  const context: BenchContext = {
    completionRunId,
    fixture,
    harness,
    progressRunId,
  };
  // Materialize all 90 agents in the snapshot first so every measured
  // progress batch folds against the steady-state 90-agent snapshot.
  ingest(
    context,
    progressRunId,
    Array.from({ length: PROGRESS_AGENT_COUNT }, (_, index) => ({
      type: "agent/started" as const,
      ...agentMeta(index + 1),
    })),
  );
  return context;
}

const context = await createBenchContext();
let completionIteration = 0;

function buildProgressBatch(): WorkflowRunEvent[] {
  return Array.from({ length: PROGRESS_AGENT_COUNT }, (_, index) => ({
    type: "agent/progress" as const,
    lastToolName: "bash",
    inputTokens: 1_000 + index,
    outputTokens: 200 + index,
    ...agentMeta(index + 1),
  }));
}

function buildCompletionBatch(): WorkflowRunEvent[] {
  completionIteration += 1;
  return Array.from({ length: COMPLETION_BATCH_SIZE }, (_, index) => ({
    type: "agent/completed" as const,
    cached: false,
    entry: {
      key: `bench-${completionIteration}-${index + 1}`,
      agentIndex: index + 1,
      branchKey: "root",
      status: "completed" as const,
      resultText: COMPLETION_RESULT_TEXT,
      usage: { inputTokens: 500, outputTokens: 120 },
      provider: "fake-provider",
      durationMs: 1_500,
    },
    ...agentMeta(index + 1),
  }));
}

describe("workflow run-event ingestion", () => {
  afterAll(async () => {
    await context.harness.cleanup();
  });

  bench(`ingest ${PROGRESS_AGENT_COUNT}-agent progress batch (anchored run)`, () => {
    ingest(context, context.progressRunId, buildProgressBatch());
  });

  bench(`ingest ${COMPLETION_BATCH_SIZE}-completion journal batch (1KB results)`, () => {
    ingest(context, context.completionRunId, buildCompletionBatch());
  });
});
