// M7 exit criterion (multi-run soak): 3 concurrent runs × 30 worktree agents
// push ~90 real git-worktree provisions and fake-provider processes through
// the daemon's provider-process token gate, asserting resource OUTCOMES:
//
// - peak Σ live workflow provider processes stays ≤ the worktree token cap
//   plus ≤1 shared-cwd process per shared-cwd-bearing run — the AS-BUILT M2
//   semantics (the token gate bounds worktree runtimes only; shared-cwd
//   processes are uncounted). Plan §6/§10 offered M7 a fork: wire admission
//   to the Σ accessor, or keep the gate and assert the re-worded bound. The
//   recorded M7 decision is the latter — `countLiveProviderProcesses` stays
//   observability-only, and this assertion IS the re-worded soak bound. The
//   peak is asserted BOTH from the daemon's own Σ accessor AND from
//   OS-level `ps` sampling of fake-provider child pids, so a disposal bug
//   that drops a runtime entry while its child process survives (corrupting
//   the self-reported count) cannot pass silently;
// - an over-cap launch (5th run against the 4-run host admission cap)
//   observably holds in the `requested` operation state with no command;
// - after every run settles, the daemon returns to baseline: zero live
//   provider processes (Σ accessor AND every OS-observed provider pid dead),
//   no active run ids, and no leaked git worktrees or `wf/*` branches in the
//   project repo (clean worktree teardown removed every checkout AND its
//   branch).

import { DEFAULTS } from "@bb/config/defaults";
import type { WorkflowRunResponse } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { createProjectFixture } from "../helpers/fixtures.js";
import { withHarness } from "../helpers/harness.js";
import { scaleTimeoutMs } from "../helpers/time.js";
import {
  launchPublicWorkflowRun,
  waitForPublicWorkflowRunTerminal,
} from "../helpers/workflow-public-api.js";
import {
  countWorkflowRunEventsOfType,
  expectWorkflowStartHeldUndispatched,
  listWorkflowRunEventRows,
  parseWorkflowRunEventRow,
  requireWorkflowRun,
  requireWorkflowRunOperation,
  runWorkflowRunLifecycleSweep,
  WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
  workflowServerDeps,
} from "../helpers/workflow-runs.js";
import {
  buildFanOutWorkflowSource,
  isProcessAlive,
  listGitWorktreePaths,
  listOsFakeProviderPids,
  listWorkflowWorktreeBranches,
  startOsProviderPidSampler,
  startProviderProcessSampler,
  waitUntil,
} from "./helpers.js";

const WORKTREE_RUN_COUNT = 3;
const WORKTREE_AGENT_COUNT = 30;
const AGENT_TURN_DELAY_MS = 500;
/** Long enough for the capacity-holder to bracket the over-cap assertions. */
const HOLDER_AGENT_DELAY_MS = 15_000;
/** 90 worktree provisions + provider spawns through an 8-token gate. */
const SOAK_SETTLE_TIMEOUT_MS = scaleTimeoutMs(240_000);

function parseRunResult(run: WorkflowRunResponse): unknown {
  if (run.resultJson === null) {
    throw new Error(`Expected a result on workflow run ${run.id}`);
  }
  return JSON.parse(run.resultJson);
}

