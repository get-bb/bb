import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  hostDaemonSessions,
  listEvents,
  listWorkflowRunEvents,
  truncateCompletedEventItemOutputs,
  workflowRuns,
} from "@bb/db";
import { workflowRunEventSchema } from "@bb/domain";
import type { WorkflowRunEvent } from "@bb/domain";
import {
  hostDaemonOnlineRpcCommandSchema,
  hostDaemonServerWsMessageSchema,
} from "@bb/host-daemon-contract";
import {
  ingestWorkflowRunEventBatch,
  resetWorkflowRunAnchorProgressThrottle,
} from "../../src/services/workflows/workflow-run-events.js";
import { requestWorkflowRunResume } from "../../src/services/workflows/workflow-run-lifecycle.js";
import {
  runWorkflowRunDirPruneSweep,
  runWorkflowRunRetentionSweep,
  WORKFLOW_RUN_ARCHIVE_AFTER_MS,
} from "../../src/services/workflows/workflow-run-retention.js";
import { internalAuthHeaders } from "../helpers/commands.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import {
  buildRunEventEnvelope,
  createRun,
  forceRunStatus,
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
} as const;

const JOURNAL_ENTRY = {
  key: "k1",
  agentIndex: 1,
  branchKey: "root",
  status: "completed" as const,
  resultText: "a very large agent result worth pruning",
  structured: { findings: ["a", "b"] },
  usage: { inputTokens: 50, outputTokens: 20 },
  provider: "fake-provider",
  durationMs: 900,
};

function ingest(
  harness: TestAppHarness,
  fixture: Pick<WorkflowFixture, "hostId">,
  runId: string,
  events: WorkflowRunEvent[],
): void {
  ingestWorkflowRunEventBatch(harness.deps, {
    hostId: fixture.hostId,
    events: events.map((event) => buildRunEventEnvelope(runId, event)),
  });
  resetWorkflowRunAnchorProgressThrottle();
}

function backdateRun(
  harness: TestAppHarness,
  runId: string,
  args: { settledAt?: number; updatedAt: number },
): void {
  harness.db
    .update(workflowRuns)
    .set({
      updatedAt: args.updatedAt,
      ...(args.settledAt !== undefined ? { settledAt: args.settledAt } : {}),
    })
    .where(eq(workflowRuns.id, runId))
    .run();
}

function readJournalEntries(harness: TestAppHarness, runId: string) {
  return listWorkflowRunEvents(harness.db, {
    runId,
    types: ["agent/completed", "agent/failed"],
  }).map((row) => {
    const event = workflowRunEventSchema.parse(JSON.parse(row.payload));
    if (event.type !== "agent/completed" && event.type !== "agent/failed") {
      throw new Error("unexpected journal event type");
    }
    return event.entry;
  });
}

