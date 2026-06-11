// M5 exit criteria: an anchored `POST /workflow-runs` with `hostId` omitted
// inherits `{hostId, workspacePath}` from the anchor thread's environment (the
// env-inheritance seam deferred from M4) — proven against a real provisioned
// managed worktree, whose path differs from the project's default source — and
// the inline anchor row lands in the anchor thread as soon as the run is
// observably running (the row appends in the same ingestion transaction that
// flips the status, well within one throttle window), folding into exactly ONE
// workflow timeline row across the whole lifecycle.

import { describe, expect, it } from "vitest";
import { getThreadTimeline } from "../../helpers/api.js";
import {
  createProjectFixture,
  createReadyHostThread,
} from "../../helpers/fixtures.js";
import { withHarness } from "../../helpers/harness.js";
import { scaleTimeoutMs } from "../../helpers/time.js";
import { listWorkflowTimelineRows } from "../../helpers/timeline-response.js";
import {
  launchPublicWorkflowRun,
  waitForPublicWorkflowRunStatus,
  waitForPublicWorkflowRunTerminal,
} from "../../helpers/workflow-public-api.js";
import {
  buildSequentialAgentWorkflowSource,
  latestBackgroundTaskRowForItem,
  listBackgroundTaskRowsForItem,
  WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
} from "../../helpers/workflow-runs.js";

const SETUP_TIMEOUT_MS = scaleTimeoutMs(15_000);

describe.sequential("workflow anchored launch env-inheritance", () => {
  it(
    "inherits the anchor thread's worktree environment and folds the live anchor row into one timeline row (M5 launch resolution)",
    { timeout: scaleTimeoutMs(120_000) },
    () =>
      withHarness(async (harness) => {
        const project = await createProjectFixture(harness, {
          name: "Workflow Anchored Launch",
        });
        // A managed worktree gives the thread an environment whose path is
        // NOT the project's default source — the only way to observe that the
        // launch inherited the thread environment instead of silently falling
        // back to default-source resolution.
        const { environment, thread } = await createReadyHostThread(harness, {
          projectId: project.id,
          timeoutMs: SETUP_TIMEOUT_MS,
          workspace: { type: "managed-worktree" },
        });
        const worktreePath = environment.path;
        if (!worktreePath) {
          throw new Error("Expected the worktree environment to have a path");
        }
        expect(worktreePath).not.toBe(harness.repoDir);

        // Anchored launch with hostId omitted: omission means "inherit from
        // the anchor thread's environment" (the M5 launch-resolution seam).
        const run = await launchPublicWorkflowRun(harness.api, {
          projectId: project.id,
          anchorThreadId: thread.id,
          source: {
            type: "inline",
            script: buildSequentialAgentWorkflowSource({
              name: "anchored-inherit-flow",
              prompts: ["delay:5000 inherited work"],
            }),
          },
        });
        expect(run.anchorThreadId).toBe(thread.id);
        expect(run.hostId).toBe(environment.hostId);
        expect(run.hostId).toBe(harness.hostId);
        expect(run.workspacePath).toBe(worktreePath);

        // Once the run is observably running, the inline anchor row has
        // already landed: the first ingestion batch appends the thread-scoped
        // progress row in the SAME transaction that flips the status (the
        // run/started status change bypasses the 500ms throttle), so the live
        // row appears within one throttle window of launch.
        await waitForPublicWorkflowRunStatus(
          harness.api,
          run.id,
          "running",
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );
        expect(
          latestBackgroundTaskRowForItem(harness, thread.id, run.id),
        ).toMatchObject({
          type: "item/backgroundTask/progress",
          taskStatus: "running",
          taskType: "bb_workflow",
        });

        // The thread-view projection (the same fold the SPA row renders)
        // materializes ONE live workflow row from the bare thread-scoped
        // progress row — no active turn was involved in the anchor append.
        const liveRows = listWorkflowTimelineRows(
          await getThreadTimeline(harness.api, thread.id, {
            includeNestedRows: true,
          }),
        );
        expect(liveRows).toHaveLength(1);
        expect(liveRows[0]).toMatchObject({
          itemId: run.id,
          taskType: "bb_workflow",
          taskStatus: "running",
          completedAt: null,
        });

        // The run executes in the inherited worktree to completion; the
        // anchor item settles with exactly one completed row, last.
        const settled = await waitForPublicWorkflowRunTerminal(
          harness.api,
          run.id,
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );
        expect(settled.status).toBe("completed");
        expect(settled.resultJson).toContain("inherited work");

        const anchorRows = listBackgroundTaskRowsForItem(
          harness,
          thread.id,
          run.id,
        );
        expect(anchorRows.length).toBeGreaterThanOrEqual(2);
        expect(anchorRows.every((row) => row.taskType === "bb_workflow")).toBe(
          true,
        );
        expect(
          anchorRows.filter(
            (row) => row.type === "item/backgroundTask/completed",
          ),
        ).toHaveLength(1);
        expect(anchorRows.at(-1)?.type).toBe("item/backgroundTask/completed");

        // Still exactly ONE workflow row after settlement — every lifecycle
        // row folded into the same item.
        const settledRows = listWorkflowTimelineRows(
          await getThreadTimeline(harness.api, thread.id, {
            includeNestedRows: true,
          }),
        );
        expect(settledRows).toHaveLength(1);
        expect(settledRows[0]).toMatchObject({
          itemId: run.id,
          taskType: "bb_workflow",
          taskStatus: "completed",
        });
        expect(settledRows[0]?.completedAt).not.toBeNull();
      }),
  );
});
