// Manager notification lifecycle over the real stack — manager-anchored runs,
// a real daemon crash + restart, and the durable pending-notification intent
// (M6 fix) delivering each manager message exactly once:
//
// 1. The M5 exit criterion: exactly one terminal notification across an
//    interrupt + resume cycle, with the paused INFORMATIONAL message now
//    delivered exactly once too. Pre-M6 this test pinned the paused count at
//    ZERO (KNOWN BUG): `interruptWorkflowRunsWithAnchors` pushed the message
//    via a one-shot setImmediate while the run's host was unreachable over
//    the hub socket — reconnect reconciliation runs inside
//    /internal/session/open BEFORE the daemon attaches its WS, so the
//    manager-preferences host RPC failed `host_unavailable` and the
//    best-effort wrapper swallowed it. The M6 fix records durable intent in
//    the interruption transaction (`workflow_runs.pendingManagerNotification`)
//    and the daemon's socket attach drains it — this test is the regression
//    proof that the real interruption trigger delivers over the real stack.
// 2. The M6 server-settle-cancel alignment: cancelling an interrupted run
//    through the public route settles entirely server-side (no daemon
//    round-trip, no `run/cancelled` event) and pre-M6 queued NO manager
//    notification while daemon-converged cancels notified via ingestion. The
//    settle now records the `settled` intent in the same transaction; the
//    manager hears "was cancelled" exactly once.

import { createPublicApiClient } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  waitForHostDisconnected,
  waitForThreadStatus,
} from "../../helpers/assertions.js";
import {
  createProjectFixture,
  createReadyHostThread,
} from "../../helpers/fixtures.js";
import { withHarness, type IntegrationHarness } from "../../helpers/harness.js";
import {
  countManagerWorkflowMessages,
  hasPrefixedWorkflowMessagePart,
  listManagerWorkflowMessageRows,
  waitForManagerWorkflowMessage,
  WORKFLOW_RUN_CANCELLED_MESSAGE_MARKER,
  WORKFLOW_RUN_COMPLETED_MESSAGE_MARKER,
  WORKFLOW_RUN_PAUSED_MESSAGE_MARKER,
} from "../../helpers/manager-workflow-messages.js";
import { scaleTimeoutMs } from "../../helpers/time.js";
import {
  cancelPublicWorkflowRun,
  getPublicWorkflowRun,
  launchPublicWorkflowRun,
  listPublicWorkflowRunEvents,
  resumePublicWorkflowRun,
  waitForPublicWorkflowRunEventCount,
  waitForPublicWorkflowRunStatus,
  waitForPublicWorkflowRunTerminal,
} from "../../helpers/workflow-public-api.js";
import {
  buildSequentialAgentWorkflowSource,
  latestBackgroundTaskRowForItem,
  WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
} from "../../helpers/workflow-runs.js";

const MANAGER_READY_TIMEOUT_MS = scaleTimeoutMs(30_000);
const RECOVERY_TIMEOUT_MS = scaleTimeoutMs(30_000);
const NOTIFICATION_TIMEOUT_MS = scaleTimeoutMs(20_000);
/** Settle window proving no duplicate notification fires after the first. */
const DUPLICATE_SETTLE_WINDOW_MS = 1_500;

type PublicApiClient = ReturnType<typeof createPublicApiClient>;

interface InterruptedManagerRunFixture {
  managerThreadId: string;
  runId: string;
}

interface SetupInterruptedManagerRunArgs {
  managerName: string;
  projectName: string;
  workflowName: string;
}

/**
 * The shared interruption scenario both tests start from: a manager-anchored
 * run (two sequential agents; the slow second keeps the run mid-turn), a real
 * daemon crash + restart whose session-open reconciliation interrupts the
 * run, and the paused INFORMATIONAL message delivered exactly once with its
 * manager turn completed — so a pending undelivered manager command never
 * suppresses the terminal message each test settles toward.
 */
