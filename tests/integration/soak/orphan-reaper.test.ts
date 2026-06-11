// M7 exit criterion (orphan-reaper soak): repeated daemon kill-9/restart
// cycles across concurrent mid-flight runs converge every run to a
// terminal-or-interrupted state with zero stranded processes or run-dir
// records. Each cycle uses the harness crash lever (spool disposed first so
// a crashed daemon emits nothing new — the kill -9 shape), then a fresh
// daemon instance whose session-open reconciliation interrupts the
// unreported runs; an explicit resume replays the cached journal prefix and
// the runs finish for real. Convergence is asserted at every step AND at the
// end: recorded runner pids are dead, pid/heartbeat records cleared, the
// manager reports no live processes or active runs, real work ran exactly
// once (fresh vs cached completion counts), and no workflow command is left
// queued.
//
// Coverage honesty (M7 review finding, recorded): the crash lever SIGKILLs
// the runner children itself (emulating the daemon dying with its process
// group), so the crash cycles alone exercise crash-cycle CONVERGENCE — spool
// survival, bucket-(b) interruption, cached resume, exactly-once work — not
// the reaper. The reaper is exercised by the fabricated-orphan phase below:
// a genuinely live, handle-less runner process recorded in a run dir with no
// heartbeat (deterministically stale) that the next daemon instance must
// SIGKILL and clear at boot via reapStaleRunners — the harness never kills
// it. The runner-side parent-death stdin watchdog (self-termination when the
// daemon dies without SIGKILLing children) remains covered at the unit tier
// only (workflow-run-manager.test.ts / the runner entry tests); an in-process
// harness cannot die without taking its children's pipes down the same way.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { waitForHostDisconnected } from "../helpers/assertions.js";
import { createProjectFixture } from "../helpers/fixtures.js";
import { listWorkflowRunOperations } from "@bb/db";
import { activeLifecycleOperationStates } from "@bb/domain";
import { withHarness } from "../helpers/harness.js";
import { scaleTimeoutMs } from "../helpers/time.js";
import { resumePublicWorkflowRun } from "../helpers/workflow-public-api.js";
import {
  buildSequentialAgentWorkflowSource,
  countWorkflowRunEventsOfType,
  createIntegrationWorkflowRun,
  listAgentCompletedRunEvents,
  requestWorkflowRunStart,
  requireWorkflowRun,
  requireWorkflowRunOperation,
  waitForWorkflowRunEventCount,
  waitForWorkflowRunStatus,
  WORKFLOW_RUN_DAEMON_RESTARTED_REASON,
  WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
  workflowServerDeps,
} from "../helpers/workflow-runs.js";
import {
  hasRunnerHeartbeat,
  isProcessAlive,
  readRecordedRunnerPid,
  waitUntil,
  workflowRunDirPathFor,
} from "./helpers.js";

const RUN_COUNT = 3;
const CRASH_CYCLES = 2;
/** The long step must outlast a full crash/restart/observe cycle. */
const LONG_STEP_DELAY_MS = 20_000;
const RECOVERY_TIMEOUT_MS = scaleTimeoutMs(30_000);
/** Run dir name for the fabricated handle-less orphan runner (no DB row —
 *  the boot reap is run-dir-driven and silent, so none is needed). */
const ORPHAN_RUN_ID = "wfr_soak_orphan";
/** Bounded leak window: the fabricated orphan self-exits even if the test
 *  fails before the boot reap kills it. */
const ORPHAN_RUNNER_SELF_EXIT_MS = 120_000;