describe("workflow run retention sweep", () => {
  it("archives terminal runs past the window and prunes journal payloads while keeping the run record", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "ret-terminal");
      const run = createRun(harness, fixture);
      await startRunToRunning(harness, run.id);
      ingest(harness, fixture, run.id, [
        {
          type: "agent/completed",
          cached: false,
          entry: JOURNAL_ENTRY,
          ...AGENT_META,
        },
        {
          type: "run/completed",
          result: { verdict: "ship it" },
          usage: { inputTokens: 50, outputTokens: 20 },
        },
      ]);
      const freshRun = createRun(harness, fixture);
      await startRunToRunning(harness, freshRun.id);

      // Within the window: untouched.
      runWorkflowRunRetentionSweep(harness.deps);
      expect(requireRun(harness, run.id).retention).toBe("live");

      const past = Date.now() - WORKFLOW_RUN_ARCHIVE_AFTER_MS - 1;
      backdateRun(harness, run.id, { settledAt: past, updatedAt: past });
      runWorkflowRunRetentionSweep(harness.deps);

      const archived = requireRun(harness, run.id);
      expect(archived.retention).toBe("archived");
      expect(archived.status).toBe("completed");
      // The run record keeps its result and usage forever…
      expect(archived.resultJson).toBe(JSON.stringify({ verdict: "ship it" }));
      expect(archived.usageInputTokens).toBe(50);
      // …while journal payloads lose their unbounded fields but stay
      // schema-valid for display.
      const entries = readJournalEntries(harness, run.id);
      expect(entries).toEqual([
        expect.objectContaining({
          key: "k1",
          status: "completed",
          resultText: "",
          usage: { inputTokens: 50, outputTokens: 20 },
        }),
      ]);
      expect(entries[0]).not.toHaveProperty("structured");

      // Live runs are untouched; a second sweep is a no-op.
      expect(requireRun(harness, freshRun.id).retention).toBe("live");
      runWorkflowRunRetentionSweep(harness.deps);
      expect(requireRun(harness, run.id).retention).toBe("archived");
    });
  });

  it("archives an abandoned interrupted run: cancels its stale resume, settles the anchor item as stopped, and blocks resume", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "ret-abandoned");
      const { thread } = seedAnchorThread(harness, fixture);
      const run = createRun(harness, fixture, { anchorThreadId: thread.id });
      await startRunToRunning(harness, run.id);
      forceRunStatus(harness, run.id, "interrupted", "host-daemon-restarted");
      // A resume was requested but the host never answered it.
      await requestWorkflowRunResume(harness.deps, { runId: run.id });
      expect(requireOperation(harness, run.id, "resume").state).toBe("queued");

      const past = Date.now() - WORKFLOW_RUN_ARCHIVE_AFTER_MS - 1;
      backdateRun(harness, run.id, { updatedAt: past });
      runWorkflowRunRetentionSweep(harness.deps);

      const archived = requireRun(harness, run.id);
      expect(archived.retention).toBe("archived");
      expect(archived.status).toBe("interrupted");
      expect(requireOperation(harness, run.id, "resume").state).toBe(
        "cancelled",
      );

      // The lifecycle module's one sanctioned settle for an abandoned run:
      // the anchor item completes as "stopped".
      const completedRows = listEvents(harness.deps.db, {
        threadId: thread.id,
      }).filter((row) => row.type === "item/backgroundTask/completed");
      expect(completedRows).toHaveLength(1);
      const { item } = JSON.parse(completedRows[0]?.data ?? "{}") as {
        item: { taskStatus: string; status: string };
      };
      expect(item).toMatchObject({
        taskStatus: "stopped",
        status: "interrupted",
      });

      // Archived runs are never resumable.
      await expect(
        requestWorkflowRunResume(harness.deps, { runId: run.id }),
      ).rejects.toMatchObject({ body: { code: "workflow_run_archived" } });
    });
  });

  it("keeps live journal payloads untouched by the completed-event output truncation sweep (structural exemption)", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "ret-truncation");
      const run = createRun(harness, fixture);
      await startRunToRunning(harness, run.id);
      ingest(harness, fixture, run.id, [
        {
          type: "agent/completed",
          cached: false,
          entry: JOURNAL_ENTRY,
          ...AGENT_META,
        },
      ]);

      // The thread-event truncation sweep scans the events table only;
      // workflow_run_events is structurally exempt while retention = live.
      truncateCompletedEventItemOutputs(harness.db, {
        createdBefore: Date.now() + 60_000,
        limit: 1000,
        truncatedAt: Date.now(),
      });

      expect(readJournalEntries(harness, run.id)).toEqual([
        expect.objectContaining({
          resultText: JOURNAL_ENTRY.resultText,
          structured: JOURNAL_ENTRY.structured,
        }),
      ]);
    });
  });

  it("refuses the journal route for archived runs", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "ret-journal");
      const run = createRun(harness, fixture);
      await startRunToRunning(harness, run.id);
      forceRunStatus(harness, run.id, "interrupted", "host-daemon-restarted");

      const past = Date.now() - WORKFLOW_RUN_ARCHIVE_AFTER_MS - 1;
      backdateRun(harness, run.id, { updatedAt: past });
      runWorkflowRunRetentionSweep(harness.deps);
      expect(requireRun(harness, run.id).retention).toBe("archived");

      const response = await harness.app.request(
        `/internal/session/workflow-run-journal?sessionId=${fixture.sessionId}&runId=${run.id}`,
        {
          method: "GET",
          headers: internalAuthHeaders(harness, { hostId: fixture.hostId }),
        },
      );
      expect(response.status).toBe(409);
    });
  });
});

