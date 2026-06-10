// M3 exit criterion (i): an over-cap launch holds in the `requested`
// operation state (no command, run stays `created`) and admits when host
// capacity frees — then the REAL daemon executes the admitted run to
// completion (runner child + fake provider + spool ingestion).

import { listWorkflowRunEvents } from "@bb/db";
import { describe, expect, it } from "vitest";
import { createProjectFixture } from "../../helpers/fixtures.js";
import { withHarness } from "../../helpers/harness.js";
import { scaleTimeoutMs } from "../../helpers/time.js";
import {
  createIntegrationWorkflowRun,
  expectWorkflowStartHeldUndispatched,
  forceWorkflowRunStatusSteps,
  requestWorkflowRunStart,
  requireWorkflowRun,
  requireWorkflowRunOperation,
  runWorkflowRunLifecycleSweep,
  settleWorkflowRunForTest,
  waitForWorkflowRunStatus,
  WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
  workflowServerDeps,
} from "../../helpers/workflow-runs.js";

describe.sequential("workflow run admission cap integration", () => {
  it(
    "holds an over-cap launch in requested and admits it when capacity frees (exit criterion i)",
    { timeout: scaleTimeoutMs(120_000) },
    () =>
      withHarness(async (harness) => {
        const project = await createProjectFixture(harness, {
          name: "Workflow Admission Cap",
        });
        const deps = workflowServerDeps(harness);

        // Fill the host's admission cap with capacity-holding runs (the cap
        // is server config now — M7 — so read it where the server does).
        const holders = Array.from(
          { length: deps.config.workflowMaxConcurrentRunsPerHost },
          () =>
            createIntegrationWorkflowRun(harness, { projectId: project.id }),
        );
        for (const holder of holders) {
          forceWorkflowRunStatusSteps(harness, holder.id, ["starting"]);
        }

        const overCapRun = createIntegrationWorkflowRun(harness, {
          projectId: project.id,
        });
        await requestWorkflowRunStart(deps, { runId: overCapRun.id });

        // Over cap: the operation holds in `requested`, the run stays
        // `created`, and no live command was ever dispatched.
        expectWorkflowStartHeldUndispatched(harness, overCapRun.id);
        expect(requireWorkflowRun(harness, overCapRun.id).status).toBe(
          "created",
        );

        // A sweep tick without free capacity re-admits nothing.
        await runWorkflowRunLifecycleSweep(deps);
        expectWorkflowStartHeldUndispatched(harness, overCapRun.id);

        // Capacity frees; the next sweep admits the held launch.
        const settledHolder = holders[0];
        if (!settledHolder) {
          throw new Error("Expected a capacity-holding fixture run");
        }
        settleWorkflowRunForTest(harness, settledHolder.id, "cancelled");
        await runWorkflowRunLifecycleSweep(deps);

        // The sweep dispatched the live command (execution id recorded on the
        // operation). The daemon may already be racing the acceptance ack, so
        // assert the state loosely here and precisely after settlement below.
        const admittedOperation = requireWorkflowRunOperation(
          harness,
          overCapRun.id,
          "start",
        );
        expect(admittedOperation.commandId).not.toBeNull();
        expect(["queued", "completed"]).toContain(admittedOperation.state);

        // The admitted run executes for real and settles.
        const settled = await waitForWorkflowRunStatus(
          harness,
          overCapRun.id,
          "completed",
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );
        expect(settled.resultJson).toContain("Response to:");
        expect(
          requireWorkflowRunOperation(harness, overCapRun.id, "start").state,
        ).toBe("completed");
        const eventTypes = listWorkflowRunEvents(harness.db, {
          runId: overCapRun.id,
        }).map((row) => row.type);
        // Exactly one runner spawn across the whole hold/admit cycle: a
        // re-dispatched start would have produced a second run/started.
        expect(eventTypes.filter((type) => type === "run/started")).toHaveLength(
          1,
        );
        expect(eventTypes).toContain("run/completed");
      }),
  );
});
