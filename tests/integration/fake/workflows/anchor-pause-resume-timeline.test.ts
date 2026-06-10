// M5 exit criteria: the pause/resume anchor lifecycle observed at the
// projection level — the SPA-free equivalent of the run page walkthrough. A
// real daemon crash + restart interrupts the run (the anchor timeline shows
// `paused`), event pruning between pause and resume keeps exactly the latest
// paused snapshot row (and timeline backfill still materializes the workflow
// row from that bare thread-scoped row), an explicit resume needs NO turn on
// the anchor thread ("hours later" semantics — every post-launch anchor row is
// a thread-scoped server append), and the timeline renders paused → running →
// completed as ONE workflow row whose single completed row lands only at the
// true terminal, with the final `completedAt` from the terminal settle rather
// than the interruption.
//
// The anchor thread is ARCHIVED right after the launch: an archived manager
// is the legitimate turn-free anchor state — lifecycle notification messages
// skip archived threads while anchor ROWS still append — which is exactly the
// "hours later, nobody is driving the thread" regime these projection
// criteria describe. It also keeps the timeline readable across the daemon
// restart: the agent-runtime fake provider script numbers turn ids `turn-<n>`
// per process, so a notification turn after the restart would reuse `turn-1`
// and make every later timeline read 500 with "duplicate turn/started" (the
// daemon's workflow fake-provider script pid-qualifies its turn ids; the
// agent-runtime one does not). The notification delivery lifecycle itself is
// covered by manager-terminal-notification.test.ts.

import { describe, expect, it } from "vitest";
import { waitForHostDisconnected } from "../../helpers/assertions.js";
import {
  archiveThread,
  getThread,
  getThreadTimeline,
} from "../../helpers/api.js";
import {
  createProjectFixture,
  createReadyHostThread,
} from "../../helpers/fixtures.js";
import { withHarness } from "../../helpers/harness.js";
import { readStoredTurnEvents } from "../../helpers/queries.js";
import { scaleTimeoutMs } from "../../helpers/time.js";
import { listWorkflowTimelineRows } from "../../helpers/timeline-response.js";
import {
  launchPublicWorkflowRun,
  resumePublicWorkflowRun,
  waitForPublicWorkflowRunEventCount,
  waitForPublicWorkflowRunStatus,
  waitForPublicWorkflowRunTerminal,
} from "../../helpers/workflow-public-api.js";
import {
  buildSequentialAgentWorkflowSource,
  listBackgroundTaskCompletedRows,
  listBackgroundTaskRowsForItem,
  pruneThreadEventHistory,
  WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
  workflowServerDeps,
} from "../../helpers/workflow-runs.js";
import type { IntegrationHarness } from "../../helpers/harness.js";

const SETUP_TIMEOUT_MS = scaleTimeoutMs(15_000);
const RECOVERY_TIMEOUT_MS = scaleTimeoutMs(30_000);

function countAnchorTurnRequests(
  harness: IntegrationHarness,
  threadId: string,
): number {
  return readStoredTurnEvents(harness.db, threadId).filter(
    (row) => row.type === "client/turn/requested",
  ).length;
}

