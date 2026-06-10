import { describe, expect, it } from "vitest";
import {
  getWorkflowRunOperation,
  listEvents,
  upsertProjectWorkflowPolicy,
} from "@bb/db";
import { archiveWorkflowRunInTransaction } from "@bb/db/internal-lifecycle";
import { workflowStartCommandSchema } from "@bb/host-daemon-contract";
import {
  listQueuedWorkflowRunCommands,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  type QueuedCommand,
} from "../helpers/commands.js";
import {
  advanceWorkflowRunStart,
  finalizeWorkflowRunInTransaction,
  interruptWorkflowRunsForHostInTransaction,
  requestWorkflowRunCancel,
  requestWorkflowRunCancelForReportedTerminalRun,
  requestWorkflowRunResume,
  requestWorkflowRunStart,
  runWorkflowRunLifecycleSweep,
} from "../../src/services/workflows/workflow-run-lifecycle.js";
import { NotificationBuffer } from "../../src/services/lib/notification-buffer.js";
import {
  seedHost,
  seedProjectWithSource,
  seedSession,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import {
  appendRunStartedEvent,
  createRun,
  forceRunStatus,
  reportCancelCommandAccepted,
  reportStartCommandResult,
  requireOperation,
  requireRun,
  seedAnchorThread,
  seedWorkflowFixture,
  startRunToRunning,
  waitForWorkflowStartCommand,
  ZERO_USAGE,
} from "../helpers/workflow-runs.js";

describe("workflow run start lifecycle", () => {
  it("dispatches workflow.start with the run snapshot and moves created → starting", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "start-queues");
      const run = createRun(harness, fixture);

      await requestWorkflowRunStart(harness.deps, { runId: run.id });

      const operation = requireOperation(harness, run.id, "start");
      expect(operation.state).toBe("queued");
      expect(operation.commandId).not.toBeNull();

      const queued = await waitForWorkflowStartCommand(harness, {
        runId: run.id,
      });
      const command = workflowStartCommandSchema.parse(queued.command);
      expect(command.runId).toBe(run.id);
      expect(command.projectId).toBe(run.projectId);
      expect(command.resume).toBeNull();
      expect(command.script.name).toBe(run.workflowName);
      expect(command.script.content).toBe(run.scriptSource);
      expect(command.script.hash).toBe(run.scriptHash);
      expect(command.seed).toBe(run.seed);
      expect(command.baseTimeMs).toBe(run.createdAt);
      expect(command.workspacePath).toBe(run.workspacePath);
      expect(command.defaults.providerId).toBe(run.providerId);
      expect(command.defaults.concurrency).toBe(run.concurrency);

      expect(requireRun(harness, run.id).status).toBe("starting");

      // Idempotent re-request: the in-flight RPC is reused, no second
      // dispatch.
      await requestWorkflowRunStart(harness.deps, { runId: run.id });
      expect(
        listQueuedWorkflowRunCommands(harness, "workflow.start"),
      ).toHaveLength(1);
      expect(requireOperation(harness, run.id, "start").commandId).toBe(
        operation.commandId,
      );
    });
  });

  it("holds the operation in requested while the host is offline; the sweep admits after reconnect", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host-start-offline" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/wf-start-offline",
      });
      const run = createRun(harness, { projectId: project.id });

      await requestWorkflowRunStart(harness.deps, { runId: run.id });
      expect(requireOperation(harness, run.id, "start").state).toBe(
        "requested",
      );
      expect(requireRun(harness, run.id).status).toBe("created");
      expect(
        listQueuedWorkflowRunCommands(harness, "workflow.start"),
      ).toHaveLength(0);

      seedSession(harness.deps, host.id);
      await runWorkflowRunLifecycleSweep(harness.deps);

      expect(requireOperation(harness, run.id, "start").state).toBe("queued");
      expect(requireRun(harness, run.id).status).toBe("starting");
    });
  });

  it("holds over-cap runs in requested and admits them as capacity frees (exit criterion i)", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "start-capacity");
      // The cap is server config (M7) — read it where the lifecycle does.
      const hostRunCap = harness.config.workflowMaxConcurrentRunsPerHost;
      const runs = Array.from({ length: hostRunCap + 1 }, () =>
        createRun(harness, fixture),
      );
      for (const run of runs) {
        await requestWorkflowRunStart(harness.deps, { runId: run.id });
      }

      const states = runs.map(
        (run) => requireOperation(harness, run.id, "start").state,
      );
      expect(states.filter((state) => state === "queued")).toHaveLength(
        hostRunCap,
      );
      expect(states.filter((state) => state === "requested")).toHaveLength(1);

      const heldRun = runs[states.indexOf("requested")];
      const admittedRun = runs[states.indexOf("queued")];

      // Re-advancing while the host is full stays held.
      await advanceWorkflowRunStart(harness.deps, { runId: heldRun.id });
      expect(requireOperation(harness, heldRun.id, "start").state).toBe(
        "requested",
      );

      // Settle one admitted run; the sweep then admits the held one.
      await reportStartCommandResult(harness, {
        runId: admittedRun.id,
        ok: true,
      });
      forceRunStatus(harness, admittedRun.id, "running");
      harness.db.transaction(
        (tx) => {
          finalizeWorkflowRunInTransaction(
            { db: tx, hub: new NotificationBuffer() },
            {
              runId: admittedRun.id,
              status: "completed",
              failureReason: null,
              resultJson: null,
              usage: ZERO_USAGE,
            },
          );
        },
        { behavior: "immediate" },
      );

      await runWorkflowRunLifecycleSweep(harness.deps);
      expect(requireOperation(harness, heldRun.id, "start").state).toBe(
        "queued",
      );
      expect(requireRun(harness, heldRun.id).status).toBe("starting");
    });
  });

  it("clamps a held start's carried ceiling when the grant is revoked before admission", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host-start-ceiling" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/wf-start-ceiling",
      });
      upsertProjectWorkflowPolicy(harness.db, {
        projectId: project.id,
        sandboxCeiling: "danger-full-access",
        defaultBudgetOutputTokens: null,
      });
      const run = createRun(harness, { projectId: project.id });
      expect(run.sandboxCeiling).toBe("danger-full-access");

      // Host offline: the start holds in requested with its payload built
      // under the grant.
      await requestWorkflowRunStart(harness.deps, { runId: run.id });
      expect(requireOperation(harness, run.id, "start").state).toBe(
        "requested",
      );

      // Revoke before admission: the eventually-dispatched command must
      // carry the lowered ceiling, not the held payload's snapshot.
      upsertProjectWorkflowPolicy(harness.db, {
        projectId: project.id,
        sandboxCeiling: "workspace-write",
        defaultBudgetOutputTokens: null,
      });
      seedSession(harness.deps, host.id);
      await runWorkflowRunLifecycleSweep(harness.deps);

      expect(requireOperation(harness, run.id, "start").state).toBe("queued");
      const queued = await waitForWorkflowStartCommand(harness, {
        runId: run.id,
      });
      const command = workflowStartCommandSchema.parse(queued.command);
      expect(command.sandboxCeiling).toBe("workspace-write");
    });
  });

  it("acceptance ack completes the operation and leaves the run starting", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "start-ack");
      const run = createRun(harness, fixture);
      await requestWorkflowRunStart(harness.deps, { runId: run.id });

      await reportStartCommandResult(harness, { runId: run.id, ok: true });

      expect(requireOperation(harness, run.id, "start").state).toBe(
        "completed",
      );
      // The run stays `starting` until ingestion sees run/started.
      expect(requireRun(harness, run.id).status).toBe("starting");
    });
  });

  it("fails the operation and the run on a lost ack with zero events since dispatch (exit criterion d)", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "start-expired");
      const run = createRun(harness, fixture);
      await requestWorkflowRunStart(harness.deps, { runId: run.id });

      // The live RPC settles with the timeout failure class (the lost-ack
      // shape) and no run event ever landed: the run never started.
      await reportStartCommandResult(harness, {
        runId: run.id,
        ok: false,
        errorCode: "command_timeout",
      });

      const operation = requireOperation(harness, run.id, "start");
      expect(operation.state).toBe("failed");
      const updated = requireRun(harness, run.id);
      expect(updated.status).toBe("failed");
      expect(updated.failureReason).toBe("command_timeout");
      expect(updated.settledAt).not.toBeNull();
    });
  });

  it("treats a lost ack with events since dispatch as started (exit criterion d)", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "start-expired-events");
      const run = createRun(harness, fixture);
      await requestWorkflowRunStart(harness.deps, { runId: run.id });

      // Events landed after the command was dispatched: the run demonstrably
      // started even though the daemon never reported the ack.
      await new Promise((resolve) => setTimeout(resolve, 5));
      appendRunStartedEvent(harness, run.id);

      await reportStartCommandResult(harness, {
        runId: run.id,
        ok: false,
        errorCode: "command_timeout",
      });

      expect(requireOperation(harness, run.id, "start").state).toBe(
        "completed",
      );
      expect(requireRun(harness, run.id).status).toBe("starting");
    });
  });

  it("resets the operation to requested on host_unavailable with zero events; the sweep re-dispatches", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "start-unavailable");
      const run = createRun(harness, fixture);
      await requestWorkflowRunStart(harness.deps, { runId: run.id });

      // Delivery never confirmed (daemon dropped the socket before
      // answering): the durable start intent survives as `requested`.
      await reportStartCommandResult(harness, {
        runId: run.id,
        ok: false,
        errorCode: "host_unavailable",
      });

      expect(requireOperation(harness, run.id, "start").state).toBe(
        "requested",
      );
      expect(requireRun(harness, run.id).status).toBe("starting");

      // The sweep re-dispatches over the (restored) session.
      await runWorkflowRunLifecycleSweep(harness.deps);
      expect(requireOperation(harness, run.id, "start").state).toBe("queued");
      await reportStartCommandResult(harness, { runId: run.id, ok: true });
      expect(requireOperation(harness, run.id, "start").state).toBe(
        "completed",
      );
    });
  });

  it("fails the run with the daemon errorCode on script_invalid", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "start-invalid");
      const run = createRun(harness, fixture);
      await requestWorkflowRunStart(harness.deps, { runId: run.id });

      await reportStartCommandResult(harness, {
        runId: run.id,
        ok: false,
        errorCode: "script_invalid",
      });

      expect(requireOperation(harness, run.id, "start").state).toBe("failed");
      const updated = requireRun(harness, run.id);
      expect(updated.status).toBe("failed");
      expect(updated.failureReason).toBe("script_invalid");
    });
  });
});

