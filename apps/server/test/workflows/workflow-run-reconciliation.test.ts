import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeSession,
  getWorkflowRunOperation,
  hostDaemonSessions,
  listEvents,
} from "@bb/db";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import { DAEMON_DISCONNECT_GRACE_MS } from "../../src/constants.js";
import {
  handleDaemonSocketClosed,
  handleExpiredHostSessionLeases,
} from "../../src/internal/session-owner-side-effects.js";
import {
  finalizeWorkflowRunInTransaction,
  requestWorkflowRunCancel,
  requestWorkflowRunResume,
  runWorkflowRunLifecycleSweep,
  WORKFLOW_RUN_HOST_SESSION_EXPIRED_REASON,
} from "../../src/services/workflows/workflow-run-lifecycle.js";
import { ingestWorkflowRunEventBatch } from "../../src/services/workflows/workflow-run-events.js";
import {
  reconcileDaemonReportedWorkflowRuns,
  runWorkflowRunInterruptionBackstopSweep,
  WORKFLOW_RUN_DAEMON_RESTARTED_REASON,
} from "../../src/services/workflows/workflow-run-reconciliation.js";
import {
  internalAuthHeaders,
  listQueuedWorkflowRunCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import {
  seedHost,
  seedSession,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import {
  buildRunEventEnvelope,
  createRun,
  forceRunStatus,
  reportCancelCommandAccepted,
  reportStartCommandResult,
  requireOperation,
  requireRun,
  seedAnchorThread,
  seedWorkflowFixture,
  startRunToRunning,
} from "../helpers/workflow-runs.js";

function listAnchorTaskStatuses(
  harness: TestAppHarness,
  threadId: string,
): Array<{ type: string; taskStatus: string; itemStatus: string }> {
  return listEvents(harness.deps.db, { threadId })
    .filter(
      (row) =>
        row.type === "item/backgroundTask/progress" ||
        row.type === "item/backgroundTask/completed",
    )
    .map((row) => {
      const { item } = JSON.parse(row.data) as {
        item: { taskStatus: string; status: string };
      };
      return {
        type: row.type,
        taskStatus: item.taskStatus,
        itemStatus: item.status,
      };
    });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("reconcileDaemonReportedWorkflowRuns", () => {
  it("bucket (b): interrupts unreported running runs with the paused anchor row, leaving reported runs untouched", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "rec-bucket-b");
      const { thread } = seedAnchorThread(harness, fixture);
      const missingRun = createRun(harness, fixture, {
        anchorThreadId: thread.id,
      });
      const reportedRun = createRun(harness, fixture);
      await startRunToRunning(harness, missingRun.id);
      await startRunToRunning(harness, reportedRun.id);

      await reconcileDaemonReportedWorkflowRuns(harness.deps, {
        activeWorkflowRunIds: [reportedRun.id],
        hostId: fixture.hostId,
      });

      const interrupted = requireRun(harness, missingRun.id);
      expect(interrupted.status).toBe("interrupted");
      expect(interrupted.failureReason).toBe(
        WORKFLOW_RUN_DAEMON_RESTARTED_REASON,
      );
      expect(requireRun(harness, reportedRun.id).status).toBe("running");

      // Paused snapshot, never a completed row: the anchor item stays open.
      expect(listAnchorTaskStatuses(harness, thread.id)).toEqual([
        {
          type: "item/backgroundTask/progress",
          taskStatus: "paused",
          itemStatus: "pending",
        },
      ]);
      // No workflow.cancel dispatched for an interrupted run.
      expect(
        listQueuedWorkflowRunCommands(harness, "workflow.cancel"),
      ).toHaveLength(0);
    });
  });

  it("bucket (c): revives reported interrupted runs and clears the failure reason", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "rec-bucket-c");
      const run = createRun(harness, fixture);
      await startRunToRunning(harness, run.id);
      forceRunStatus(
        harness,
        run.id,
        "interrupted",
        WORKFLOW_RUN_DAEMON_RESTARTED_REASON,
      );

      await reconcileDaemonReportedWorkflowRuns(harness.deps, {
        activeWorkflowRunIds: [run.id],
        hostId: fixture.hostId,
      });

      const revived = requireRun(harness, run.id);
      expect(revived.status).toBe("running");
      expect(revived.failureReason).toBeNull();
      expect(
        listQueuedWorkflowRunCommands(harness, "workflow.cancel"),
      ).toHaveLength(0);
    });
  });

  it("bucket (d): dispatches workflow.cancel only for reported true-terminal runs", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "rec-bucket-d");
      const terminalRun = createRun(harness, fixture);
      const interruptedRun = createRun(harness, fixture);
      await startRunToRunning(harness, terminalRun.id);
      await startRunToRunning(harness, interruptedRun.id);
      harness.db.transaction(
        (tx) => {
          finalizeWorkflowRunInTransaction(
            { db: tx, hub: harness.hub },
            {
              runId: terminalRun.id,
              status: "cancelled",
              failureReason: null,
              resultJson: null,
              usage: {
                inputTokens: 0,
                outputTokens: 0,
                toolUses: 0,
                durationMs: 0,
              },
            },
          );
        },
        { behavior: "immediate" },
      );
      forceRunStatus(
        harness,
        interruptedRun.id,
        "interrupted",
        WORKFLOW_RUN_DAEMON_RESTARTED_REASON,
      );

      // The daemon reports BOTH as alive after a restart.
      await reconcileDaemonReportedWorkflowRuns(harness.deps, {
        activeWorkflowRunIds: [terminalRun.id, interruptedRun.id],
        hostId: fixture.hostId,
      });

      // The terminal run converges via workflow.cancel…
      expect(requireOperation(harness, terminalRun.id, "cancel").state).toBe(
        "queued",
      );
      await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workflow.cancel" &&
          command.runId === terminalRun.id,
      );
      expect(
        listQueuedWorkflowRunCommands(harness, "workflow.cancel"),
      ).toHaveLength(1);
      // …while the interrupted run is revived, never cancelled.
      expect(requireRun(harness, interruptedRun.id).status).toBe("running");
      expect(
        getWorkflowRunOperation(harness.db, {
          runId: interruptedRun.id,
          kind: "cancel",
        }),
      ).toBeNull();
    });
  });

  it("bucket (c) revival cancels a pending resume op the revived run makes unreachable", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "rec-revive-resume");
      const run = createRun(harness, fixture);
      await startRunToRunning(harness, run.id);
      forceRunStatus(
        harness,
        run.id,
        "interrupted",
        WORKFLOW_RUN_DAEMON_RESTARTED_REASON,
      );
      await requestWorkflowRunResume(harness.deps, { runId: run.id });
      expect(requireOperation(harness, run.id, "resume").state).toBe("queued");

      await reconcileDaemonReportedWorkflowRuns(harness.deps, {
        activeWorkflowRunIds: [run.id],
        hostId: fixture.hostId,
      });

      expect(requireRun(harness, run.id).status).toBe("running");
      // A `running` run can never advance a resume op: left active it would
      // silently auto-resume (and re-bill) on the NEXT interruption.
      expect(requireOperation(harness, run.id, "resume").state).toBe(
        "cancelled",
      );
    });
  });

  it("durable user cancel intent survives lease-expiry interruption and lands after revival", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "rec-cancel-survives");
      const run = createRun(harness, fixture);
      await startRunToRunning(harness, run.id);

      // The user cancels, then the daemon dies before answering the cancel
      // RPC: the connectivity failure resets the durable intent to
      // `requested` instead of dropping it.
      await requestWorkflowRunCancel(harness.deps, { runId: run.id });
      expect(requireOperation(harness, run.id, "cancel").state).toBe("queued");
      closeSession(harness.db, harness.hub, fixture.sessionId, "expired");
      handleExpiredHostSessionLeases(harness.deps, {
        expiredLeases: {
          expiredHostIds: [fixture.hostId],
          expiredSessionIds: [fixture.sessionId],
          sessionsClosed: 1,
        },
      });
      expect(requireRun(harness, run.id).status).toBe("interrupted");
      // The cancel intent survived interruption, and the in-flight RPC's
      // host_unavailable settle reset it to `requested` for re-dispatch.
      await vi.waitFor(() => {
        expect(requireOperation(harness, run.id, "cancel").state).toBe(
          "requested",
        );
      });

      // Same-instance reconnect: the runner survived sleep, the run revives.
      seedSession(harness.deps, fixture.hostId);
      await reconcileDaemonReportedWorkflowRuns(harness.deps, {
        activeWorkflowRunIds: [run.id],
        hostId: fixture.hostId,
      });
      expect(requireRun(harness, run.id).status).toBe("running");
      expect(requireOperation(harness, run.id, "cancel").state).toBe(
        "requested",
      );

      // The sweep re-dispatches the surviving intent over the new session;
      // the daemon aborts the runner and the spooled run/cancelled settles
      // the run: the user's cancel landed.
      await runWorkflowRunLifecycleSweep(harness.deps);
      await reportCancelCommandAccepted(harness, run.id);
      expect(requireOperation(harness, run.id, "cancel").state).toBe(
        "completed",
      );
      ingestWorkflowRunEventBatch(harness.deps, {
        hostId: fixture.hostId,
        events: [
          buildRunEventEnvelope(run.id, {
            type: "run/cancelled",
            usage: { inputTokens: 1, outputTokens: 1 },
          }),
        ],
      });
      expect(requireRun(harness, run.id).status).toBe("cancelled");
    });
  });

  it("queues the manager 'run paused' message exactly once across an interrupt + revive cycle", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "rec-paused-message");
      const { environment, thread } = seedAnchorThread(harness, fixture);
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-manager-paused",
        inputText: "Manage things",
        model: "fake-model",
      });
      const run = createRun(harness, fixture, { anchorThreadId: thread.id });
      await startRunToRunning(harness, run.id);

      // Bucket (b): the daemon restarted without the run.
      await reconcileDaemonReportedWorkflowRuns(harness.deps, {
        activeWorkflowRunIds: [],
        hostId: fixture.hostId,
      });
      expect(requireRun(harness, run.id).status).toBe("interrupted");

      const listPausedNotifications = () =>
        listEvents(harness.deps.db, { threadId: thread.id }).filter(
          (row) =>
            row.type === "client/turn/requested" && row.data.includes(run.id),
        );
      await vi.waitFor(() => {
        const requested = listPausedNotifications();
        expect(requested).toHaveLength(1);
        expect(requested[0]?.data).toContain("paused");
        expect(requested[0]?.data).toContain("bb workflow resume");
      });

      // Bucket (c) revival queues NO second message — the paused message is
      // queued exactly once per interrupt + revive cycle.
      await reconcileDaemonReportedWorkflowRuns(harness.deps, {
        activeWorkflowRunIds: [run.id],
        hostId: fixture.hostId,
      });
      expect(requireRun(harness, run.id).status).toBe("running");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(listPausedNotifications()).toHaveLength(1);
    });
  });

  it("queues exactly one terminal notification across an interrupt + resume cycle (M5 exit criterion)", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "rec-terminal-once");
      const { environment, thread } = seedAnchorThread(harness, fixture);
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-manager-terminal",
        inputText: "Manage things",
        model: "fake-model",
      });
      const run = createRun(harness, fixture, { anchorThreadId: thread.id });
      await startRunToRunning(harness, run.id);

      const listRunNotifications = () =>
        listEvents(harness.deps.db, { threadId: thread.id }).filter(
          (row) =>
            row.type === "client/turn/requested" && row.data.includes(run.id),
        );

      // Interrupt (bucket b): the paused informational message — a different
      // message about a different transition than the terminal notification.
      await reconcileDaemonReportedWorkflowRuns(harness.deps, {
        activeWorkflowRunIds: [],
        hostId: fixture.hostId,
      });
      expect(requireRun(harness, run.id).status).toBe("interrupted");
      await vi.waitFor(() => {
        const requested = listRunNotifications();
        expect(requested).toHaveLength(1);
        expect(requested[0]?.data).toContain("was paused");
      });

      // Settle the paused message's live manager turn dispatch so the
      // manager thread converges before the terminal message arrives.
      const pausedTurnSubmit = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "turn.submit" && command.threadId === thread.id,
      );
      await reportQueuedCommandSuccess(harness, pausedTurnSubmit, {
        appliedAs: "new-turn",
      });

      // Explicit resume: the acceptance ack moves interrupted → starting,
      // the resume segment's run/started moves it to running.
      await requestWorkflowRunResume(harness.deps, { runId: run.id });
      await reportStartCommandResult(harness, {
        runId: run.id,
        ok: true,
        kind: "resume",
      });
      expect(requireRun(harness, run.id).status).toBe("starting");
      ingestWorkflowRunEventBatch(harness.deps, {
        hostId: fixture.hostId,
        events: [
          buildRunEventEnvelope(run.id, { type: "run/started", runId: run.id }),
        ],
      });
      expect(requireRun(harness, run.id).status).toBe("running");

      // True terminal settle: exactly one terminal notification.
      const terminalEnvelope = buildRunEventEnvelope(run.id, {
        type: "run/completed",
        result: "done",
        usage: { inputTokens: 1, outputTokens: 1 },
      });
      ingestWorkflowRunEventBatch(harness.deps, {
        hostId: fixture.hostId,
        events: [terminalEnvelope],
      });
      expect(requireRun(harness, run.id).status).toBe("completed");
      await vi.waitFor(() => {
        const requested = listRunNotifications();
        expect(requested).toHaveLength(2);
        expect(
          requested.filter((row) => row.data.includes("Fetch the result")),
        ).toHaveLength(1);
        expect(
          requested.filter((row) => row.data.includes("was paused")),
        ).toHaveLength(1);
      });

      // A redelivered terminal batch re-acks (nothing inserted) and a late
      // duplicate terminal with a fresh producer id appends as history only
      // (finalize answers already-terminal): neither re-notifies.
      ingestWorkflowRunEventBatch(harness.deps, {
        hostId: fixture.hostId,
        events: [terminalEnvelope],
      });
      ingestWorkflowRunEventBatch(harness.deps, {
        hostId: fixture.hostId,
        events: [
          buildRunEventEnvelope(run.id, {
            type: "run/completed",
            result: "done",
            usage: { inputTokens: 1, outputTokens: 1 },
          }),
        ],
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(listRunNotifications()).toHaveLength(2);
    });
  });

  it("session re-open reporting the run keeps it running; an unreporting re-open interrupts it (criterion b unit shape)", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "rec-session-open");
      const { thread } = seedAnchorThread(harness, fixture);
      const run = createRun(harness, fixture, { anchorThreadId: thread.id });
      await startRunToRunning(harness, run.id);
      const host = seedHost(harness.deps, { id: `host-rec-session-open` });

      const openSessionWith = (
        instanceId: string,
        activeWorkflowRunIds: string[],
      ) =>
        harness.app.request("/internal/session/open", {
          method: "POST",
          headers: internalAuthHeaders(harness, {
            hostId: fixture.hostId,
            hostType: host.type,
          }),
          body: JSON.stringify({
            hostId: fixture.hostId,
            instanceId,
            hostName: "Test Host",
            hostType: host.type,
            dataDir: `/tmp/bb-host-data/${fixture.hostId}`,
            protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
            activeThreads: [],
            activeWorkflowRunIds,
          }),
        });

      // Same-instance reconnect (sleep/wake) reporting the run: stays
      // running, no cancel, no anchor interruption rows.
      const sameInstance = await openSessionWith("instance-1", [run.id]);
      expect(sameInstance.status).toBe(201);
      expect(requireRun(harness, run.id).status).toBe("running");
      expect(
        listQueuedWorkflowRunCommands(harness, "workflow.cancel"),
      ).toHaveLength(0);
      expect(listAnchorTaskStatuses(harness, thread.id)).toEqual([]);

      // A restarted daemon that does NOT report the run: interrupted with
      // the restart reason and the paused anchor snapshot.
      const restarted = await openSessionWith("instance-2", []);
      expect(restarted.status).toBe(201);
      const interrupted = requireRun(harness, run.id);
      expect(interrupted.status).toBe("interrupted");
      expect(interrupted.failureReason).toBe(
        WORKFLOW_RUN_DAEMON_RESTARTED_REASON,
      );
      expect(listAnchorTaskStatuses(harness, thread.id)).toEqual([
        {
          type: "item/backgroundTask/progress",
          taskStatus: "paused",
          itemStatus: "pending",
        },
      ]);

      // The daemon comes back reporting the surviving runner: revived.
      const revived = await openSessionWith("instance-2", [run.id]);
      expect(revived.status).toBe(201);
      expect(requireRun(harness, run.id).status).toBe("running");
      expect(requireRun(harness, run.id).failureReason).toBeNull();
    });
  });
});