describe.sequential("workflow anchor pause/resume timeline integration", () => {
  it(
    "renders paused → running → completed as one workflow row, surviving pruning between pause and resume (M5 lifecycle)",
    { timeout: scaleTimeoutMs(180_000) },
    () =>
      withHarness(async (harness) => {
        const project = await createProjectFixture(harness, {
          name: "Workflow Pause Resume Timeline",
        });
        const { thread } = await createReadyHostThread(harness, {
          projectId: project.id,
          timeoutMs: SETUP_TIMEOUT_MS,
          workspace: { type: "unmanaged", path: harness.repoDir },
        });

        // alpha journals quickly; beta is still mid-turn when the daemon
        // dies, so the interruption catches a half-done run and the resume
        // replays alpha free.
        const run = await launchPublicWorkflowRun(harness.api, {
          projectId: project.id,
          anchorThreadId: thread.id,
          source: {
            type: "inline",
            script: buildSequentialAgentWorkflowSource({
              name: "pause-resume-timeline",
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

        // Archive the anchor (see the header): the run keeps running and the
        // anchor rows keep appending, but no notification turn will ever land
        // on the thread — the projection below observes pure thread-scoped
        // server appends.
        await archiveThread(harness.api, thread.id);

        // Interrupt via a real daemon restart: the crash drops the runner,
        // and the fresh instance's session-open reconciliation (bucket b)
        // interrupts the run and appends the paused anchor snapshot.
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

        // Paused, never settled: no completed row exists, and the projection
        // folds the lifecycle so far into ONE paused workflow row.
        expect(listBackgroundTaskCompletedRows(harness, thread.id)).toEqual(
          [],
        );
        const rowsAtPause = listBackgroundTaskRowsForItem(
          harness,
          thread.id,
          run.id,
        );
        expect(rowsAtPause.length).toBeGreaterThanOrEqual(2);
        expect(rowsAtPause.at(-1)?.taskStatus).toBe("paused");
        const pausedTimelineRows = listWorkflowTimelineRows(
          await getThreadTimeline(harness.api, thread.id, {
            includeNestedRows: true,
          }),
        );
        expect(pausedTimelineRows).toHaveLength(1);
        expect(pausedTimelineRows[0]).toMatchObject({
          itemId: run.id,
          taskType: "bb_workflow",
          taskStatus: "paused",
          completedAt: null,
        });

        // Event pruning between pause and resume (the real pruning worker the
        // gated sweep delegates to): every superseded progress row is
        // deleted, the MAX-sequence paused row survives — the timeline
        // backfill must still materialize the workflow row from that single
        // bare thread-scoped row.
        const pruned = pruneThreadEventHistory(workflowServerDeps(harness), {
          mode: "idle",
          threadId: thread.id,
        });
        expect(pruned.removedBackgroundTaskProgressEvents).toBe(
          rowsAtPause.length - 1,
        );
        const rowsAfterPrune = listBackgroundTaskRowsForItem(
          harness,
          thread.id,
          run.id,
        );
        expect(rowsAfterPrune).toHaveLength(1);
        expect(rowsAfterPrune[0]).toMatchObject({
          type: "item/backgroundTask/progress",
          taskStatus: "paused",
          taskType: "bb_workflow",
        });
        const backfillRows = listWorkflowTimelineRows(
          await getThreadTimeline(harness.api, thread.id, {
            includeNestedRows: true,
          }),
        );
        expect(backfillRows).toHaveLength(1);
        expect(backfillRows[0]).toMatchObject({
          itemId: run.id,
          taskStatus: "paused",
          taskType: "bb_workflow",
        });

        // "Hours later" semantics: the anchor thread is idle with no active
        // turn, and the resume never creates one — all anchor lifecycle rows
        // are thread-scoped server appends.
        expect((await getThread(harness.api, thread.id)).status).toBe("idle");
        const turnRequestsBeforeResume = countAnchorTurnRequests(
          harness,
          thread.id,
        );
        const resumeRequestedAt = Date.now();
        await resumePublicWorkflowRun(harness.api, run.id);

        // The paused → running flip appends immediately (reconciliation
        // cleared the run's throttle entry, and the run/started status change
        // bypasses it anyway); still no completed row mid-resume.
        await waitForPublicWorkflowRunStatus(
          harness.api,
          run.id,
          "running",
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );
        expect(listBackgroundTaskCompletedRows(harness, thread.id)).toEqual(
          [],
        );
        expect(
          listBackgroundTaskRowsForItem(harness, thread.id, run.id).at(-1)
            ?.taskStatus,
        ).toBe("running");
        const runningTimelineRows = listWorkflowTimelineRows(
          await getThreadTimeline(harness.api, thread.id, {
            includeNestedRows: true,
          }),
        );
        expect(runningTimelineRows).toHaveLength(1);
        expect(runningTimelineRows[0]).toMatchObject({
          itemId: run.id,
          taskStatus: "running",
          completedAt: null,
        });

        const settled = await waitForPublicWorkflowRunTerminal(
          harness.api,
          run.id,
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );
        expect(settled.status).toBe("completed");
        expect(settled.resultJson).toContain("alpha step");
        expect(settled.resultJson).toContain("beta step");

        // One anchor item end to end: the surviving paused row first, at
        // least one running row from the resume segment, and exactly one
        // completed row appended at the true terminal.
        const finalRows = listBackgroundTaskRowsForItem(
          harness,
          thread.id,
          run.id,
        );
        expect(
          finalRows.every((row) => row.taskType === "bb_workflow"),
        ).toBe(true);
        expect(finalRows[0]?.taskStatus).toBe("paused");
        expect(
          finalRows.some(
            (row) =>
              row.type === "item/backgroundTask/progress" &&
              row.taskStatus === "running",
          ),
        ).toBe(true);
        expect(
          finalRows.filter(
            (row) => row.type === "item/backgroundTask/completed",
          ),
        ).toHaveLength(1);
        expect(finalRows.at(-1)?.taskStatus).toBe("completed");

        // The projection still folds everything into ONE workflow row, with
        // the final completedAt from the terminal settle (after the resume),
        // never from the interruption, and the cached replay visible in the
        // snapshot the row carries.
        const finalTimelineRows = listWorkflowTimelineRows(
          await getThreadTimeline(harness.api, thread.id, {
            includeNestedRows: true,
          }),
        );
        expect(finalTimelineRows).toHaveLength(1);
        const finalRow = finalTimelineRows[0];
        expect(finalRow).toMatchObject({
          itemId: run.id,
          taskType: "bb_workflow",
          taskStatus: "completed",
        });
        if (finalRow?.completedAt == null) {
          throw new Error("Expected a completedAt on the settled workflow row");
        }
        expect(finalRow.completedAt).toBeGreaterThanOrEqual(resumeRequestedAt);
        expect(finalRow.workflow?.agents).toHaveLength(2);
        expect(
          finalRow.workflow?.agents.every((agent) => agent.state === "done"),
        ).toBe(true);
        expect(
          finalRow.workflow?.agents.filter((agent) => agent.cached),
        ).toHaveLength(1);

        // No turn was ever needed: the anchor thread saw zero new turn
        // requests across pause, prune, resume, and settlement.
        expect(countAnchorTurnRequests(harness, thread.id)).toBe(
          turnRequestsBeforeResume,
        );
      }),
  );
});