describe("workflow run resume lifecycle", () => {
  async function interruptRunningRun(
    harness: TestAppHarness,
    runId: string,
  ): Promise<void> {
    await startRunToRunning(harness, runId);
    forceRunStatus(harness, runId, "interrupted", "host-daemon-restarted");
  }

  it("dispatches a resume command while the run stays interrupted; acceptance moves it to starting (exit criterion c shape)", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "resume-happy");
      const run = createRun(harness, fixture);
      await interruptRunningRun(harness, run.id);

      await requestWorkflowRunResume(harness.deps, { runId: run.id });

      const operation = requireOperation(harness, run.id, "resume");
      expect(operation.state).toBe("queued");
      const queued = await waitForWorkflowStartCommand(harness, {
        runId: run.id,
        kind: "resume",
      });
      const command = workflowStartCommandSchema.parse(queued.command);
      expect(command.resume).toEqual({ nonce: expect.any(String) });
      expect(command.runId).toBe(run.id);
      // Resume never flips status at dispatch time.
      expect(requireRun(harness, run.id).status).toBe("interrupted");

      await reportStartCommandResult(harness, {
        runId: run.id,
        kind: "resume",
        ok: true,
      });
      expect(requireOperation(harness, run.id, "resume").state).toBe(
        "completed",
      );
      expect(requireRun(harness, run.id).status).toBe("starting");
    });
  });

  it("journal_fetch_failed leaves the run interrupted with a failed resume op (exit criterion f)", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "resume-journal");
      const run = createRun(harness, fixture);
      await interruptRunningRun(harness, run.id);
      await requestWorkflowRunResume(harness.deps, { runId: run.id });

      await reportStartCommandResult(harness, {
        runId: run.id,
        kind: "resume",
        ok: false,
        errorCode: "journal_fetch_failed",
      });

      expect(requireOperation(harness, run.id, "resume").state).toBe("failed");
      const updated = requireRun(harness, run.id);
      expect(updated.status).toBe("interrupted");
      expect(updated.settledAt).toBeNull();

      // Still resumable: a new resume request re-upserts the terminal op.
      await requestWorkflowRunResume(harness.deps, { runId: run.id });
      expect(requireOperation(harness, run.id, "resume").state).toBe("queued");
    });
  });

  it("collapses concurrent resume requests onto one op and one command (exit criterion e)", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "resume-concurrent");
      const run = createRun(harness, fixture);
      await interruptRunningRun(harness, run.id);

      await Promise.all([
        requestWorkflowRunResume(harness.deps, { runId: run.id }),
        requestWorkflowRunResume(harness.deps, { runId: run.id }),
        requestWorkflowRunResume(harness.deps, { runId: run.id }),
      ]);

      // Exactly one live dispatch: wait for it, then confirm no sibling
      // appeared. (The original start RPC was already answered and removed.)
      await waitForWorkflowStartCommand(harness, {
        runId: run.id,
        kind: "resume",
      });
      expect(
        listQueuedWorkflowRunCommands(harness, "workflow.start"),
      ).toHaveLength(1);
      expect(requireOperation(harness, run.id, "resume").state).toBe("queued");
    });
  });

  it("clamps the carried sandbox ceiling to the project's current policy at dispatch time (revocation reaches resumes)", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "resume-ceiling-clamp");
      upsertProjectWorkflowPolicy(harness.db, {
        projectId: fixture.projectId,
        sandboxCeiling: "danger-full-access",
        defaultBudgetOutputTokens: null,
      });
      const run = createRun(harness, fixture);
      expect(run.sandboxCeiling).toBe("danger-full-access");
      await interruptRunningRun(harness, run.id);

      // Revoke the grant, then resume: the dispatched command carries the
      // clamped ceiling, not the launch snapshot — a revoked grant must not
      // stay live on interrupted runs (resume is reachable by anyone with
      // server access). The run-row snapshot survives as the upper bound.
      upsertProjectWorkflowPolicy(harness.db, {
        projectId: fixture.projectId,
        sandboxCeiling: "read-only",
        defaultBudgetOutputTokens: null,
      });
      await requestWorkflowRunResume(harness.deps, { runId: run.id });

      const queued = await waitForWorkflowStartCommand(harness, {
        runId: run.id,
        kind: "resume",
      });
      const command = workflowStartCommandSchema.parse(queued.command);
      expect(command.sandboxCeiling).toBe("read-only");
      expect(requireRun(harness, run.id).sandboxCeiling).toBe(
        "danger-full-access",
      );
    });
  });

  it("never loosens an existing run when the policy ceiling is raised (snapshot stays the upper bound)", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "resume-ceiling-raise");
      const run = createRun(harness, fixture);
      expect(run.sandboxCeiling).toBe("workspace-write");
      await interruptRunningRun(harness, run.id);

      upsertProjectWorkflowPolicy(harness.db, {
        projectId: fixture.projectId,
        sandboxCeiling: "danger-full-access",
        defaultBudgetOutputTokens: null,
      });
      await requestWorkflowRunResume(harness.deps, { runId: run.id });

      const queued = await waitForWorkflowStartCommand(harness, {
        runId: run.id,
        kind: "resume",
      });
      const command = workflowStartCommandSchema.parse(queued.command);
      expect(command.sandboxCeiling).toBe("workspace-write");
    });
  });

  it("rejects resume for non-interrupted runs", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "resume-reject");
      const run = createRun(harness, fixture);
      await expect(
        requestWorkflowRunResume(harness.deps, { runId: run.id }),
      ).rejects.toThrowError(/cannot be resumed/);
    });
  });
});

