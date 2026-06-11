// M3 exit criterion (c): resuming an interrupted run replays the journaled
// prefix for free (`cached: true` in the events and the snapshot fold),
// re-runs only the divergent suffix, and walks the anchor item through
// paused → running → completed as ONE item (stable `item.id` = the run id)
// with a single completed row at the true terminal. The resume journal is
// rebuilt from the server (`workflow_run_events`), not from daemon-local
// state — the daemon that ran the prefix is dead.

import { workflowProgressSnapshotSchema } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { waitForHostDisconnected } from "../../helpers/assertions.js";
import {
  createProjectFixture,
  createReadyHostThread,
} from "../../helpers/fixtures.js";
import { withHarness } from "../../helpers/harness.js";
import { scaleTimeoutMs } from "../../helpers/time.js";
import {
  buildSequentialAgentWorkflowSource,
  countWorkflowRunEventsOfType,
  createIntegrationWorkflowRun,
  listAgentCompletedRunEvents,
  listBackgroundTaskRowsForItem,
  requestWorkflowRunResume,
  requestWorkflowRunStart,
  requireWorkflowRunOperation,
  waitForWorkflowRunEventCount,
  waitForWorkflowRunStatus,
  WORKFLOW_RUN_DAEMON_RESTARTED_REASON,
  WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
  workflowServerDeps,
} from "../../helpers/workflow-runs.js";

const RECOVERY_TIMEOUT_MS = scaleTimeoutMs(30_000);

describe.sequential("workflow run resume cached-prefix integration", () => {
  it(
    "replays the cached prefix and re-runs the suffix with one anchor item lifecycle (exit criterion c)",
    { timeout: scaleTimeoutMs(180_000) },
    () =>
      withHarness(async (harness) => {
        const project = await createProjectFixture(harness, {
          name: "Workflow Resume Cached Prefix",
        });
        const { thread } = await createReadyHostThread(harness, {
          projectId: project.id,
          workspace: { type: "unmanaged", path: harness.repoDir },
        });
        const run = createIntegrationWorkflowRun(harness, {
          projectId: project.id,
          anchorThreadId: thread.id,
          source: buildSequentialAgentWorkflowSource({
            name: "resume-cached",
            // alpha journals quickly; beta is still mid-turn when the daemon
            // dies, so resume replays alpha and re-runs only beta.
            prompts: ["alpha step", "delay:8000 beta step"],
          }),
        });
        await requestWorkflowRunStart(workflowServerDeps(harness), {
          runId: run.id,
        });
        await waitForWorkflowRunStatus(
          harness,
          run.id,
          "running",
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );
        await waitForWorkflowRunEventCount(
          harness,
          run.id,
          "agent/completed",
          1,
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );

        // Kill the daemon mid-beta, then reconnect a NEW instance: bucket (b)
        // interrupts the run and pauses the anchor item.
        await harness.crashDaemon();
        await waitForHostDisconnected(
          harness.api,
          harness.hostId,
          RECOVERY_TIMEOUT_MS,
        );
        await harness.startDaemon();
        const interrupted = await waitForWorkflowRunStatus(
          harness,
          run.id,
          "interrupted",
          RECOVERY_TIMEOUT_MS,
        );
        expect(interrupted.failureReason).toBe(
          WORKFLOW_RUN_DAEMON_RESTARTED_REASON,
        );
        const anchorBeforeResume = listBackgroundTaskRowsForItem(
          harness,
          thread.id,
          run.id,
        );
        expect(
          anchorBeforeResume.filter(
            (row) => row.type === "item/backgroundTask/completed",
          ),
        ).toHaveLength(0);
        const pausedRow = anchorBeforeResume.at(-1);
        expect(pausedRow?.taskStatus).toBe("paused");
        const pausedSequence = pausedRow?.sequence ?? 0;
        const interruptedAt = Date.now();

        // Explicit resume: the daemon rebuilds the journal from the server
        // route, replays alpha instantly, and re-runs beta for real.
        await requestWorkflowRunResume(workflowServerDeps(harness), {
          runId: run.id,
        });

        // Paused → running on the anchor item: the run/started ingest flips
        // the run and appends the running anchor row in the same transaction.
        // Asserted mid-cycle because anchor progress rows are pruned to the
        // latest load-bearing row once later turns settle the thread (only
        // the completed row survives to the end).
        await waitForWorkflowRunStatus(
          harness,
          run.id,
          "running",
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );
        expect(
          listBackgroundTaskRowsForItem(harness, thread.id, run.id).some(
            (row) =>
              row.type === "item/backgroundTask/progress" &&
              row.taskStatus === "running" &&
              row.sequence > pausedSequence,
          ),
        ).toBe(true);

        const settled = await waitForWorkflowRunStatus(
          harness,
          run.id,
          "completed",
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );
        expect(
          requireWorkflowRunOperation(harness, run.id, "resume").state,
        ).toBe("completed");
        expect(settled.resultJson).toContain("alpha step");
        expect(settled.resultJson).toContain("beta step");

        // Cached prefix: alpha completed once for real (segment 1) and once
        // as a free replay (segment 2, same journal key and result text);
        // beta completed exactly once, never cached. Two run segments.
        const completedAgents = listAgentCompletedRunEvents(harness, run.id);
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
        expect(cachedReplay.agentIndex).toBe(alphaOriginal.agentIndex);
        const betaEvents = freshEvents.filter(
          (event) => event.entry.key !== cachedReplay.entry.key,
        );
        expect(betaEvents).toHaveLength(1);
        expect(
          countWorkflowRunEventsOfType(harness, run.id, "run/started"),
        ).toBe(2);
        expect(
          countWorkflowRunEventsOfType(harness, run.id, "run/completed"),
        ).toBe(1);

        // The snapshot fold carries the cached flag the timeline renders.
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
        expect(snapshot.agents.filter((agent) => agent.cached)).toHaveLength(
          1,
        );

        // One anchor item across the whole interrupt+resume cycle: exactly
        // one completed row, appended at the true terminal, after the paused
        // snapshot. (Superseded progress rows are pruned once anchor turns
        // settle, so the end state asserts the completed row only — the
        // paused and running phases were asserted live above.)
        const anchorRows = listBackgroundTaskRowsForItem(
          harness,
          thread.id,
          run.id,
        );
        const completedRows = anchorRows.filter(
          (row) => row.type === "item/backgroundTask/completed",
        );
        expect(completedRows).toHaveLength(1);
        const completedRow = completedRows[0];
        expect(completedRow?.sequence).toBeGreaterThan(pausedSequence);
        expect(anchorRows.at(-1)?.taskStatus).toBe("completed");
        const { settledAt } = settled;
        if (settledAt === null) {
          throw new Error("Expected settledAt on the settled run");
        }
        expect(settledAt).toBeGreaterThanOrEqual(interruptedAt);
      }),
  );
});