describe.sequential("workflow multi-run worktree soak", () => {
  it(
    "bounds peak provider processes, holds over-cap launches, and returns the daemon to baseline (M7 exit criterion)",
    { timeout: scaleTimeoutMs(300_000) },
    () =>
      withHarness(async (harness) => {
        const project = await createProjectFixture(harness, {
          name: "Workflow Multi-Run Soak",
        });
        const deps = workflowServerDeps(harness);
        const runCap = deps.config.workflowMaxConcurrentRunsPerHost;
        const processCap = DEFAULTS.workflowMaxLiveProviderProcesses;

        const sampler = startProviderProcessSampler(harness);
        const osSampler = startOsProviderPidSampler();
        let peak = 0;
        let osObservedPids = new Set<number>();
        let osPeakConcurrent = 0;
        try {
          // Three 30-agent worktree fan-outs plus one shared-cwd holder fill
          // the host admission cap (4) exactly.
          const fanOutRuns: WorkflowRunResponse[] = [];
          for (let index = 0; index < WORKTREE_RUN_COUNT; index += 1) {
            fanOutRuns.push(
              await launchPublicWorkflowRun(harness.api, {
                projectId: project.id,
                source: {
                  type: "inline",
                  script: buildFanOutWorkflowSource({
                    agentCount: WORKTREE_AGENT_COUNT,
                    delayMs: AGENT_TURN_DELAY_MS,
                    name: `soak-worktree-${index + 1}`,
                    worktree: true,
                  }),
                },
              }),
            );
          }
          const holderRun = await launchPublicWorkflowRun(harness.api, {
            projectId: project.id,
            source: {
              type: "inline",
              script: buildFanOutWorkflowSource({
                agentCount: 1,
                delayMs: HOLDER_AGENT_DELAY_MS,
                name: "soak-capacity-holder",
                worktree: false,
              }),
            },
          });
          const capacityHolders = [...fanOutRuns, holderRun];
          expect(capacityHolders).toHaveLength(runCap);
          for (const run of capacityHolders) {
            expect(["starting", "running"]).toContain(
              requireWorkflowRun(harness, run.id).status,
            );
          }

          // The 5th launch is over-cap: held in `requested`, run `created`,
          // no command queued — the excess run observably waits.
          const heldRun = await launchPublicWorkflowRun(harness.api, {
            projectId: project.id,
            source: {
              type: "inline",
              script: buildFanOutWorkflowSource({
                agentCount: 1,
                delayMs: 0,
                name: "soak-held-run",
                worktree: false,
              }),
            },
          });
          expectWorkflowStartHeldUndispatched(harness, heldRun.id);
          expect(requireWorkflowRun(harness, heldRun.id).status).toBe(
            "created",
          );

          // The real daemon executes all four capacity holders to completion:
          // 90 worktree agents + 1 shared agent, every settlement non-null,
          // zero failed agents.
          for (const run of fanOutRuns) {
            const settled = await waitForPublicWorkflowRunTerminal(
              harness.api,
              run.id,
              SOAK_SETTLE_TIMEOUT_MS,
            );
            expect(settled.status).toBe("completed");
            // Surface any failed agent's error payload BEFORE the count
            // assertions — a worktree soak failure is only diagnosable from
            // the journaled agent/failed entries.
            const failedAgentEvents = listWorkflowRunEventRows(
              harness,
              run.id,
            )
              .filter((row) => row.type === "agent/failed")
              .map((row) => parseWorkflowRunEventRow(row));
            expect(failedAgentEvents).toEqual([]);
            expect(parseRunResult(settled)).toEqual({
              settled: WORKTREE_AGENT_COUNT,
            });
            expect(
              countWorkflowRunEventsOfType(harness, run.id, "agent/completed"),
            ).toBe(WORKTREE_AGENT_COUNT);
          }
          const settledHolder = await waitForPublicWorkflowRunTerminal(
            harness.api,
            holderRun.id,
            SOAK_SETTLE_TIMEOUT_MS,
          );
          expect(settledHolder.status).toBe("completed");

          // Capacity freed: the sweep admits the held run, which completes
          // with exactly one runner spawn across the whole hold/admit cycle
          // (a re-dispatched start would have produced a second run/started).
          await runWorkflowRunLifecycleSweep(deps);
          const settledHeld = await waitForPublicWorkflowRunTerminal(
            harness.api,
            heldRun.id,
            WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
          );
          expect(settledHeld.status).toBe("completed");
          expect(
            requireWorkflowRunOperation(harness, heldRun.id, "start").state,
          ).toBe("completed");
          expect(
            countWorkflowRunEventsOfType(harness, heldRun.id, "run/started"),
          ).toBe(1);
        } finally {
          peak = await sampler.stop();
          const osSample = await osSampler.stop();
          osObservedPids = osSample.observedPids;
          osPeakConcurrent = osSample.peakConcurrent;
          // Logged in the finally so the measurement survives an assertion
          // failure inside the soak body.
          console.info(
            `[soak multi-run] peak live workflow provider processes = ${peak} ` +
              `(os peak ${osPeakConcurrent}, os distinct pids ${osObservedPids.size}; ` +
              `worktree token cap ${processCap}, host run cap ${runCap})`,
          );
        }

        // The recorded M7 bound (as-built M2 semantics): the token gate
        // bounds WORKTREE provider processes at `processCap`; each
        // shared-cwd-bearing run may additionally hold ≤1 shared-cwd process
        // per provider (one provider in this soak). The allowance is derived
        // from the SCENARIO, not from runCap: only the holder run has any
        // shared-cwd agent — the three fan-outs are all-worktree — so the
        // honest maximum is processCap + 1 (= 9, the measured peak). An
        // admission regression leaking even one extra process at peak fails.
        const sharedCwdRunCount = 1;
        expect(peak).toBeLessThanOrEqual(processCap + sharedCwdRunCount);
        // Sampler sanity: an 8-token gate saturated by 90 agents for tens
        // of seconds must observably run multiple providers at once.
        expect(peak).toBeGreaterThanOrEqual(2);
        // OS-grounded companion bound: the daemon's Σ accessor reads its own
        // entries map, so it alone cannot catch a disposal bug that drops an
        // entry while the child process survives. The 250ms ps sampler can
        // only undercount a transient peak, so the cap bound stays valid; the
        // distinct-pid floor proves it genuinely observed the fleet (each
        // worktree agent spawns a dedicated provider process).
        expect(osPeakConcurrent).toBeLessThanOrEqual(
          processCap + sharedCwdRunCount,
        );
        expect(osPeakConcurrent).toBeGreaterThanOrEqual(2);
        expect(osObservedPids.size).toBeGreaterThanOrEqual(processCap);

        // Baseline: no live processes, no active runs, no leaked worktrees
        // or wf/* branches (every clean teardown removed checkout + branch).
        expect(
          harness.daemonApp.workflowRunManager.countLiveProviderProcesses(),
        ).toBe(0);
        expect(
          await harness.daemonApp.workflowRunManager.listActiveWorkflowRunIds(),
        ).toEqual([]);
        // OS-level baseline, mirroring the orphan soak's recorded-pid +
        // signal-0 probes: no fake-provider child of this process survives
        // and every provider pid ever observed is dead (provider shutdown is
        // async SIGTERM→exit→reap, so converge within a bounded window).
        await waitUntil(
          async () =>
            (await listOsFakeProviderPids()).length === 0 &&
            [...osObservedPids].every((pid) => !isProcessAlive(pid)),
          () => "fake-provider child processes survived run settlement",
          scaleTimeoutMs(15_000),
        );
        expect(await listGitWorktreePaths(harness.repoDir)).toHaveLength(1);
        expect(await listWorkflowWorktreeBranches(harness.repoDir)).toEqual(
          [],
        );
      }),
  );
});