describe.sequential("workflow orphan-reaper crash-cycle soak", () => {
  it(
    "converges concurrent runs across repeated daemon kill-9 cycles and boot-reaps a genuinely live orphaned runner (M7 exit criterion)",
    { timeout: scaleTimeoutMs(300_000) },
    () =>
      withHarness(async (harness) => {
        const project = await createProjectFixture(harness, {
          name: "Workflow Orphan Reaper Soak",
        });
        const deps = workflowServerDeps(harness);

        const runs = Array.from({ length: RUN_COUNT }, (_, index) =>
          createIntegrationWorkflowRun(harness, {
            projectId: project.id,
            source: buildSequentialAgentWorkflowSource({
              name: `soak-crash-cycle-${index + 1}`,
              prompts: ["seed step", `delay:${LONG_STEP_DELAY_MS} long step`],
            }),
          }),
        );
        for (const run of runs) {
          await requestWorkflowRunStart(deps, { runId: run.id });
        }

        let orphanRunner: ChildProcess | null = null;
        const recordedRunnerPids = new Set<number>();
        const captureRunnerPids = async (): Promise<void> => {
          for (const run of runs) {
            const pid = await readRecordedRunnerPid(harness, run.id);
            if (pid !== null) {
              recordedRunnerPids.add(pid);
            }
          }
        };

        for (let cycle = 1; cycle <= CRASH_CYCLES; cycle += 1) {
          // Every run mid-flight: running, seed step settled (segment 1) or
          // cached-replayed (later segments), long step in flight.
          for (const run of runs) {
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
              cycle,
              WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
            );
          }
          await captureRunnerPids();

          // kill -9: spool disposed first (nothing new escapes), runner
          // children killed, pid/heartbeat records cleared, lock released.
          await harness.crashDaemon();
          await waitForHostDisconnected(
            harness.api,
            harness.hostId,
            RECOVERY_TIMEOUT_MS,
          );

          // Last cycle: while the daemon is down, fabricate a genuinely live
          // orphaned runner for the boot reap (see the header note). The pid
          // record points at a real process the harness never kills; no
          // heartbeat file means deterministically stale.
          if (cycle === CRASH_CYCLES) {
            orphanRunner = spawn(
              process.execPath,
              ["-e", `setTimeout(() => {}, ${ORPHAN_RUNNER_SELF_EXIT_MS})`],
              { stdio: "ignore" },
            );
            if (orphanRunner.pid === undefined) {
              throw new Error("Failed to spawn the fabricated orphan runner");
            }
            const orphanRunDir = workflowRunDirPathFor(
              harness,
              ORPHAN_RUN_ID,
            );
            await mkdir(orphanRunDir, { recursive: true });
            await writeFile(
              path.join(orphanRunDir, "runner.pid"),
              JSON.stringify({ pid: orphanRunner.pid }),
            );
          }

          // A fresh instance reconciles: every unreported run interrupts
          // (bucket (b)), resumable, with nothing falsely reported active.
          await harness.startDaemon();
          for (const run of runs) {
            const interrupted = await waitForWorkflowRunStatus(
              harness,
              run.id,
              "interrupted",
              RECOVERY_TIMEOUT_MS,
            );
            expect(interrupted.failureReason).toBe(
              WORKFLOW_RUN_DAEMON_RESTARTED_REASON,
            );
            expect(interrupted.retention).toBe("live");
          }
          expect(
            harness.daemonApp.workflowRunManager.countLiveProviderProcesses(),
          ).toBe(0);
          expect(
            await harness.daemonApp.workflowRunManager.listActiveWorkflowRunIds(),
          ).toEqual([]);

          // Real reaper coverage: the boot reap of the fresh instance must
          // SIGKILL the fabricated live orphan and clear its pid record —
          // the DAEMON kills this process, never the harness or the crash
          // lever (SIGKILL → exit → reap is async, so converge bounded).
          if (cycle === CRASH_CYCLES) {
            const orphanPid = orphanRunner?.pid;
            if (orphanPid === undefined) {
              throw new Error("Fabricated orphan runner was never spawned");
            }
            await waitUntil(
              async () =>
                (await readRecordedRunnerPid(harness, ORPHAN_RUN_ID)) ===
                  null && !isProcessAlive(orphanPid),
              () =>
                "Boot reap never killed the fabricated orphan runner or cleared its pid record",
              RECOVERY_TIMEOUT_MS,
            );
            expect(await hasRunnerHeartbeat(harness, ORPHAN_RUN_ID)).toBe(
              false,
            );
          }

          // Explicit resume: the journal prefix replays cached, the long
          // step re-runs for real.
          for (const run of runs) {
            await resumePublicWorkflowRun(harness.api, run.id);
          }
        }

        // Final segment: capture its runner pids too, then let every run
        // finish for real.
        for (const run of runs) {
          await waitForWorkflowRunStatus(
            harness,
            run.id,
            "running",
            WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
          );
        }
        await captureRunnerPids();
        for (const run of runs) {
          const settled = await waitForWorkflowRunStatus(
            harness,
            run.id,
            "completed",
            WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
          );
          expect(settled.resultJson).toContain("long step");

          // Exactly-once real work despite the crashes: the seed step and
          // the long step each ran fresh exactly once; every other
          // completion row is a cached replay (one per resume).
          const completions = listAgentCompletedRunEvents(harness, run.id);
          expect(
            completions.filter((event) => !event.cached),
          ).toHaveLength(2);
          expect(
            completions.filter((event) => event.cached),
          ).toHaveLength(CRASH_CYCLES);
          // One run segment per crash cycle plus the first, one terminal.
          expect(
            countWorkflowRunEventsOfType(harness, run.id, "run/started"),
          ).toBe(CRASH_CYCLES + 1);
          expect(
            countWorkflowRunEventsOfType(harness, run.id, "run/completed"),
          ).toBe(1);
          expect(
            requireWorkflowRunOperation(harness, run.id, "start").state,
          ).toBe("completed");
          expect(
            requireWorkflowRunOperation(harness, run.id, "resume").state,
          ).toBe("completed");
          expect(requireWorkflowRun(harness, run.id).status).toBe("completed");
        }

        // Zero stranded state: every runner pid this soak ever recorded is
        // dead, every run dir's pid/heartbeat record is cleared, the manager
        // is at baseline, and no workflow command is left queued. The pid
        // record clears on child-exit handling, which trails the terminal
        // event by a beat — wait for the clearance, which itself proves the
        // child is down.
        for (const run of runs) {
          await waitUntil(
            async () =>
              (await readRecordedRunnerPid(harness, run.id)) === null,
            () => `Runner pid record for run ${run.id} was never cleared`,
            RECOVERY_TIMEOUT_MS,
          );
          expect(await hasRunnerHeartbeat(harness, run.id)).toBe(false);
        }
        expect(recordedRunnerPids.size).toBeGreaterThanOrEqual(RUN_COUNT);
        for (const pid of recordedRunnerPids) {
          expect(isProcessAlive(pid)).toBe(false);
        }
        expect(
          harness.daemonApp.workflowRunManager.countLiveProviderProcesses(),
        ).toBe(0);
        expect(
          await harness.daemonApp.workflowRunManager.listActiveWorkflowRunIds(),
        ).toEqual([]);
        // Settled operation rows persist by design; what must not remain is
        // undelivered workflow intent (a requested/queued operation) for
        // converged runs — the sweep would re-dispatch it against the
        // settled state.
        expect(
          listWorkflowRunOperations(harness.db, {
            states: [...activeLifecycleOperationStates],
          }),
        ).toEqual([]);
      }),
  );
});
