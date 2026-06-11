// M7 exit criterion (retention, end to end): archived runs lose per-agent
// event logs and resumability but keep results — and archiving an abandoned
// interrupted run settles its anchor item as "stopped" via the lifecycle
// module. The clock-advanced unit suite (apps/server/test/workflows/
// workflow-run-retention.test.ts) already pins the server-side archive
// transaction and the prune sweep's marker convergence against a stubbed
// host; this scenario extends it with the half a unit test cannot reach:
// runs executed by the REAL daemon, the run-dir prune travelling the real
// `workflow.prune` online RPC, the run dir actually disappearing from disk,
// and the public per-agent events route flipping to 404 afterwards.

import { describe, expect, it } from "vitest";
import { waitForHostDisconnected } from "../helpers/assertions.js";
import {
  createProjectFixture,
  createReadyHostThread,
} from "../helpers/fixtures.js";
import { withHarness } from "../helpers/harness.js";
import { scaleTimeoutMs } from "../helpers/time.js";
import {
  expectApiError,
  getPublicWorkflowAgentEvents,
  getPublicWorkflowRun,
  launchPublicWorkflowRun,
  listPublicWorkflowRunEvents,
  waitForPublicWorkflowRunTerminal,
} from "../helpers/workflow-public-api.js";
import {
  buildSequentialAgentWorkflowSource,
  INTEGRATION_WORKFLOW_SOURCE,
  listBackgroundTaskRowsForItem,
  requireWorkflowRun,
  waitForWorkflowRunEventCount,
  waitForWorkflowRunStatus,
  WORKFLOW_RUN_DAEMON_RESTARTED_REASON,
  WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
  workflowServerDeps,
} from "../helpers/workflow-runs.js";
import {
  backdateWorkflowRun,
  pathExists,
  runWorkflowRunDirPruneSweep,
  runWorkflowRunRetentionSweep,
  WORKFLOW_RUN_ARCHIVE_AFTER_MS,
  workflowRunDirPathFor,
} from "./helpers.js";

const SETUP_TIMEOUT_MS = scaleTimeoutMs(15_000);
const RECOVERY_TIMEOUT_MS = scaleTimeoutMs(30_000);
/** Well past the 30d window so both archive keys (settledAt/updatedAt) trip. */
const BACKDATE_MARGIN_MS = 60 * 60 * 1000;

