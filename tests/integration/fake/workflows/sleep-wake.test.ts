// M3 exit criterion (b), both halves:
//
// 1. Sleep/wake: the daemon's WS drops without killing the run process,
//    time advances past the 5s disconnect grace (real wait — workflows take
//    no action) and the 30s session lease (backdated + periodic-sweep
//    backstop, which interrupts), then the SAME daemon instance reconnects
//    reporting the run in activeWorkflowRunIds while flushing its spooled
//    events: the run returns to `running` (bucket (c) revival), is never
//    cancelled, the offline-spooled events ingest exactly once, and the final
//    result lands without a resume.
// 2. Counter-case: a DIFFERENT daemon instance reconnects with no live runner
//    and no fresh heartbeat → the run is interrupted with reason
//    `host-daemon-restarted` and the anchor item shows `paused` (never a
//    completed row), leaving the resume affordance open.

import { setTimeout as sleep } from "node:timers/promises";
import { getWorkflowRunOperation } from "@bb/db";
import { describe, expect, it } from "vitest";
import {
  waitForHostConnected,
  waitForHostDisconnected,
} from "../../helpers/assertions.js";
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
  DAEMON_DISCONNECT_GRACE_MS,
  expireHostSessionLeases,
  listAgentCompletedRunEvents,
  listBackgroundTaskRowsForItem,
  requestWorkflowRunStart,
  requireWorkflowRun,
  runPeriodicSweeps,
  waitForWorkflowRunEventCount,
  waitForWorkflowRunStatus,
  WORKFLOW_RUN_DAEMON_RESTARTED_REASON,
  WORKFLOW_RUN_HOST_SESSION_EXPIRED_REASON,
  WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
  workflowServerDeps,
} from "../../helpers/workflow-runs.js";

const RECOVERY_TIMEOUT_MS = scaleTimeoutMs(30_000);

// The second agent settles inside the offline window (its completion can only
// ride the durable spool); the third outlasts the window so the daemon still
// reports the run alive at reconnect.
const OFFLINE_AGENT_DELAY_MS = 6_000;
const LATE_AGENT_DELAY_MS = 20_000;

