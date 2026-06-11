// M4 exit criterion: the full no-UI loop over the public HTTP surface alone —
// author a `.workflow.js` into the repo's `.bb/workflows/`, the registry
// listing shows it at tier `project`, a named `POST /workflow-runs` launch
// resolves the project's default source (host + cwd recorded on the run row)
// and runs to completion through the real daemon + runner child + fake
// provider, `run --wait` semantics ride the `/wait` long-poll, the events
// cursor is gapless, the per-agent drill-in log decodes, and a detached run
// re-attaches via a later `/wait`.

import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectFixture } from "../../helpers/fixtures.js";
import { withHarness } from "../../helpers/harness.js";
import { createTestFile } from "../../helpers/seed.js";
import { scaleTimeoutMs } from "../../helpers/time.js";
import {
  expectApiError,
  getPublicWorkflowAgentEvents,
  launchPublicWorkflowRun,
  listPublicWorkflowRunEvents,
  listPublicWorkflowRuns,
  listPublicWorkflows,
  waitForPublicWorkflowRunStatus,
  waitForPublicWorkflowRunTerminal,
  waitPublicWorkflowRunRound,
} from "../../helpers/workflow-public-api.js";
import {
  buildSequentialAgentWorkflowSource,
  WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
} from "../../helpers/workflow-runs.js";

// The registry resolves by meta.name, never the filename — keep them distinct
// so the loop proves it.
const AUTHORED_WORKFLOW_NAME = "repo-loop-flow";
const AUTHORED_WORKFLOW_FILENAME = "repo-loop.workflow.js";

