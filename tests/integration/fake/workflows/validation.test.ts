// M3 exit criterion (j): a meta containing an IIFE/computed expression is
// rejected 422 WITHOUT executing (a globalThis canary proves structural
// rejection), and inline-tier launch validation succeeds with the host
// offline — no vm, no host round-trip. The offline-created run then admits
// and completes for real once the daemon returns.

import { describe, expect, it } from "vitest";
import { waitForHostDisconnected } from "../../helpers/assertions.js";
import { createProjectFixture } from "../../helpers/fixtures.js";
import { withHarness } from "../../helpers/harness.js";
import { countStoredWorkflowRuns } from "../../helpers/queries.js";
import { scaleTimeoutMs } from "../../helpers/time.js";
import {
  ApiError,
  createIntegrationWorkflowRun,
  expectWorkflowStartHeldUndispatched,
  requestWorkflowRunStart,
  requireWorkflowRun,
  runWorkflowRunLifecycleSweep,
  validateWorkflowScriptSource,
  waitForWorkflowRunStatus,
  WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
  workflowServerDeps,
} from "../../helpers/workflow-runs.js";

const HOST_OFFLINE_TIMEOUT_MS = scaleTimeoutMs(15_000);

const CANARY_KEY = "__bb_integration_workflow_meta_canary__";

const IIFE_META_SOURCE = `export const meta = {
  name: (() => { globalThis.${CANARY_KEY} = true; return "evil"; })(),
  description: "computed meta that must never evaluate",
};

await agent("never runs");
`;

describe.sequential("workflow validation integration", () => {
  it(
    "rejects an IIFE meta 422 without executing and validates inline launches host-offline (exit criterion j)",
    { timeout: scaleTimeoutMs(120_000) },
    () =>
      withHarness(async (harness) => {
        const project = await createProjectFixture(harness, {
          name: "Workflow Offline Validation",
        });
        // The whole validation/launch path below runs with the host offline.
        await harness.shutdownDaemon("workflow-validation-offline");
        await waitForHostDisconnected(
          harness.api,
          harness.hostId,
          HOST_OFFLINE_TIMEOUT_MS,
        );

        // The IIFE writes to globalThis if it ever evaluates; the canary
        // proves the rejection is structural (pure-literal parse, no vm).
        const globalRecord = globalThis as Record<string, unknown>;
        delete globalRecord[CANARY_KEY];
        let validationError: unknown;
        try {
          validateWorkflowScriptSource(IIFE_META_SOURCE);
        } catch (error) {
          validationError = error;
        }
        if (!(validationError instanceof ApiError)) {
          throw new Error("Expected workflow validation to reject the IIFE meta");
        }
        expect(validationError.status).toBe(422);
        expect(validationError.body.code).toBe("workflow_validation_failed");
        expect(globalRecord[CANARY_KEY]).toBeUndefined();
        expect(countStoredWorkflowRuns(harness.db)).toBe(0);

        // Inline-tier launch validation needs no host: the run row persists
        // and the start operation holds in `requested` while offline.
        const deps = workflowServerDeps(harness);
        const run = createIntegrationWorkflowRun(harness, {
          projectId: project.id,
        });
        await requestWorkflowRunStart(deps, { runId: run.id });
        expectWorkflowStartHeldUndispatched(harness, run.id);
        expect(requireWorkflowRun(harness, run.id).status).toBe("created");

        // The daemon returns; the periodic sweep admits the held launch and
        // the run executes to completion for real.
        await harness.startDaemon();
        await runWorkflowRunLifecycleSweep(deps);
        const settled = await waitForWorkflowRunStatus(
          harness,
          run.id,
          "completed",
          WORKFLOW_RUN_SETTLE_TIMEOUT_MS,
        );
        expect(settled.resultJson).toContain("Response to:");
      }),
  );
});