describe.sequential("workflow run sleep/wake integration", () => {
  it(
    "revives a live run across a same-instance reconnect after grace and lease expiry (exit criterion b)",
    { timeout: scaleTimeoutMs(180_000) },
    () =>
      withHarness(async (harness) => {
        const project = await createProjectFixture(harness, {
          name: "Workflow Sleep Wake",
        });
        const { thread } = await createReadyHostThread(harness, {
          projectId: project.id,
          workspace: { type: "unmanaged", path: harness.repoDir },
        });
        const run = createIntegrationWorkflowRun(harness, {
          projectId: project.id,
          anchorThreadId: thread.id,
          source: buildSequentialAgentWorkflowSource({
            name: "sleep-wake",
            prompts: [
              "alpha step",
              `delay:${OFFLINE_AGENT_DELAY_MS} offline step`,
              `delay:${LATE_AGENT_DELAY_MS} late step`,
            ],
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

        // Drop the daemon's WS without killing the daemon process: the runner
        // child, its provider sessions, and the durable spool all stay alive,
        // and the eventual reconnect reuses the same instanceId.
        const disconnectedAt = Date.now();
        await harness.daemonApp.connection.shutdown();
        await waitForHostDisconnected(
          harness.api,
          harness.hostId,
          RECOVERY_TIMEOUT_MS,
        );

        // Past the 5s disconnect grace (real time): workflows take no action,
        // and the dangling background-task settle must skip the bb_workflow
        // anchor item (the carve-out) — the run stays running with no
        // completed anchor row.
        await sleep(DAEMON_DISCONNECT_GRACE_MS + 1_500);
        expect(requireWorkflowRun(harness, run.id).status).toBe("running");
        expect(
          listBackgroundTaskRowsForItem(harness, thread.id, run.id).filter(
            (row) => row.type === "item/backgroundTask/completed",
          ),
        ).toHaveLength(0);

        // Past the 30s lease: with no replacement session the periodic
        // backstop sweep interrupts the run (criterion (b) tolerates this
        // flip before the same-instance reconnect revives it).
        expireHostSessionLeases(harness.db, harness.hostId);
        await runPeriodicSweeps(workflowServerDeps(harness));
        const interrupted = requireWorkflowRun(harness, run.id);
        expect(interrupted.status).toBe("interrupted");
        expect(interrupted.failureReason).toBe(
          WORKFLOW_RUN_HOST_SESSION_EXPIRED_REASON,
        );
        const anchorAfterInterrupt = listBackgroundTaskRowsForItem(
          harness,
          thread.id,
          run.id,
        );
        expect(anchorAfterInterrupt.at(-1)?.taskStatus).toBe("paused");
        expect(
          anchorAfterInterrupt.filter(
            (row) => row.type === "item/backgroundTask/completed",
          ),
        ).toHaveLength(0);

        // Let the offline agent settle daemon-side: its completion can only
        // be sitting in the durable spool — the server has not seen it.
        const elapsedOffline = Date.now() - disconnectedAt;
        const offlineAgentDeadline = OFFLINE_AGENT_DELAY_MS + 2_000;
        if (elapsedOffline < offlineAgentDeadline) {
          await sleep(offlineAgentDeadline - elapsedOffline);
        }
        expect(
          countWorkflowRunEventsOfType(harness, run.id, "agent/completed"),
        ).toBe(1);

        // Reconnect with the SAME instanceId: the heartbeat-verified report
        // revives the run (bucket (c)) and the spool flush delivers the
        // offline events exactly once.
        await harness.daemonApp.connection.start();
        await waitForHostConnected(harness.api, RECOVERY_TIMEOUT_MS);
        const revived = await waitForWorkflowRunStatus(
          harness,
          run.id,
          "running",
          RECOVERY_TIMEOUT_MS,
        );
        expect(revived.failureReason).toBeNull();
        await waitForWorkflowRunEventCount(
          harness,
          run.id,
          "agent/completed",
          2,
          RECOVERY_TIMEOUT_MS,
        );

        // The flushed batch's ingest also flipped the anchor item back to
        // running (revival cleared the run's progress throttle). Asserted
        // mid-cycle: superseded anchor progress rows are pruned once later
        // anchor turns settle, so only the completed row survives to the end.
        const pausedSequence = anchorAfterInterrupt.at(-1)?.sequence ?? 0;
        expect(
          listBackgroundTaskRowsForItem(harness, thread.id, run.id).some(
            (row) =>
              row.type === "item/backgroundTask/progress" &&
              row.taskStatus === "running" &&
              row.sequence > pausedSequence,
          ),
        ).toBe(true);

        // The final result lands without a resume.
        const settled = await waitForWorkflowRunStatus(
          harness,
          run.id,
          "completed",
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );
        expect(settled.resultJson).toContain("late step");
        expect(
          getWorkflowRunOperation(harness.db, {
            runId: run.id,
            kind: "resume",
          }),
        ).toBeNull();
        expect(
          getWorkflowRunOperation(harness.db, { runId: run.id, kind: "cancel" }),
        ).toBeNull();

        // Exactly-once ingestion across the disconnect: one run segment, one
        // terminal event, one completion per agent.
        expect(
          countWorkflowRunEventsOfType(harness, run.id, "run/started"),
        ).toBe(1);
        expect(
          countWorkflowRunEventsOfType(harness, run.id, "run/completed"),
        ).toBe(1);
        const completedAgents = listAgentCompletedRunEvents(harness, run.id);
        expect(completedAgents).toHaveLength(3);
        expect(
          new Set(completedAgents.map((event) => event.agentIndex)).size,
        ).toBe(3);
        expect(completedAgents.every((event) => !event.cached)).toBe(true);

        // Anchor lifecycle end state: exactly one completed row at the true
        // terminal, as the item's last row (paused at interruption and
        // running after revival were asserted live above, before pruning
        // could collapse them).
        const anchorRows = listBackgroundTaskRowsForItem(
          harness,
          thread.id,
          run.id,
        );
        const completedRows = anchorRows.filter(
          (row) => row.type === "item/backgroundTask/completed",
        );
        expect(completedRows).toHaveLength(1);
        expect(anchorRows.at(-1)?.taskStatus).toBe("completed");
      }),
  );

  it(
    "interrupts an unreported run on a restarted-daemon reconnect with a paused anchor item (exit criterion b counter-case)",
    { timeout: scaleTimeoutMs(120_000) },
    () =>
      withHarness(async (harness) => {
        const project = await createProjectFixture(harness, {
          name: "Workflow Restart Interrupt",
        });
        const { thread } = await createReadyHostThread(harness, {
          projectId: project.id,
          workspace: { type: "unmanaged", path: harness.repoDir },
        });
        const run = createIntegrationWorkflowRun(harness, {
          projectId: project.id,
          anchorThreadId: thread.id,
          source: buildSequentialAgentWorkflowSource({
            name: "restart-interrupt",
            prompts: ["alpha step", "delay:30000 beta step"],
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

        // Crash the daemon (runner killed, no terminal event escapes, pid and
        // heartbeat records cleared): the disconnect alone interrupts nothing.
        await harness.crashDaemon();
        await waitForHostDisconnected(
          harness.api,
          harness.hostId,
          RECOVERY_TIMEOUT_MS,
        );
        expect(requireWorkflowRun(harness, run.id).status).toBe("running");

        // A NEW daemon instance reconnects reporting no active runs (no live
        // handle, no fresh heartbeat) → bucket (b): interrupt, paused anchor.
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

        const anchorRows = listBackgroundTaskRowsForItem(
          harness,
          thread.id,
          run.id,
        );
        expect(
          anchorRows.filter(
            (row) => row.type === "item/backgroundTask/completed",
          ),
        ).toHaveLength(0);
        const latest = anchorRows.at(-1);
        expect(latest?.type).toBe("item/backgroundTask/progress");
        expect(latest?.taskStatus).toBe("paused");

        // Cancel is reserved for daemon-reported TERMINAL runs (bucket (d)):
        // interruption must never request one, and nothing resumed implicitly.
        expect(
          getWorkflowRunOperation(harness.db, { runId: run.id, kind: "cancel" }),
        ).toBeNull();
        expect(
          getWorkflowRunOperation(harness.db, {
            runId: run.id,
            kind: "resume",
          }),
        ).toBeNull();

        // The resume affordance stays open: interrupted + live retention is
        // exactly the state the resume request gate accepts (criterion (c)
        // exercises the real resume).
        expect(interrupted.retention).toBe("live");
      }),
  );
});