describe("workflow run disconnect and lease semantics", () => {
  it("keeps runs running through the disconnect grace window", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "rec-grace");
      const run = createRun(harness, fixture);
      await startRunToRunning(harness, run.id);

      vi.useFakeTimers();
      handleDaemonSocketClosed(harness.deps, { sessionId: fixture.sessionId });
      vi.advanceTimersByTime(DAEMON_DISCONNECT_GRACE_MS + 1);

      // Connection loss alone does not prove the run is gone.
      expect(requireRun(harness, run.id).status).toBe("running");
    });
  });

  it("interrupts runs when the lease expires with no replacement session", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "rec-lease");
      const { thread } = seedAnchorThread(harness, fixture);
      const run = createRun(harness, fixture, { anchorThreadId: thread.id });
      await startRunToRunning(harness, run.id);

      closeSession(harness.db, harness.hub, fixture.sessionId, "expired");
      handleExpiredHostSessionLeases(harness.deps, {
        expiredLeases: {
          expiredHostIds: [fixture.hostId],
          expiredSessionIds: [fixture.sessionId],
          sessionsClosed: 1,
        },
      });

      const interrupted = requireRun(harness, run.id);
      expect(interrupted.status).toBe("interrupted");
      expect(interrupted.failureReason).toBe(
        WORKFLOW_RUN_HOST_SESSION_EXPIRED_REASON,
      );
      expect(listAnchorTaskStatuses(harness, thread.id)).toEqual([
        {
          type: "item/backgroundTask/progress",
          taskStatus: "paused",
          itemStatus: "pending",
        },
      ]);
    });
  });

  it("sweep backstop interrupts running runs only after the host session lease lapses", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "rec-backstop");
      const { thread } = seedAnchorThread(harness, fixture);
      const run = createRun(harness, fixture, { anchorThreadId: thread.id });
      await startRunToRunning(harness, run.id);

      // Active session: untouched.
      runWorkflowRunInterruptionBackstopSweep(harness.deps);
      expect(requireRun(harness, run.id).status).toBe("running");

      // Closed session but within the lease window: untouched (brief blip).
      closeSession(
        harness.db,
        harness.hub,
        fixture.sessionId,
        "daemon-disconnect",
      );
      runWorkflowRunInterruptionBackstopSweep(harness.deps);
      expect(requireRun(harness, run.id).status).toBe("running");

      // Lease lapsed with no replacement session: interrupted, with the
      // paused anchor snapshot.
      harness.db
        .update(hostDaemonSessions)
        .set({ leaseExpiresAt: Date.now() - 60_000 })
        .where(eq(hostDaemonSessions.id, fixture.sessionId))
        .run();
      runWorkflowRunInterruptionBackstopSweep(harness.deps);
      const updated = requireRun(harness, run.id);
      expect(updated.status).toBe("interrupted");
      expect(updated.failureReason).toBe(
        WORKFLOW_RUN_HOST_SESSION_EXPIRED_REASON,
      );
      expect(listAnchorTaskStatuses(harness, thread.id)).toEqual([
        {
          type: "item/backgroundTask/progress",
          taskStatus: "paused",
          itemStatus: "pending",
        },
      ]);
    });
  });
});
