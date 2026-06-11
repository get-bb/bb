import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listEvents,
  listWorkflowRunEvents,
  ProducerEventPayloadMismatchError,
} from "@bb/db";
import { workflowProgressSnapshotSchema } from "@bb/domain";
import type { WorkflowProgressSnapshot, WorkflowRunEvent } from "@bb/domain";
import {
  foldWorkflowRunEventIntoSnapshot,
  ingestWorkflowRunEventBatch,
  resetWorkflowRunAnchorProgressThrottle,
  WORKFLOW_RUN_ANCHOR_PROGRESS_THROTTLE_MS,
} from "../../src/services/workflows/workflow-run-events.js";
import {
  requestWorkflowRunResume,
  requestWorkflowRunStart,
} from "../../src/services/workflows/workflow-run-lifecycle.js";
import {
  internalAuthHeaders,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { seedThreadRuntimeState } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import {
  buildRunEventEnvelope,
  createRun,
  forceRunStatus,
  reportStartCommandResult,
  requireOperation,
  requireRun,
  seedAnchorThread,
  seedWorkflowFixture,
  startRunToRunning,
  type WorkflowFixture,
} from "../helpers/workflow-runs.js";

const AGENT_META = {
  agentIndex: 1,
  label: "researcher",
  provider: "fake-provider",
  model: "fake-model",
} as const;

function completedEntry(overrides: { resultText?: string } = {}) {
  return {
    key: "k1",
    agentIndex: 1,
    branchKey: "root",
    status: "completed" as const,
    resultText: overrides.resultText ?? "the answer",
    usage: { inputTokens: 100, outputTokens: 40 },
    provider: "fake-provider",
    durationMs: 1200,
  };
}

function ingest(
  harness: TestAppHarness,
  fixture: Pick<WorkflowFixture, "hostId">,
  runId: string,
  events: WorkflowRunEvent[],
) {
  return ingestWorkflowRunEventBatch(harness.deps, {
    hostId: fixture.hostId,
    events: events.map((event) => buildRunEventEnvelope(runId, event)),
  });
}

/** Drive a created run to `starting` through the real start path. */
async function startRunToStarting(
  harness: TestAppHarness,
  runId: string,
): Promise<void> {
  await requestWorkflowRunStart(harness.deps, { runId });
  await reportStartCommandResult(harness, { runId, ok: true });
}

function listAnchorRows(
  harness: TestAppHarness,
  threadId: string,
  type: "item/backgroundTask/completed" | "item/backgroundTask/progress",
) {
  return listEvents(harness.deps.db, { threadId })
    .filter((row) => row.type === type)
    .map((row) => {
      const { item } = JSON.parse(row.data) as {
        item: {
          id: string;
          taskType: string;
          taskStatus: string;
          status: string;
          workflow?: WorkflowProgressSnapshot;
          usage?: { totalTokens: number };
        };
      };
      return item;
    });
}

function parseSnapshot(harness: TestAppHarness, runId: string) {
  const run = requireRun(harness, runId);
  if (run.progressSnapshot === null) {
    return null;
  }
  return workflowProgressSnapshotSchema.parse(JSON.parse(run.progressSnapshot));
}

afterEach(() => {
  vi.useRealTimers();
  resetWorkflowRunAnchorProgressThrottle();
});

describe("workflow run event ingestion", () => {
  it("appends, transitions on run/started, finalizes on run/completed, and re-acks a redelivered batch without re-firing side effects", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "ingest-happy");
      const { thread } = seedAnchorThread(harness, fixture);
      const run = createRun(harness, fixture, { anchorThreadId: thread.id });
      await startRunToStarting(harness, run.id);

      const events: WorkflowRunEvent[] = [
        { type: "run/started", runId: run.id },
        { type: "agent/queued", promptPreview: "Do the work", ...AGENT_META },
        { type: "agent/started", ...AGENT_META },
        {
          type: "agent/completed",
          cached: false,
          entry: completedEntry(),
          ...AGENT_META,
        },
        {
          type: "run/completed",
          result: { answer: 42 },
          usage: { inputTokens: 100, outputTokens: 40 },
        },
      ];
      const envelopes = events.map((event) =>
        buildRunEventEnvelope(run.id, event),
      );

      const first = ingestWorkflowRunEventBatch(harness.deps, {
        hostId: fixture.hostId,
        events: envelopes,
      });
      expect(first.rejectedEvents).toEqual([]);
      expect(first.acceptedEvents.map((event) => event.sequence)).toEqual([
        1, 2, 3, 4, 5,
      ]);

      const settled = requireRun(harness, run.id);
      expect(settled.status).toBe("completed");
      expect(settled.resultJson).toBe(JSON.stringify({ answer: 42 }));
      expect(settled.usageInputTokens).toBe(100);
      expect(settled.usageOutputTokens).toBe(40);
      expect(settled.settledAt).not.toBeNull();
      expect(settled.startedAt).not.toBeNull();

      // The single anchor completed row, carrying usage and the snapshot.
      const completedRows = listAnchorRows(
        harness,
        thread.id,
        "item/backgroundTask/completed",
      );
      expect(completedRows).toHaveLength(1);
      expect(completedRows[0]).toMatchObject({
        id: run.id,
        taskType: "bb_workflow",
        taskStatus: "completed",
        status: "completed",
        usage: { totalTokens: 140 },
      });
      expect(completedRows[0]?.workflow?.agents[0]).toMatchObject({
        index: 1,
        state: "done",
        cached: false,
      });

      // Redelivery: identical producer ids re-ack with the original
      // sequences; nothing is re-inserted and no side effect re-fires.
      const second = ingestWorkflowRunEventBatch(harness.deps, {
        hostId: fixture.hostId,
        events: envelopes,
      });
      expect(second.acceptedEvents).toEqual(first.acceptedEvents);
      expect(
        listWorkflowRunEvents(harness.db, { runId: run.id }),
      ).toHaveLength(5);
      expect(
        listAnchorRows(harness, thread.id, "item/backgroundTask/completed"),
      ).toHaveLength(1);
      expect(requireRun(harness, run.id).status).toBe("completed");
    });
  });

  it("rejects events for unknown runs and runs owned by another host, accepting the rest", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "ingest-owned");
      const foreignFixture = seedWorkflowFixture(harness, "ingest-foreign");
      const run = createRun(harness, fixture);
      const foreignRun = createRun(harness, foreignFixture);
      await startRunToStarting(harness, run.id);

      const result = ingestWorkflowRunEventBatch(harness.deps, {
        hostId: fixture.hostId,
        events: [
          buildRunEventEnvelope(run.id, {
            type: "run/started",
            runId: run.id,
          }),
          buildRunEventEnvelope(foreignRun.id, {
            type: "run/started",
            runId: foreignRun.id,
          }),
          buildRunEventEnvelope("wfr_does_not_exist", {
            type: "log",
            message: "hello",
          }),
        ],
      });

      expect(result.acceptedEvents).toHaveLength(1);
      expect(result.rejectedEvents).toEqual([
        expect.objectContaining({
          runId: foreignRun.id,
          reason: "run_not_owned_by_host",
        }),
        expect.objectContaining({
          runId: "wfr_does_not_exist",
          reason: "run_not_owned_by_host",
        }),
      ]);
      expect(requireRun(harness, run.id).status).toBe("running");
      expect(requireRun(harness, foreignRun.id).status).toBe("created");
      expect(
        listWorkflowRunEvents(harness.db, { runId: foreignRun.id }),
      ).toHaveLength(0);
    });
  });

  it("throws on a producer id reused with a different payload", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "ingest-mismatch");
      const run = createRun(harness, fixture);
      await startRunToStarting(harness, run.id);

      const envelope = buildRunEventEnvelope(run.id, {
        type: "log",
        message: "original",
      });
      ingestWorkflowRunEventBatch(harness.deps, {
        hostId: fixture.hostId,
        events: [envelope],
      });

      expect(() =>
        ingestWorkflowRunEventBatch(harness.deps, {
          hostId: fixture.hostId,
          events: [{ ...envelope, event: { type: "log", message: "altered" } }],
        }),
      ).toThrow(ProducerEventPayloadMismatchError);
    });
  });

  it("folds every batch into the snapshot but throttles anchor progress rows to one per window, bypassing on status changes", async () => {
    await withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const baseTime = Date.now();
      vi.setSystemTime(baseTime);

      const fixture = seedWorkflowFixture(harness, "ingest-throttle");
      const { thread } = seedAnchorThread(harness, fixture);
      const run = createRun(harness, fixture, { anchorThreadId: thread.id });
      await startRunToStarting(harness, run.id);

      // Batch 1: status change (starting → running) bypasses the throttle.
      ingest(harness, fixture, run.id, [
        { type: "run/started", runId: run.id },
        { type: "agent/queued", promptPreview: "p", ...AGENT_META },
      ]);
      expect(
        listAnchorRows(harness, thread.id, "item/backgroundTask/progress"),
      ).toHaveLength(1);

      // Batch 2 inside the window: snapshot still folds, no anchor row.
      vi.setSystemTime(baseTime + 100);
      ingest(harness, fixture, run.id, [
        { type: "agent/started", ...AGENT_META },
        { type: "agent/progress", lastToolName: "bash", ...AGENT_META },
      ]);
      expect(
        listAnchorRows(harness, thread.id, "item/backgroundTask/progress"),
      ).toHaveLength(1);
      expect(parseSnapshot(harness, run.id)?.agents[0]).toMatchObject({
        state: "running",
        lastToolName: "bash",
      });

      // Batch 3 past the window appends the next anchor row.
      vi.setSystemTime(
        baseTime + 100 + WORKFLOW_RUN_ANCHOR_PROGRESS_THROTTLE_MS,
      );
      ingest(harness, fixture, run.id, [
        {
          type: "agent/completed",
          cached: true,
          entry: completedEntry(),
          ...AGENT_META,
        },
      ]);
      const progressRows = listAnchorRows(
        harness,
        thread.id,
        "item/backgroundTask/progress",
      );
      expect(progressRows).toHaveLength(2);
      expect(progressRows[1]?.taskStatus).toBe("running");
      expect(progressRows[1]?.workflow?.agents[0]).toMatchObject({
        state: "done",
        cached: true,
      });
    });
  });

  it("settles an interrupted run when the real terminal outcome arrives late (criterion g)", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "ingest-supersede");
      const { thread } = seedAnchorThread(harness, fixture);
      const run = createRun(harness, fixture, { anchorThreadId: thread.id });
      await startRunToRunning(harness, run.id);
      forceRunStatus(harness, run.id, "interrupted", "host-daemon-restarted");

      ingest(harness, fixture, run.id, [
        {
          type: "run/completed",
          result: "late but real",
          usage: { inputTokens: 10, outputTokens: 5 },
        },
      ]);

      const settled = requireRun(harness, run.id);
      expect(settled.status).toBe("completed");
      expect(settled.failureReason).toBeNull();
      expect(settled.resultJson).toBe(JSON.stringify("late but real"));
      expect(
        listAnchorRows(harness, thread.id, "item/backgroundTask/completed"),
      ).toHaveLength(1);
    });
  });

  it("never changes a terminal status from late events, which still append as history", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "ingest-terminal");
      const { thread } = seedAnchorThread(harness, fixture);
      const run = createRun(harness, fixture, { anchorThreadId: thread.id });
      await startRunToRunning(harness, run.id);

      ingest(harness, fixture, run.id, [
        {
          type: "run/completed",
          result: null,
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ]);
      expect(requireRun(harness, run.id).status).toBe("completed");
      const settledSnapshot = requireRun(harness, run.id).progressSnapshot;

      // A late duplicate terminal (fresh producer ids) and trailing progress:
      // rows append, nothing else changes.
      ingest(harness, fixture, run.id, [
        { type: "agent/progress", lastToolName: "bash", ...AGENT_META },
        {
          type: "run/failed",
          error: "late contradictory terminal",
          usage: { inputTokens: 9, outputTokens: 9 },
        },
      ]);

      const after = requireRun(harness, run.id);
      expect(after.status).toBe("completed");
      expect(after.usageInputTokens).toBe(1);
      expect(after.progressSnapshot).toBe(settledSnapshot);
      expect(listWorkflowRunEvents(harness.db, { runId: run.id })).toHaveLength(
        3,
      );
      expect(
        listAnchorRows(harness, thread.id, "item/backgroundTask/completed"),
      ).toHaveLength(1);
      expect(
        listAnchorRows(harness, thread.id, "item/backgroundTask/progress"),
      ).toHaveLength(0);
    });
  });

  it("cancels an in-flight resume (op + queued command) when a late terminal event supersedes the interruption", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "ingest-resume-supersede");
      const run = createRun(harness, fixture);
      await startRunToRunning(harness, run.id);
      forceRunStatus(harness, run.id, "interrupted", "host-daemon-restarted");

      // User requests a resume while the run is interrupted; the live RPC is
      // dispatched but the daemon has not answered it yet.
      await requestWorkflowRunResume(harness.deps, { runId: run.id });
      const resumeOperation = requireOperation(harness, run.id, "resume");
      expect(resumeOperation.state).toBe("queued");
      const resumeRpc = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workflow.start" &&
          command.runId === run.id &&
          command.resume !== null,
      );

      // The daemon's spool flush lands the segment's REAL outcome late:
      // interrupted → failed supersede.
      ingest(harness, fixture, run.id, [
        {
          type: "run/failed",
          error: "the real outcome",
          usage: { inputTokens: 2, outputTokens: 1 },
        },
      ]);

      expect(requireRun(harness, run.id).status).toBe("failed");
      // The resume can never legally run again — finalize cancelled the op,
      // so the daemon never re-spawns (and never re-bills) the now-terminal
      // run; the in-flight RPC's late ack settles as a no-op against the
      // cancelled operation.
      expect(requireOperation(harness, run.id, "resume").state).toBe(
        "cancelled",
      );
      await reportQueuedCommandSuccess(harness, resumeRpc, { accepted: true });
      expect(requireOperation(harness, run.id, "resume").state).toBe(
        "cancelled",
      );
      expect(requireRun(harness, run.id).status).toBe("failed");
    });
  });

  it("appends a late run/cancelled for an interrupted run without settling it (stays resumable)", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "ingest-cancel-late");
      const run = createRun(harness, fixture);
      await startRunToRunning(harness, run.id);
      forceRunStatus(harness, run.id, "interrupted", "host-daemon-restarted");

      ingest(harness, fixture, run.id, [
        {
          type: "run/cancelled",
          usage: { inputTokens: 3, outputTokens: 2 },
        },
      ]);

      const after = requireRun(harness, run.id);
      expect(after.status).toBe("interrupted");
      expect(after.failureReason).toBe("host-daemon-restarted");
      expect(listWorkflowRunEvents(harness.db, { runId: run.id })).toHaveLength(
        1,
      );
    });
  });

  it("queues the single manager terminal notification when the anchor thread is a manager", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "ingest-manager");
      const { environment, thread } = seedAnchorThread(harness, fixture);
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-manager-wf",
        inputText: "Manage things",
        model: "fake-model",
      });
      const run = createRun(harness, fixture, { anchorThreadId: thread.id });
      await startRunToRunning(harness, run.id);

      ingest(harness, fixture, run.id, [
        {
          type: "run/completed",
          result: "done",
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ]);

      // The deferred notification queues a manager turn (a live turn.submit
      // rides it; answering it is not needed for the queued event row).
      await vi.waitFor(() => {
        // seedThreadRuntimeState seeds one prior turn request; exactly one
        // NEW request carries the run's terminal notification.
        const requested = listEvents(harness.deps.db, {
          threadId: thread.id,
        }).filter(
          (row) =>
            row.type === "client/turn/requested" && row.data.includes(run.id),
        );
        expect(requested).toHaveLength(1);
        expect(requested[0]?.data).toContain("completed");
      });
    });
  });
});

