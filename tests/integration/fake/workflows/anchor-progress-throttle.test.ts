// M5 exit criterion: a 30-agent fake-provider fan-out keeps the anchor
// thread's `item/backgroundTask/progress` appends throttled — the run events
// themselves all land in `workflow_run_events` (and fold into the snapshot
// column unthrottled), but anchor rows append at most once per 500ms window
// per run, so the count of progress rows is bounded by the run's wall-clock
// span. The whole fan-out still collapses to ONE workflow timeline row whose
// snapshot carries all 30 agents.

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
  listPublicWorkflowRunEvents,
  waitForPublicWorkflowRunTerminal,
} from "../../helpers/workflow-public-api.js";
import {
  listBackgroundTaskRowsForItem,
  WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
} from "../../helpers/workflow-runs.js";

const SETUP_TIMEOUT_MS = scaleTimeoutMs(15_000);
const FAN_OUT_AGENT_COUNT = 30;
// WORKFLOW_RUN_ANCHOR_PROGRESS_THROTTLE_MS, with a little tolerance: the
// throttle compares Date.now() at ingestion while the row's createdAt is
// assigned moments later inside the append transaction.
const THROTTLE_WINDOW_LOWER_BOUND_MS = 450;

/**
 * One phase fanning out `agentCount` parallel agents against the fake
 * provider. The per-agent delay spreads the run across several seconds of
 * spool flushes (the spool debounces only 100ms and flushes journal events
 * immediately), so ingestion batches far outnumber 500ms throttle windows —
 * an unthrottled regression would blow straight past the span-derived bound.
 */
function buildFanOutWorkflowSource(agentCount: number): string {
  return [
    'export const meta = { name: "fanout-throttle-flow", description: "M5 fan-out throttle fixture" };',
    "",
    'phase("fan-out");',
    "const results = await parallel(",
    `  Array.from({ length: ${agentCount} }, (_, index) => () =>`,
    '    agent("delay:500 fanout item " + (index + 1)),',
    "  ),",
    ");",
    "return { settled: results.length };",
    "",
  ].join("\n");
}

describe.sequential("workflow anchor progress throttle integration", () => {
  it(
    "bounds anchor progress appends for a 30-agent fan-out by the 500ms throttle (M5 exit criterion)",
    { timeout: scaleTimeoutMs(240_000) },
    () =>
      withHarness(async (harness) => {
        const project = await createProjectFixture(harness, {
          name: "Workflow Fanout Throttle",
        });
        const { thread } = await createReadyHostThread(harness, {
          projectId: project.id,
          timeoutMs: SETUP_TIMEOUT_MS,
          workspace: { type: "unmanaged", path: harness.repoDir },
        });

        const run = await launchPublicWorkflowRun(harness.api, {
          projectId: project.id,
          anchorThreadId: thread.id,
          source: {
            type: "inline",
            script: buildFanOutWorkflowSource(FAN_OUT_AGENT_COUNT),
          },
        });
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
        expect(JSON.parse(resultJson)).toEqual({
          settled: FAN_OUT_AGENT_COUNT,
        });

        // The durable journal is unthrottled: every agent's completion landed
        // as a run event regardless of how few anchor rows were appended.
        const runEventRows = await listPublicWorkflowRunEvents(
          harness.api,
          run.id,
        );
        expect(
          runEventRows.filter((row) => row.event.type === "agent/completed"),
        ).toHaveLength(FAN_OUT_AGENT_COUNT);

        // Anchor rows: exactly one completed row at the terminal, and the
        // progress appends bounded by the throttle. Each progress row after
        // the first non-bypass append is ≥500ms behind its predecessor —
        // only the very first append and the one run/started status-change
        // bypass are exempt — so the count can never exceed the observed
        // span divided by the window, plus those exemptions.
        const anchorRows = listBackgroundTaskRowsForItem(
          harness,
          thread.id,
          run.id,
        );
        expect(anchorRows.every((row) => row.taskType === "bb_workflow")).toBe(
          true,
        );
        expect(
          anchorRows.filter(
            (row) => row.type === "item/backgroundTask/completed",
          ),
        ).toHaveLength(1);
        expect(anchorRows.at(-1)?.type).toBe(
          "item/backgroundTask/completed",
        );
        const progressRows = anchorRows.filter(
          (row) => row.type === "item/backgroundTask/progress",
        );
        expect(progressRows.length).toBeGreaterThanOrEqual(1);
        const firstAppendAt = progressRows[0]?.createdAt ?? 0;
        const lastAppendAt = progressRows.at(-1)?.createdAt ?? 0;
        const spanMs = lastAppendAt - firstAppendAt;
        const maxThrottledAppends =
          Math.floor(spanMs / THROTTLE_WINDOW_LOWER_BOUND_MS) + 2;
        expect(progressRows.length).toBeLessThanOrEqual(maxThrottledAppends);

        // The whole fan-out is still ONE workflow row, with every agent in
        // the snapshot it carries — dropped intermediate rows lost nothing.
        const timelineRows = listWorkflowTimelineRows(
          await getThreadTimeline(harness.api, thread.id, {
            includeNestedRows: true,
          }),
        );
        expect(timelineRows).toHaveLength(1);
        const workflowRow = timelineRows[0];
        expect(workflowRow).toMatchObject({
          itemId: run.id,
          taskType: "bb_workflow",
          taskStatus: "completed",
        });
        expect(workflowRow?.workflow?.agents).toHaveLength(
          FAN_OUT_AGENT_COUNT,
        );
        expect(
          workflowRow?.workflow?.agents.every(
            (agent) => agent.state === "done",
          ),
        ).toBe(true);
      }),
  );
});
