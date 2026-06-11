// M4 exit criteria over the public routes: a mid-run cancel converges through
// the durable daemon path to `cancelled` (and terminal runs then no-op cancel
// / 409 resume — the recorded interrupted-only resume gate), and the
// `kill`+`resume` loop — interrupt a live run, `POST /resume`, and the run
// completes with the journaled prefix replayed as `cached: true` agents.

import { describe, expect, it } from "vitest";
import { waitForHostDisconnected } from "../../helpers/assertions.js";
import { createProjectFixture } from "../../helpers/fixtures.js";
import { withHarness } from "../../helpers/harness.js";
import { scaleTimeoutMs } from "../../helpers/time.js";
import {
  cancelPublicWorkflowRun,
  expectApiError,
  getPublicWorkflowRun,
  launchPublicWorkflowRun,
  listPublicWorkflowRunEvents,
  resumePublicWorkflowRun,
  waitForPublicWorkflowRunEventCount,
  waitForPublicWorkflowRunStatus,
  waitForPublicWorkflowRunTerminal,
  waitPublicWorkflowRunRound,
} from "../../helpers/workflow-public-api.js";
import {
  buildSequentialAgentWorkflowSource,
  WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
  type AgentCompletedRunEvent,
} from "../../helpers/workflow-runs.js";

const RECOVERY_TIMEOUT_MS = scaleTimeoutMs(30_000);

describe.sequential("workflow public cancel and resume", () => {
  it(
    "cancels a live run through the durable daemon path and gates resume on terminal",
    { timeout: scaleTimeoutMs(120_000) },
    () =>
      withHarness(async (harness) => {
        const project = await createProjectFixture(harness, {
          name: "Workflow Public Cancel",
        });
        // One long fake turn keeps the runner mid-agent while the cancel
        // round-trips: server queues workflow.cancel, the daemon aborts the
        // runner, the runner exits run/cancelled, ingestion finalizes.
        const run = await launchPublicWorkflowRun(harness.api, {
          projectId: project.id,
          source: {
            type: "inline",
            script: buildSequentialAgentWorkflowSource({
              name: "public-cancel-flow",
              prompts: ["delay:20000 slow step"],
            }),
          },
        });
        expect(run.sourceTier).toBe("inline");
        await waitForPublicWorkflowRunStatus(
          harness.api,
          run.id,
          "running",
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );

        await cancelPublicWorkflowRun(harness.api, run.id);
        const settled = await waitForPublicWorkflowRunTerminal(
          harness.api,
          run.id,
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );
        expect(settled.status).toBe("cancelled");
        // The runner exited with the durable terminal event — this was the
        // daemon path, not a server-side settle.
        const rows = await listPublicWorkflowRunEvents(harness.api, run.id);
        expect(rows.at(-1)?.event.type).toBe("run/cancelled");

        // Terminal cancels no-op (200, still cancelled)…
        await cancelPublicWorkflowRun(harness.api, run.id);
        expect((await getPublicWorkflowRun(harness.api, run.id)).status).toBe(
          "cancelled",
        );
        // …and terminal runs are never resumable (the recorded
        // interrupted-only gate: `cancelled` is never revived).
        const resume = await harness.api["workflow-runs"][":id"].resume.$post({
          param: { id: run.id },
        });
        expect((await expectApiError(resume, 409)).code).toBe(
          "workflow_run_not_resumable",
        );
      }),
  );

  it(
    "resumes an interrupted run via the public routes with a cached prefix",
    { timeout: scaleTimeoutMs(180_000) },
    () =>
      withHarness(async (harness) => {
        const project = await createProjectFixture(harness, {
          name: "Workflow Public Resume",
        });
        // alpha journals quickly; beta is still mid-turn when the daemon
        // dies, so the resume replays alpha free and re-runs only beta.
        const run = await launchPublicWorkflowRun(harness.api, {
          projectId: project.id,
          source: {
            type: "inline",
            script: buildSequentialAgentWorkflowSource({
              name: "public-resume-flow",
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

        // Kill the daemon mid-beta; the replacement instance reports the run
        // gone and reconciliation interrupts it.
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

        // `interrupted` is not terminal: /wait keeps 204ing — waiting alone
        // never settles it (the CLI's exit-4 short-circuit rests on this).
        expect(
          await waitPublicWorkflowRunRound(harness.api, run.id, 1),
        ).toBeNull();

        await resumePublicWorkflowRun(harness.api, run.id);
        const settled = await waitForPublicWorkflowRunTerminal(
          harness.api,
          run.id,
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );
        expect(settled.status).toBe("completed");
        const { resultJson } = settled;
        if (resultJson === null) {
          throw new Error("Expected a run result");
        }
        expect(resultJson).toContain("alpha step");
        expect(resultJson).toContain("beta step");

        // Cached prefix, observed through the public events route: alpha
        // completed once for real and once as a free replay reusing the same
        // journal key and result; beta completed exactly once, never cached;
        // two run segments, one terminal.
        const rows = await listPublicWorkflowRunEvents(harness.api, run.id);
        // Gapless across the interruption: the resume segment continues the
        // run's single monotonic sequence (no restart at 1, no duplicates).
        rows.forEach((row, index) => {
          expect(row.sequence).toBe(index + 1);
        });
        const completedAgents = rows
          .map((row) => row.event)
          .filter(
            (event): event is AgentCompletedRunEvent =>
              event.type === "agent/completed",
          );
        const cachedEvents = completedAgents.filter((event) => event.cached);
        expect(cachedEvents).toHaveLength(1);
        const cachedReplay = cachedEvents[0];
        if (!cachedReplay) {
          throw new Error("Expected a cached replay event");
        }
        const freshEvents = completedAgents.filter((event) => !event.cached);
        expect(freshEvents).toHaveLength(2);
        const alphaOriginal = freshEvents.find(
          (event) => event.entry.key === cachedReplay.entry.key,
        );
        if (!alphaOriginal) {
          throw new Error(
            "Expected the cached replay to reuse the original journal key",
          );
        }
        expect(cachedReplay.entry.resultText).toBe(
          alphaOriginal.entry.resultText,
        );
        const runStartedRows = rows.filter(
          (row) => row.event.type === "run/started",
        );
        expect(runStartedRows).toHaveLength(2);
        expect(
          rows.filter((row) => row.event.type === "run/completed"),
        ).toHaveLength(1);

        // An afterSeq cursor split across the segment boundary stitches the
        // resume segment exactly (the M4 gapless-cursor criterion, two-segment
        // shape).
        const resumeSegmentStart = runStartedRows[1];
        if (!resumeSegmentStart) {
          throw new Error("Expected a resume-segment run/started row");
        }
        const cursor = resumeSegmentStart.sequence - 1;
        const tail = await listPublicWorkflowRunEvents(
          harness.api,
          run.id,
          cursor,
        );
        expect(tail).toEqual(rows.filter((row) => row.sequence > cursor));
      }),
  );
});