describe("foldWorkflowRunEventIntoSnapshot", () => {
  it("tracks phases and the agent lifecycle including failures", () => {
    const snapshot: WorkflowProgressSnapshot = { phases: [], agents: [] };
    const meta = { ...AGENT_META, phaseIndex: 1, phaseTitle: "Research" };

    foldWorkflowRunEventIntoSnapshot(
      snapshot,
      { type: "phase/started", phaseIndex: 1, title: "Research" },
      1000,
    );
    foldWorkflowRunEventIntoSnapshot(
      snapshot,
      { type: "agent/queued", promptPreview: "p1", ...meta },
      1000,
    );
    foldWorkflowRunEventIntoSnapshot(
      snapshot,
      {
        type: "agent/queued",
        promptPreview: "p2",
        ...meta,
        agentIndex: 2,
        label: "checker",
      },
      1000,
    );
    foldWorkflowRunEventIntoSnapshot(
      snapshot,
      { type: "agent/started", ...meta },
      2000,
    );
    foldWorkflowRunEventIntoSnapshot(
      snapshot,
      {
        type: "agent/failed",
        error: "provider exploded",
        entry: {
          ...completedEntry(),
          status: "failed",
          usage: { inputTokens: 7, outputTokens: 3 },
        },
        ...meta,
      },
      3000,
    );

    expect(snapshot.phases).toEqual([{ index: 1, title: "Research" }]);
    expect(snapshot.agents).toHaveLength(2);
    expect(snapshot.agents[0]).toMatchObject({
      index: 1,
      label: "researcher",
      state: "failed",
      error: "provider exploded",
      tokens: 10,
      phaseIndex: 1,
      phaseTitle: "Research",
      startedAt: 2000,
      queuedAt: 1000,
      lastProgressAt: 3000,
    });
    expect(snapshot.agents[1]).toMatchObject({
      index: 2,
      label: "checker",
      state: "queued",
      promptPreview: "p2",
    });
    // The fold output always satisfies the persisted snapshot schema.
    expect(workflowProgressSnapshotSchema.parse(snapshot)).toBeTruthy();
  });
});

