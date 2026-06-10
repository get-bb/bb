// M6 notification polish: durable pending manager notifications for workflow
// runs. These tests drive the two production failure shapes the one-shot
// best-effort push could never survive — the reconnect window where the
// daemon's session row is active but its hub socket is not attached yet
// (bucket (b) fires inside /internal/session/open, before the WS attach), and
// lease-expiry/backstop interruptions that fire with no session at all — plus
// the server-settled cancel notification alignment and its cross-kind
// supersede semantics.

import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { closeSession, listEvents, workflowRuns } from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  type ResolvedThreadExecutionOptions,
} from "@bb/domain";
import { handleExpiredHostSessionLeases } from "../../src/internal/session-owner-side-effects.js";
import {
  hasLiveThreadStartInFlight,
  requestThreadStart,
} from "../../src/services/threads/thread-lifecycle.js";
import { requestWorkflowRunCancel } from "../../src/services/workflows/workflow-run-lifecycle.js";
import { runWorkflowRunPendingNotificationSweep } from "../../src/services/workflows/workflow-run-pending-notifications.js";
import { reconcileDaemonReportedWorkflowRuns } from "../../src/services/workflows/workflow-run-reconciliation.js";
import {
  runWorkflowRunRetentionSweep,
  WORKFLOW_RUN_ARCHIVE_AFTER_MS,
} from "../../src/services/workflows/workflow-run-retention.js";
import {
  registerTestHostRpcCapture,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import { seedSession, seedThreadRuntimeState } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import {
  createRun,
  requireRun,
  seedAnchorThread,
  seedWorkflowFixture,
  startRunToRunning,
  type WorkflowFixture,
} from "../helpers/workflow-runs.js";

function listRunNotificationTexts(
  harness: TestAppHarness,
  threadId: string,
  runId: string,
): string[] {
  return listEvents(harness.deps.db, { threadId })
    .filter(
      (row) =>
        row.type === "client/turn/requested" && row.data.includes(runId),
    )
    .map((row) => row.data);
}

/** Seeds a manager anchor thread that can receive system messages. */
function seedManagerAnchor(
  harness: TestAppHarness,
  fixture: WorkflowFixture,
  key: string,
) {
  const { environment, thread } = seedAnchorThread(harness, fixture);
  seedThreadRuntimeState(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    providerThreadId: `provider-${key}`,
    inputText: "Manage things",
    model: "fake-model",
  });
  return thread;
}

