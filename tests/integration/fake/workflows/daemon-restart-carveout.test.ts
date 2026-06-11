// M3 exit criterion (h): when the daemon dies mid-run and a fresh instance
// re-registers, settleDanglingBackgroundTasks settles ordinary local_workflow
// items as stopped — but skips bb_workflow anchor items (the carve-out), which
// the workflow lifecycle owns: reconciliation bucket (b) interrupts the run
// and appends the PAUSED anchor snapshot, never a completed row, so the run
// stays resumable. Driven through the real session-open trigger: a real
// daemon restart with a new instanceId reporting no active workflow runs.

import { getWorkflowRunOperation } from "@bb/db";
import { describe, expect, it } from "vitest";
import { createProjectFixture, createReadyHostThread } from "../../helpers/fixtures.js";
import { withHarness } from "../../helpers/harness.js";
import { scaleTimeoutMs } from "../../helpers/time.js";
import {
  buildRunEventEnvelope,
  createIntegrationWorkflowRun,
  forceWorkflowRunStatusSteps,
  latestBackgroundTaskRowForItem,
  listBackgroundTaskCompletedRows,
  postWorkflowRunEvents,
  seedOpenLocalWorkflowTaskItem,
  waitForWorkflowRunStatus,
  WORKFLOW_OPERATION_TIMEOUT_MS,
} from "../../helpers/workflow-runs.js";

const SETUP_TIMEOUT_MS = scaleTimeoutMs(15_000);
const LOCAL_ITEM_ID = "task:local-workflow-1";

describe.sequential("workflow daemon-restart carve-out integration", () => {
  it(
    "a restarted daemon settles local_workflow items but leaves the bb_workflow anchor item open and paused (exit criterion h)",
    { timeout: scaleTimeoutMs(120_000) },
    () =>
      withHarness(async (harness) => {
        const project = await createProjectFixture(harness, {
          name: "Workflow Carveout",
        });
        const { thread } = await createReadyHostThread(harness, {
          projectId: project.id,
          timeoutMs: SETUP_TIMEOUT_MS,
          workspace: { type: "unmanaged", path: harness.repoDir },
        });

        // An open claude-native local_workflow item on the same host — the
        // kind the generic settle backstop still owns after the carve-out.
        seedOpenLocalWorkflowTaskItem(harness, {
          threadId: thread.id,
          environmentId: thread.environmentId ?? null,
          itemId: LOCAL_ITEM_ID,
        });

        // A thread-anchored run, demonstrably mid-run: running status plus a
        // real ingestion-folded anchor progress row (taskType bb_workflow).
        const run = createIntegrationWorkflowRun(harness, {
          projectId: project.id,
          anchorThreadId: thread.id,
        });
        forceWorkflowRunStatusSteps(harness, run.id, ["starting", "running"]);
        await postWorkflowRunEvents(harness, [
          buildRunEventEnvelope(run.id, {
            type: "agent/started",
            agentIndex: 0,
            label: "integration agent",
            provider: "fake-provider",
          }),
        ]);
        const liveAnchorRow = latestBackgroundTaskRowForItem(
          harness,
          thread.id,
          run.id,
        );
        expect(liveAnchorRow).toMatchObject({
          type: "item/backgroundTask/progress",
          taskStatus: "running",
          taskType: "bb_workflow",
        });

        // The "kill -9" lever: a fresh daemon instance re-registers (new
        // instanceId, heartbeat-verified activeWorkflowRunIds = []), firing
        // settleDanglingBackgroundTasks + reconcileDaemonReportedWorkflowRuns
        // on the real /internal/session/open path.
        await harness.restartDaemon("workflow-carveout-restart");

        const interrupted = await waitForWorkflowRunStatus(
          harness,
          run.id,
          "interrupted",
          WORKFLOW_OPERATION_TIMEOUT_MS,
        );
        expect(interrupted.failureReason).toBe("host-daemon-restarted");

        // The local_workflow item was settled as stopped...
        const completedRows = listBackgroundTaskCompletedRows(
          harness,
          thread.id,
        );
        expect(completedRows).toHaveLength(1);
        expect(completedRows[0]).toMatchObject({
          itemId: LOCAL_ITEM_ID,
          taskType: "local_workflow",
          taskStatus: "stopped",
        });

        // ...while the bb_workflow anchor item stays OPEN (no completed row)
        // with the paused snapshot — resumable, exactly as the plan demands.
        const pausedAnchorRow = latestBackgroundTaskRowForItem(
          harness,
          thread.id,
          run.id,
        );
        expect(pausedAnchorRow).toMatchObject({
          type: "item/backgroundTask/progress",
          taskStatus: "paused",
          taskType: "bb_workflow",
        });

        // Interruption is bucket (b), never bucket (d): no workflow.cancel
        // was requested for the interrupted (resumable) run (a cancel only
        // dispatches off a cancel operation row).
        expect(
          getWorkflowRunOperation(harness.db, { runId: run.id, kind: "cancel" }),
        ).toBeNull();
      }),
  );
});