async function setupInterruptedManagerRun(
  harness: IntegrationHarness,
  args: SetupInterruptedManagerRunArgs,
): Promise<InterruptedManagerRunFixture> {
  const project = await createProjectFixture(harness, {
    name: args.projectName,
  });
  // The manager is an ordinary thread anchored at the project checkout (an
  // unmanaged env at the project source path), on a real catalog provider id
  // (executed by the harness's fake adapter, like every workflow agent here):
  // manager system messages dispatch as `turn.submit`, whose gate rejects
  // non-catalog providers such as the test-only "fake".
  const { thread: manager } = await createReadyHostThread(harness, {
    projectId: project.id,
    providerId: "codex",
    timeoutMs: MANAGER_READY_TIMEOUT_MS,
    title: args.managerName,
    workspace: { type: "unmanaged", path: harness.repoDir },
  });

  // Manager-anchored launch (hostId omitted → inherited from the
  // manager's environment); beta keeps the run mid-turn for the crash.
  const run = await launchPublicWorkflowRun(harness.api, {
    projectId: project.id,
    anchorThreadId: manager.id,
    source: {
      type: "inline",
      script: buildSequentialAgentWorkflowSource({
        name: args.workflowName,
        prompts: ["alpha step", "delay:8000 beta step"],
      }),
    },
  });
  await waitForPublicWorkflowRunStatus(
    harness.api,
    run.id,
    "running",
    WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
  );
  await waitForPublicWorkflowRunEventCount(
    harness.api,
    run.id,
    "agent/completed",
    1,
    WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
  );

  // Interrupt via a real daemon restart → session-open reconciliation
  // pauses the run on the manager anchor.
  await harness.crashDaemon();
  await waitForHostDisconnected(
    harness.api,
    harness.hostId,
    RECOVERY_TIMEOUT_MS,
  );
  await harness.startDaemon();
  await waitForPublicWorkflowRunStatus(
    harness.api,
    run.id,
    "interrupted",
    RECOVERY_TIMEOUT_MS,
  );
  // The interruption reached the manager anchor: the durable paused
  // snapshot row is there (the run page / thread row renders it)...
  expect(
    latestBackgroundTaskRowForItem(harness, manager.id, run.id),
  ).toMatchObject({
    type: "item/backgroundTask/progress",
    taskStatus: "paused",
    taskType: "bb_workflow",
  });

  // ...and the paused INFORMATIONAL message arrives exactly once (the M6
  // regression proof): the interruption transaction recorded the durable
  // "paused" intent while the daemon's hub socket was still detached — the
  // window every pre-M6 one-shot push died in — and the socket attach
  // drained it.
  await waitForManagerWorkflowMessage({
    api: harness.api,
    marker: WORKFLOW_RUN_PAUSED_MESSAGE_MARKER,
    runId: run.id,
    threadId: manager.id,
    timeoutMs: NOTIFICATION_TIMEOUT_MS,
  });
  await new Promise((resolve) =>
    setTimeout(resolve, DUPLICATE_SETTLE_WINDOW_MS),
  );
  expect(
    await countManagerWorkflowMessages({
      api: harness.api,
      marker: WORKFLOW_RUN_PAUSED_MESSAGE_MARKER,
      runId: run.id,
      threadId: manager.id,
    }),
  ).toBe(1);

  // The delivered paused message queued a manager turn; let it complete
  // through the live daemon before each test settles the run — a pending
  // undelivered manager command would suppress the terminal message.
  await waitForThreadStatus(
    harness.api,
    manager.id,
    "idle",
    MANAGER_READY_TIMEOUT_MS,
  );

  return { managerThreadId: manager.id, runId: run.id };
}

async function expectWholeCycleMessageTexts(
  api: PublicApiClient,
  fixture: InterruptedManagerRunFixture,
  terminalMarker: string,
): Promise<void> {
  await new Promise((resolve) =>
    setTimeout(resolve, DUPLICATE_SETTLE_WINDOW_MS),
  );
  expect(
    await countManagerWorkflowMessages({
      api,
      marker: terminalMarker,
      runId: fixture.runId,
      threadId: fixture.managerThreadId,
    }),
  ).toBe(1);
  // The whole cycle produced exactly the paused message and the one
  // terminal message about this run — nothing else, no re-fires — and each
  // carries the `[bb system]` prefix the manager instructions teach.
  const rows = await listManagerWorkflowMessageRows({
    api,
    runId: fixture.runId,
    threadId: fixture.managerThreadId,
  });
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(hasPrefixedWorkflowMessagePart(row, fixture.runId)).toBe(true);
  }
}

