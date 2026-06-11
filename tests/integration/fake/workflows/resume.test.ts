// M3 exit criteria (e) and (f): resume request collapse and journal-fetch
// failure, driven through the REAL machinery — server lifecycle request
// functions, the live workflow.start dispatch, the daemon's workflow.start
// handler, journal fetch over the internal HTTP route, runner child + fake
// provider, and spool-fed ingestion.

import { listWorkflowRunEvents } from "@bb/db";
import { describe, expect, it } from "vitest";
import { createProjectFixture } from "../../helpers/fixtures.js";
import { withHarness } from "../../helpers/harness.js";
import { scaleTimeoutMs } from "../../helpers/time.js";
import {
  appendCorruptJournalEventRow,
  countWorkflowRunEventsOfType,
  createIntegrationWorkflowRun,
  forceWorkflowRunStatusSteps,
  parseWorkflowStartOperationCommand,
  requestWorkflowRunResume,
  requireWorkflowRun,
  requireWorkflowRunOperation,
  waitForWorkflowRunOperation,
  waitForWorkflowRunStatus,
  WORKFLOW_OPERATION_TIMEOUT_MS,
  WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
  workflowServerDeps,
} from "../../helpers/workflow-runs.js";

describe.sequential("workflow run resume integration", () => {
  it(
    "collapses concurrent resume requests onto one op and one command, then resumes end to end (exit criterion e)",
    { timeout: scaleTimeoutMs(120_000) },
    () =>
      withHarness(async (harness) => {
        const project = await createProjectFixture(harness, {
          name: "Workflow Resume Collapse",
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

        const deps = workflowServerDeps(harness);
        await Promise.all(
          Array.from({ length: 5 }, () =>
            requestWorkflowRunResume(deps, { runId: run.id }),
          ),
        );

        // The burst collapsed: one resume operation (unique(runId, kind) +
        // the active-op gate) carrying the single prebuilt workflow.start
        // command — a resume, nonce minted once for the whole burst.
        const operation = requireWorkflowRunOperation(harness, run.id, "resume");
        expect(parseWorkflowStartOperationCommand(operation)).toMatchObject({
          type: "workflow.start",
          resume: { nonce: expect.any(String) },
          runId: run.id,
        });
        // The daemon may already have raced the acceptance ack in.
        expect(["requested", "queued", "completed"]).toContain(operation.state);

        // The real daemon resumes: journal fetched from the server (empty —
        // fresh segment), runner child spawned, fake provider turn completes,
        // and the spooled terminal event finalizes the run.
        const settled = await waitForWorkflowRunStatus(
          harness,
          run.id,
          "completed",
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );
        // The fake provider echoed OUR script's prompt back through the
        // runner into the persisted run result.
        expect(settled.resultJson).toContain("Response to: do the integration work");
        expect(settled.failureReason).toBeNull();
        expect(settled.settledAt).not.toBeNull();
        expect(
          requireWorkflowRunOperation(harness, run.id, "resume").state,
        ).toBe("completed");
        // Exactly one runner spawn across the whole burst — a second
        // dispatched resume would have produced a second run/started.
        expect(
          countWorkflowRunEventsOfType(harness, run.id, "run/started"),
        ).toBe(1);

        const eventTypes = listWorkflowRunEvents(harness.db, {
          runId: run.id,
        }).map((row) => row.type);
        expect(eventTypes).toContain("agent/completed");
        expect(eventTypes).toContain("run/completed");
      }),
  );

  it(
    "journal-fetch failure leaves the run interrupted with a failed resume op (exit criterion f)",
    { timeout: scaleTimeoutMs(120_000) },
    () =>
      withHarness(async (harness) => {
        const project = await createProjectFixture(harness, {
          name: "Workflow Resume Journal Failure",
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
        // An unreadable journal row makes the journal route refuse the whole
        // fetch (a silently shortened journal would shift agent indexes and
        // re-bill work) — the daemon maps that onto journal_fetch_failed.
        appendCorruptJournalEventRow(harness, run.id);

        const deps = workflowServerDeps(harness);
        await requestWorkflowRunResume(deps, { runId: run.id });

        const failedOperation = await waitForWorkflowRunOperation(
          harness,
          run.id,
          "resume",
          (operation) => operation.state === "failed",
          WORKFLOW_OPERATION_TIMEOUT_MS,
        );
        expect(failedOperation.failureReason).toContain("journal");
        // Never half-resumed: the run stays interrupted and resumable.
        const interrupted = requireWorkflowRun(harness, run.id);
        expect(interrupted.status).toBe("interrupted");
        expect(interrupted.settledAt).toBeNull();

        // Retryable: a fresh resume request is accepted and re-requests the
        // operation (the daemon will fail this one the same way — the row
        // is still corrupt — but the request path itself never rejects).
        await requestWorkflowRunResume(deps, { runId: run.id });
        const retried = requireWorkflowRunOperation(harness, run.id, "resume");
        expect(retried.requestedAt).toBeGreaterThanOrEqual(
          failedOperation.requestedAt,
        );
        expect(["requested", "queued", "failed"]).toContain(retried.state);
        expect(requireWorkflowRun(harness, run.id).status).toBe("interrupted");
      }),
  );
});
