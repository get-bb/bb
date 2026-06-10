// M3 exit criterion (g), through the real internal ingestion route with the
// live daemon session's credentials: a spooled terminal event arriving for an
// `interrupted` run settles it with the real outcome, while terminal statuses
// are never changed by late events — which still append as history and re-ack
// idempotently on redelivery.

import { listWorkflowRunEvents } from "@bb/db";
import { describe, expect, it } from "vitest";
import { createProjectFixture } from "../../helpers/fixtures.js";
import { withHarness } from "../../helpers/harness.js";
import {
  buildRunEventEnvelope,
  createIntegrationWorkflowRun,
  forceWorkflowRunStatusSteps,
  postWorkflowRunEvents,
  requireWorkflowRun,
} from "../../helpers/workflow-runs.js";

describe.sequential("workflow run late terminal event integration", () => {
  it("supersedes an interruption with the late real outcome while terminal statuses never change (exit criterion g)", () =>
    withHarness(async (harness) => {
      const project = await createProjectFixture(harness, {
        name: "Workflow Late Terminal",
      });
      const run = createIntegrationWorkflowRun(harness, {
        projectId: project.id,
      });
      forceWorkflowRunStatusSteps(
        harness,
        run.id,
        ["starting", "running", "interrupted"],
        "host-daemon-restarted",
      );

      // A partitioned daemon's spool flushes the real outcome late: the
      // interrupted run settles with it (interrupted → completed supersede).
      const completedEnvelope = buildRunEventEnvelope(run.id, {
        type: "run/completed",
        result: { verdict: "ok" },
        usage: { inputTokens: 11, outputTokens: 7 },
      });
      const firstResponse = await postWorkflowRunEvents(harness, [
        completedEnvelope,
      ]);
      expect(firstResponse.rejectedEvents).toEqual([]);
      expect(firstResponse.acceptedEvents).toHaveLength(1);

      const settled = requireWorkflowRun(harness, run.id);
      expect(settled.status).toBe("completed");
      expect(settled.resultJson).toBe(JSON.stringify({ verdict: "ok" }));
      expect(settled.failureReason).toBeNull();
      expect(settled.settledAt).not.toBeNull();
      expect(settled.usageInputTokens).toBe(11);
      expect(settled.usageOutputTokens).toBe(7);

      // A later conflicting terminal appends as history but changes nothing.
      const lateFailureResponse = await postWorkflowRunEvents(harness, [
        buildRunEventEnvelope(run.id, {
          type: "run/failed",
          error: "late failure that must not win",
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      ]);
      expect(lateFailureResponse.acceptedEvents).toHaveLength(1);

      const afterLateFailure = requireWorkflowRun(harness, run.id);
      expect(afterLateFailure.status).toBe("completed");
      expect(afterLateFailure.resultJson).toBe(JSON.stringify({ verdict: "ok" }));
      expect(afterLateFailure.failureReason).toBeNull();
      expect(afterLateFailure.settledAt).toBe(settled.settledAt);
      expect(afterLateFailure.usageInputTokens).toBe(11);

      const eventTypes = listWorkflowRunEvents(harness.db, {
        runId: run.id,
      }).map((row) => row.type);
      expect(eventTypes).toEqual(["run/completed", "run/failed"]);

      // A redelivered duplicate re-acks with its original sequence and never
      // re-fires settlement side effects (row count unchanged).
      const redelivered = await postWorkflowRunEvents(harness, [
        completedEnvelope,
      ]);
      expect(redelivered.acceptedEvents[0]?.sequence).toBe(
        firstResponse.acceptedEvents[0]?.sequence,
      );
      expect(listWorkflowRunEvents(harness.db, { runId: run.id })).toHaveLength(
        2,
      );
      expect(requireWorkflowRun(harness, run.id).status).toBe("completed");
    }));
});