describe("workflow run dir prune sweep", () => {
  /**
   * Replaces the fixture session's hub socket with one that answers
   * `workflow.prune` RPCs synchronously (the waiter registers before send, so
   * an in-send response resolves it) and records every pruned run id. A
   * `{ errorCode }` outcome answers with an RPC failure of that code (the
   * server surfaces it as an ApiError with the same code — the lever for the
   * connectivity-class batch-abandon behavior).
   */
  function installPruneResponder(
    harness: TestAppHarness,
    fixture: WorkflowFixture,
    respond: (runId: string) => { pruned: boolean } | { errorCode: string },
  ): string[] {
    const calls: string[] = [];
    harness.hub.registerDaemon(fixture.sessionId, fixture.hostId, {
      close() {},
      send(data: string) {
        const message = hostDaemonServerWsMessageSchema.parse(
          JSON.parse(data),
        );
        if (message.type !== "host-rpc.request") {
          return;
        }
        const command = hostDaemonOnlineRpcCommandSchema.parse(
          message.command,
        );
        if (command.type !== "workflow.prune") {
          return;
        }
        calls.push(command.runId);
        const outcome = respond(command.runId);
        harness.hub.recordHostOnlineRpcResponse({
          sessionId: fixture.sessionId,
          message:
            "errorCode" in outcome
              ? {
                  type: "host-rpc.response",
                  requestId: message.requestId,
                  commandType: "workflow.prune",
                  ok: false,
                  errorCode: outcome.errorCode,
                  errorMessage: "simulated stalled host",
                }
              : {
                  type: "host-rpc.response",
                  requestId: message.requestId,
                  commandType: "workflow.prune",
                  ok: true,
                  result: outcome,
                },
        });
      },
    });
    return calls;
  }

  async function archiveRun(
    harness: TestAppHarness,
    fixture: WorkflowFixture,
  ): Promise<string> {
    const run = createRun(harness, fixture);
    await startRunToRunning(harness, run.id);
    ingest(harness, fixture, run.id, [
      {
        type: "run/completed",
        result: null,
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const past = Date.now() - WORKFLOW_RUN_ARCHIVE_AFTER_MS - 1;
    backdateRun(harness, run.id, { settledAt: past, updatedAt: past });
    runWorkflowRunRetentionSweep(harness.deps);
    expect(requireRun(harness, run.id).retention).toBe("archived");
    return run.id;
  }

  it("prunes archived runs on connected hosts and converges on the durable marker", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "prune-ok");
      // Archive through the real start path first (it needs the default
      // capture socket); then swap in the prune responder.
      const archivedRunId = await archiveRun(harness, fixture);
      // A live run on the same host must never be offered for pruning.
      const liveRun = createRun(harness, fixture);
      const calls = installPruneResponder(harness, fixture, () => ({
        pruned: true,
      }));

      await runWorkflowRunDirPruneSweep(harness.deps);

      expect(calls).toEqual([archivedRunId]);
      expect(requireRun(harness, archivedRunId).runDirPrunedAt).not.toBeNull();
      expect(requireRun(harness, liveRun.id).runDirPrunedAt).toBeNull();

      // The marker stops re-sends: a second pass issues no RPC.
      await runWorkflowRunDirPruneSweep(harness.deps);
      expect(calls).toEqual([archivedRunId]);
    });
  });

  it("keeps the marker null on a refused prune and retries on later passes", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "prune-refused");
      let pruned = false;
      const archivedRunId = await archiveRun(harness, fixture);
      const calls = installPruneResponder(harness, fixture, () => ({
        pruned,
      }));

      await runWorkflowRunDirPruneSweep(harness.deps);
      expect(calls).toEqual([archivedRunId]);
      expect(requireRun(harness, archivedRunId).runDirPrunedAt).toBeNull();

      // Still refused: retried, still unmarked.
      await runWorkflowRunDirPruneSweep(harness.deps);
      expect(calls).toHaveLength(2);
      expect(requireRun(harness, archivedRunId).runDirPrunedAt).toBeNull();

      // The daemon finally lets go (run no longer live there).
      pruned = true;
      await runWorkflowRunDirPruneSweep(harness.deps);
      expect(calls).toHaveLength(3);
      expect(requireRun(harness, archivedRunId).runDirPrunedAt).not.toBeNull();
    });
  });

  it("abandons a host's remaining batch on the first connectivity-class failure and retries on a later pass", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "prune-stalled");
      let stalled = true;
      const firstRunId = await archiveRun(harness, fixture);
      const secondRunId = await archiveRun(harness, fixture);
      const calls = installPruneResponder(harness, fixture, () =>
        stalled ? { errorCode: "command_timeout" } : { pruned: true },
      );

      // The first timeout abandons this host's batch for the pass: exactly
      // one RPC was spent, not one full timeout per archived run.
      await runWorkflowRunDirPruneSweep(harness.deps);
      expect(calls).toHaveLength(1);
      expect(requireRun(harness, firstRunId).runDirPrunedAt).toBeNull();
      expect(requireRun(harness, secondRunId).runDirPrunedAt).toBeNull();

      // The host recovers: a later pass converges both markers.
      stalled = false;
      await runWorkflowRunDirPruneSweep(harness.deps);
      expect(calls).toHaveLength(3);
      expect(requireRun(harness, firstRunId).runDirPrunedAt).not.toBeNull();
      expect(requireRun(harness, secondRunId).runDirPrunedAt).not.toBeNull();
    });
  });

  it("skips hosts without an active session entirely (offline hosts retry later)", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "prune-offline");
      const archivedRunId = await archiveRun(harness, fixture);
      const calls = installPruneResponder(harness, fixture, () => ({
        pruned: true,
      }));

      // Expire the host's session lease: listConnectedHostIds drops it, so
      // the sweep never issues an RPC and the durable marker stays null.
      harness.db
        .update(hostDaemonSessions)
        .set({ leaseExpiresAt: Date.now() - 60_000 })
        .where(eq(hostDaemonSessions.hostId, fixture.hostId))
        .run();

      await runWorkflowRunDirPruneSweep(harness.deps);
      expect(calls).toEqual([]);
      expect(requireRun(harness, archivedRunId).runDirPrunedAt).toBeNull();
    });
  });
});