describe("internal workflow run routes", () => {
  it("ingests over HTTP, 409s on payload mismatch, and serves the journal with completed AND failed entries", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "route-journal");
      const run = createRun(harness, fixture);
      await startRunToStarting(harness, run.id);

      const envelopes = [
        buildRunEventEnvelope(run.id, { type: "run/started", runId: run.id }),
        buildRunEventEnvelope(run.id, {
          type: "agent/completed",
          cached: false,
          entry: completedEntry({ resultText: "first agent result" }),
          ...AGENT_META,
        }),
        buildRunEventEnvelope(run.id, {
          type: "agent/failed",
          error: "boom",
          entry: {
            ...completedEntry(),
            key: "k2",
            agentIndex: 2,
            status: "failed" as const,
            resultText: "",
            usage: { inputTokens: 11, outputTokens: 2 },
          },
          ...AGENT_META,
          agentIndex: 2,
        }),
      ];

      const postResponse = await harness.app.request(
        "/internal/session/workflow-run-events",
        {
          method: "POST",
          headers: internalAuthHeaders(harness, { hostId: fixture.hostId }),
          body: JSON.stringify({
            sessionId: fixture.sessionId,
            events: envelopes,
          }),
        },
      );
      expect(postResponse.status).toBe(200);
      const body = (await postResponse.json()) as {
        acceptedEvents: Array<{ sequence: number }>;
        rejectedEvents: unknown[];
      };
      expect(body.acceptedEvents.map((event) => event.sequence)).toEqual([
        1, 2, 3,
      ]);
      expect(body.rejectedEvents).toEqual([]);

      // Same producer id, different payload → 409, nothing stored.
      const mismatchResponse = await harness.app.request(
        "/internal/session/workflow-run-events",
        {
          method: "POST",
          headers: internalAuthHeaders(harness, { hostId: fixture.hostId }),
          body: JSON.stringify({
            sessionId: fixture.sessionId,
            events: [
              {
                ...envelopes[0],
                event: { type: "log", message: "different payload" },
              },
            ],
          }),
        },
      );
      expect(mismatchResponse.status).toBe(409);

      const journalResponse = await harness.app.request(
        `/internal/session/workflow-run-journal?sessionId=${fixture.sessionId}&runId=${run.id}`,
        {
          method: "GET",
          headers: internalAuthHeaders(harness, { hostId: fixture.hostId }),
        },
      );
      expect(journalResponse.status).toBe(200);
      const journal = (await journalResponse.json()) as {
        entries: Array<{ key: string; status: string; resultText: string }>;
      };
      // Both event types, in sequence order — failed entries pin indexes
      // and billed usage.
      expect(journal.entries).toEqual([
        expect.objectContaining({
          key: "k1",
          status: "completed",
          resultText: "first agent result",
        }),
        expect.objectContaining({ key: "k2", status: "failed" }),
      ]);

      // A run on another host is invisible to this session.
      const foreignFixture = seedWorkflowFixture(harness, "route-foreign");
      const foreignRun = createRun(harness, foreignFixture);
      const forbiddenResponse = await harness.app.request(
        `/internal/session/workflow-run-journal?sessionId=${fixture.sessionId}&runId=${foreignRun.id}`,
        {
          method: "GET",
          headers: internalAuthHeaders(harness, { hostId: fixture.hostId }),
        },
      );
      expect(forbiddenResponse.status).toBe(403);

      // Terminal runs refuse the journal: a raced resume (command fetched
      // before a late-supersede settle cancelled it) must fail typed instead
      // of re-executing a settled run.
      // (The first batch's run/started already moved the run to `running`.)
      ingest(harness, fixture, run.id, [
        {
          type: "run/completed",
          result: null,
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ]);
      const terminalResponse = await harness.app.request(
        `/internal/session/workflow-run-journal?sessionId=${fixture.sessionId}&runId=${run.id}`,
        {
          method: "GET",
          headers: internalAuthHeaders(harness, { hostId: fixture.hostId }),
        },
      );
      expect(terminalResponse.status).toBe(409);
      const terminalBody = (await terminalResponse.json()) as { code: string };
      expect(terminalBody.code).toBe("workflow_run_not_resumable");
    });
  });
});
