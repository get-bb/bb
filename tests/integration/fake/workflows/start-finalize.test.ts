// M3 exit criterion (a): start → run events land in `workflow_run_events` →
// terminal finalize, through the REAL machinery end to end — lifecycle
// request function, the live workflow.start dispatch, the daemon's
// workflow.start handler, runner child + fake provider, the durable
// run-event spool, ingestion fold, and the anchor-thread backgroundTask rows.

import { getWorkflowRunOperation } from "@bb/db";
import { workflowProgressSnapshotSchema } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  createProjectFixture,
  createReadyHostThread,
} from "../../helpers/fixtures.js";
import { withHarness } from "../../helpers/harness.js";
import { scaleTimeoutMs } from "../../helpers/time.js";
import {
  buildSequentialAgentWorkflowSource,
  createIntegrationWorkflowRun,
  listAgentCompletedRunEvents,
  listBackgroundTaskRowsForItem,
  listWorkflowRunEventRows,
  requestWorkflowRunStart,
  requireWorkflowRunOperation,
  waitForWorkflowRunStatus,
  WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
  workflowServerDeps,
} from "../../helpers/workflow-runs.js";

describe.sequential("workflow run start-to-finalize integration", () => {
  it(
    "lands run events durably and finalizes with a single anchor completed row (exit criterion a)",
    { timeout: scaleTimeoutMs(120_000) },
    () =>
      withHarness(async (harness) => {
        const project = await createProjectFixture(harness, {
          name: "Workflow Finalize",
        });
        const { thread } = await createReadyHostThread(harness, {
          projectId: project.id,
          workspace: { type: "unmanaged", path: harness.repoDir },
        });
        const run = createIntegrationWorkflowRun(harness, {
          projectId: project.id,
          anchorThreadId: thread.id,
          source: buildSequentialAgentWorkflowSource({
            name: "finalize-flow",
            prompts: ["alpha step", "beta step"],
          }),
        });
        expect(run.status).toBe("created");

        await requestWorkflowRunStart(workflowServerDeps(harness), {
          runId: run.id,
        });
        const settled = await waitForWorkflowRunStatus(
          harness,
          run.id,
          "completed",
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );

        // The run row settled with timestamps in causal order and the
        // workflow's return value (the fake provider echoes each prompt).
        expect(settled.failureReason).toBeNull();
        const { createdAt, startedAt, settledAt } = settled;
        if (startedAt === null || settledAt === null) {
          throw new Error("Expected startedAt and settledAt on a settled run");
        }
        expect(startedAt).toBeGreaterThanOrEqual(createdAt);
        expect(settledAt).toBeGreaterThanOrEqual(startedAt);
        const { resultJson } = settled;
        if (resultJson === null) {
          throw new Error("Expected a run result");
        }
        expect(resultJson).toContain("alpha step");
        expect(resultJson).toContain("beta step");

        // The durable journal landed: per-run monotonic sequences from 1,
        // unique producer ids, one run/started, one terminal event (last),
        // and one agent/completed per agent with distinct display indexes.
        const rows = listWorkflowRunEventRows(harness, run.id);
        expect(rows.length).toBeGreaterThanOrEqual(4);
        rows.forEach((row, index) => {
          expect(row.sequence).toBe(index + 1);
        });
        expect(new Set(rows.map((row) => row.producerEventId)).size).toBe(
          rows.length,
        );
        expect(rows.filter((row) => row.type === "run/started")).toHaveLength(
          1,
        );
        expect(
          rows.filter((row) => row.type === "run/completed"),
        ).toHaveLength(1);
        expect(rows.at(-1)?.type).toBe("run/completed");
        const completedAgents = listAgentCompletedRunEvents(harness, run.id);
        expect(completedAgents).toHaveLength(2);
        expect(
          new Set(completedAgents.map((event) => event.agentIndex)).size,
        ).toBe(2);
        expect(completedAgents.every((event) => !event.cached)).toBe(true);

        // The superseding snapshot fold settled both agents.
        const { progressSnapshot } = settled;
        if (progressSnapshot === null) {
          throw new Error("Expected a progress snapshot");
        }
        const snapshot = workflowProgressSnapshotSchema.parse(
          JSON.parse(progressSnapshot),
        );
        expect(snapshot.agents).toHaveLength(2);
        expect(snapshot.agents.every((agent) => agent.state === "done")).toBe(
          true,
        );

        // The acceptance-only ack settled the start operation; nothing ever
        // requested a cancel (a workflow.cancel only dispatches off a cancel
        // operation row).
        expect(requireWorkflowRunOperation(harness, run.id, "start").state).toBe(
          "completed",
        );
        expect(
          getWorkflowRunOperation(harness.db, { runId: run.id, kind: "cancel" }),
        ).toBeNull();

        // Anchor item: lifecycle rows all carry the run id as the item id,
        // with exactly one completed row, and it is the item's last row.
        const anchorRows = listBackgroundTaskRowsForItem(
          harness,
          thread.id,
          run.id,
        );
        expect(anchorRows.length).toBeGreaterThanOrEqual(1);
        expect(
          anchorRows.every((row) => row.taskType === "bb_workflow"),
        ).toBe(true);
        const completedRows = anchorRows.filter(
          (row) => row.type === "item/backgroundTask/completed",
        );
        expect(completedRows).toHaveLength(1);
        const lastAnchorRow = anchorRows.at(-1);
        expect(lastAnchorRow?.type).toBe("item/backgroundTask/completed");
        expect(lastAnchorRow?.taskStatus).toBe("completed");
      }),
  );
});