describe("workflow run cancel lifecycle", () => {
  it("dispatches a durable workflow.cancel for a running run and settles the op on ack", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "cancel-running");
      const run = createRun(harness, fixture);
      await startRunToRunning(harness, run.id);

      await requestWorkflowRunCancel(harness.deps, { runId: run.id });
      // Idempotent: the second request advances the same op.
      await requestWorkflowRunCancel(harness.deps, { runId: run.id });

      const operation = requireOperation(harness, run.id, "cancel");
      expect(operation.state).toBe("queued");

      await reportCancelCommandAccepted(harness, run.id);
      expect(requireOperation(harness, run.id, "cancel").state).toBe(
        "completed",
      );
      expect(
        listQueuedWorkflowRunCommands(harness, "workflow.cancel"),
      ).toHaveLength(0);
      // Status converges via the run/cancelled terminal event (ingestion),
      // never via the cancel ack.
      expect(requireRun(harness, run.id).status).toBe("running");
    });
  });

  it("resets the cancel op to requested on host_unavailable so the durable intent survives", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "cancel-unavailable");
      const run = createRun(harness, fixture);
      await startRunToRunning(harness, run.id);

      await requestWorkflowRunCancel(harness.deps, { runId: run.id });
      const queued = await waitForQueuedWorkflowCancel(harness, run.id);
      await reportQueuedCommandError(harness, queued, {
        errorCode: "host_unavailable",
        errorMessage: "daemon dropped mid-cancel",
      });

      expect(requireOperation(harness, run.id, "cancel").state).toBe(
        "requested",
      );

      // The sweep re-dispatches the surviving intent.
      await runWorkflowRunLifecycleSweep(harness.deps);
      expect(requireOperation(harness, run.id, "cancel").state).toBe("queued");
      await reportCancelCommandAccepted(harness, run.id);
      expect(requireOperation(harness, run.id, "cancel").state).toBe(
        "completed",
      );
    });
  });

  it("cancels a delivery-unconfirmed start entirely server-side: starting → cancelled, no daemon command", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "cancel-prestart");
      const run = createRun(harness, fixture);
      await requestWorkflowRunStart(harness.deps, { runId: run.id });
      // The start's delivery was never confirmed: the connectivity failure
      // reset the operation to `requested` (run stays `starting`).
      await reportStartCommandResult(harness, {
        runId: run.id,
        ok: false,
        errorCode: "host_unavailable",
      });
      expect(requireRun(harness, run.id).status).toBe("starting");
      expect(requireOperation(harness, run.id, "start").state).toBe(
        "requested",
      );

      await requestWorkflowRunCancel(harness.deps, { runId: run.id });

      const updated = requireRun(harness, run.id);
      expect(updated.status).toBe("cancelled");
      expect(requireOperation(harness, run.id, "start").state).toBe(
        "cancelled",
      );
      expect(
        listQueuedWorkflowRunCommands(harness, "workflow.cancel"),
      ).toHaveLength(0);
    });
  });

  it("settles created and interrupted runs cancelled server-side; terminal runs no-op", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "cancel-gates");

      // Never-requested `created` run: settles via the user-cancel edge with
      // no daemon round-trip.
      const createdRun = createRun(harness, fixture);
      await requestWorkflowRunCancel(harness.deps, { runId: createdRun.id });
      expect(requireRun(harness, createdRun.id).status).toBe("cancelled");

      // Anchored `interrupted` run with a pending resume: the cancel settles
      // server-side, cancels the resume operation, and appends the single
      // anchor completed row ("stopped").
      const { thread } = seedAnchorThread(harness, fixture);
      const interruptedRun = createRun(harness, fixture, {
        anchorThreadId: thread.id,
      });
      await startRunToRunning(harness, interruptedRun.id);
      forceRunStatus(harness, interruptedRun.id, "interrupted", "test");
      await requestWorkflowRunResume(harness.deps, {
        runId: interruptedRun.id,
      });
      await requestWorkflowRunCancel(harness.deps, {
        runId: interruptedRun.id,
      });
      expect(requireRun(harness, interruptedRun.id).status).toBe("cancelled");
      expect(
        requireOperation(harness, interruptedRun.id, "resume").state,
      ).toBe("cancelled");
      const completedRows = listEvents(harness.db, {
        threadId: thread.id,
      }).filter((row) => row.type === "item/backgroundTask/completed");
      expect(completedRows).toHaveLength(1);

      // No durable workflow.cancel was ever needed for either settle.
      expect(
        listQueuedWorkflowRunCommands(harness, "workflow.cancel"),
      ).toHaveLength(0);

      const terminalRun = createRun(harness, fixture);
      await startRunToRunning(harness, terminalRun.id);
      harness.db.transaction(
        (tx) => {
          finalizeWorkflowRunInTransaction(
            { db: tx, hub: new NotificationBuffer() },
            {
              runId: terminalRun.id,
              status: "completed",
              failureReason: null,
              resultJson: null,
              usage: ZERO_USAGE,
            },
          );
        },
        { behavior: "immediate" },
      );
      await requestWorkflowRunCancel(harness.deps, { runId: terminalRun.id });
      expect(
        getWorkflowRunOperation(harness.db, {
          runId: terminalRun.id,
          kind: "cancel",
        }),
      ).toBeNull();
    });
  });

  it("cancels a capacity-held created run: the held start operation cancels with the run", async () => {
    await withTestHarness(async (harness) => {
      // Offline host: the start operation holds in `requested` and the run
      // stays `created` — exactly the launch-on-offline-host shape a user
      // must be able to abandon.
      const host = seedHost(harness.deps, { id: "host-cancel-held" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/wf-cancel-held",
      });
      const run = createRun(harness, { projectId: project.id });
      await requestWorkflowRunStart(harness.deps, { runId: run.id });
      expect(requireRun(harness, run.id).status).toBe("created");
      expect(requireOperation(harness, run.id, "start").state).toBe(
        "requested",
      );

      await requestWorkflowRunCancel(harness.deps, { runId: run.id });

      expect(requireRun(harness, run.id).status).toBe("cancelled");
      expect(requireOperation(harness, run.id, "start").state).toBe(
        "cancelled",
      );
      expect(
        listQueuedWorkflowRunCommands(harness, "workflow.cancel"),
      ).toHaveLength(0);
    });
  });

  it("rejects cancel for archived runs (archiving already settled the anchor item)", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "cancel-archived");
      const run = createRun(harness, fixture);
      await startRunToRunning(harness, run.id);
      forceRunStatus(harness, run.id, "interrupted", "test");
      harness.db.transaction(
        (tx) => {
          archiveWorkflowRunInTransaction(tx, { id: run.id });
        },
        { behavior: "immediate" },
      );

      await expect(
        requestWorkflowRunCancel(harness.deps, { runId: run.id }),
      ).rejects.toThrowError(/archived/);
      expect(requireRun(harness, run.id).status).toBe("interrupted");
    });
  });

  it("dispatches cancel convergence for a terminal run the daemon still reports live (bucket d)", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "cancel-terminal");
      const run = createRun(harness, fixture);
      await startRunToRunning(harness, run.id);
      harness.db.transaction(
        (tx) => {
          finalizeWorkflowRunInTransaction(
            { db: tx, hub: new NotificationBuffer() },
            {
              runId: run.id,
              status: "cancelled",
              failureReason: null,
              resultJson: null,
              usage: ZERO_USAGE,
            },
          );
        },
        { behavior: "immediate" },
      );

      await requestWorkflowRunCancelForReportedTerminalRun(harness.deps, {
        runId: run.id,
      });

      expect(requireOperation(harness, run.id, "cancel").state).toBe("queued");
      await waitForQueuedWorkflowCancel(harness, run.id);
      expect(
        listQueuedWorkflowRunCommands(harness, "workflow.cancel"),
      ).toHaveLength(1);
    });
  });
});