/** Lets the deferred (setImmediate) delivery attempt settle. */
async function settleDeferredDelivery(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("workflow run pending manager notifications", () => {
  it("holds the paused intent through the socket-detach window and delivers once on re-attach", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "pn-detach");
      const thread = seedManagerAnchor(harness, fixture, "pn-detach");
      const run = createRun(harness, fixture, { anchorThreadId: thread.id });
      await startRunToRunning(harness, run.id);

      // The exact bucket-(b) production window: the session row is active
      // (the daemon just re-opened it inside /internal/session/open) but the
      // hub socket has not attached yet.
      harness.hub.unregisterDaemon(fixture.sessionId);

      await reconcileDaemonReportedWorkflowRuns(harness.deps, {
        activeWorkflowRunIds: [],
        hostId: fixture.hostId,
      });
      const interrupted = requireRun(harness, run.id);
      expect(interrupted.status).toBe("interrupted");
      expect(interrupted.pendingManagerNotification).toBe("paused");

      // The deferred attempt finds an active session but no hub socket and
      // KEEPS the durable intent instead of consuming it on a doomed
      // dispatch.
      await settleDeferredDelivery();
      expect(requireRun(harness, run.id).pendingManagerNotification).toBe(
        "paused",
      );
      expect(
        listRunNotificationTexts(harness, thread.id, run.id),
      ).toHaveLength(0);

      // The daemon's hub socket attaches: the socket-attach trigger drains.
      registerTestHostRpcCapture(harness.deps, {
        hostId: fixture.hostId,
        sessionId: fixture.sessionId,
      });
      runWorkflowRunPendingNotificationSweep(harness.deps);
      await vi.waitFor(() => {
        const texts = listRunNotificationTexts(harness, thread.id, run.id);
        expect(texts).toHaveLength(1);
        expect(texts[0]).toContain("was paused");
        expect(texts[0]).toContain("bb workflow resume");
        expect(
          requireRun(harness, run.id).pendingManagerNotification,
        ).toBeNull();
      });

      // The intent was consumed: further sweeps deliver nothing.
      runWorkflowRunPendingNotificationSweep(harness.deps);
      await settleDeferredDelivery();
      expect(
        listRunNotificationTexts(harness, thread.id, run.id),
      ).toHaveLength(1);
    });
  });

  it("holds the paused intent across lease expiry with no session and delivers when the host returns", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "pn-lease");
      const thread = seedManagerAnchor(harness, fixture, "pn-lease");
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
      expect(requireRun(harness, run.id).status).toBe("interrupted");
      expect(requireRun(harness, run.id).pendingManagerNotification).toBe(
        "paused",
      );

      // No active session: the sweep skips without attempting delivery, and
      // the intent survives.
      runWorkflowRunPendingNotificationSweep(harness.deps);
      await settleDeferredDelivery();
      expect(
        listRunNotificationTexts(harness, thread.id, run.id),
      ).toHaveLength(0);
      expect(requireRun(harness, run.id).pendingManagerNotification).toBe(
        "paused",
      );

      // Hours later the daemon returns (new session + attached socket): the
      // session-open/socket-attach path drains the intent.
      seedSession(harness.deps, fixture.hostId);
      runWorkflowRunPendingNotificationSweep(harness.deps);
      await vi.waitFor(() => {
        const texts = listRunNotificationTexts(harness, thread.id, run.id);
        expect(texts).toHaveLength(1);
        expect(texts[0]).toContain("was paused");
        expect(
          requireRun(harness, run.id).pendingManagerNotification,
        ).toBeNull();
      });
    });
  });

  it("clears the paused intent on revival before delivery (no stale message)", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "pn-revive");
      const thread = seedManagerAnchor(harness, fixture, "pn-revive");
      const run = createRun(harness, fixture, { anchorThreadId: thread.id });
      await startRunToRunning(harness, run.id);

      harness.hub.unregisterDaemon(fixture.sessionId);
      await reconcileDaemonReportedWorkflowRuns(harness.deps, {
        activeWorkflowRunIds: [],
        hostId: fixture.hostId,
      });
      await settleDeferredDelivery();
      expect(requireRun(harness, run.id).pendingManagerNotification).toBe(
        "paused",
      );

      // Bucket (c): the daemon reports the run alive — revival moves it back
      // to running and structurally clears the now-stale paused intent.
      await reconcileDaemonReportedWorkflowRuns(harness.deps, {
        activeWorkflowRunIds: [run.id],
        hostId: fixture.hostId,
      });
      expect(requireRun(harness, run.id).status).toBe("running");
      expect(
        requireRun(harness, run.id).pendingManagerNotification,
      ).toBeNull();

      registerTestHostRpcCapture(harness.deps, {
        hostId: fixture.hostId,
        sessionId: fixture.sessionId,
      });
      runWorkflowRunPendingNotificationSweep(harness.deps);
      await settleDeferredDelivery();
      expect(
        listRunNotificationTexts(harness, thread.id, run.id),
      ).toHaveLength(0);
    });
  });

  it("notifies the manager when a created run is cancelled server-side (M6 alignment)", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "pn-cancel-created");
      const thread = seedManagerAnchor(harness, fixture, "pn-cancel-created");
      const run = createRun(harness, fixture, { anchorThreadId: thread.id });

      // Never admitted: the cancel settles entirely server-side, so no
      // run/cancelled event will ever arrive to notify via ingestion.
      await requestWorkflowRunCancel(harness.deps, { runId: run.id });
      expect(requireRun(harness, run.id).status).toBe("cancelled");

      // The post-settle drain delivers promptly (host online).
      await vi.waitFor(() => {
        const texts = listRunNotificationTexts(harness, thread.id, run.id);
        expect(texts).toHaveLength(1);
        expect(texts[0]).toContain("was cancelled");
        expect(
          requireRun(harness, run.id).pendingManagerNotification,
        ).toBeNull();
      });

      // Exactly one: nothing further to deliver.
      runWorkflowRunPendingNotificationSweep(harness.deps);
      await settleDeferredDelivery();
      expect(
        listRunNotificationTexts(harness, thread.id, run.id),
      ).toHaveLength(1);
    });
  });

  it("supersedes an undelivered paused intent when an interrupted run is cancelled offline, delivering only the cancelled message", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "pn-cancel-offline");
      const thread = seedManagerAnchor(harness, fixture, "pn-cancel-offline");
      const run = createRun(harness, fixture, { anchorThreadId: thread.id });
      await startRunToRunning(harness, run.id);

      // The host dies for good: lease expiry interrupts the run while the
      // paused message is undeliverable.
      closeSession(harness.db, harness.hub, fixture.sessionId, "expired");
      handleExpiredHostSessionLeases(harness.deps, {
        expiredLeases: {
          expiredHostIds: [fixture.hostId],
          expiredSessionIds: [fixture.sessionId],
          sessionsClosed: 1,
        },
      });
      expect(requireRun(harness, run.id).pendingManagerNotification).toBe(
        "paused",
      );

      // The user cancels the interrupted run from the run page (M5 exposes
      // Cancel there): the server-side settle replaces the stale paused
      // intent with the terminal one in the same transaction.
      await requestWorkflowRunCancel(harness.deps, { runId: run.id });
      expect(requireRun(harness, run.id).status).toBe("cancelled");
      expect(requireRun(harness, run.id).pendingManagerNotification).toBe(
        "settled",
      );

      // Host returns: exactly one message — the cancelled one, never the
      // superseded paused one.
      seedSession(harness.deps, fixture.hostId);
      runWorkflowRunPendingNotificationSweep(harness.deps);
      await vi.waitFor(() => {
        const texts = listRunNotificationTexts(harness, thread.id, run.id);
        expect(texts).toHaveLength(1);
        expect(texts[0]).toContain("was cancelled");
        expect(texts[0]).not.toContain("was paused");
        expect(
          requireRun(harness, run.id).pendingManagerNotification,
        ).toBeNull();
      });
    });
  });

  it("clears an undelivered paused intent at retention archive so a returning host delivers nothing", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "pn-archive");
      const thread = seedManagerAnchor(harness, fixture, "pn-archive");
      const run = createRun(harness, fixture, { anchorThreadId: thread.id });
      await startRunToRunning(harness, run.id);

      // The host dies for good: lease expiry interrupts the run and the
      // paused intent is held by design while nothing is deliverable.
      closeSession(harness.db, harness.hub, fixture.sessionId, "expired");
      handleExpiredHostSessionLeases(harness.deps, {
        expiredLeases: {
          expiredHostIds: [fixture.hostId],
          expiredSessionIds: [fixture.sessionId],
          sessionsClosed: 1,
        },
      });
      expect(requireRun(harness, run.id).pendingManagerNotification).toBe(
        "paused",
      );

      // 30 days later the retention sweep archives the abandoned run. The
      // archive transaction is an intent-invalidating writer: resumability is
      // gone (resume/cancel now 409 workflow_run_archived), so the "resume
      // it" message must never deliver.
      harness.db
        .update(workflowRuns)
        .set({ updatedAt: Date.now() - WORKFLOW_RUN_ARCHIVE_AFTER_MS - 1 })
        .where(eq(workflowRuns.id, run.id))
        .run();
      runWorkflowRunRetentionSweep(harness.deps);
      const archived = requireRun(harness, run.id);
      expect(archived.retention).toBe("archived");
      expect(archived.pendingManagerNotification).toBeNull();

      // The host finally returns: the sweep finds nothing — no stale
      // "resume it" message for a run whose resume route now 409s.
      seedSession(harness.deps, fixture.hostId);
      runWorkflowRunPendingNotificationSweep(harness.deps);
      await settleDeferredDelivery();
      expect(
        listRunNotificationTexts(harness, thread.id, run.id),
      ).toHaveLength(0);
    });
  });

  it("keeps a paused intent blocked by the manager's in-flight thread.start and delivers once it settles", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "pn-pending-cmd");
      const { environment, thread } = seedAnchorThread(harness, fixture);
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-pn-pending-cmd",
        inputText: "Manage things",
        model: "fake-model",
      });
      const run = createRun(harness, fixture, { anchorThreadId: thread.id });
      await startRunToRunning(harness, run.id);

      // The host dies: lease expiry interrupts the run and records the
      // durable paused intent (nothing deliverable yet).
      closeSession(harness.db, harness.hub, fixture.sessionId, "expired");
      handleExpiredHostSessionLeases(harness.deps, {
        expiredLeases: {
          expiredHostIds: [fixture.hostId],
          expiredSessionIds: [fixture.sessionId],
          sessionsClosed: 1,
        },
      });
      expect(requireRun(harness, run.id).pendingManagerNotification).toBe(
        "paused",
      );
      seedSession(harness.deps, fixture.hostId);

      // A user turn puts a live thread.start RPC in flight on the manager
      // thread — the transient blocking condition.
      const execution = {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "workspace-write",
        source: "client/turn/requested",
      } satisfies ResolvedThreadExecutionOptions;
      await requestThreadStart(harness.deps, {
        thread,
        environment,
        input: textInput("kick off the manager"),
        requestId: encodeClientTurnRequestIdNumber({ value: 1 }),
        execution,
        permissionEscalation: "ask",
        projectId: fixture.projectId,
        providerId: thread.providerId,
        syncGeneratedTitle: false,
      });
      const startCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      expect(hasLiveThreadStartInFlight(thread.id)).toBe(true);

      // The sweep's delivery attempt hits the in-flight start: the intent is
      // KEPT, not consumed — dropping here would eat the run's notification
      // forever.
      runWorkflowRunPendingNotificationSweep(harness.deps);
      await settleDeferredDelivery();
      expect(requireRun(harness, run.id).pendingManagerNotification).toBe(
        "paused",
      );
      expect(
        listRunNotificationTexts(harness, thread.id, run.id),
      ).toHaveLength(0);

      // The manager's start RPC settles (the runtime came up); the next
      // sweep delivers exactly once.
      await reportQueuedCommandSuccess(harness, startCommand, {
        providerThreadId: "provider-pn-pending-cmd",
      });
      await vi.waitFor(() => {
        expect(hasLiveThreadStartInFlight(thread.id)).toBe(false);
      });
      runWorkflowRunPendingNotificationSweep(harness.deps);
      await vi.waitFor(() => {
        const texts = listRunNotificationTexts(harness, thread.id, run.id);
        expect(texts).toHaveLength(1);
        expect(texts[0]).toContain("was paused");
        expect(
          requireRun(harness, run.id).pendingManagerNotification,
        ).toBeNull();
      });
    });
  });

  it("records no intent for unanchored runs", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "pn-unanchored");
      const interruptedRun = createRun(harness, fixture);
      await startRunToRunning(harness, interruptedRun.id);
      const cancelledRun = createRun(harness, fixture);

      harness.hub.unregisterDaemon(fixture.sessionId);
      await reconcileDaemonReportedWorkflowRuns(harness.deps, {
        activeWorkflowRunIds: [],
        hostId: fixture.hostId,
      });
      expect(requireRun(harness, interruptedRun.id).status).toBe(
        "interrupted",
      );
      expect(
        requireRun(harness, interruptedRun.id).pendingManagerNotification,
      ).toBeNull();

      await requestWorkflowRunCancel(harness.deps, {
        runId: cancelledRun.id,
      });
      expect(requireRun(harness, cancelledRun.id).status).toBe("cancelled");
      expect(
        requireRun(harness, cancelledRun.id).pendingManagerNotification,
      ).toBeNull();
    });
  });
});