describe.sequential("workflow archive retention soak", () => {
  it(
    "archives terminal and abandoned runs, settles the abandoned anchor as stopped, and prunes run dirs over the real daemon RPC (M7 exit criterion)",
    { timeout: scaleTimeoutMs(180_000) },
    () =>
      withHarness(async (harness) => {
        const project = await createProjectFixture(harness, {
          name: "Workflow Archive Soak",
        });
        const { thread } = await createReadyHostThread(harness, {
          projectId: project.id,
          timeoutMs: SETUP_TIMEOUT_MS,
          workspace: { type: "unmanaged", path: harness.repoDir },
        });
        const deps = workflowServerDeps(harness);

        // A terminal run, executed for real (its anchor completed row lands
        // at finalize).
        const terminalRun = await launchPublicWorkflowRun(harness.api, {
          projectId: project.id,
          anchorThreadId: thread.id,
          source: { type: "inline", script: INTEGRATION_WORKFLOW_SOURCE },
        });
        const settledTerminal = await waitForPublicWorkflowRunTerminal(
          harness.api,
          terminalRun.id,
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );
        expect(settledTerminal.status).toBe("completed");
        expect(settledTerminal.resultJson).toContain("Response to:");

        // An interrupted run abandoned mid-flight: daemon kill-9 + fresh
        // instance → reconciliation interrupts it, paused anchor, resumable.
        const abandonedRun = await launchPublicWorkflowRun(harness.api, {
          projectId: project.id,
          anchorThreadId: thread.id,
          source: {
            type: "inline",
            script: buildSequentialAgentWorkflowSource({
              name: "soak-abandoned",
              prompts: ["first step", "delay:30000 stuck step"],
            }),
          },
        });
        await waitForWorkflowRunStatus(
          harness,
          abandonedRun.id,
          "running",
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );
        await waitForWorkflowRunEventCount(
          harness,
          abandonedRun.id,
          "agent/completed",
          1,
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );
        await harness.crashDaemon();
        await waitForHostDisconnected(
          harness.api,
          harness.hostId,
          RECOVERY_TIMEOUT_MS,
        );
        await harness.startDaemon();
        const interrupted = await waitForWorkflowRunStatus(
          harness,
          abandonedRun.id,
          "interrupted",
          RECOVERY_TIMEOUT_MS,
        );
        expect(interrupted.failureReason).toBe(
          WORKFLOW_RUN_DAEMON_RESTARTED_REASON,
        );

        // Pre-archive observability the archive must destroy: the per-agent
        // daemon log is readable, and journal payloads carry full results.
        const preArchiveAgentEvents = await getPublicWorkflowAgentEvents(
          harness.api,
          terminalRun.id,
          1,
        );
        expect(preArchiveAgentEvents.length).toBeGreaterThan(0);
        const preArchiveJournal = await listPublicWorkflowRunEvents(
          harness.api,
          terminalRun.id,
        );
        const preArchiveCompletions = preArchiveJournal.filter(
          (row) => row.event.type === "agent/completed",
        );
        expect(preArchiveCompletions.length).toBeGreaterThan(0);
        for (const row of preArchiveCompletions) {
          if (row.event.type !== "agent/completed") {
            throw new Error("filtered row changed type");
          }
          expect(row.event.entry.resultText).toContain("Response to:");
        }

        // Age both runs past the window: terminal keys on settledAt,
        // abandoned interrupted keys on updatedAt.
        const agedTimestamp =
          Date.now() - WORKFLOW_RUN_ARCHIVE_AFTER_MS - BACKDATE_MARGIN_MS;
        backdateWorkflowRun(harness, {
          runId: terminalRun.id,
          settledAt: agedTimestamp,
          updatedAt: agedTimestamp,
        });
        backdateWorkflowRun(harness, {
          runId: abandonedRun.id,
          updatedAt: agedTimestamp,
        });

        runWorkflowRunRetentionSweep(deps);

        // Archived, results kept: the run row keeps status/result/usage
        // forever; journal payloads are pruned in place (rows stay
        // schema-valid for display, resultText emptied, structured removed).
        const archivedTerminal = requireWorkflowRun(harness, terminalRun.id);
        expect(archivedTerminal.retention).toBe("archived");
        expect(archivedTerminal.status).toBe("completed");
        const archivedTerminalPublic = await getPublicWorkflowRun(
          harness.api,
          terminalRun.id,
        );
        expect(archivedTerminalPublic.resultJson).toContain("Response to:");
        const postArchiveJournal = await listPublicWorkflowRunEvents(
          harness.api,
          terminalRun.id,
        );
        expect(postArchiveJournal.length).toBe(preArchiveJournal.length);
        for (const row of postArchiveJournal) {
          if (row.event.type !== "agent/completed") {
            continue;
          }
          expect(row.event.entry.resultText).toBe("");
          expect(row.event.entry.structured).toBeUndefined();
        }

        // The abandoned run's anchor item settles as "stopped" through the
        // archive — the lifecycle module's one sanctioned settle for a run
        // that will never resume — and resumability is gone (409).
        const archivedAbandoned = requireWorkflowRun(harness, abandonedRun.id);
        expect(archivedAbandoned.retention).toBe("archived");
        expect(archivedAbandoned.status).toBe("interrupted");
        const anchorRows = listBackgroundTaskRowsForItem(
          harness,
          thread.id,
          abandonedRun.id,
        );
        const completedAnchorRows = anchorRows.filter(
          (row) => row.type === "item/backgroundTask/completed",
        );
        expect(completedAnchorRows).toHaveLength(1);
        expect(anchorRows.at(-1)).toMatchObject({
          type: "item/backgroundTask/completed",
          taskStatus: "stopped",
          taskType: "bb_workflow",
        });
        const resumeResponse = await harness.api["workflow-runs"][
          ":id"
        ].resume.$post({ param: { id: abandonedRun.id } });
        const resumeError = await expectApiError(resumeResponse, 409);
        expect(resumeError.code).toBe("workflow_run_archived");

        // The daemon half: run dirs exist until the prune sweep sends the
        // real `workflow.prune` RPC, then disappear from disk and converge
        // on the durable runDirPrunedAt marker.
        const terminalRunDir = workflowRunDirPathFor(harness, terminalRun.id);
        const abandonedRunDir = workflowRunDirPathFor(
          harness,
          abandonedRun.id,
        );
        expect(await pathExists(terminalRunDir)).toBe(true);
        expect(await pathExists(abandonedRunDir)).toBe(true);
        expect(archivedTerminal.runDirPrunedAt).toBeNull();
        expect(archivedAbandoned.runDirPrunedAt).toBeNull();

        await runWorkflowRunDirPruneSweep(deps);

        expect(await pathExists(terminalRunDir)).toBe(false);
        expect(await pathExists(abandonedRunDir)).toBe(false);
        expect(
          requireWorkflowRun(harness, terminalRun.id).runDirPrunedAt,
        ).not.toBeNull();
        expect(
          requireWorkflowRun(harness, abandonedRun.id).runDirPrunedAt,
        ).not.toBeNull();

        // Per-agent event logs are gone: the daemon-proxied route 404s (the
        // M5-recorded post-prune UX), while the pruned journal still serves.
        const prunedAgentEventsResponse = await harness.api["workflow-runs"][
          ":id"
        ].agents[":index"].events.$get({
          param: { id: terminalRun.id, index: "1" },
        });
        await expectApiError(prunedAgentEventsResponse, 404);

        // Repeat passes are harmless: the marker keeps converged runs out of
        // the work list (idempotent by construction).
        await runWorkflowRunDirPruneSweep(deps);
        expect(await pathExists(terminalRunDir)).toBe(false);
      }),
  );
});