describe("workflow run finalize and interruption", () => {
  it("finalizes once and treats late terminal outcomes as already-terminal (exit criterion g shape)", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "finalize");
      const run = createRun(harness, fixture);
      await startRunToRunning(harness, run.id);

      const settled = harness.db.transaction(
        (tx) =>
          finalizeWorkflowRunInTransaction(
            { db: tx, hub: new NotificationBuffer() },
            {
              runId: run.id,
              status: "completed",
              failureReason: null,
              resultJson: '{"answer":42}',
              usage: {
                inputTokens: 10,
                outputTokens: 20,
                toolUses: 3,
                durationMs: 1234,
              },
            },
          ),
        { behavior: "immediate" },
      );
      expect(settled.outcome).toBe("settled");

      const updated = requireRun(harness, run.id);
      expect(updated.status).toBe("completed");
      expect(updated.resultJson).toBe('{"answer":42}');
      expect(updated.usageOutputTokens).toBe(20);
      expect(updated.settledAt).not.toBeNull();

      // A late, conflicting terminal event never changes a terminal status.
      const late = harness.db.transaction(
        (tx) =>
          finalizeWorkflowRunInTransaction(
            { db: tx, hub: new NotificationBuffer() },
            {
              runId: run.id,
              status: "failed",
              failureReason: "late",
              resultJson: null,
              usage: ZERO_USAGE,
            },
          ),
        { behavior: "immediate" },
      );
      expect(late.outcome).toBe("already-terminal");
      expect(requireRun(harness, run.id).status).toBe("completed");
    });
  });

  it("supersedes an interruption with the real late outcome (interrupted → completed)", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "finalize-supersede");
      const run = createRun(harness, fixture);
      await startRunToRunning(harness, run.id);
      forceRunStatus(harness, run.id, "interrupted", "host-daemon-restarted");

      const settled = harness.db.transaction(
        (tx) =>
          finalizeWorkflowRunInTransaction(
            { db: tx, hub: new NotificationBuffer() },
            {
              runId: run.id,
              status: "completed",
              failureReason: null,
              resultJson: '{"late":true}',
              usage: ZERO_USAGE,
            },
          ),
        { behavior: "immediate" },
      );
      expect(settled.outcome).toBe("settled");
      expect(requireRun(harness, run.id).status).toBe("completed");
    });
  });

  it("interrupts only unreported running runs, cancelling start/resume ops while user cancel intent SURVIVES", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "interrupt");
      const reportedRun = createRun(harness, fixture);
      const missingRun = createRun(harness, fixture);
      await startRunToRunning(harness, reportedRun.id);
      // The missing run reached `running` with its start ack still in flight
      // (op queued — a lost ack the timeout settle would normally own).
      await requestWorkflowRunStart(harness.deps, { runId: missingRun.id });
      forceRunStatus(harness, missingRun.id, "running");
      expect(requireOperation(harness, missingRun.id, "start").state).toBe(
        "queued",
      );
      // And the user cancelled while the daemon was already unresponsive.
      await requestWorkflowRunCancel(harness.deps, { runId: missingRun.id });
      await waitForQueuedWorkflowCancel(harness, missingRun.id);

      const buffer = new NotificationBuffer();
      const interrupted = harness.db.transaction(
        (tx) =>
          interruptWorkflowRunsForHostInTransaction(
            { db: tx, hub: buffer },
            {
              hostId: fixture.hostId,
              reason: "host-daemon-restarted",
              excludeReportedRunIds: [reportedRun.id],
            },
          ),
        { behavior: "immediate" },
      );

      expect(interrupted.map((run) => run.id)).toEqual([missingRun.id]);
      expect(requireRun(harness, reportedRun.id).status).toBe("running");
      const updated = requireRun(harness, missingRun.id);
      expect(updated.status).toBe("interrupted");
      expect(updated.failureReason).toBe("host-daemon-restarted");
      // Start/resume ops die with the daemon (it can never honor them)…
      expect(requireOperation(harness, missingRun.id, "start").state).toBe(
        "cancelled",
      );
      // …but the durable cancel intent survives interruption: the op stays
      // queued with its RPC still in flight.
      expect(requireOperation(harness, missingRun.id, "cancel").state).toBe(
        "queued",
      );

      // Repeating the cancel against the now-interrupted run no-ops onto the
      // surviving op instead of throwing the not-cancellable 409 — and never
      // double-dispatches.
      await requestWorkflowRunCancel(harness.deps, { runId: missingRun.id });
      expect(requireOperation(harness, missingRun.id, "cancel").state).toBe(
        "queued",
      );
      expect(
        listQueuedWorkflowRunCommands(harness, "workflow.cancel"),
      ).toHaveLength(1);

      // The surviving cancel intent lands: the daemon (eventually) acks it.
      await reportCancelCommandAccepted(harness, missingRun.id);
      expect(requireOperation(harness, missingRun.id, "cancel").state).toBe(
        "completed",
      );

      // The interrupted run's lost start ack settles as a no-op against the
      // cancelled operation.
      await reportStartCommandResult(harness, {
        runId: missingRun.id,
        ok: true,
      });
      expect(requireOperation(harness, missingRun.id, "start").state).toBe(
        "cancelled",
      );
    });
  });

  it("finalize cancels remaining active operations; their in-flight RPCs settle as no-ops", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "finalize-op-cleanup");
      const run = createRun(harness, fixture);
      await startRunToRunning(harness, run.id);
      await requestWorkflowRunCancel(harness.deps, { runId: run.id });
      await waitForQueuedWorkflowCancel(harness, run.id);

      harness.db.transaction(
        (tx) => {
          finalizeWorkflowRunInTransaction(
            { db: tx, hub: new NotificationBuffer() },
            {
              runId: run.id,
              status: "completed",
              failureReason: null,
              resultJson: null,
              usage: ZERO_USAGE,
            },
          );
        },
        { behavior: "immediate" },
      );

      expect(requireOperation(harness, run.id, "cancel").state).toBe(
        "cancelled",
      );

      // The still-in-flight cancel RPC settles after finalize: the guard on
      // an active operation makes it a no-op rather than a resurrection.
      const queued = await waitForQueuedWorkflowCancel(harness, run.id);
      await reportQueuedCommandSuccess(harness, queued, { accepted: true });
      expect(requireOperation(harness, run.id, "cancel").state).toBe(
        "cancelled",
      );
      expect(requireRun(harness, run.id).status).toBe("completed");
    });
  });

  // The no-replacement-session interruption backstop moved to
  // workflow-run-reconciliation.ts (which owns the paused-anchor side of
  // interruption); its sweep is covered in workflow-run-reconciliation.test.ts.
});

function waitForQueuedWorkflowCancel(
  harness: TestAppHarness,
  runId: string,
): Promise<QueuedCommand> {
  return waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "workflow.cancel" && command.runId === runId,
  );
}