describe.sequential("workflow public-surface full loop", () => {
  it(
    "authors, lists, launches by name, waits, paginates events, drills into agents, and re-attaches (M4 full loop)",
    { timeout: scaleTimeoutMs(180_000) },
    () =>
      withHarness(async (harness) => {
        const project = await createProjectFixture(harness, {
          name: "Workflow Public Loop",
        });

        // Author the workflow into the project checkout, post-boot: the
        // daemon registry rescans per RPC, no restart involved.
        const source = buildSequentialAgentWorkflowSource({
          name: AUTHORED_WORKFLOW_NAME,
          prompts: ["collect alpha", "summarize beta"],
        });
        await createTestFile({
          filePath: path.join(
            harness.repoDir,
            ".bb",
            "workflows",
            AUTHORED_WORKFLOW_FILENAME,
          ),
          content: source,
        });

        // The listing resolves the project's default source and merges tiers:
        // the authored file wins at tier `project`, builtins still surface.
        const listings = await listPublicWorkflows(harness.api, {
          projectId: project.id,
        });
        expect(
          listings.find((listing) => listing.name === AUTHORED_WORKFLOW_NAME),
        ).toEqual({
          name: AUTHORED_WORKFLOW_NAME,
          description: "M3 integration fixture workflow",
          tier: "project",
        });
        expect(listings.some((listing) => listing.tier === "builtin")).toBe(
          true,
        );
        // Explicit-host resolution sees the same checkout.
        expect(
          await listPublicWorkflows(harness.api, {
            projectId: project.id,
            hostId: harness.hostId,
          }),
        ).toEqual(listings);

        // Named launch with the host left implicit: the default source picks
        // the target, and the run row records both halves of it.
        const run = await launchPublicWorkflowRun(harness.api, {
          projectId: project.id,
          source: { type: "named", name: AUTHORED_WORKFLOW_NAME },
        });
        expect(run.hostId).toBe(harness.hostId);
        expect(run.workspacePath).toBe(harness.repoDir);
        expect(run.sourceTier).toBe("project");
        expect(run.workflowName).toBe(AUTHORED_WORKFLOW_NAME);
        expect(run.anchorThreadId).toBeNull();
        // The snapshot hash is computed server-side over the resolved source.
        expect(run.scriptHash).toBe(
          createHash("sha256").update(source, "utf8").digest("hex"),
        );

        // `run --wait`: loop /wait rounds until the terminal run comes back
        // with the workflow's result (the fake provider echoes each prompt).
        const settled = await waitForPublicWorkflowRunTerminal(
          harness.api,
          run.id,
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );
        expect(settled.status).toBe("completed");
        expect(settled.failureReason).toBeNull();
        const { resultJson } = settled;
        if (resultJson === null) {
          throw new Error("Expected a run result");
        }
        expect(resultJson).toContain("collect alpha");
        expect(resultJson).toContain("summarize beta");

        // The public event stream is the durable journal verbatim: gapless
        // sequences from 1, one run/started, terminal last, one
        // agent/completed per agent.
        const rows = await listPublicWorkflowRunEvents(harness.api, run.id);
        expect(rows.length).toBeGreaterThanOrEqual(4);
        rows.forEach((row, index) => {
          expect(row.sequence).toBe(index + 1);
        });
        expect(
          rows.filter((row) => row.event.type === "run/started"),
        ).toHaveLength(1);
        expect(
          rows.filter((row) => row.event.type === "agent/completed"),
        ).toHaveLength(2);
        expect(rows.at(-1)?.event.type).toBe("run/completed");

        // afterSeq is a strictly-greater cursor: any split point stitches
        // back into the identical full stream — no gaps, no duplicates.
        const total = rows.length;
        for (const cursor of [0, 1, Math.floor(total / 2), total - 1, total]) {
          const tail = await listPublicWorkflowRunEvents(
            harness.api,
            run.id,
            cursor,
          );
          expect(tail).toEqual(rows.filter((row) => row.sequence > cursor));
        }

        // Per-agent drill-in: each agent's proxied provider-event log decodes
        // as thread event rows carrying the run-scoped wfa_ identity. The
        // agent display indexes come from the run events themselves (they are
        // 1-based) — exactly how a timeline consumer would address the logs.
        const agentIndexes = rows
          .filter((row) => row.event.type === "agent/completed")
          .map((row) => row.agentIndex)
          .filter((value): value is number => value !== null);
        expect(new Set(agentIndexes).size).toBe(2);
        for (const agentIndex of agentIndexes) {
          const agentEvents = await getPublicWorkflowAgentEvents(
            harness.api,
            run.id,
            agentIndex,
          );
          expect(agentEvents.length).toBeGreaterThan(0);
          expect(
            agentEvents.every((row) =>
              row.threadId.startsWith(`wfa_${run.id}_${agentIndex}`),
            ),
          ).toBe(true);
        }
        // A log that never existed on the host is a 404, not a 500.
        const missingLog = await harness.api["workflow-runs"][":id"].agents[
          ":index"
        ].events.$get({ param: { id: run.id, index: "99" } });
        await expectApiError(missingLog, 404);

        // Detached launch + later wait: nobody polls /wait while it runs;
        // once it has settled, a 1ms wait round re-attaches with the result.
        const detached = await launchPublicWorkflowRun(harness.api, {
          projectId: project.id,
          source: { type: "named", name: AUTHORED_WORKFLOW_NAME },
        });
        await waitForPublicWorkflowRunStatus(
          harness.api,
          detached.id,
          "completed",
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );
        const reattached = await waitPublicWorkflowRunRound(
          harness.api,
          detached.id,
          1,
        );
        if (reattached === null) {
          throw new Error("Expected /wait on a settled run to return it");
        }
        expect(reattached.status).toBe("completed");
        expect(reattached.resultJson).toContain("collect alpha");

        // The project run list serves both runs, newest first.
        const runsList = await listPublicWorkflowRuns(harness.api, {
          projectId: project.id,
        });
        expect(runsList.map((row) => row.id)).toEqual([detached.id, run.id]);
        expect(
          (
            await listPublicWorkflowRuns(harness.api, {
              projectId: project.id,
              limit: 1,
            })
          ).map((row) => row.id),
        ).toEqual([detached.id]);
      }),
  );
});