describe.sequential("workflow manager terminal notification integration", () => {
  it(
    "delivers one paused and one terminal notification across interrupt + resume (M5 exit criterion, M6 paused-delivery fix)",
    { timeout: scaleTimeoutMs(180_000) },
    () =>
      withHarness(async (harness) => {
        const fixture = await setupInterruptedManagerRun(harness, {
          managerName: "Workflow manager",
          projectName: "Workflow Manager Notification",
          workflowName: "manager-notify-flow",
        });

        // Resume through the public route; the run completes for real.
        await resumePublicWorkflowRun(harness.api, fixture.runId);
        const settled = await waitForPublicWorkflowRunTerminal(
          harness.api,
          fixture.runId,
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );
        expect(settled.status).toBe("completed");

        // The terminal notification is deferred off the daemon-ingress path;
        // wait for it, give any duplicate a window to fire, then assert the
        // whole interrupt + resume cycle produced EXACTLY ONE paused and
        // EXACTLY ONE terminal notification about this run.
        await waitForManagerWorkflowMessage({
          api: harness.api,
          marker: WORKFLOW_RUN_COMPLETED_MESSAGE_MARKER,
          runId: fixture.runId,
          threadId: fixture.managerThreadId,
          timeoutMs: NOTIFICATION_TIMEOUT_MS,
        });
        await expectWholeCycleMessageTexts(
          harness.api,
          fixture,
          WORKFLOW_RUN_COMPLETED_MESSAGE_MARKER,
        );
      }),
  );

  it(
    "delivers exactly one cancelled notification for a server-side cancel of an interrupted run (M6 alignment)",
    { timeout: scaleTimeoutMs(180_000) },
    () =>
      withHarness(async (harness) => {
        const fixture = await setupInterruptedManagerRun(harness, {
          managerName: "Workflow cancel manager",
          projectName: "Workflow Manager Cancel Notification",
          workflowName: "manager-cancel-flow",
        });

        // Cancel through the public route — the run-page action the M5 UI
        // exposes on interrupted runs. The settle is entirely server-side
        // and synchronous in the route transaction.
        await cancelPublicWorkflowRun(harness.api, fixture.runId);
        expect(
          (await getPublicWorkflowRun(harness.api, fixture.runId)).status,
        ).toBe("cancelled");

        // Server-settle proof: no `run/cancelled` terminal event ever lands
        // (the daemon-converged path this asymmetry was measured against
        // notifies via ingestion of exactly that event)...
        const rows = await listPublicWorkflowRunEvents(
          harness.api,
          fixture.runId,
        );
        expect(rows.some((row) => row.event.type === "run/cancelled")).toBe(
          false,
        );
        // ...and the anchor item settled as stopped with its single
        // completed row, appended in the same settle transaction.
        expect(
          latestBackgroundTaskRowForItem(
            harness,
            fixture.managerThreadId,
            fixture.runId,
          ),
        ).toMatchObject({
          type: "item/backgroundTask/completed",
          taskStatus: "stopped",
          taskType: "bb_workflow",
        });

        // The previously-silent path now notifies: the settle transaction
        // recorded the `settled` intent and the post-commit drain delivered
        // it (the manager host is online here; the offline case rides the
        // same durable intent — unit-covered in
        // apps/server/test/workflows/workflow-run-pending-notifications.test.ts).
        await waitForManagerWorkflowMessage({
          api: harness.api,
          marker: WORKFLOW_RUN_CANCELLED_MESSAGE_MARKER,
          runId: fixture.runId,
          threadId: fixture.managerThreadId,
          timeoutMs: NOTIFICATION_TIMEOUT_MS,
        });
        await expectWholeCycleMessageTexts(
          harness.api,
          fixture,
          WORKFLOW_RUN_CANCELLED_MESSAGE_MARKER,
        );
      }),
  );
});
