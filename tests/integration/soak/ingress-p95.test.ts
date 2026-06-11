// M7 exit criterion (ingress measurement): a 90-agent fake fan-out keeps the
// daemon-ingress p95 acceptable. The harness `daemonFetchFn` seam times every
// `POST /internal/session/workflow-run-events` batch round trip — route +
// the single per-batch ingestion transaction (producer-idempotent append,
// snapshot fold, throttled anchor append) — the only measurable end-to-end
// ingress latency (no daemon timestamp rides the wire; spool rows are
// deleted on settle). The measured p95 and this declared bar are recorded in
// docs/workflows-local-workflow-convergence.md §8, the venue the convergence
// memo reserved for them; the wire-free companion number comes from
// apps/server/test/workflows/workflow-run-ingestion.bench.ts.

import { describe, expect, it } from "vitest";
import {
  createProjectFixture,
  createReadyHostThread,
} from "../helpers/fixtures.js";
import { withHarness } from "../helpers/harness.js";
import { scaleTimeoutMs } from "../helpers/time.js";
import {
  launchPublicWorkflowRun,
  waitForPublicWorkflowRunTerminal,
} from "../helpers/workflow-public-api.js";
import { countWorkflowRunEventsOfType } from "../helpers/workflow-runs.js";
import {
  buildFanOutWorkflowSource,
  createIngressTimingFetch,
  percentile,
  sleep,
} from "./helpers.js";

const SETUP_TIMEOUT_MS = scaleTimeoutMs(15_000);
const FAN_OUT_AGENT_COUNT = 90;
const AGENT_TURN_DELAY_MS = 500;
/**
 * The declared regression bar (convergence memo §8): p95 of the ingestion
 * batch round trip during a 90-agent fan-out. Scaled with the suite's
 * timeout scale so slower CI hosts loosen proportionally; the measured
 * local-baseline numbers live in the memo. ~7x above the measured p95
 * (6–7.5ms): wide enough to absorb wire/scheduling noise, tight enough that
 * a regression to per-batch full-journal scans or per-event transactions —
 * plausibly tens of ms at 90-agent scale — fails rather than hiding under a
 * catastrophic-only bar. The wire-free micro-bench
 * (workflow-run-ingestion.bench.ts) remains the reference for sub-bar drift.
 */
const INGRESS_P95_BAR_MS = scaleTimeoutMs(50);
/**
 * With the spool's 100ms debounce / 500ms maxWait and immediate journal
 * flushes, a 90-agent run spread over several seconds must produce well more
 * than a handful of batches — fewer means the measurement hook is broken.
 */
const MIN_EXPECTED_INGRESS_BATCHES = 10;

describe.sequential("workflow ingress p95 soak", () => {
  it(
    "keeps daemon ingress p95 under the declared bar across a 90-agent fan-out (M7 exit criterion)",
    { timeout: scaleTimeoutMs(300_000) },
    async () => {
      const timing = createIngressTimingFetch();
      await withHarness(
        { daemonFetchFn: timing.fetchFn },
        async (harness) => {
          const project = await createProjectFixture(harness, {
            name: "Workflow Ingress Soak",
          });
          // Anchored so every batch exercises the production fold shape:
          // append + snapshot fold + throttled anchor progress appends.
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
              script: buildFanOutWorkflowSource({
                agentCount: FAN_OUT_AGENT_COUNT,
                delayMs: AGENT_TURN_DELAY_MS,
                name: "soak-ingress-fanout",
                worktree: false,
              }),
            },
          });
          const settled = await waitForPublicWorkflowRunTerminal(
            harness.api,
            run.id,
            scaleTimeoutMs(180_000),
          );
          expect(settled.status).toBe("completed");
          if (settled.resultJson === null) {
            throw new Error("Expected a run result");
          }
          expect(JSON.parse(settled.resultJson)).toEqual({
            settled: FAN_OUT_AGENT_COUNT,
          });
          expect(
            countWorkflowRunEventsOfType(harness, run.id, "agent/completed"),
          ).toBe(FAN_OUT_AGENT_COUNT);

          // Give the post-terminal spool drain a moment so trailing batches
          // are included in the sample, then judge the distribution.
          await sleep(1_000);
          const samples = timing.durationsMs;
          expect(samples.length).toBeGreaterThanOrEqual(
            MIN_EXPECTED_INGRESS_BATCHES,
          );
          const p50 = percentile(samples, 50);
          const p95 = percentile(samples, 95);
          const max = Math.max(...samples);
          console.info(
            `[soak ingress] batches=${samples.length} ` +
              `p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms ` +
              `max=${max.toFixed(1)}ms bar=${INGRESS_P95_BAR_MS}ms ` +
              `(${FAN_OUT_AGENT_COUNT} agents)`,
          );
          expect(p95).toBeLessThanOrEqual(INGRESS_P95_BAR_MS);
        },
      );
    },
  );
});
